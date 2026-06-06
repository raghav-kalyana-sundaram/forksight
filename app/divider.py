"""Lichess Divider reimplementation. Mixedness table is documented in MODEL.md."""

from __future__ import annotations

from dataclasses import dataclass

import chess

from app.versions import DIVIDER_VERSION

VERSION = DIVIDER_VERSION


@dataclass(frozen=True)
class Division:
    middle: int | None
    end: int | None
    plies: int

    def phase_for_ply(self, ply: int) -> str:
        if self.end is not None and ply >= self.end:
            return "endgame"
        if self.middle is None or ply < self.middle:
            return "opening"
        return "middlegame"


def majors_and_minors(board: chess.Board) -> int:
    return chess.popcount(board.occupied & ~(board.kings | board.pawns))


def backrank_sparse(board: chess.Board) -> bool:
    white_home = chess.popcount(board.occupied_co[chess.WHITE] & chess.BB_RANK_1)
    black_home = chess.popcount(board.occupied_co[chess.BLACK] & chess.BB_RANK_8)
    return white_home < 4 or black_home < 4


def mixedness_score(y: int, white: int, black: int) -> int:
    if white == 0:
        if black == 1:
            return 1 + y
        if black == 2:
            return 2 + (6 - y) if y < 6 else 0
        if black in (3, 4):
            return 3 + (7 - y) if y < 7 else 0
        return 0
    if white == 1:
        if black == 0:
            return 1 + (8 - y)
        if black == 1:
            return 5 + abs(4 - y)
        if black == 2:
            return 4 + (7 - y)
        if black == 3:
            return 5 + (7 - y)
        return 0
    if white == 2:
        if black == 0:
            return 2 + (y - 2) if y > 2 else 0
        if black == 1:
            return 4 + (y - 1)
        if black == 2:
            return 7
        return 0
    if white == 3:
        if black == 0:
            return 3 + (y - 1) if y > 1 else 0
        if black == 1:
            return 5 + (y - 1)
        return 0
    if white == 4:
        if black == 0:
            return 3 + (y - 1) if y > 1 else 0
        return 0
    return 0


def mixedness(board: chess.Board) -> int:
    acc = 0
    for y_idx in range(7):
        y = y_idx + 1
        for x in range(7):
            region = 0
            for dr in (0, 1):
                for df in (0, 1):
                    region |= chess.BB_SQUARES[(y_idx + dr) * 8 + (x + df)]
            white = chess.popcount(board.occupied_co[chess.WHITE] & region)
            black = chess.popcount(board.occupied_co[chess.BLACK] & region)
            acc += mixedness_score(y, white, black)
    return acc


def is_middlegame_trigger(board: chess.Board) -> bool:
    return majors_and_minors(board) <= 10 or backrank_sparse(board) or mixedness(board) > 150


def divide(boards: list[chess.Board]) -> Division:
    mid = next((i for i, board in enumerate(boards) if is_middlegame_trigger(board)), None)
    end = None
    if mid is not None:
        end = next((i for i, board in enumerate(boards) if majors_and_minors(board) <= 6), None)
        if end is not None and end <= mid:
            mid = None
    return Division(middle=mid, end=end, plies=len(boards))
