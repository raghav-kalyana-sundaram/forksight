"""Time class, material signatures, castling, rating bands, FEN normalization."""

from __future__ import annotations

import hashlib
import re
import struct
from dataclasses import dataclass

import chess
import chess.polyglot

from app.versions import CLASSIFICATION_VERSION

VERSION = CLASSIFICATION_VERSION

PIECE_ORDER = ("Q", "R", "B", "N", "P")
PIECE_TYPES = (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN)

RATING_BANDS = (
    (1200, 1399, "1200-1399"),
    (1400, 1599, "1400-1599"),
    (1600, 1799, "1600-1799"),
    (1800, 1999, "1800-1999"),
    (2000, 2199, "2000-2199"),
    (2200, 2399, "2200-2399"),
)


@dataclass(frozen=True)
class TimeControl:
    base: int | None
    increment: int | None
    estimate: int | None
    tc_class: str
    raw: str


def parse_time_control(header: str | None) -> TimeControl:
    raw = (header or "").strip()
    if not raw or raw in ("-", "*"):
        return TimeControl(None, None, None, "unknown", raw)
    low = raw.lower()
    if "correspondence" in low or low in ("-", "unlimited"):
        return TimeControl(None, None, None, "daily", raw)
    if "/" in raw and "+" not in raw:
        # 1/86400 style correspondence
        try:
            parts = raw.split("/")
            seconds = int(parts[-1])
            if seconds >= 86400:
                return TimeControl(seconds, 0, seconds, "daily", raw)
        except ValueError:
            return TimeControl(None, None, None, "unknown", raw)
    m = re.match(r"^\s*(\d+)\s*(?:\+\s*(\d+))?\s*$", raw)
    if not m:
        return TimeControl(None, None, None, "unknown", raw)
    base = int(m.group(1))
    increment = int(m.group(2) or 0)
    if base >= 86400:
        return TimeControl(base, increment, base + 40 * increment, "daily", raw)
    estimate = base + 40 * increment
    if estimate < 180:
        cls = "bullet"
    elif estimate < 480:
        cls = "blitz"
    elif estimate < 1500:
        cls = "rapid"
    else:
        cls = "classical"
    return TimeControl(base, increment, estimate, cls, raw)


def rating_band(elo: int | None) -> str | None:
    if elo is None:
        return None
    if elo >= 2400:
        return "2400+"
    for lo, hi, label in RATING_BANDS:
        if lo <= elo <= hi:
            return label
    if elo < 1200:
        return "0-1199"
    return None


def you_color(white: str, black: str, aliases: list[str]) -> str | None:
    names = [a.strip().lower() for a in aliases if a.strip()]
    if not names:
        return None
    w = white.strip().lower()
    b = black.strip().lower()
    w_hit = any(w == a or a in w for a in names)
    b_hit = any(b == a or a in b for a in names)
    if w_hit and b_hit:
        return None
    if w_hit:
        return "white"
    if b_hit:
        return "black"
    return None


def parse_site_id(site: str | None, link: str | None) -> str | None:
    for value in (link, site):
        if not value:
            continue
        m = re.search(r"lichess\.org/(?:game/)?([A-Za-z0-9]{8})", value)
        if m:
            return m.group(1)
        m = re.search(r"chess\.com/game/(?:live|daily)/(\d+)", value)
        if m:
            return f"cc-{m.group(1)}"
    return None


def fingerprint(site_id: str | None, white: str, black: str, utc_date: str, result: str, san_line: str) -> str:
    if site_id:
        return site_id
    payload = "\n".join([san_line, white, black, utc_date, result])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def piece_counts(board: chess.Board) -> tuple[tuple[int, ...], tuple[int, ...]]:
    white = tuple(chess.popcount(board.pieces_mask(pt, chess.WHITE)) for pt in PIECE_TYPES)
    black = tuple(chess.popcount(board.pieces_mask(pt, chess.BLACK)) for pt in PIECE_TYPES)
    return white, black


def signature_from_counts(counts: tuple[int, ...]) -> str:
    letters = []
    for letter, n in zip(PIECE_ORDER, counts, strict=True):
        letters.append(letter * n)
    return "K" + "".join(letters)


def material_wb(board: chess.Board) -> str:
    white, black = piece_counts(board)
    return f"{signature_from_counts(white)}v{signature_from_counts(black)}"


def material_you(wb: str, color: str | None) -> str:
    if color != "black":
        return wb
    left, _, right = wb.partition("v")
    return f"{right}v{left}"


def parse_signature(token: str) -> str:
    return token.replace(" ", "").upper()


def fen_norm(board: chess.Board) -> str:
    ep = board.ep_square if board.has_legal_en_passant() else None
    parts = board.fen().split()
    ep_s = chess.SQUARE_NAMES[ep] if ep is not None else "-"
    return f"{parts[0]} {parts[1]} {parts[2]} {ep_s}"


def position_hash_bytes(board: chess.Board) -> bytes:
    return struct.pack(">Q", chess.polyglot.zobrist_hash(board) & 0xFFFFFFFFFFFFFFFF)


def repetition_key(board: chess.Board) -> tuple:
    return (board.board_fen(), board.turn, board.castling_rights, board.ep_square)


def is_history_sensitive(board: chess.Board, seen: dict[tuple, int]) -> bool:
    count = seen.get(repetition_key(board), 0)
    return count >= 1 or board.halfmove_clock >= 80


def castle_kind(move: chess.Move, board: chess.Board) -> str | None:
    if not board.is_castling(move):
        return None
    return "long" if board.is_queenside_castling(move) else "short"


def parse_elo(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"\d+", value)
    return int(m.group(0)) if m else None


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None
