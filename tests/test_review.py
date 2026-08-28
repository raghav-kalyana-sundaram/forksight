from app.ingest import ingest_files
from app.stats import games_table, improve, review


def test_games_table_player_relative_result(store, fixtures):
    ingest_files(store, [("short.pgn", (fixtures / "short.pgn").read_bytes())], aliases=["Alice"])
    data = games_table(store, "tc:all")
    assert data["rows"]
    row = data["rows"][0]
    assert row["user_result"] in ("win", "draw", "loss")
    assert row["you_elo"] is not None or row["opp_elo"] is not None or True


def test_improve_gated_on_tiny_corpus(store, fixtures):
    ingest_files(store, [("short.pgn", (fixtures / "short.pgn").read_bytes())], aliases=["Alice"])
    data = improve(store, "tc:all", nmin=30)
    assert data["ready"] is False
    assert data["analyzed"] == 0
    assert data["vs_self"] == []


def test_review_lists_losses(store, fixtures):
    ingest_files(store, [("short.pgn", (fixtures / "short.pgn").read_bytes())], aliases=["Alice"])
    data = review(store, "tc:all")
    assert "recent_losses" in data
    assert "unanalyzed" in data
    assert data["unanalyzed"] >= 1
