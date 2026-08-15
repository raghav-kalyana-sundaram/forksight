from app.ingest import ingest_files
from app.store import Store


def test_import_fixtures(store: Store, fixtures):
    store.set_setting("aliases", '["Alice"]')
    files = []
    for name in ("short.pgn", "long.pgn", "noclock.pgn", "chess960.pgn", "aborted.pgn", "malformed.pgn"):
        path = fixtures / name
        files.append((name, path.read_bytes()))
    report = ingest_files(store, files, aliases=["Alice"])
    assert report.inserted >= 3
    assert report.dropped_aborted == 1
    counts = dict(store.fetchall("SELECT tc_class, COUNT(*) FROM games GROUP BY 1"))
    assert counts.get("blitz", 0) >= 1
    assert counts.get("rapid", 0) >= 1
    n960 = store.fetchone("SELECT COUNT(*) FROM games WHERE variant = 'chess960'")[0]
    assert n960 == 1
    eco960 = store.fetchone("SELECT eco FROM games WHERE variant = 'chess960'")[0]
    assert eco960 is None


def test_dedup(store: Store, fixtures):
    data = (fixtures / "short.pgn").read_bytes()
    r1 = ingest_files(store, [("short.pgn", data)], aliases=["Alice"])
    r2 = ingest_files(store, [("short.pgn", data)], aliases=["Alice"])
    assert r1.inserted == 1
    assert r2.duplicates == 1
    assert store.fetchone("SELECT COUNT(*) FROM games")[0] == 1


def test_alias_claim_reveals_game(store: Store, fixtures):
    from app.ingest import apply_aliases

    data = (fixtures / "short.pgn").read_bytes()
    report = ingest_files(store, [("short.pgn", data)], aliases=[])
    assert report.observed == 1
    assert "Alice" in report.names
    assert store.fetchone("SELECT you_color FROM games")[0] is None
    apply_aliases(store, ["Alice"])
    assert store.fetchone("SELECT you_color FROM games")[0] == "white"

