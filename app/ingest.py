from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field

import chess
import chess.pgn

from app import accuracy, classify, divider, openings
from app.pgn_eval import best_from_comment, eval_from_comment, score_comment_evals
from app.store import Store
from app.versions import ACCURACY_VERSION, CLASSIFICATION_VERSION, DIVIDER_VERSION


@dataclass
class ImportReport:
    inserted: int = 0
    replaced: int = 0
    duplicates: int = 0
    dropped_unparseable: int = 0
    dropped_aborted: int = 0
    dropped_incomplete: int = 0
    files: int = 0
    personal: int = 0
    observed: int = 0
    with_evals: int = 0
    names: list[str] = field(default_factory=list)


@dataclass
class GameIngest:
    status: str
    you_color: str | None = None
    white: str = ""
    black: str = ""
    with_evals: bool = False


def _clock_centis(node: chess.pgn.GameNode) -> int | None:
    comment = node.comment or ""
    # [%clk 0:01:23] or [%clk 0:01:23.4]
    import re

    m = re.search(r"\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]", comment)
    if not m:
        return None
    h, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return int(round((h * 3600 + mi * 60 + sec) * 100))


def _collect_pgn_texts(files: list[tuple[str, bytes]]) -> list[str]:
    texts: list[str] = []
    for name, data in files:
        lower = name.lower()
        if lower.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    if info.filename.lower().endswith(".pgn"):
                        texts.append(zf.read(info).decode("utf-8", errors="replace"))
        else:
            texts.append(data.decode("utf-8", errors="replace"))
    return texts


def ingest_files(store: Store, files: list[tuple[str, bytes]], aliases: list[str] | None = None) -> ImportReport:
    aliases = aliases if aliases is not None else json_aliases(store)
    report = ImportReport(files=len(files))
    openings.position_index()
    for text in _collect_pgn_texts(files):
        handle = io.StringIO(text)
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            out = ingest_game(store, game, aliases)
            setattr(report, out.status, getattr(report, out.status) + 1)
            if out.with_evals:
                report.with_evals += 1
            if out.status in ("inserted", "replaced"):
                if out.you_color:
                    report.personal += 1
                else:
                    report.observed += 1
                    for name in (out.white, out.black):
                        if name and name not in report.names:
                            report.names.append(name)
    if not aliases:
        guessed = _guess_alias(store)
        if guessed:
            store.save_settings({"aliases": [guessed]})
            apply_aliases(store, [guessed])
            report.personal = int(
                (store.fetchone("SELECT COUNT(*) FROM games WHERE you_color IS NOT NULL") or [0])[0] or 0
            )
            report.observed = int(
                (store.fetchone("SELECT COUNT(*) FROM games WHERE you_color IS NULL") or [0])[0] or 0
            )
            report.names = []
    return report


def _guess_alias(store: Store) -> str | None:
    rows = store.fetchall("SELECT white, black FROM games")
    counts: dict[str, int] = {}
    for white, black in rows:
        for name in (white, black):
            if name:
                counts[name] = counts.get(name, 0) + 1
    if not counts:
        return None
    name, n = max(counts.items(), key=lambda kv: kv[1])
    if n >= max(3, len(rows) // 3):
        return name
    return None


def json_aliases(store: Store) -> list[str]:
    import json

    return json.loads(store.setting("aliases", "[]") or "[]")


def ingest_game(store: Store, game: chess.pgn.Game, aliases: list[str]) -> GameIngest:
    headers = game.headers
    board = game.board()
    if game.errors:
        return GameIngest("dropped_unparseable")

    moves_out: list[tuple] = []
    sans: list[str] = []
    board_keys: list[str] = []
    boards: list[chess.Board] = [board.copy(stack=False)]
    clocks_found = False
    node = game
    ply = 0
    user_castled = opp_castled = None
    user_castle_ply = None
    you = classify.you_color(headers.get("White", ""), headers.get("Black", ""), aliases)

    while node.variations:
        node = node.variations[0]
        move = node.move
        if move is None:
            break
        san = board.san(move)
        castle = classify.castle_kind(move, board)
        board.push(move)
        ply += 1
        sans.append(san)
        boards.append(board.copy(stack=False))
        board_keys.append(" ".join(board.fen().split()[:4]))
        clock = _clock_centis(node)
        if clock is not None:
            clocks_found = True
        mover = "black" if ply % 2 == 0 else "white"
        if castle:
            if you == mover:
                user_castled = castle
                user_castle_ply = ply
            elif you:
                opp_castled = castle
        wb = classify.material_wb(board)
        white_c, black_c = classify.piece_counts(board)
        moves_out.append(
            {
                "ply": ply,
                "san": san,
                "uci": move.uci(),
                "fen": board.fen(),
                "fen_norm": classify.fen_norm(board),
                "position_hash": classify.position_hash_bytes(board),
                "mover": mover,
                "clock_centis": clock,
                "material_wb": wb,
                "material_you": classify.material_you(wb, you),
                "counts": white_c + black_c,
                "piece_count": chess.popcount(board.occupied),
                "halfmove": board.halfmove_clock,
                "is_castling": castle,
                "eval_cp": eval_from_comment(node.comment),
                "best": best_from_comment(node.comment),
            }
        )

    if ply == 0:
        return GameIngest("dropped_aborted")

    variant = (headers.get("Variant") or "standard").strip()
    tc = classify.parse_time_control(headers.get("TimeControl"))
    site_id = classify.parse_site_id(headers.get("Site"), headers.get("Link"), headers.get("GameId"))
    utc_date = headers.get("UTCDate") or headers.get("Date") or ""
    result = headers.get("Result", "*")
    fp = classify.fingerprint(site_id, headers.get("White", ""), headers.get("Black", ""), utc_date, result, " ".join(sans))

    incoming_evals = any(m.get("eval_cp") is not None for m in moves_out)
    existing = store.fetchone(
        "SELECT has_clocks, analysis_status, termination FROM games WHERE fingerprint = ?",
        (fp,),
    )
    if existing:
        has_clocks, analysis_status, termination = existing
        stale = (
            (not has_clocks and clocks_found)
            or (incoming_evals and analysis_status != "complete")
            or (not termination and headers.get("Termination"))
        )
        if not stale:
            return GameIngest(
                "duplicates",
                you,
                headers.get("White", ""),
                headers.get("Black", ""),
                incoming_evals,
            )
        replace = True
    else:
        replace = False

    div = divider.divide(boards)
    eco, family, opening_name, book_depth = openings.classify_opening(board_keys, variant)
    opposite = bool(user_castled and opp_castled and user_castled != opp_castled)

    for row in moves_out:
        row["phase"] = div.phase_for_ply(row["ply"])
        row["is_book"] = row["ply"] <= book_depth and bool(eco)

    game_row = {
        "game_id": fp,
        "site_id": site_id,
        "fingerprint": fp,
        "white": headers.get("White", ""),
        "black": headers.get("Black", ""),
        "you_color": you,
        "result": result,
        "utc_date": utc_date,
        "utc_time": headers.get("UTCTime"),
        "time_control": tc.raw,
        "time_base": tc.base,
        "time_inc": tc.increment,
        "time_estimate": tc.estimate,
        "tc_class": tc.tc_class,
        "variant": variant.lower(),
        "white_elo": classify.parse_elo(headers.get("WhiteElo")),
        "black_elo": classify.parse_elo(headers.get("BlackElo")),
        "eco": eco,
        "eco_family": family,
        "opening_name": headers.get("Opening") or opening_name,
        "termination": _termination(headers.get("Termination"), sans[-1] if sans else None),
        "book_depth": book_depth,
        "ply_count": ply,
        "opening_end_ply": div.middle,
        "endgame_start_ply": div.end,
        "user_castled": user_castled,
        "opp_castled": opp_castled,
        "opposite_side": opposite,
        "user_castle_ply": user_castle_ply,
        "has_clocks": clocks_found,
        "analysis_status": "none",
        "classification_version": CLASSIFICATION_VERSION,
        "divider_version": DIVIDER_VERSION,
        "pgn": str(game),
    }
    action = store.upsert_game(game_row, replace=replace)
    move_tuples = [
        (
            fp,
            m["ply"],
            m["san"],
            m["uci"],
            m["fen"],
            m["fen_norm"],
            m["position_hash"],
            m["mover"],
            m["clock_centis"],
            m["material_wb"],
            m["material_you"],
            *m["counts"],
            m["phase"],
            m["piece_count"],
            m["halfmove"],
            m["is_castling"],
            m["is_book"],
        )
        for m in moves_out
    ]
    store.executemany(
        """
        INSERT INTO moves (
            game_id, ply, san, uci, fen, fen_norm, position_hash, mover, clock_centis,
            material_wb, material_you, q_w, r_w, b_w, n_w, p_w, q_b, r_b, b_b, n_b, p_b,
            phase, piece_count, halfmove, is_castling, is_book
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        move_tuples,
    )
    _insert_spans(store, fp, moves_out)
    _apply_pgn_evals(store, fp, moves_out, you)
    status = "replaced" if action == "replaced" else "inserted"
    return GameIngest(status, you, headers.get("White", ""), headers.get("Black", ""), incoming_evals)


def _termination(raw: str | None, last_san: str | None = None) -> str | None:
    if last_san and str(last_san).endswith("#"):
        return "mate"
    if not raw:
        return None
    t = raw.strip().lower()
    if "time" in t or "flag" in t:
        return "flag"
    if "mate" in t or "checkmate" in t:
        return "mate"
    if "resign" in t:
        return "resign"
    if "abandon" in t or "left" in t:
        return "abandon"
    if t in ("normal", "rules infraction", "unexplained"):
        return "normal"
    return t or None


def _apply_pgn_evals(store: Store, game_id: str, moves_out: list[dict], you: str | None) -> None:
    evals = [m.get("eval_cp") for m in moves_out]
    if not any(c is not None for c in evals):
        return
    movers = [m["mover"] == "white" for m in moves_out]
    scored = score_comment_evals(evals, movers)
    by_ply = {s.ply: s for s in scored}
    ev_rows = []
    cp = accuracy.INITIAL_CP
    for m in moves_out:
        s = by_ply.get(m["ply"])
        if m.get("eval_cp") is not None:
            cp = m["eval_cp"]
        ev_rows.append(
            (
                game_id,
                m["ply"],
                12,
                "lichess-pgn",
                None,
                1,
                cp,
                accuracy.winpct_from_cp(cp),
                s.move_class if s else None,
                s.winpct_loss if s else None,
                s.accuracy if s else None,
                None,
                None,
                None,
                False,
            )
        )
    store.execute("DELETE FROM evaluations WHERE game_id = ?", (game_id,))
    store.executemany(
        """
        INSERT INTO evaluations (
          game_id, ply, depth, engine_version, net_hash, multipv, eval_cp, winpct,
          move_class, winpct_loss, accuracy, only_move, missed_win, tb_wdl, history_sensitive
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        ev_rows,
    )
    user_acc = accuracy.user_accuracy(scored, you)
    white_acc, black_acc = accuracy.game_accuracy(scored)
    store.execute(
        """
        UPDATE games SET analysis_status = 'complete', analysis_depth = 12,
          accuracy = ?, accuracy_white = ?, accuracy_black = ?, accuracy_version = ?
        WHERE game_id = ?
        """,
        (user_acc, white_acc, black_acc, ACCURACY_VERSION, game_id),
    )
    _fill_span_entries(store, game_id, you, scored)


def _fill_span_entries(store: Store, game_id: str, you: str | None, scored) -> None:
    by_ply = {s.ply: s for s in scored}
    rows = store.fetchall("SELECT span_id, start_ply FROM spans WHERE game_id = ?", (game_id,))
    for span_id, start in rows:
        s = by_ply.get(int(start))
        if s is None:
            continue
        wp = s.winpct_after if you != "black" else 100.0 - s.winpct_after
        store.execute("UPDATE spans SET entry_winpct = ? WHERE span_id = ?", (wp, span_id))


def _insert_spans(store: Store, game_id: str, moves_out: list[dict]) -> None:
    if not moves_out:
        return
    sid = store.next_span_id()
    rows = []
    start = moves_out[0]
    for prev, cur in zip(moves_out, moves_out[1:]):
        if cur["material_wb"] != prev["material_wb"]:
            rows.append((sid, game_id, start["material_wb"], start["material_you"], start["ply"], prev["ply"], None, None))
            sid += 1
            start = cur
    last = moves_out[-1]
    rows.append((sid, game_id, start["material_wb"], start["material_you"], start["ply"], last["ply"], None, None))
    store.executemany(
        """
        INSERT INTO spans (span_id, game_id, material_wb, material_you, start_ply, end_ply, entry_winpct, entry_tb)
        VALUES (?,?,?,?,?,?,?,?)
        """,
        rows,
    )


def recompute_classification(store: Store) -> int:
    """Replay-only recompute of classification, divider, openings, spans."""
    aliases = json_aliases(store)
    rows = store.fetchall("SELECT game_id, pgn FROM games")
    n = 0
    for game_id, pgn in rows:
        game = chess.pgn.read_game(io.StringIO(pgn or ""))
        if game is None:
            continue
        store.delete_game_children(game_id)
        store.execute("DELETE FROM games WHERE game_id = ?", (game_id,))
        ingest_game(store, game, aliases)
        n += 1
    return n


def apply_aliases(store: Store, aliases: list[str]) -> int:
    """Re-tag you_color, material_you, and castling from stored names. No replay."""
    rows = store.fetchall("SELECT game_id, white, black FROM games")
    n = 0
    for game_id, white, black in rows:
        you = classify.you_color(white or "", black or "", aliases)
        store.execute("UPDATE games SET you_color = ? WHERE game_id = ?", (you, game_id))
        if you == "black":
            store.execute(
                """
                UPDATE moves SET material_you =
                  split_part(material_wb, 'v', 2) || 'v' || split_part(material_wb, 'v', 1)
                WHERE game_id = ?
                """,
                (game_id,),
            )
            store.execute(
                """
                UPDATE spans SET material_you =
                  split_part(material_wb, 'v', 2) || 'v' || split_part(material_wb, 'v', 1)
                WHERE game_id = ?
                """,
                (game_id,),
            )
        else:
            store.execute("UPDATE moves SET material_you = material_wb WHERE game_id = ?", (game_id,))
            store.execute("UPDATE spans SET material_you = material_wb WHERE game_id = ?", (game_id,))
        castles = store.fetchall(
            "SELECT ply, mover, is_castling FROM moves WHERE game_id = ? AND is_castling IS NOT NULL ORDER BY ply",
            (game_id,),
        )
        user_castled = opp_castled = None
        user_castle_ply = None
        for ply, mover, kind in castles:
            if you == mover and user_castled is None:
                user_castled = kind
                user_castle_ply = ply
            elif you and you != mover and opp_castled is None:
                opp_castled = kind
        opposite = bool(user_castled and opp_castled and user_castled != opp_castled)
        acc_row = store.fetchone(
            "SELECT accuracy_white, accuracy_black FROM games WHERE game_id = ?",
            (game_id,),
        )
        acc = None
        if acc_row:
            if you == "white":
                acc = acc_row[0]
            elif you == "black":
                acc = acc_row[1]
        store.execute(
            """
            UPDATE games SET user_castled = ?, opp_castled = ?, opposite_side = ?, user_castle_ply = ?, accuracy = ?
            WHERE game_id = ?
            """,
            (user_castled, opp_castled, opposite, user_castle_ply, acc, game_id),
        )
        _refill_span_winpct(store, game_id, you)
        n += 1
    return n


def _refill_span_winpct(store: Store, game_id: str, you: str | None) -> None:
    rows = store.fetchall("SELECT span_id, start_ply FROM spans WHERE game_id = ?", (game_id,))
    for span_id, start in rows:
        ev = store.fetchone(
            "SELECT winpct FROM evaluations WHERE game_id = ? AND ply = ?",
            (game_id, int(start)),
        )
        if not ev or ev[0] is None:
            continue
        wp = ev[0] if you != "black" else 100.0 - ev[0]
        store.execute("UPDATE spans SET entry_winpct = ? WHERE span_id = ?", (wp, span_id))

