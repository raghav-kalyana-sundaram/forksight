from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UI = ROOT / "ui"
USER = ROOT / "user_data"
TOOLS = ROOT / "tools"

DB_PATH = USER / "chess.duckdb"
PGN_DIR = USER / "pgns"
SYZYGY_DIR = USER / "syzygy"
POP_OPENINGS = USER / "pop_openings.parquet"
STOCKFISH_DIR = USER / "stockfish"

OPENINGS_BOOK = DATA / "openings.eco.json"
POP_RESULTS = DATA / "pop_results.parquet"
POP_ENDGAMES = DATA / "pop_endgames.parquet"


def ensure_user_dirs() -> None:
    for path in (USER, PGN_DIR, SYZYGY_DIR, STOCKFISH_DIR):
        path.mkdir(parents=True, exist_ok=True)
