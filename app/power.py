from __future__ import annotations

import shutil
import subprocess
import sys


class SleepInhibitor:
    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None

    def acquire(self) -> None:
        self.release()
        if sys.platform == "darwin" and shutil.which("caffeinate"):
            self._proc = subprocess.Popen(["caffeinate", "-dimsu", "-w", str(os_getpid())])
            return
        if sys.platform.startswith("linux") and shutil.which("systemd-inhibit"):
            self._proc = subprocess.Popen(
                [
                    "systemd-inhibit",
                    "--what=idle:sleep",
                    "--who=ForkSight",
                    "--why=Engine analysis",
                    "--mode=block",
                    "sleep",
                    "infinity",
                ]
            )
            return
        if sys.platform == "win32":
            try:
                import ctypes

                ES_CONTINUOUS = 0x80000000
                ES_SYSTEM_REQUIRED = 0x00000001
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
            except Exception:
                pass

    def release(self) -> None:
        if self._proc is not None:
            try:
                self._proc.terminate()
            except Exception:
                pass
            self._proc = None
        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
            except Exception:
                pass


def os_getpid() -> int:
    import os

    return os.getpid()


def notify(title: str, body: str) -> None:
    if sys.platform == "darwin" and shutil.which("osascript"):
        script = f'display notification {body!r} with title {title!r}'
        subprocess.Popen(["osascript", "-e", script])
        return
    if shutil.which("notify-send"):
        subprocess.Popen(["notify-send", title, body])
