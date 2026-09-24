from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from app.classify import rating_band
from app.labels import (
    eco_family_name,
    expected_score,
    format_pgn_date,
    hour_band,
    length_band,
    material_imbalance,
    opening_label,
    rating_diff_band,
    term_label,
    user_result,
)
from app.query import compile_query, parse_query, pieces_sql, user_result_sql
from app.store import Store


def _wilson(successes: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return 0.0, 1.0
    p = max(0.0, min(1.0, successes / n))
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return max(0.0, center - margin), min(1.0, center + margin)


def run_query(store: Store, text: str, default_tc: bool = False) -> dict[str, Any]:
    q = parse_query(text)
    settings = store.settings_json()
    depth = store.report_depth()
    sql, params, generated = compile_query(
        q,
        include_observed=settings["include_observed"],
        default_tc=("blitz", "rapid") if default_tc else (),
        report_depth=depth,
    )
    store.execute("DROP TABLE IF EXISTS _matched")
    store.execute(f"CREATE TEMP TABLE _matched AS {sql}", params)

    header = store.fetchone(
        """
        SELECT
          COUNT(DISTINCT m.game_id),
          COUNT(*),
          COUNT(DISTINCT CASE
            WHEN g.analysis_status = 'complete' AND (? IS NULL OR g.analysis_depth >= ?)
            THEN m.game_id END)
        FROM _matched m
        JOIN games g ON g.game_id = m.game_id
        """,
        (depth, depth),
    )
    games_n, plies_n, complete_n = (int(header[0] or 0), int(header[1] or 0), int(header[2] or 0))

    wdl = store.fetchone(
        f"""
        SELECT
          SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END),
          SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END),
          SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END)
        FROM (
          SELECT DISTINCT g.game_id, ({user_result_sql()}) AS r
          FROM _matched m
          JOIN games g ON g.game_id = m.game_id
        )
        """
    )
    wins, draws, losses = [int(x or 0) for x in wdl]
    n = wins + draws + losses
    score = (wins + 0.5 * draws) / n if n else None

    exp_row = store.fetchone(
        """
        SELECT AVG(
          CASE
            WHEN you_elo IS NULL OR opp_elo IS NULL THEN NULL
            ELSE 1.0 / (1.0 + pow(10, (opp_elo - you_elo) / 400.0))
          END
        )
        FROM (
          SELECT DISTINCT g.game_id,
            CASE WHEN g.you_color = 'white' THEN g.white_elo ELSE g.black_elo END AS you_elo,
            CASE WHEN g.you_color = 'white' THEN g.black_elo ELSE g.white_elo END AS opp_elo
          FROM _matched m
          JOIN games g ON g.game_id = m.game_id
          WHERE g.you_color IS NOT NULL
        )
        """
    )
    expected = float(exp_row[0]) if exp_row and exp_row[0] is not None else None
    performance = (score - expected) if score is not None and expected is not None else None

    ply_acc = store.fetchone(
        """
        SELECT AVG(e.accuracy)
        FROM _matched mm
        JOIN moves m ON m.game_id = mm.game_id AND m.ply = mm.ply
        JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply
        JOIN games g ON g.game_id = m.game_id
        WHERE e.accuracy IS NOT NULL
          AND g.analysis_status = 'complete'
          AND ((g.you_color = 'white' AND m.mover = 'white')
            OR (g.you_color = 'black' AND m.mover = 'black'))
        """
    )
    return {
        "query": q.raw,
        "sql": generated,
        "games": games_n,
        "plies": plies_n,
        "complete_at_depth": complete_n,
        "report_depth": depth,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "score": score,
        "expected": expected,
        "performance": performance,
        "accuracy_plies": ply_acc[0],
        "partial": complete_n < games_n and ply_acc[0] is not None,
        "accuracy_note": "Lichess formula (win% loss → accuracy). Only your moves in finished analyses.",
    }


def _you_elo_sql() -> str:
    return "CASE WHEN g.you_color = 'white' THEN g.white_elo ELSE g.black_elo END"


def _opp_elo_sql() -> str:
    return "CASE WHEN g.you_color = 'white' THEN g.black_elo ELSE g.white_elo END"


def games_table(store: Store, text: str, limit: int = 200, offset: int = 0) -> dict[str, Any]:
    summary = run_query(store, text)
    rows = store.fetchall(
        f"""
        SELECT g.game_id, g.utc_date, g.you_color,
               CASE WHEN g.you_color = 'white' THEN g.black ELSE g.white END AS opponent,
               {_you_elo_sql()} AS you_elo,
               {_opp_elo_sql()} AS opp_elo,
               g.tc_class, g.eco, g.eco_family, g.opening_name, g.result,
               g.analysis_status, g.accuracy, g.analysis_depth, g.site_id, g.ply_count,
               g.termination,
               (SELECT e.engine_version FROM evaluations e WHERE e.game_id = g.game_id LIMIT 1) AS eval_source
        FROM games g
        WHERE g.game_id IN (SELECT DISTINCT game_id FROM _matched)
        ORDER BY g.utc_date DESC NULLS LAST, g.utc_time DESC NULLS LAST
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    out_rows = []
    for r in rows:
        you_elo, opp_elo = r[4], r[5]
        diff = None
        if you_elo is not None and opp_elo is not None:
            diff = int(you_elo) - int(opp_elo)
        status = r[11]
        acc = r[12] if status == "complete" and r[12] is not None else None
        exp = expected_score(you_elo, opp_elo)
        term = r[16]
        out_rows.append(
            {
                "game_id": r[0],
                "date": r[1],
                "date_label": format_pgn_date(r[1]),
                "color": r[2],
                "opponent": r[3],
                "you_elo": you_elo,
                "opp_elo": opp_elo,
                "rating": opp_elo,
                "rating_diff": diff,
                "expected": exp,
                "tc_class": r[6],
                "eco": r[7],
                "opening": opening_label(r[9], r[7], r[8]),
                "result": r[10],
                "user_result": user_result(r[2], r[10]),
                "analysis_status": status,
                "accuracy": acc,
                "analysis_depth": r[13],
                "site_id": r[14],
                "ply_count": r[15],
                "termination": term,
                "termination_label": term_label(term),
                "eval_source": r[17],
            }
        )
    review_bits = _review_from_matched(store, limit=8)
    return {**summary, "rows": out_rows, "limit": limit, "offset": offset, "total": summary["games"], **review_bits}


def _pack_group(k, n, w, d, l, acc, *, n_unit: str, query: str | None = None, label: str | None = None) -> dict[str, Any]:
    n = int(n or 0)
    w, d, l = int(w or 0), int(d or 0), int(l or 0)
    return {
        "key": k,
        "label": label if label is not None else (str(k) if k is not None else "—"),
        "n": n,
        "n_unit": n_unit,
        "wins": w,
        "draws": d,
        "losses": l,
        "score": (w + 0.5 * d) / n if n else None,
        "accuracy": acc,
        "query": query,
    }


def _group(store: Store, select_key: str, extra_where: str = "1=1", n_unit: str = "games") -> list[dict[str, Any]]:
    rows = store.fetchall(
        f"""
        SELECT {select_key} AS k,
               COUNT(DISTINCT g.game_id) AS n,
               SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
               SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l,
               AVG(CASE WHEN g.analysis_status = 'complete' AND g.accuracy IS NOT NULL AND g.accuracy > 0 THEN g.accuracy END) AS acc
        FROM (
          SELECT DISTINCT g.game_id, g.you_color, g.result, g.accuracy, g.analysis_status,
                 g.tc_class, g.eco_family, g.opening_name, g.eco, g.user_castled, g.opp_castled, g.opposite_side,
                 g.white_elo, g.black_elo, g.utc_time, g.utc_date, g.ply_count, g.termination,
                 g.white, g.black,
                 ({user_result_sql()}) AS r
          FROM _matched m
          JOIN games g ON g.game_id = m.game_id
          WHERE {extra_where}
        ) g
        GROUP BY 1
        ORDER BY n DESC
        """
    )
    return [_pack_group(k, n, w, d, l, acc, n_unit=n_unit) for k, n, w, d, l, acc in rows if k is not None or n]


def _annotate_opening(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        key = row["key"]
        row["label"] = eco_family_name(key) if key else "Unknown"
        row["query"] = f"eco:{key}" if key else None
    return rows


def _python_groups(store: Store) -> dict[str, list[dict[str, Any]]]:
    rows = store.fetchall(
        f"""
        SELECT DISTINCT g.game_id, g.you_color, g.result, g.accuracy, g.analysis_status,
               g.white_elo, g.black_elo, g.utc_time, g.utc_date, g.ply_count,
               ({user_result_sql()}) AS r
        FROM _matched m
        JOIN games g ON g.game_id = m.game_id
        """
    )
    buckets: dict[str, dict[str, list]] = {
        "rating_diff": defaultdict(list),
        "time_of_day": defaultdict(list),
        "game_length": defaultdict(list),
        "session": defaultdict(list),
    }
    by_day: dict[str, list] = defaultdict(list)
    for rec in rows:
        game_id, you, result, acc, status, w_elo, b_elo, utc_time, utc_date, ply_count, r = rec
        you_elo = w_elo if you == "white" else b_elo if you == "black" else None
        opp_elo = b_elo if you == "white" else w_elo if you == "black" else None
        diff = None
        if you_elo is not None and opp_elo is not None:
            diff = int(you_elo) - int(opp_elo)
        item = {"r": r, "acc": acc if status == "complete" else None}
        rd = rating_diff_band(diff)
        if rd:
            buckets["rating_diff"][rd].append(item)
        tod = hour_band(utc_time)
        if tod:
            buckets["time_of_day"][tod].append(item)
        ln = length_band(ply_count)
        if ln:
            buckets["game_length"][ln].append(item)
        if utc_date:
            by_day[utc_date].append((utc_time or "", item))

    for _day, items in by_day.items():
        items.sort(key=lambda t: t[0])
        for i, (_t, item) in enumerate(items):
            if i == 0:
                buckets["session"]["first of the day"].append(item)
            elif i >= 4:
                buckets["session"]["5th or later"].append(item)
            else:
                buckets["session"][f"game {i + 1} of the day"].append(item)

    order = {
        "rating_diff": ["down 200+", "down 80–199", "even", "up 80–199", "up 200+"],
        "time_of_day": ["night (00–06)", "morning (06–12)", "afternoon (12–18)", "evening (18–24)"],
        "game_length": ["short (<20 moves)", "medium (20–39)", "long (40+)"],
        "session": ["first of the day", "game 2 of the day", "game 3 of the day", "game 4 of the day", "5th or later"],
    }
    queries = {
        "rating_diff": {
            "down 200+": "ratediff:down200",
            "down 80–199": "ratediff:down",
            "even": "ratediff:even",
            "up 80–199": "ratediff:up",
            "up 200+": "ratediff:up200",
        },
        "time_of_day": {
            "night (00–06)": "tod:night",
            "morning (06–12)": "tod:morning",
            "afternoon (12–18)": "tod:afternoon",
            "evening (18–24)": "tod:evening",
        },
        "game_length": {
            "short (<20 moves)": "length:short",
            "medium (20–39)": "length:medium",
            "long (40+)": "length:long",
        },
        "session": {},
    }
    out: dict[str, list[dict[str, Any]]] = {}
    for name, groups in buckets.items():
        packed = []
        for key in order[name]:
            items = groups.get(key) or []
            if not items:
                continue
            w = sum(1 for i in items if i["r"] == "win")
            d = sum(1 for i in items if i["r"] == "draw")
            l = sum(1 for i in items if i["r"] == "loss")
            accs = [i["acc"] for i in items if i["acc"] is not None]
            packed.append(
                _pack_group(
                    key,
                    len(items),
                    w,
                    d,
                    l,
                    sum(accs) / len(accs) if accs else None,
                    n_unit="games",
                    query=queries[name].get(key),
                    label=key,
                )
            )
        out[name] = packed
    return out


def _conversion(store: Store) -> list[dict[str, Any]]:
    rows = store.fetchall(
        f"""
        SELECT band, n, w, d, l FROM (
          SELECT
            CASE
              WHEN mx >= 70 THEN 'was winning'
              WHEN mn <= 30 THEN 'was losing'
              WHEN mx IS NULL THEN 'no eval'
              ELSE 'always balanced'
            END AS band,
            COUNT(*) AS n,
            SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
            SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
            SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
          FROM (
            SELECT g.game_id, ({user_result_sql()}) AS r,
                   MAX(s.entry_winpct) AS mx, MIN(s.entry_winpct) AS mn
            FROM games g
            JOIN (SELECT DISTINCT game_id FROM _matched) mm ON mm.game_id = g.game_id
            LEFT JOIN spans s ON s.game_id = g.game_id AND s.entry_winpct IS NOT NULL
            GROUP BY g.game_id, r
          )
          GROUP BY 1
        )
        """
    )
    order = ["was winning", "always balanced", "was losing"]
    by = {r[0]: r for r in rows}
    out = []
    for key in order:
        if key not in by:
            continue
        _, n, w, d, l = by[key]
        q = {"was winning": "entry:winning", "was losing": "entry:losing", "always balanced": "entry:balanced"}.get(key)
        out.append(_pack_group(key, n, w, d, l, None, n_unit="games", query=q, label=key))
    return out


def _time_trouble(store: Store) -> list[dict[str, Any]]:
    rows = store.fetchall(
        """
        SELECT
          CASE
            WHEN m.clock_centis IS NULL THEN 'no clock'
            WHEN m.clock_centis < 3000 THEN 'under 30s'
            ELSE '30s or more'
          END AS band,
          COUNT(*) AS plies,
          COUNT(DISTINCT m.game_id) AS games,
          AVG(e.accuracy) AS acc,
          SUM(CASE WHEN e.move_class = 'blunder' THEN 1 ELSE 0 END) AS blunders
        FROM _matched mm
        JOIN moves m ON m.game_id = mm.game_id AND m.ply = mm.ply
        JOIN games g ON g.game_id = m.game_id
        LEFT JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply
        WHERE g.analysis_status = 'complete'
          AND ((g.you_color = 'white' AND m.mover = 'white')
            OR (g.you_color = 'black' AND m.mover = 'black'))
        GROUP BY 1
        """
    )
    out = []
    for band, plies, games, acc, blunders in rows:
        if band == "no clock" and int(plies or 0) == 0:
            continue
        plies = int(plies or 0)
        blunders = int(blunders or 0)
        out.append(
            {
                "key": band,
                "label": band,
                "n": plies,
                "n_unit": "your moves",
                "wins": None,
                "draws": None,
                "losses": None,
                "score": None,
                "accuracy": acc,
                "blunders": blunders,
                "blunder_rate": (blunders / plies) if plies else None,
                "games": int(games or 0),
            }
        )
    return out


def insights(store: Store, text: str) -> dict[str, Any]:
    summary = run_query(store, text)
    phase_rows = store.fetchall(
        """
        SELECT mv.phase,
               COUNT(*) AS plies,
               COUNT(DISTINCT mm.game_id) AS n,
               AVG(CASE WHEN g.analysis_status = 'complete' THEN e.accuracy END) AS acc
        FROM _matched mm
        JOIN moves mv ON mv.game_id = mm.game_id AND mv.ply = mm.ply
        JOIN games g ON g.game_id = mm.game_id
        LEFT JOIN evaluations e ON e.game_id = mv.game_id AND e.ply = mv.ply
          AND ((g.you_color = 'white' AND mv.mover = 'white')
            OR (g.you_color = 'black' AND mv.mover = 'black'))
        GROUP BY 1
        """
    )
    materials = store.fetchall(
        """
        SELECT s.material_you,
               COUNT(DISTINCT s.game_id) AS n_games,
               COUNT(*) AS n_spans,
               SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
               SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
        FROM spans s
        JOIN games g ON g.game_id = s.game_id
        JOIN (SELECT DISTINCT game_id FROM _matched) mm ON mm.game_id = s.game_id
        JOIN (
          SELECT g.game_id, CASE
            WHEN g.you_color = 'white' AND g.result = '1-0' THEN 'win'
            WHEN g.you_color = 'black' AND g.result = '0-1' THEN 'win'
            WHEN g.result = '1/2-1/2' THEN 'draw'
            WHEN g.you_color IS NOT NULL AND g.result IN ('1-0', '0-1') THEN 'loss'
          END AS r
          FROM games g
        ) rr ON rr.game_id = s.game_id
        WHERE s.material_you IN (
          SELECT DISTINCT material_you FROM _matched m
          JOIN moves mv ON mv.game_id = m.game_id AND mv.ply = m.ply
        )
        GROUP BY 1
        HAVING n_games >= 1
        ORDER BY n_games DESC
        LIMIT 80
        """
    )
    imbalance: dict[str, dict[str, Any]] = {}
    for mat, n_games, n_spans, w, d, l in materials:
        label = material_imbalance(mat)
        slot = imbalance.setdefault(
            label,
            {
                "key": label,
                "label": label,
                "n": 0,
                "spans": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "signatures": 0,
                "_sig_counts": {},
            },
        )
        slot["n"] += int(n_games or 0)
        slot["spans"] += int(n_spans or 0)
        slot["wins"] += int(w or 0)
        slot["draws"] += int(d or 0)
        slot["losses"] += int(l or 0)
        slot["signatures"] += 1
        if mat:
            slot["_sig_counts"][mat] = slot["_sig_counts"].get(mat, 0) + int(n_games or 0)
    material_rows = []
    for slot in sorted(imbalance.values(), key=lambda s: s["n"], reverse=True)[:20]:
        n = slot["n"]
        sig_counts = slot.pop("_sig_counts")
        row = {
            **slot,
            "n_unit": "game-reaches (a game can appear in several rows)",
            "score": (slot["wins"] + 0.5 * slot["draws"]) / n if n else None,
            "accuracy": None,
        }
        query = _material_query(sig_counts)
        if query:
            row["query"] = query
        material_rows.append(row)

    extra = _python_groups(store)
    openings = _group(store, "COALESCE(g.opening_name, g.eco, 'Unknown')")
    for row in openings:
        row["label"] = row["key"]
        row["query"] = f'opening:"{row["key"]}"' if row["key"] and " " in str(row["key"]) else (f"opening:{row['key']}" if row["key"] else None)

    your_castle = _group(store, "COALESCE(g.user_castled, 'none')", "g.variant IN ('standard', 'chess')")
    for row in your_castle:
        row["label"] = {"short": "you castled short", "long": "you castled long", "none": "you did not castle"}.get(
            str(row["key"]), str(row["key"])
        )
        row["query"] = f"castled:{row['key']}"

    kings = _group(
        store,
        """CASE
              WHEN g.opposite_side THEN 'opposite-side'
              WHEN g.user_castled IS NOT NULL AND g.opp_castled IS NOT NULL THEN 'same-side'
              WHEN g.user_castled IS NOT NULL THEN 'you only'
              WHEN g.opp_castled IS NOT NULL THEN 'they only'
              ELSE 'neither'
            END""",
        "g.variant IN ('standard', 'chess')",
    )
    for row in kings:
        row["label"] = {
            "opposite-side": "opposite-side castling",
            "same-side": "same-side castling",
            "you only": "only you castled",
            "they only": "only they castled",
            "neither": "neither castled",
        }.get(str(row["key"]), str(row["key"]))
        if row["key"] == "opposite-side":
            row["query"] = "castled:opposite"
        elif row["key"] in ("short", "long", "none"):
            row["query"] = f"castled:{row['key']}"

    return {
        **summary,
        "groups": {
            "color": [{**r, "label": r["key"], "query": f"color:{r['key']}"} for r in _group(store, "g.you_color")],
            "time_class": [{**r, "label": r["key"], "query": f"tc:{r['key']}"} for r in _group(store, "g.tc_class")],
            "opening": openings,
            "eco_family": _annotate_opening(_group(store, "g.eco_family", "g.variant IN ('standard', 'chess')")),
            "your_castle": your_castle,
            "kings": kings,
            "rating_diff": extra["rating_diff"],
            "time_of_day": extra["time_of_day"],
            "game_length": extra["game_length"],
            "session": extra["session"],
            "conversion": _conversion(store),
            "time_trouble": _time_trouble(store),
            "termination": [
                {**r, "label": term_label(str(r["key"])), "query": f"term:{r['key']}"}
                for r in _group(store, "g.termination")
                if r["key"]
            ],
            "year": [
                {**r, "label": str(r["key"]), "query": f"year:{r['key']}"}
                for r in _group(store, "substr(replace(COALESCE(g.utc_date, ''), '.', '-'), 1, 4)")
                if r["key"]
            ],
            "opponent": [
                {**r, "label": str(r["key"]), "query": f'opponent:"{r["key"]}"' if " " in str(r["key"]) else f"opponent:{r['key']}"}
                for r in _group(store, "CASE WHEN g.you_color = 'white' THEN g.black ELSE g.white END")
                if r["key"]
            ][:20],
            "phase": [
                {
                    "key": r[0],
                    "label": r[0],
                    "plies": int(r[1] or 0),
                    "n": int(r[2] or 0),
                    "n_unit": "games that reached this phase",
                    "accuracy": r[3],
                    "query": f"phase:{r[0]}" if r[0] else None,
                }
                for r in phase_rows
                if r[0]
            ],
            "material": material_rows,
            "positions": _position_rows(store),
            "pieces": _piece_rows(store),
        },
    }


def _material_query(sig_counts: dict[str, int]) -> str | None:
    if not sig_counts:
        return None
    best_n = max(sig_counts.values())
    best = [sig for sig, n in sig_counts.items() if n == best_n]
    if len(best) != 1:
        return None
    return f"material:{best[0]}"


_PIECE_SLICES = (
    ("queens-off", "queens traded", "no=Q"),
    ("you-only-queen", "you have the only queen", "me=Q,opp=0Q"),
    ("they-only-queen", "they have the only queen", "opp=Q,me=0Q"),
    ("both-queens", "both queens on", "me=Q,opp=Q"),
    ("rook-endgame", "rook endgame", "no=QBN,me=R,opp=R"),
    ("minor-ending", "minor-piece ending", "no=QR"),
)


def _position_rows(store: Store) -> list[dict[str, Any]]:
    import chess

    from app.classify import fen_norm

    start = fen_norm(chess.Board())
    rows = store.fetchall(
        f"""
        SELECT m.fen_norm,
               MIN(m.ply) AS ply,
               COUNT(DISTINCT m.game_id) AS n,
               COUNT(DISTINCT CASE WHEN ({user_result_sql()}) = 'win' THEN m.game_id END) AS w,
               COUNT(DISTINCT CASE WHEN ({user_result_sql()}) = 'draw' THEN m.game_id END) AS d,
               COUNT(DISTINCT CASE WHEN ({user_result_sql()}) = 'loss' THEN m.game_id END) AS l
        FROM moves m
        JOIN (SELECT DISTINCT game_id FROM _matched) mm ON mm.game_id = m.game_id
        JOIN games g ON g.game_id = m.game_id
        WHERE m.fen_norm IS NOT NULL
          AND m.fen_norm <> ?
        GROUP BY m.fen_norm
        HAVING COUNT(DISTINCT m.game_id) >= 3
        ORDER BY n DESC, ply
        LIMIT 30
        """,
        (start,),
    )
    out = []
    for fen, ply, n, w, d, l in rows:
        n, w, d, l = int(n or 0), int(w or 0), int(d or 0), int(l or 0)
        side = "white" if len(str(fen).split()) > 1 and str(fen).split()[1] == "w" else "black"
        out.append(
            {
                "key": fen,
                "label": f"ply {int(ply)} · {side} to move",
                "n": n,
                "wins": w,
                "draws": d,
                "losses": l,
                "score": (w + 0.5 * d) / n if n else None,
                "query": f'fen:"{fen}"',
            }
        )
    return out


def _piece_rows(store: Store) -> list[dict[str, Any]]:
    selects = []
    for clause, _params in (pieces_sql(spec) for _key, _label, spec in _PIECE_SLICES):
        selects.append(f"COUNT(DISTINCT CASE WHEN {clause} THEN m.game_id END)")
        selects.append(
            f"COUNT(DISTINCT CASE WHEN {clause} AND ({user_result_sql()}) = 'win' THEN m.game_id END)"
        )
        selects.append(
            f"COUNT(DISTINCT CASE WHEN {clause} AND ({user_result_sql()}) = 'draw' THEN m.game_id END)"
        )
        selects.append(
            f"COUNT(DISTINCT CASE WHEN {clause} AND ({user_result_sql()}) = 'loss' THEN m.game_id END)"
        )
    row = store.fetchone(
        f"""
        SELECT {", ".join(selects)}
        FROM moves m
        JOIN (SELECT DISTINCT game_id FROM _matched) mm ON mm.game_id = m.game_id
        JOIN games g ON g.game_id = m.game_id
        """
    )
    if row is None:
        return []
    out = []
    for i, (key, label, spec) in enumerate(_PIECE_SLICES):
        n, w, d, l = [int(row[i * 4 + j] or 0) for j in range(4)]
        if n == 0:
            continue
        out.append(
            {
                "key": key,
                "label": label,
                "n": n,
                "wins": w,
                "draws": d,
                "losses": l,
                "score": (w + 0.5 * d) / n if n else None,
                "query": f"pieces:{spec}",
            }
        )
    return out


def _shrink_k(scores: list[float], global_score: float) -> float:
    if len(scores) < 3:
        return 40.0
    mean = sum(scores) / len(scores)
    var = sum((s - mean) ** 2 for s in scores) / (len(scores) - 1)
    p = min(0.95, max(0.05, global_score))
    k = p * (1 - p) / max(var, 1e-6)
    return min(200.0, max(5.0, k))


def _rank_slices(slices: list[dict[str, Any]], baseline: float, nmin: int) -> list[dict[str, Any]]:
    scores = [s["score"] for s in slices if s["n"] >= nmin and s["score"] is not None]
    k = _shrink_k(scores, baseline)
    ranked = []
    for s in slices:
        n = s["n"]
        raw = s["score"]
        if raw is None or n < nmin:
            continue
        shrunk = baseline + (n / (n + k)) * (raw - baseline)
        points = n * raw
        lo, hi = _wilson(points, n)
        gap = 100.0 * (baseline - shrunk)
        gap_lo = 100.0 * (baseline - hi)
        gap_hi = 100.0 * (baseline - lo)
        ranked.append(
            {
                **s,
                "score_raw": raw,
                "score_shrunk": shrunk,
                "extra_losses_per_100": gap,
                "interval": [gap_lo, gap_hi],
                "crosses_zero": gap_lo <= 0 <= gap_hi,
                "nmin": nmin,
                "below_nmin": False,
                "conservative": gap_lo,
            }
        )
    ranked.sort(key=lambda r: r["conservative"], reverse=True)
    return ranked


def _dedup_slices(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop collinear copies: same n/WDL, keep the more general slice."""
    kind_rank = {
        "opening": 0,
        "eco_family": 1,
        "color": 2,
        "time_class": 3,
        "your_castle": 4,
        "rating_diff": 5,
        "material": 9,
    }
    rows = sorted(rows, key=lambda r: (kind_rank.get(r.get("kind"), 5), -r.get("n", 0)))
    seen: set[tuple] = set()
    out = []
    for r in rows:
        sig = (r.get("n"), r.get("wins"), r.get("draws"), r.get("losses"), round(r.get("score") or 0, 6))
        if sig in seen:
            continue
        seen.add(sig)
        out.append(r)
    return out


def improve(store: Store, text: str, nmin: int = 30) -> dict[str, Any]:
    summary = run_query(store, text)
    analyzed = summary["complete_at_depth"]
    ready = analyzed >= nmin
    baseline = summary["score"] or 0.5
    groups = []
    if ready:
        for row in _group(store, "COALESCE(g.opening_name, g.eco_family, 'Unknown')"):
            if row["key"] is None:
                continue
            qkey = str(row["key"])
            groups.append(
                {
                    **row,
                    "slice": row["label"],
                    "kind": "opening",
                    "query": f'opening:"{qkey}"' if " " in qkey else f"opening:{qkey}",
                }
            )
        for row in _group(store, "g.you_color"):
            groups.append({**row, "slice": str(row["key"]), "kind": "color", "query": f"color:{row['key']}"})
        for row in _group(store, "g.tc_class"):
            groups.append({**row, "slice": str(row["key"]), "kind": "time_class", "query": f"tc:{row['key']}"})
        for row in _group(store, "COALESCE(g.user_castled, 'none')", "g.variant IN ('standard', 'chess')"):
            groups.append({**row, "slice": f"you {row['key']}", "kind": "your_castle", "query": f"castled:{row['key']}"})
        extra = _python_groups(store)
        for row in extra["rating_diff"]:
            groups.append({**row, "slice": row["label"], "kind": "rating_diff", "query": row.get("query")})
        mats = insights(store, text)["groups"]["material"]
        for row in mats:
            groups.append({**row, "slice": row["label"], "kind": "material"})
        groups = _dedup_slices(groups)

    vs_self = _rank_slices(groups, baseline, nmin) if ready else []
    significant = [r for r in vs_self if not r["crosses_zero"]]

    vs_peers = []
    if ready:
        cubes = _peer_rows(store, text)
        redone = [row for row in cubes if row.get("peer_score") is not None]
        for s in redone:
            n = s["n"]
            raw = s["score"]
            peer = s["peer_score"]
            if raw is None or n < nmin:
                continue
            k = 40.0
            shrunk = peer + (n / (n + k)) * (raw - peer)
            points = n * raw
            lo, hi = _wilson(points, n)
            gap = 100.0 * (peer - shrunk)
            gap_lo = 100.0 * (peer - hi)
            gap_hi = 100.0 * (peer - lo)
            vs_peers.append(
                {
                    **s,
                    "score_raw": raw,
                    "score_shrunk": shrunk,
                    "extra_losses_per_100": gap,
                    "interval": [gap_lo, gap_hi],
                    "crosses_zero": gap_lo <= 0 <= gap_hi,
                    "conservative": gap_lo,
                    "below_nmin": False,
                }
            )
        vs_peers.sort(key=lambda r: r["conservative"], reverse=True)

    return {
        **summary,
        "nmin": nmin,
        "ready": ready,
        "analyzed": analyzed,
        "needed": nmin,
        "vs_self": significant,
        "vs_self_all": vs_self,
        "vs_peers": [r for r in vs_peers if not r["crosses_zero"]],
        "note": "Extra losses per 100 games versus your overall score in this filter. Ranked by the lower end of the interval. Rows that could still be zero are hidden.",
    }


def _review_from_matched(store: Store, limit: int = 8) -> dict[str, Any]:
    losses = store.fetchall(
        f"""
        SELECT g.game_id, g.utc_date, g.you_color,
               CASE WHEN g.you_color = 'white' THEN g.black ELSE g.white END,
               {_opp_elo_sql()},
               g.tc_class, g.opening_name, g.eco, g.analysis_status, g.accuracy, g.site_id,
               g.termination
        FROM games g
        WHERE g.game_id IN (SELECT DISTINCT game_id FROM _matched)
          AND ({user_result_sql()}) = 'loss'
        ORDER BY g.utc_date DESC NULLS LAST, g.utc_time DESC NULLS LAST
        LIMIT ?
        """,
        (limit,),
    )
    items = []
    for row in losses:
        gid = row[0]
        turns = store.fetchall(
            """
            SELECT m.ply, m.san, e.move_class, e.winpct_loss, e.accuracy, m.clock_centis, m.phase
            FROM moves m
            JOIN games g ON g.game_id = m.game_id
            JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply
            WHERE m.game_id = ?
              AND ((g.you_color = 'white' AND m.mover = 'white')
                OR (g.you_color = 'black' AND m.mover = 'black'))
              AND e.winpct_loss IS NOT NULL
              AND e.move_class IN ('inaccuracy', 'mistake', 'blunder')
            ORDER BY e.winpct_loss DESC
            LIMIT 3
            """,
            (gid,),
        )
        items.append(
            {
                "game_id": gid,
                "date_label": format_pgn_date(row[1]),
                "color": row[2],
                "opponent": row[3],
                "opp_elo": row[4],
                "tc_class": row[5],
                "opening": opening_label(row[6], row[7], None),
                "analysis_status": row[8],
                "accuracy": row[9] if row[8] == "complete" else None,
                "site_id": row[10],
                "termination": row[11],
                "termination_label": term_label(row[11]),
                "turning_points": [
                    {
                        "ply": t[0],
                        "san": t[1],
                        "move_class": t[2],
                        "winpct_loss": t[3],
                        "accuracy": t[4],
                        "clock": t[5],
                        "phase": t[6],
                    }
                    for t in turns
                ],
            }
        )
    unanalyzed = store.fetchone(
        """
        SELECT COUNT(DISTINCT g.game_id)
        FROM games g
        WHERE g.game_id IN (SELECT DISTINCT game_id FROM _matched)
          AND g.you_color IS NOT NULL
          AND g.analysis_status <> 'complete'
        """
    )
    return {
        "recent_losses": items,
        "unanalyzed": int(unanalyzed[0] or 0),
    }


def review(store: Store, text: str, limit: int = 8) -> dict[str, Any]:
    """Tuesday-night loop: recent losses and the moves that swung them."""
    summary = run_query(store, text)
    return {**summary, **_review_from_matched(store, limit=limit)}


def _peer_rows(store: Store, text: str) -> list[dict[str, Any]]:
    from app.paths import POP_RESULTS

    if not POP_RESULTS.exists():
        return []
    try:
        store.execute(f"CREATE OR REPLACE TEMP VIEW pop_results AS SELECT * FROM '{POP_RESULTS}'")
    except Exception:
        return []
    rows = store.fetchall(
        f"""
        SELECT g.eco_family, g.tc_class,
               CASE WHEN g.you_color = 'white' THEN g.white_elo ELSE g.black_elo END,
               CASE WHEN g.you_color = 'white' THEN g.black_elo ELSE g.white_elo END,
               ({user_result_sql()}) AS r
        FROM games g
        WHERE g.game_id IN (SELECT DISTINCT game_id FROM _matched)
          AND g.you_color IS NOT NULL
        """
    )
    buckets: dict[tuple, list] = defaultdict(list)
    for eco, tc, my_elo, opp_elo, r in rows:
        band = rating_band(int(my_elo) if my_elo is not None else None)
        opp_band = rating_band(int(opp_elo) if opp_elo is not None else None)
        if not band or not eco:
            continue
        buckets[(eco, tc, band, opp_band)].append(r)
    out = []
    for (eco, tc, band, opp_band), rs in buckets.items():
        n = len(rs)
        w = sum(1 for r in rs if r == "win")
        d = sum(1 for r in rs if r == "draw")
        l = sum(1 for r in rs if r == "loss")
        score = (w + 0.5 * d) / n if n else None
        peer = store.fetchone(
            """
            SELECT n, wins, draws, losses FROM pop_results
            WHERE eco_family = ? AND tc_class = ? AND rating_band = ?
              AND (opp_rating_band = ? OR opp_rating_band IS NULL)
            ORDER BY CASE WHEN opp_rating_band = ? THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (eco, tc, band, opp_band, opp_band),
        )
        if peer is None:
            continue
        pn, pw, pd, pl = peer
        pn = int(pn or 0)
        if pn <= 0:
            continue
        peer_score = (int(pw or 0) + 0.5 * int(pd or 0)) / pn
        out.append(
            {
                "key": eco,
                "slice": eco_family_name(eco),
                "kind": "eco_family",
                "n": n,
                "wins": w,
                "draws": d,
                "losses": l,
                "score": score,
                "peer_score": peer_score,
                "peer_n": pn,
                "rating_band": band,
                "opp_rating_band": opp_band,
                "fallback": opp_band is None,
            }
        )
    return out


def explorer(store: Store, fens: list[str] | None = None, uci_prefix: list[str] | None = None) -> dict[str, Any]:
    import chess

    board = chess.Board()
    prefix = list(uci_prefix or [])
    for uci in prefix:
        board.push_uci(uci)
    from app.classify import fen_norm

    fen = fen_norm(board)
    result_join = """
        JOIN (
          SELECT game_id,
            CASE
              WHEN you_color = 'white' AND result = '1-0' THEN 'win'
              WHEN you_color = 'black' AND result = '0-1' THEN 'win'
              WHEN result = '1/2-1/2' THEN 'draw'
              WHEN you_color IS NOT NULL AND result IN ('1-0', '0-1') THEN 'loss'
            END AS r
          FROM games
        ) rr ON rr.game_id = m.game_id
    """
    if not prefix:
        rows = store.fetchall(
            f"""
            SELECT m.san, m.uci,
                   COUNT(*) AS n,
                   SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
                   SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
                   SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
            FROM moves m
            JOIN games g ON g.game_id = m.game_id
            {result_join}
            WHERE m.ply = 1
              AND g.variant IN ('standard', 'chess')
              AND g.you_color IS NOT NULL
            GROUP BY 1, 2
            ORDER BY n DESC
            """
        )
    else:
        rows = store.fetchall(
            f"""
            SELECT m2.san, m2.uci,
                   COUNT(*) AS n,
                   SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
                   SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
                   SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
            FROM moves m
            JOIN moves m2 ON m2.game_id = m.game_id AND m2.ply = m.ply + 1
            JOIN games g ON g.game_id = m.game_id
            {result_join}
            WHERE m.fen_norm = ?
              AND g.variant IN ('standard', 'chess')
              AND g.you_color IS NOT NULL
            GROUP BY 1, 2
            ORDER BY n DESC
            """,
            (fen,),
        )
    moves = []
    for san, uci, n, w, d, l in rows:
        n = int(n)
        moves.append(
            {
                "san": san,
                "uci": uci,
                "n": n,
                "wins": int(w or 0),
                "draws": int(d or 0),
                "losses": int(l or 0),
                "score": (int(w or 0) + 0.5 * int(d or 0)) / n if n else None,
            }
        )
    return {
        "fen": board.fen(),
        "fen_norm": fen,
        "moves": moves,
        "peer_note": "no peer data below this depth" if not _pop_openings_available() else None,
    }


def _pop_openings_available() -> bool:
    from app.paths import POP_OPENINGS

    return POP_OPENINGS.exists()
