"""Lichess accuracy: per-move formula plus volatility-weighted / harmonic aggregation."""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.versions import ACCURACY_VERSION

VERSION = ACCURACY_VERSION

WINPCT_K = 0.00368208
ACC_A = 103.1668
ACC_B = 0.04354
ACC_C = 3.1669
INITIAL_CP = 15

MOVE_CLASSES = (
    ("best", 2.0),
    ("good", 5.0),
    ("inaccuracy", 10.0),
    ("mistake", 20.0),
    ("blunder", math.inf),
)

ONLY_MOVE_GAP = 12.0
MISSED_WIN_BEST = 90.0
MISSED_WIN_PLAYED = 50.0


def mate_to_cp(moves_to_mate: int) -> int:
    sign = 1 if moves_to_mate > 0 else -1
    return sign * (10000 - 50 * abs(moves_to_mate))


def winpct_from_cp(cp: int) -> float:
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-WINPCT_K * cp)) - 1.0)


def move_accuracy(winpct_before: float, winpct_after: float) -> float:
    loss = max(0.0, winpct_before - winpct_after)
    raw = ACC_A * math.exp(-ACC_B * loss) - ACC_C
    return min(100.0, max(0.0, raw))


def mover_winpct(cp_white: int, mover_is_white: bool) -> float:
    wp = winpct_from_cp(cp_white)
    return wp if mover_is_white else 100.0 - wp


def classify_loss(winpct_loss: float) -> str:
    for name, cap in MOVE_CLASSES:
        if winpct_loss < cap:
            return name
    return "blunder"


def _stdev(xs: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs) / (n - 1)
    return math.sqrt(var)


def _harmonic_mean(xs: list[float]) -> float | None:
    if not xs or any(x <= 0 for x in xs):
        positive = [x for x in xs if x > 0]
        if not positive:
            return None
        xs = [max(x, 1e-9) for x in xs]
    return len(xs) / sum(1.0 / x for x in xs)


def _weighted_mean(pairs: list[tuple[float, float]]) -> float | None:
    total_w = sum(w for _, w in pairs)
    if total_w <= 0:
        return None
    return sum(v * w for v, w in pairs) / total_w


def _window_weights(winpcts: list[float], n_moves: int) -> list[float]:
    window = min(8, max(2, n_moves // 10))
    window = min(window, len(winpcts))
    pad = max(0, window - 2)
    first = winpcts[:window]
    windows = [first] * pad + [winpcts[i : i + window] for i in range(0, len(winpcts) - window + 1)]
    weights = []
    for chunk in windows[:n_moves]:
        sd = _stdev(chunk)
        weights.append(min(12.0, max(0.5, sd)))
    while len(weights) < n_moves:
        weights.append(0.5)
    return weights[:n_moves]


@dataclass(frozen=True)
class MoveEval:
    ply: int
    mover_is_white: bool
    cp_before: int
    cp_after: int
    cp_second: int | None = None


@dataclass(frozen=True)
class ScoredMove:
    ply: int
    mover_is_white: bool
    cp_before: int
    cp_after: int
    winpct_before: float
    winpct_after: float
    winpct_loss: float
    accuracy: float
    move_class: str
    only_move: bool | None
    missed_win: bool | None


def score_moves(moves: list[MoveEval], multipv: int = 1) -> list[ScoredMove]:
    scored: list[ScoredMove] = []
    for mv in moves:
        before = mover_winpct(mv.cp_before, mv.mover_is_white)
        after = mover_winpct(mv.cp_after, mv.mover_is_white)
        loss = max(0.0, before - after)
        only_move = None
        missed_win = None
        if multipv >= 2 and mv.cp_second is not None:
            second = mover_winpct(mv.cp_second, mv.mover_is_white)
            only_move = (before - second) > ONLY_MOVE_GAP
            missed_win = before >= MISSED_WIN_BEST and after < MISSED_WIN_PLAYED
        scored.append(
            ScoredMove(
                ply=mv.ply,
                mover_is_white=mv.mover_is_white,
                cp_before=mv.cp_before,
                cp_after=mv.cp_after,
                winpct_before=before,
                winpct_after=after,
                winpct_loss=loss,
                accuracy=move_accuracy(before, after),
                move_class=classify_loss(loss),
                only_move=only_move,
                missed_win=missed_win,
            )
        )
    return scored


def game_accuracy(scored: list[ScoredMove], start_white: bool = True) -> tuple[float | None, float | None]:
    if not scored:
        return None, None
    cps_after = [mv.cp_after for mv in scored]
    winpcts = [winpct_from_cp(INITIAL_CP)] + [winpct_from_cp(cp) for cp in cps_after]
    weights = _window_weights(winpcts, len(scored))

    def for_color(white: bool) -> float | None:
        pairs = [(s.accuracy, w) for s, w in zip(scored, weights) if s.mover_is_white == white]
        if not pairs:
            return None
        weighted = _weighted_mean(pairs)
        harmonic = _harmonic_mean([a for a, _ in pairs])
        if weighted is None or harmonic is None:
            return None
        return (weighted + harmonic) / 2.0

    white_acc = for_color(True)
    black_acc = for_color(False)
    if not start_white:
        white_acc, black_acc = black_acc, white_acc
    return white_acc, black_acc


def user_accuracy(scored: list[ScoredMove], you_color: str | None) -> float | None:
    white_acc, black_acc = game_accuracy(scored)
    if you_color == "white":
        return white_acc
    if you_color == "black":
        return black_acc
    return None
