#!/usr/bin/env python3
"""Download the opening cube release asset and verify SHA-256."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "user_data" / "pop_openings.parquet"
# Fill when a release exists.
URL = ""
SHA256 = ""


def main() -> None:
    if not URL or not SHA256:
        print("opening cube is not released yet; explorer will show only your moves")
        sys.exit(0)
    DEST.parent.mkdir(parents=True, exist_ok=True)
    import urllib.request

    urllib.request.urlretrieve(URL, DEST)
    digest = hashlib.sha256(DEST.read_bytes()).hexdigest()
    if digest != SHA256:
        DEST.unlink(missing_ok=True)
        raise SystemExit(f"checksum mismatch: {digest}")
    print(f"wrote {DEST}")


if __name__ == "__main__":
    main()
