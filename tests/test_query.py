from app.ingest import ingest_files
from app.query import parse_query
from app.stats import run_query


def test_parser_every_token():
    q = parse_query(
        'tc:blitz color:white eco:B90 opening:Sicilian material:KRPvKP '
        'material_wb:KRPvKP pieces:me=R+P,opp=N,no=Q castled:long phase:endgame '
        'entry:winning analyzed:yes result:win rating:1600-1800 opprating:1800-2000 '
        'opponent:hikaru year:2025 since:2025-01-01 until:2025-12-31 leftover'
    )
    assert q.tokens["tc"] == "blitz"
    assert q.tokens["color"] == "white"
    assert q.tokens["eco"] == "B90"
    assert q.tokens["opening"] == "Sicilian"
    assert q.tokens["material"] == "KRPvKP"
    assert q.tokens["material_wb"] == "KRPvKP"
    assert q.tokens["pieces"] == "me=R+P,opp=N,no=Q"
    assert q.tokens["castled"] == "long"
    assert q.tokens["phase"] == "endgame"
    assert q.tokens["entry"] == "winning"
    assert q.tokens["analyzed"] == "yes"
    assert q.tokens["result"] == "win"
    assert q.tokens["rating"] == "1600-1800"
    assert q.tokens["opprating"] == "1800-2000"
    assert q.tokens["opponent"] == "hikaru"
    assert q.tokens["year"] == "2025"
    assert q.tokens["since"] == "2025-01-01"
    assert q.tokens["until"] == "2025-12-31"
    assert "leftover" in q.bare


def test_grain_counts(store, fixtures):
    ingest_files(store, [("short.pgn", (fixtures / "short.pgn").read_bytes())], aliases=["Alice"])
    whole = run_query(store, "color:white")
    assert whole["games"] == 1
    assert whole["plies"] == store.fetchone("SELECT ply_count FROM games")[0]
    windowed = run_query(store, "phase:opening color:white")
    assert windowed["games"] == 1
    assert windowed["plies"] <= whole["plies"]
