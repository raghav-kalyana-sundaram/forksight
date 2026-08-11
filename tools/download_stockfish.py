#!/usr/bin/env python3
"""Download the official Stockfish binary. Not bundled with the app."""

from __future__ import annotations

import platform
import stat
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "user_data" / "stockfish"
RELEASE = "https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1"


def asset() -> str:
    system, machine = platform.system(), platform.machine().lower()
    if system == "Darwin":
        return "stockfish-macos-x86-64-avx2.tar" if machine == "x86_64" else "stockfish-macos-m1-apple-silicon.tar"
    if system == "Linux":
        return "stockfish-ubuntu-x86-64-avx2.tar"
    if system == "Windows":
        return "stockfish-windows-x86-64-avx2.zip"
    raise SystemExit(f"unsupported platform {system} {machine}")


def main() -> None:
    name = asset()
    url = f"{RELEASE}/{name}"
    DEST.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / name
        urllib.request.urlretrieve(url, archive)
        if name.endswith(".zip"):
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(DEST)
        else:
            with tarfile.open(archive) as tf:
                tf.extractall(DEST, filter="data")
    for path in DEST.rglob("*"):
        if path.is_file() and path.name.lower().startswith("stockfish"):
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
            print(f"binary: {path}")
            return
    print("extracted, but no stockfish binary name matched", file=sys.stderr)


if __name__ == "__main__":
    main()
