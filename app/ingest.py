from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

import chess
import chess.pgn

from app import classify, divider, openings
from app.store import Store
from app.versions import CLASSIFICATION_VERSION, DIVIDER_VERSION


@dataclass
class ImportReport:
    inserted: int = 0
    replaced: int = 0
    duplicates: int = 0
    dropped_unparseable: int = 0
    dropped_aborted: int = 0
    dropped_incomplete: int = 0
    files: int = 0


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
            status = ingest_game(store, game, aliases)
            setattr(report, status, getattr(report, status) + 1)
    return report


def json_aliases(store: Store) -> list[str]:
    import json

    return json.loads(store.setting("aliases", "[]") or "[]")


def ingest_game(store: Store, game: chess.pgn.Game, aliases: list[str]) -> str:
    headers = game.headers
    board = game.board()
    if game.errors:
        return "dropped_unparseable"

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
            }
        )

    if ply == 0:
        return "dropped_aborted"

    variant = (headers.get("Variant") or "standard").strip()
    tc = classify.parse_time_control(headers.get("TimeControl"))
    site_id = classify.parse_site_id(headers.get("Site"), headers.get("Link"))
    utc_date = headers.get("UTCDate") or headers.get("Date") or ""
    result = headers.get("Result", "*")
    fp = classify.fingerprint(site_id, headers.get("White", ""), headers.get("Black", ""), utc_date, result, " ".join(sans))

    existing = store.fetchone("SELECT has_clocks FROM games WHERE fingerprint = ?", (fp,))
    if existing:
        if existing[0] or not clocks_found:
            return "duplicates"
        # incoming has clocks and stored does not — replace
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
        "opening_name": opening_name or headers.get("Opening"),
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
    return "replaced" if action == "replaced" else "inserted"


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
