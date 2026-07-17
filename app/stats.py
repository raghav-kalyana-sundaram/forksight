from __future__ import annotations

import math
from typing import Any

from app.classify import rating_band
from app.query import Query, compile_query, parse_query, user_result_sql
from app.store import Store


def _wilson(successes: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return 0.0, 1.0
    p = max(0.0, min(1.0, successes / n))
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return max(0.0, center - margin), min(1.0, center + margin)


def run_query(store: Store, text: str, default_tc: bool = True) -> dict[str, Any]:
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

    ply_acc = store.fetchone(
        """
        SELECT AVG(e.accuracy)
        FROM _matched mm
        JOIN moves m ON m.game_id = mm.game_id AND m.ply = mm.ply
        JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply
        JOIN games g ON g.game_id = m.game_id
        WHERE e.accuracy IS NOT NULL
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
        "accuracy_plies": ply_acc[0],
        "partial": complete_n < games_n and ply_acc[0] is not None,
    }


def games_table(store: Store, text: str, limit: int = 200, offset: int = 0) -> dict[str, Any]:
    summary = run_query(store, text)
    rows = store.fetchall(
        f"""
        SELECT g.game_id, g.utc_date, g.you_color,
               CASE WHEN g.you_color = 'white' THEN g.black ELSE g.white END AS opponent,
               CASE WHEN g.you_color = 'white' THEN g.white_elo ELSE g.black_elo END AS rating,
               g.tc_class, g.eco, g.opening_name, g.result, g.analysis_status, g.accuracy, g.analysis_depth
        FROM games g
        WHERE g.game_id IN (SELECT DISTINCT game_id FROM _matched)
        ORDER BY g.utc_date DESC NULLS LAST
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    return {
        **summary,
        "rows": [
            {
                "game_id": r[0],
                "date": r[1],
                "color": r[2],
                "opponent": r[3],
                "rating": r[4],
                "tc_class": r[5],
                "eco": r[6],
                "opening": r[7],
                "result": r[8],
                "analysis_status": r[9],
                "accuracy": r[10],
                "analysis_depth": r[11],
            }
            for r in rows
        ],
    }


def _group(store: Store, select_key: str, extra_where: str = "1=1") -> list[dict[str, Any]]:
    rows = store.fetchall(
        f"""
        SELECT {select_key} AS k,
               COUNT(DISTINCT g.game_id) AS n,
               SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
               SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l,
               AVG(CASE WHEN g.analysis_status = 'complete' THEN g.accuracy END) AS acc
        FROM (
          SELECT DISTINCT g.game_id, g.you_color, g.result, g.accuracy, g.analysis_status,
                 g.tc_class, g.eco_family, g.user_castled, g.opposite_side,
                 ({user_result_sql()}) AS r
          FROM _matched m
          JOIN games g ON g.game_id = m.game_id
          WHERE {extra_where}
        ) g
        GROUP BY 1
        ORDER BY n DESC
        """
    )
    out = []
    for k, n, w, d, l, acc in rows:
        n = int(n or 0)
        w, d, l = int(w or 0), int(d or 0), int(l or 0)
        out.append(
            {
                "key": k,
                "n": n,
                "wins": w,
                "draws": d,
                "losses": l,
                "score": (w + 0.5 * d) / n if n else None,
                "accuracy": acc,
            }
        )
    return out


def insights(store: Store, text: str) -> dict[str, Any]:
    summary = run_query(store, text)
    phase_rows = store.fetchall(
        f"""
        SELECT mv.phase,
               COUNT(*) AS plies,
               COUNT(DISTINCT mm.game_id) AS n,
               AVG(e.accuracy) AS acc
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
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l,
               AVG(s.entry_winpct) AS entry_avg
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
        WHERE s.material_you IN (SELECT DISTINCT material_you FROM _matched m JOIN moves mv ON mv.game_id = m.game_id AND mv.ply = m.ply)
        GROUP BY 1
        HAVING n_games >= 1
        ORDER BY n_games DESC
        LIMIT 40
        """
    )
    bands = store.fetchall(
        """
        SELECT s.material_you,
               CASE
                 WHEN s.entry_winpct IS NULL THEN 'unknown'
                 WHEN s.entry_winpct >= 70 THEN 'winning'
                 WHEN s.entry_winpct <= 30 THEN 'losing'
                 ELSE 'balanced'
               END AS band,
               COUNT(DISTINCT s.game_id) AS n,
               SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
               SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
        FROM spans s
        JOIN games g ON g.game_id = s.game_id
        JOIN (SELECT DISTINCT game_id FROM _matched) mm ON mm.game_id = s.game_id
        JOIN (
          SELECT game_id,
            CASE
              WHEN you_color = 'white' AND result = '1-0' THEN 'win'
              WHEN you_color = 'black' AND result = '0-1' THEN 'win'
              WHEN result = '1/2-1/2' THEN 'draw'
              WHEN you_color IS NOT NULL AND result IN ('1-0', '0-1') THEN 'loss'
            END AS r
          FROM games
        ) rr ON rr.game_id = s.game_id
        GROUP BY 1, 2
        """
    )
    band_map: dict[str, list] = {}
    for mat, band, n, w, d, l in bands:
        n = int(n or 0)
        band_map.setdefault(mat, []).append(
            {
                "band": band,
                "n": n,
                "wins": int(w or 0),
                "draws": int(d or 0),
                "losses": int(l or 0),
                "score": (int(w or 0) + 0.5 * int(d or 0)) / n if n else None,
            }
        )
    material_rows = []
    for mat, n_games, n_spans, w, d, l, entry_avg in materials:
        n = int(n_games or 0)
        material_rows.append(
            {
                "key": mat,
                "n": n,
                "spans": int(n_spans or 0),
                "wins": int(w or 0),
                "draws": int(d or 0),
                "losses": int(l or 0),
                "score": (int(w or 0) + 0.5 * int(d or 0)) / n if n else None,
                "entry_avg": entry_avg,
                "bands": band_map.get(mat, []),
            }
        )
    return {
        **summary,
        "groups": {
            "color": _group(store, "g.you_color"),
            "time_class": _group(store, "g.tc_class"),
            "eco_family": _group(store, "g.eco_family", "g.variant IN ('standard', 'chess')"),
            "castling": _group(
                store,
                "CASE WHEN g.opposite_side THEN 'opposite' ELSE COALESCE(g.user_castled, 'none') END",
                "g.variant IN ('standard', 'chess')",
            ),
            "phase": [
                {"key": r[0], "plies": int(r[1] or 0), "n": int(r[2] or 0), "accuracy": r[3]}
                for r in phase_rows
            ],
            "material": material_rows,
        },
    }


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
        if raw is None or n <= 0:
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
                "below_nmin": n < nmin,
                "conservative": gap_lo,
            }
        )
    ranked.sort(key=lambda r: r["conservative"], reverse=True)
    return ranked


def improve(store: Store, text: str, nmin: int = 30) -> dict[str, Any]:
    summary = run_query(store, text)
    baseline = summary["score"] or 0.5
    groups = []
    for key_sql, label in (
        ("g.eco_family", "eco_family"),
        ("g.you_color", "color"),
        ("g.tc_class", "time_class"),
        ("COALESCE(g.user_castled, 'none')", "castling"),
    ):
        for row in _group(store, key_sql):
            if row["key"] is None:
                continue
            groups.append({**row, "slice": f"{label}:{row['key']}", "kind": label})
    mats = insights(store, text)["groups"]["material"]
    for row in mats:
        groups.append({**row, "slice": f"material:{row['key']}", "kind": "material"})

    vs_self = _rank_slices(groups, baseline, nmin)

    vs_peers = []
    cubes = _peer_rows(store, text)
    if cubes:
        vs_peers = _rank_slices(cubes, 0.0, nmin)  # baseline replaced below
        # re-rank against peer baseline stored on each row
        redone = []
        for row in cubes:
            peer = row.get("peer_score")
            if peer is None:
                continue
            redone.append(row)
        vs_peers = []
        for s in redone:
            n = s["n"]
            raw = s["score"]
            peer = s["peer_score"]
            if raw is None or n <= 0:
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
                    "below_nmin": n < nmin,
                }
            )
        vs_peers.sort(key=lambda r: r["conservative"], reverse=True)

    acc_slices = []
    for row in _group(store, "g.eco_family"):
        if row["accuracy"] is not None:
            acc_slices.append({**row, "slice": f"eco_family:{row['key']}", "score": row["accuracy"] / 100.0})
    acc_baseline = summary.get("accuracy_plies")
    acc_lists = []
    if acc_baseline is not None:
        acc_lists = _rank_slices(
            [{**s, "score": s["score"]} for s in acc_slices],
            acc_baseline / 100.0,
            nmin,
        )

    return {
        **summary,
        "nmin": nmin,
        "vs_self": vs_self,
        "vs_peers": vs_peers,
        "accuracy_gaps": acc_lists,
        "note": "Descriptive, not causal. A rook-ending gap may be position selection; see entry bands.",
    }


def _peer_rows(store: Store, text: str) -> list[dict[str, Any]]:
    from pathlib import Path

    from app.paths import POP_ENDGAMES, POP_RESULTS

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
    # Aggregate in Python — cube is small.
    from collections import defaultdict

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
        fallback = False
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
                "slice": f"eco_family:{eco}",
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
    for uci in uci_prefix or []:
        board.push_uci(uci)
    prefix_hash = None
    try:
        from app.classify import position_hash_bytes

        h = position_hash_bytes(board)
    except Exception:
        h = None
    # Walk user's own tree from this position via move uci sequences stored as SAN... 
    # Use fen_norm of current board and look at next moves.
    from app.classify import fen_norm

    fen = fen_norm(board)
    rows = store.fetchall(
        """
        SELECT m2.san, m2.uci,
               COUNT(*) AS n,
               SUM(CASE WHEN r = 'win' THEN 1 ELSE 0 END) AS w,
               SUM(CASE WHEN r = 'draw' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN r = 'loss' THEN 1 ELSE 0 END) AS l
        FROM moves m
        JOIN moves m2 ON m2.game_id = m.game_id AND m2.ply = m.ply + 1
        JOIN games g ON g.game_id = m.game_id
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
    return {"fen": board.fen(), "fen_norm": fen, "moves": moves, "peer_note": "no peer data below this depth" if not _pop_openings_available() else None}


def _pop_openings_available() -> bool:
    from app.paths import POP_OPENINGS

    return POP_OPENINGS.exists()
