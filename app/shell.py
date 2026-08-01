"""C7 desktop wrapper. The UI talks only to the JSON API."""

from __future__ import annotations

import threading
import time

import uvicorn


def run_desktop(port: int = 7437) -> None:
    config = uvicorn.Config("app.server:create_app", factory=True, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.1)
    try:
        import webview
    except ImportError as exc:
        raise SystemExit("pywebview is not installed. pip install 'forksight[desktop]'") from exc
    webview.create_window("ForkSight", f"http://127.0.0.1:{port}/", width=1280, height=840)
    webview.start()
    server.should_exit = True
