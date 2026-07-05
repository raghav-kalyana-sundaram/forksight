from __future__ import annotations

from pathlib import Path

import pytest

from app.store import Store

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "test.duckdb")


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES
