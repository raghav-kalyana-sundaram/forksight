import chess

from app.classify import material_wb, material_you
from app.ingest import ingest_files
from app.query import parse_query
from app.stats import games_table


def test_signatures_krk_krpvkp_kqvkr():
    krk = chess.Board("4k3/8/8/8/8/8/8/4K2R w - - 0 1")
    assert material_wb(krk) == "KRvK"
    krpvkp = chess.Board("4k3/4p3/8/8/8/8/4P3/4K2R w - - 0 1")
    assert material_wb(krpvkp) == "KRPvKP"
    kqvkr = chess.Board("4k2r/8/8/8/8/8/8/3QK3 w - - 0 1")
    assert material_wb(kqvkr) == "KQvKR"


def test_mirroring_user_perspective(store, fixtures):
    data = (fixtures / "setup_material.pgn").read_bytes()
    ingest_files(store, [("setup.pgn", data)], aliases=["Alice"])
    row = store.fetchone("SELECT material_wb, material_you FROM moves WHERE ply = 1")
    assert row[0] == "KRvKB"
    assert row[1] == "KBvKR"
    rook_side = games_table(store, "material:KRvKB", limit=10)
    bishop_side = games_table(store, "material:KBvKR", limit=10)
    assert rook_side["games"] == 0
    assert bishop_side["games"] == 1
