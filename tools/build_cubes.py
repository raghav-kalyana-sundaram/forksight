#!/usr/bin/env python3
"""
Stream a Lichess monthly dump into population cubes.

This is a multi-day job on a full sample. Checkpoint per input file.
Users are not expected to run this; the builder ships so the numbers can be audited.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import chess
import chess.pgn
import pyarrow as pa
import pyarrow.parquet as pq

from app.classify import material_wb, parse_time_control, rating_band
from app.divider import divide

FILTER = {
    "years": [2024, 2025],
    "rated_only": True,
    "tc_classes": ["blitz", "rapid"],
    "variants": ["standard"],
}


def iter_games(path: Path):
    opener = open
    if path.suffix == ".zst":
        import zstandard as zstd  # optional

        opener = lambda p: zstd.open(p, "rt")
    with opener(path) as fh:
        while True:
            game = chess.pgn.read_game(fh)
            if game is None:
                break
            yield game


def keep(game: chess.pgn.Game) -> bool:
    headers = game.headers
    if FILTER["rated_only"] and headers.get("Event", "").find("Rated") < 0:
        return False
    tc = parse_time_control(headers.get("TimeControl"))
    if tc.tc_class not in FILTER["tc_classes"]:
        return False
    variant = (headers.get("Variant") or "standard").lower()
    if variant not in FILTER["variants"]:
        return False
    date = headers.get("UTCDate") or headers.get("Date") or ""
    try:
        year = int(date[:4])
    except ValueError:
        return False
    return year in FILTER["years"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data"))
    parser.add_argument("--checkpoint", type=Path, default=Path("user_data/cube_ckpt.json"))
    args = parser.parse_args()
    ckpt = json.loads(args.checkpoint.read_text()) if args.checkpoint.exists() else {"done": []}
    results: Counter = Counter()
    endgames: Counter = Counter()
    for path in args.inputs:
        if str(path) in ckpt["done"]:
            continue
        for game in iter_games(path):
            if not keep(game):
                continue
            headers = game.headers
            tc = parse_time_control(headers.get("TimeControl")).tc_class
            result = headers.get("Result")
            for color, elo_key, win in (
                ("white", "WhiteElo", result == "1-0"),
                ("black", "BlackElo", result == "0-1"),
            ):
                band = rating_band(int(headers.get(elo_key) or 0) or None)
                opp_key = "BlackElo" if color == "white" else "WhiteElo"
                opp_band = rating_band(int(headers.get(opp_key) or 0) or None)
                eco = (headers.get("ECO") or "?")[:2]
                key = (band, opp_band, tc, color, eco)
                results[key + ("n",)] += 1
                if result == "1/2-1/2":
                    results[key + ("d",)] += 1
                elif win:
                    results[key + ("w",)] += 1
                else:
                    results[key + ("l",)] += 1
            board = game.board()
            boards = [board.copy(stack=False)]
            node = game
            seen_mat = set()
            while node.variations:
                node = node.variations[0]
                board.push(node.move)
                boards.append(board.copy(stack=False))
                sig = material_wb(board)
                if sig in seen_mat:
                    continue
                seen_mat.add(sig)
                we = rating_band(int(headers.get("WhiteElo") or 0) or None)
                be = rating_band(int(headers.get("BlackElo") or 0) or None)
                for color, band, opp in (("white", we, be), ("black", be, we)):
                    key = (band, opp, tc, sig)
                    endgames[key + ("n",)] += 1
                    if result == "1/2-1/2":
                        endgames[key + ("d",)] += 1
                    elif (result == "1-0" and color == "white") or (result == "0-1" and color == "black"):
                        endgames[key + ("w",)] += 1
                    else:
                        endgames[key + ("l",)] += 1
        ckpt["done"].append(str(path))
        args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
        args.checkpoint.write_text(json.dumps(ckpt))
        print(f"checkpointed {path}")
    _write_results(args.out / "pop_results.parquet", results)
    _write_endgames(args.out / "pop_endgames.parquet", endgames)


def _write_results(path: Path, counter: Counter) -> None:
    keys = {k[:5] for k in counter}
    rows = []
    for band, opp, tc, color, eco in keys:
        n = counter[(band, opp, tc, color, eco, "n")]
        rows.append(
            {
                "rating_band": band,
                "opp_rating_band": opp,
                "tc_class": tc,
                "colour": color,
                "eco_family": eco,
                "n": n,
                "wins": counter[(band, opp, tc, color, eco, "w")],
                "draws": counter[(band, opp, tc, color, eco, "d")],
                "losses": counter[(band, opp, tc, color, eco, "l")],
            }
        )
    table = pa.Table.from_pylist(rows) if rows else pa.table(
        {
            "rating_band": pa.array([], pa.string()),
            "opp_rating_band": pa.array([], pa.string()),
            "tc_class": pa.array([], pa.string()),
            "colour": pa.array([], pa.string()),
            "eco_family": pa.array([], pa.string()),
            "n": pa.array([], pa.int64()),
            "wins": pa.array([], pa.int64()),
            "draws": pa.array([], pa.int64()),
            "losses": pa.array([], pa.int64()),
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path)


def _write_endgames(path: Path, counter: Counter) -> None:
    keys = {k[:4] for k in counter}
    rows = [
        {
            "rating_band": band,
            "opp_rating_band": opp,
            "tc_class": tc,
            "material_signature": sig,
            "n_reached": counter[(band, opp, tc, sig, "n")],
            "wins": counter[(band, opp, tc, sig, "w")],
            "draws": counter[(band, opp, tc, sig, "d")],
            "losses": counter[(band, opp, tc, sig, "l")],
        }
        for band, opp, tc, sig in keys
    ]
    table = pa.Table.from_pylist(rows) if rows else pa.table(
        {
            "rating_band": pa.array([], pa.string()),
            "opp_rating_band": pa.array([], pa.string()),
            "tc_class": pa.array([], pa.string()),
            "material_signature": pa.array([], pa.string()),
            "n_reached": pa.array([], pa.int64()),
            "wins": pa.array([], pa.int64()),
            "draws": pa.array([], pa.int64()),
            "losses": pa.array([], pa.int64()),
        }
    )
    pq.write_table(table, path)


if __name__ == "__main__":
    main()
