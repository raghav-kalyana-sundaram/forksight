from __future__ import annotations

import json
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Iterable

import duckdb

from app.paths import DB_PATH, ensure_user_dirs
from app.versions import ACCURACY_VERSION, CLASSIFICATION_VERSION, DIVIDER_VERSION

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS games (
    game_id TEXT PRIMARY KEY,
    site_id TEXT,
    fingerprint TEXT UNIQUE,
    white TEXT,
    black TEXT,
    you_color TEXT,
    result TEXT,
    utc_date TEXT,
    utc_time TEXT,
    time_control TEXT,
    time_base INTEGER,
    time_inc INTEGER,
    time_estimate INTEGER,
    tc_class TEXT,
    variant TEXT,
    white_elo INTEGER,
    black_elo INTEGER,
    eco TEXT,
    eco_family TEXT,
    opening_name TEXT,
    book_depth INTEGER,
    ply_count INTEGER,
    opening_end_ply INTEGER,
    endgame_start_ply INTEGER,
    user_castled TEXT,
    opp_castled TEXT,
    opposite_side BOOLEAN,
    user_castle_ply INTEGER,
    has_clocks BOOLEAN,
    analysis_status TEXT DEFAULT 'none',
    analysis_depth INTEGER,
    accuracy DOUBLE,
    accuracy_white DOUBLE,
    accuracy_black DOUBLE,
    classification_version INTEGER,
    divider_version INTEGER,
    accuracy_version INTEGER,
    pgn TEXT,
    imported_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS moves (
    game_id TEXT,
    ply INTEGER,
    san TEXT,
    uci TEXT,
    fen TEXT,
    fen_norm TEXT,
    position_hash BLOB,
    mover TEXT,
    clock_centis INTEGER,
    material_wb TEXT,
    material_you TEXT,
    q_w INTEGER, r_w INTEGER, b_w INTEGER, n_w INTEGER, p_w INTEGER,
    q_b INTEGER, r_b INTEGER, b_b INTEGER, n_b INTEGER, p_b INTEGER,
    phase TEXT,
    piece_count INTEGER,
    halfmove INTEGER,
    is_castling TEXT,
    is_book BOOLEAN,
    PRIMARY KEY (game_id, ply)
);

CREATE TABLE IF NOT EXISTS spans (
    span_id INTEGER PRIMARY KEY,
    game_id TEXT,
    material_wb TEXT,
    material_you TEXT,
    start_ply INTEGER,
    end_ply INTEGER,
    entry_winpct DOUBLE,
    entry_tb TEXT
);

CREATE TABLE IF NOT EXISTS eval_cache (
    fen_norm TEXT,
    depth INTEGER,
    engine_version TEXT,
    net_hash TEXT,
    multipv INTEGER,
    threads INTEGER,
    eval_cp INTEGER,
    eval_cp_2 INTEGER,
    PRIMARY KEY (fen_norm, depth, engine_version, net_hash, multipv)
);

CREATE TABLE IF NOT EXISTS evaluations (
    game_id TEXT,
    ply INTEGER,
    depth INTEGER,
    engine_version TEXT,
    net_hash TEXT,
    multipv INTEGER,
    eval_cp INTEGER,
    winpct DOUBLE,
    move_class TEXT,
    winpct_loss DOUBLE,
    accuracy DOUBLE,
    only_move BOOLEAN,
    missed_win BOOLEAN,
    tb_wdl TEXT,
    history_sensitive BOOLEAN,
    PRIMARY KEY (game_id, ply)
);

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT,
    settings_json TEXT,
    started_at TIMESTAMP,
    updated_at TIMESTAMP,
    log_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_games_tc ON games(tc_class);
CREATE INDEX IF NOT EXISTS idx_games_you ON games(you_color);
CREATE INDEX IF NOT EXISTS idx_games_eco ON games(eco_family);
CREATE INDEX IF NOT EXISTS idx_moves_mat ON moves(material_you);
CREATE INDEX IF NOT EXISTS idx_moves_phase ON moves(phase);
CREATE INDEX IF NOT EXISTS idx_spans_mat ON spans(material_you);
CREATE INDEX IF NOT EXISTS idx_eval_fen ON eval_cache(fen_norm);

CREATE OR REPLACE VIEW v_games AS
SELECT game_id, site_id, white, black, you_color, result, utc_date, tc_class,
       variant, white_elo, black_elo, eco, eco_family, opening_name, book_depth,
       ply_count, opening_end_ply, endgame_start_ply, user_castled, opp_castled,
       opposite_side, analysis_status, analysis_depth, accuracy, has_clocks
FROM games;

CREATE OR REPLACE VIEW v_moves AS
SELECT game_id, ply, san, uci, mover, material_wb, material_you, phase,
       clock_centis, is_castling, is_book, piece_count, fen_norm
FROM moves;

CREATE OR REPLACE VIEW v_spans AS
SELECT game_id, material_wb, material_you, start_ply, end_ply, entry_winpct, entry_tb
FROM spans;
"""


class Store:
    def __init__(self, path: Path | None = None) -> None:
        ensure_user_dirs()
        self.path = path or DB_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = duckdb.connect(str(self.path))
        self._conn.execute("PRAGMA threads=4")
        self._apply_schema()
        self._write_q: deque[tuple[str, tuple]] = deque()
        self._reset_crashed_jobs()

    def _apply_schema(self) -> None:
        with self._lock:
            self._conn.execute(SCHEMA)

    def _reset_crashed_jobs(self) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE games SET analysis_status = 'none' WHERE analysis_status = 'running'"
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def execute(self, sql: str, params: tuple | list | None = None) -> duckdb.DuckDBPyConnection:
        with self._lock:
            if params is None:
                return self._conn.execute(sql)
            return self._conn.execute(sql, params)

    def executemany(self, sql: str, rows: Iterable[tuple]) -> None:
        rows = list(rows)
        if not rows:
            return
        with self._lock:
            self._conn.executemany(sql, rows)

    def fetchall(self, sql: str, params: tuple | list | None = None) -> list:
        return self.execute(sql, params).fetchall()

    def fetchone(self, sql: str, params: tuple | list | None = None):
        return self.execute(sql, params).fetchone()

    def df(self, sql: str, params: tuple | list | None = None):
        return self.execute(sql, params).df()

    def setting(self, key: str, default: str | None = None) -> str | None:
        row = self.fetchone("SELECT value FROM settings WHERE key = ?", (key,))
        return row[0] if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )

    def settings_json(self) -> dict[str, Any]:
        aliases = json.loads(self.setting("aliases", "[]") or "[]")
        return {
            "aliases": aliases,
            "include_observed": self.setting("include_observed", "false") == "true",
            "stockfish_path": self.setting("stockfish_path", ""),
            "syzygy_path": self.setting("syzygy_path", ""),
            "report_depth": self.setting("report_depth", ""),
        }

    def save_settings(self, data: dict[str, Any]) -> None:
        if "aliases" in data:
            self.set_setting("aliases", json.dumps(data["aliases"]))
        if "include_observed" in data:
            self.set_setting("include_observed", "true" if data["include_observed"] else "false")
        if "stockfish_path" in data:
            self.set_setting("stockfish_path", data["stockfish_path"] or "")
        if "syzygy_path" in data:
            self.set_setting("syzygy_path", data["syzygy_path"] or "")
        if "report_depth" in data:
            self.set_setting("report_depth", str(data["report_depth"] or ""))

    def version_drift(self) -> dict[str, int]:
        row = self.fetchone(
            """
            SELECT
              SUM(CASE WHEN classification_version IS NULL OR classification_version <> ? THEN 1 ELSE 0 END),
              SUM(CASE WHEN divider_version IS NULL OR divider_version <> ? THEN 1 ELSE 0 END),
              SUM(CASE WHEN accuracy_version IS NULL OR accuracy_version <> ? THEN 1 ELSE 0 END)
            FROM games
            """,
            (CLASSIFICATION_VERSION, DIVIDER_VERSION, ACCURACY_VERSION),
        )
        return {
            "classification": int(row[0] or 0),
            "divider": int(row[1] or 0),
            "accuracy": int(row[2] or 0),
        }

    def delete_game_children(self, game_id: str) -> None:
        self.execute("DELETE FROM moves WHERE game_id = ?", (game_id,))
        self.execute("DELETE FROM spans WHERE game_id = ?", (game_id,))
        self.execute("DELETE FROM evaluations WHERE game_id = ?", (game_id,))

    def upsert_game(self, row: dict[str, Any], replace: bool) -> str:
        existing = self.fetchone(
            "SELECT game_id, has_clocks FROM games WHERE fingerprint = ?",
            (row["fingerprint"],),
        )
        if existing and not replace:
            return "duplicate"
        if existing:
            self.delete_game_children(existing[0])
            self.execute("DELETE FROM games WHERE game_id = ?", (existing[0],))
        cols = list(row.keys())
        placeholders = ", ".join(["?"] * len(cols))
        self.execute(
            f"INSERT INTO games ({', '.join(cols)}) VALUES ({placeholders})",
            tuple(row[c] for c in cols),
        )
        return "inserted" if not existing else "replaced"

    def next_span_id(self) -> int:
        row = self.fetchone("SELECT COALESCE(MAX(span_id), 0) FROM spans")
        return int(row[0] or 0) + 1

    def report_depth(self) -> int | None:
        override = self.setting("report_depth", "")
        if override:
            try:
                return int(override)
            except ValueError:
                pass
        row = self.fetchone(
            """
            SELECT MIN(analysis_depth) FROM games
            WHERE analysis_status = 'complete' AND analysis_depth IS NOT NULL
            """
        )
        return int(row[0]) if row and row[0] is not None else None

    def depth_options(self) -> list[dict[str, Any]]:
        rows = self.fetchall(
            """
            SELECT analysis_depth, COUNT(*) FROM games
            WHERE analysis_status = 'complete' AND analysis_depth IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """
        )
        return [{"depth": int(d), "games": int(n)} for d, n in rows]

    def footer(self) -> dict[str, Any]:
        last = self.fetchone("SELECT MAX(imported_at) FROM games")
        n = self.fetchone("SELECT COUNT(*) FROM games")
        return {
            "db_path": str(self.path),
            "last_import": str(last[0]) if last and last[0] else None,
            "report_depth": self.report_depth(),
            "game_count": int(n[0] or 0),
            "depth_options": self.depth_options(),
            "version_drift": self.version_drift(),
        }

    def open_panel_query(self, sql: str, row_cap: int = 500):
        """Run a validated read on the sole connection, inside a rolled-back txn.

        DuckDB refuses a second handle on the same file with a different access
        mode, so a separate read-only connection is not possible in-process.
        """
        with self._lock:
            self._conn.execute("BEGIN TRANSACTION")
            try:
                rel = self._conn.execute(sql)
                cols = [c[0] for c in rel.description] if rel.description else []
                rows = rel.fetchmany(row_cap + 1)
                return cols, rows
            finally:
                self._conn.execute("ROLLBACK")

    def export_parquet(self, dest: Path) -> None:
        dest = Path(dest)
        dest.mkdir(parents=True, exist_ok=True)
        for table in ("games", "moves", "spans", "evaluations", "eval_cache"):
            self.execute(f"COPY {table} TO '{dest / (table + '.parquet')}' (FORMAT PARQUET)")
