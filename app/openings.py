from __future__ import annotations

import io
import json
from functools import lru_cache
from pathlib import Path

import chess
import chess.pgn

from app.paths import OPENINGS_BOOK


@lru_cache(maxsize=1)
def load_book(path: Path | None = None) -> list[dict]:
    book_path = path or OPENINGS_BOOK
    if not book_path.exists():
        return []
    return json.loads(book_path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def position_index(path: Path | None = None) -> dict[str, tuple[str, str, int]]:
    """Map starting-FEN-normalized board fen (placement+turn+castling+ep) to deepest book hit."""
    index: dict[str, tuple[str, str, int]] = {}
    for entry in load_book(path):
        pgn = entry.get("pgn") or ""
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            continue
        board = game.board()
        ply = 0
        node = game
        while node.variations:
            node = node.variations[0]
            board.push(node.move)
            ply += 1
            key = _pos_key(board)
            prev = index.get(key)
            if prev is None or ply >= prev[2]:
                index[key] = (entry["eco"], entry["name"], ply)
    return index


def _pos_key(board: chess.Board) -> str:
    parts = board.fen().split()
    return " ".join(parts[:4])


def classify_opening(board_keys: list[str], variant: str | None) -> tuple[str | None, str | None, str | None, int]:
    if variant and variant.lower() not in ("", "standard", "chess"):
        return None, None, None, 0
    index = position_index()
    eco = name = None
    depth = 0
    for key in board_keys:
        hit = index.get(key)
        if hit is None:
            break
        eco, name, depth = hit
    family = None
    if eco:
        family = eco[0] + (eco[1] if len(eco) > 1 and eco[1].isdigit() else "")
    return eco, family, name, depth
