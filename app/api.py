from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from app import ingest, stats
from app.engine import Analyzer, JobSettings
from app.labels import user_result
from app.lichess import fetch_user_pgn
from app.store import Store

REQUEST_HEADER = "x-forksight-request"
SQL_CAP = 500
SQL_TIMEOUT_MS = 5000

router = APIRouter()
_store: Store | None = None
_analyzer: Analyzer | None = None


def init(store: Store, analyzer: Analyzer) -> None:
    global _store, _analyzer
    _store = store
    _analyzer = analyzer


def store() -> Store:
    assert _store is not None
    return _store


def analyzer() -> Analyzer:
    assert _analyzer is not None
    return _analyzer


def require_header(x_forksight_request: str | None) -> None:
    if x_forksight_request != "1":
        raise HTTPException(403, "Missing X-ForkSight-Request header")


class SettingsIn(BaseModel):
    aliases: list[str] | None = None
    include_observed: bool | None = None
    stockfish_path: str | None = None
    syzygy_path: str | None = None
    report_depth: int | str | None = None


class AnalyzeIn(BaseModel):
    mode: str = "depth"
    depth: int = 15
    movetime_ms: int = 200
    multipv: int = 1
    threads: int | None = None
    hash_mb: int | None = None
    skip_book: bool = True
    only_unanalyzed: bool = True
    eco: bool = False
    game_id: str | None = None


class SqlIn(BaseModel):
    sql: str


class LichessIn(BaseModel):
    username: str
    max_games: int = 200


class ExplorerIn(BaseModel):
    uci_prefix: list[str] = []


@router.get("/meta")
def meta() -> dict[str, Any]:
    return store().footer()


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return store().settings_json()


@router.post("/settings")
def post_settings(body: SettingsIn, x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    store().save_settings(body.model_dump(exclude_none=True))
    return store().settings_json()


@router.post("/import")
async def import_pgn(
    files: list[UploadFile] = File(...),
    x_forksight_request: str | None = Header(default=None),
) -> dict[str, Any]:
    require_header(x_forksight_request)
    blobs: list[tuple[str, bytes]] = []
    for f in files:
        blobs.append((f.filename or "upload.pgn", await f.read()))
    report = ingest.ingest_files(store(), blobs)
    return report.__dict__


@router.post("/import/lichess")
def import_lichess(body: LichessIn, x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    pgn = fetch_user_pgn(body.username, body.max_games)
    settings = store().settings_json()
    aliases = list(settings.get("aliases") or [])
    if body.username not in aliases:
        aliases.append(body.username)
        store().save_settings({"aliases": aliases})
    report = ingest.ingest_files(store(), [(f"{body.username}.pgn", pgn)], aliases=aliases)
    return report.__dict__


@router.get("/review")
def review(q: str = "", limit: int = 8) -> dict[str, Any]:
    return stats.review(store(), q, limit=limit)


@router.get("/sql/schema")
def sql_schema() -> dict[str, Any]:
    s = store()
    views = {}
    for name in ("v_games", "v_moves", "v_spans"):
        cols = s.fetchall(f"DESCRIBE {name}")
        views[name] = [{"name": c[0], "type": c[1]} for c in cols]
    return {"views": views}


@router.post("/recompute")
def recompute(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    n = ingest.recompute_classification(store())
    return {"recomputed": n}


@router.get("/games")
def games(q: str = "", limit: int = 200, offset: int = 0, all_tc: bool = False) -> dict[str, Any]:
    return stats.games_table(store(), q, limit=limit, offset=offset) if True else {}


@router.get("/insights")
def insights(q: str = "") -> dict[str, Any]:
    return stats.insights(store(), q)


@router.get("/improve")
def improve(q: str = "", nmin: int = 30) -> dict[str, Any]:
    return stats.improve(store(), q, nmin=nmin)


@router.get("/query")
def query(q: str = "") -> dict[str, Any]:
    return stats.run_query(store(), q)


@router.post("/explorer")
def explorer(body: ExplorerIn) -> dict[str, Any]:
    return stats.explorer(store(), uci_prefix=body.uci_prefix)


@router.get("/game/{game_id}")
def game(game_id: str) -> dict[str, Any]:
    s = store()
    g = s.fetchone("SELECT * FROM v_games WHERE game_id = ?", (game_id,))
    if not g:
        raise HTTPException(404, "game not found")
    cols = [c[0] for c in s.execute("SELECT * FROM v_games LIMIT 0").description]
    game_d = dict(zip(cols, g))
    moves = s.fetchall(
        """
        SELECT m.ply, m.san, m.uci, m.fen, m.mover, m.clock_centis, m.material_you, m.phase,
               m.is_castling, e.eval_cp, e.winpct, e.move_class, e.winpct_loss, e.accuracy,
               e.only_move, e.missed_win, e.tb_wdl
        FROM moves m
        LEFT JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply
        WHERE m.game_id = ?
        ORDER BY m.ply
        """,
        (game_id,),
    )
    start = s.fetchone("SELECT eval_cp, winpct FROM evaluations WHERE game_id = ? AND ply = 0", (game_id,))
    pgn_row = s.fetchone("SELECT pgn FROM games WHERE game_id = ?", (game_id,))
    game_d["user_result"] = user_result(game_d.get("you_color"), game_d.get("result"))
    game_d["pgn"] = pgn_row[0] if pgn_row else ""
    return {
        "game": game_d,
        "start_eval": {"eval_cp": start[0], "winpct": start[1]} if start else None,
        "moves": [
            {
                "ply": r[0],
                "san": r[1],
                "uci": r[2],
                "fen": r[3],
                "mover": r[4],
                "clock_centis": r[5],
                "material": r[6],
                "phase": r[7],
                "castling": r[8],
                "eval_cp": r[9],
                "winpct": r[10],
                "move_class": r[11],
                "winpct_loss": r[12],
                "accuracy": r[13],
                "only_move": r[14],
                "missed_win": r[15],
                "tb_wdl": r[16],
            }
            for r in moves
        ],
    }


@router.post("/analyze/start")
def analyze_start(body: AnalyzeIn, x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    return analyzer().start(JobSettings(**body.model_dump()))


@router.post("/analyze/pause")
def analyze_pause(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    return analyzer().pause()


@router.post("/analyze/resume")
def analyze_resume(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    return analyzer().resume()


@router.post("/analyze/stop-after")
def analyze_stop(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    return analyzer().stop_after_this_game()


@router.post("/analyze/benchmark")
def analyze_bench(body: AnalyzeIn, x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    return analyzer().benchmark(JobSettings(**body.model_dump()))


@router.get("/analyze/status")
def analyze_status() -> dict[str, Any]:
    return analyzer().snapshot()


@router.get("/analyze/engine")
def analyze_engine() -> dict[str, Any]:
    return analyzer().engine_info()


@router.post("/analyze/download-stockfish")
def analyze_download(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    import runpy

    from app.paths import TOOLS

    runpy.run_path(str(TOOLS / "download_stockfish.py"), run_name="__main__")
    info = analyzer().engine_info()
    if info["found"]:
        store().set_setting("stockfish_path", info["path"])
    return info


@router.post("/sql")
def sql_panel(body: SqlIn, x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    sql = body.sql.strip().rstrip(";")
    if ";" in sql:
        raise HTTPException(400, "single statement only")
    if not re.match(r"^(SELECT|WITH)\b", sql, re.I):
        raise HTTPException(400, "must begin with SELECT or WITH")
    banned = re.search(r"\b(COPY|INSTALL|LOAD|ATTACH|PRAGMA|SET|CALL|EXPORT|IMPORT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE)\b", sql, re.I)
    if banned:
        raise HTTPException(400, "statement not allowed")
    try:
        cols, rows = store().open_panel_query(sql, SQL_CAP)
        truncated = len(rows) > SQL_CAP
        return {"columns": cols, "rows": rows[:SQL_CAP], "truncated": truncated}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/export")
def export_parquet(x_forksight_request: str | None = Header(default=None)) -> dict[str, Any]:
    require_header(x_forksight_request)
    from app.paths import USER

    dest = USER / "export"
    store().export_parquet(dest)
    return {"path": str(dest)}
