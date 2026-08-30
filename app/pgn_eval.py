"""Read [%eval] comments from a Lichess PGN and score them with the site formula."""

from __future__ import annotations

import re

from app import accuracy

EVAL_RE = re.compile(r"\[%eval\s+([^\]]+)\]")
BEST_RE = re.compile(r"(?:was best|best was)\.\s*", re.I)


def parse_eval_token(raw: str) -> int | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("#"):
        try:
            n = int(text[1:])
        except ValueError:
            return None
        if n == 0:
            return None
        return accuracy.mate_to_cp(n)
    try:
        return int(round(float(text) * 100))
    except ValueError:
        return None


def eval_from_comment(comment: str | None) -> int | None:
    if not comment:
        return None
    m = EVAL_RE.search(comment)
    if not m:
        return None
    return parse_eval_token(m.group(1))


def best_from_comment(comment: str | None) -> str | None:
    if not comment:
        return None
    m = re.search(r"(\S+(?:\s+\S+){0,6}) was best", comment, re.I)
    if m:
        return m.group(1).rstrip(".")
    return None


def score_comment_evals(evals_after: list[int | None], movers_white: list[bool]) -> list[accuracy.ScoredMove]:
    """evals_after[i] is White-centric cp after ply i+1."""
    move_evals: list[accuracy.MoveEval] = []
    prev = accuracy.INITIAL_CP
    for i, (cp, is_w) in enumerate(zip(evals_after, movers_white)):
        if cp is None:
            prev = prev
            continue
        move_evals.append(
            accuracy.MoveEval(
                ply=i + 1,
                mover_is_white=is_w,
                cp_before=prev,
                cp_after=cp,
            )
        )
        prev = cp
    return accuracy.score_moves(move_evals)
