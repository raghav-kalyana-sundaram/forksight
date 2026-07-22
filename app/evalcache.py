from __future__ import annotations

from dataclasses import dataclass

from app.store import Store


@dataclass(frozen=True)
class EngineId:
    version: str
    net_hash: str
    multipv: int
    threads: int


@dataclass(frozen=True)
class CachedEval:
    eval_cp: int
    eval_cp_2: int | None


def lookup(store: Store, fen_norm: str, depth: int, engine: EngineId) -> CachedEval | None:
    row = store.fetchone(
        """
        SELECT eval_cp, eval_cp_2 FROM eval_cache
        WHERE fen_norm = ? AND depth >= ? AND engine_version = ? AND net_hash = ? AND multipv = ?
        ORDER BY depth DESC LIMIT 1
        """,
        (fen_norm, depth, engine.version, engine.net_hash, engine.multipv),
    )
    if not row:
        return None
    return CachedEval(int(row[0]), int(row[1]) if row[1] is not None else None)


def store_eval(store: Store, fen_norm: str, depth: int, engine: EngineId, eval_cp: int, eval_cp_2: int | None) -> None:
    store.execute(
        """
        INSERT OR REPLACE INTO eval_cache
          (fen_norm, depth, engine_version, net_hash, multipv, threads, eval_cp, eval_cp_2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (fen_norm, depth, engine.version, engine.net_hash, engine.multipv, engine.threads, eval_cp, eval_cp_2),
    )
