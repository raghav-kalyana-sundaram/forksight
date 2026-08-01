from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import init, router
from app.engine import Analyzer
from app.paths import UI, ensure_user_dirs
from app.store import Store


def create_app() -> FastAPI:
    ensure_user_dirs()
    store = Store()
    analyzer = Analyzer(store)
    init(store, analyzer)
    app = FastAPI(title="ForkSight", docs_url=None, redoc_url=None)
    app.include_router(router, prefix="/api")
    app.mount("/", StaticFiles(directory=str(UI), html=True), name="ui")
    return app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="forksight")
    sub = parser.add_subparsers(dest="cmd")
    serve = sub.add_parser("serve", help="run the local server")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=7437)
    sub.add_parser("desktop", help="open the pywebview shell (C7)")
    args = parser.parse_args(argv)
    cmd = args.cmd or "serve"
    if cmd == "desktop":
        from app.shell import run_desktop

        run_desktop()
        return
    if args.host != "127.0.0.1":
        print("refusing to bind outside 127.0.0.1", file=sys.stderr)
        sys.exit(2)
    uvicorn.run("app.server:create_app", factory=True, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
