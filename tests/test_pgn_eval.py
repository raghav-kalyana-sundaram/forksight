from pathlib import Path

from app.ingest import _termination, ingest_files
from app.pgn_eval import eval_from_comment, parse_eval_token
from app.stats import explorer, games_table, insights

CORPUS = Path(__file__).resolve().parents[1] / "lichess_game_2026-08-30.pgn"


def test_eval_tokens():
    assert parse_eval_token("0.24") == 24
    assert parse_eval_token("-1.63") == -163
    assert parse_eval_token("#-11") < -9000
    assert eval_from_comment("{ [%eval 2.95] [%clk 0:09:01] }") == 295


def test_mate_from_last_san():
    assert _termination("Normal", "Qg1#") == "mate"
    assert _termination("Time forfeit", "Qf6") == "flag"


def test_lichess_pgn_scores_and_alias(store):
    raw = CORPUS.read_text(encoding="utf-8")
    snippet = "\n\n\n".join(raw.split("\n\n\n")[:4])
    report = ingest_files(store, [("snip.pgn", snippet.encode())], aliases=[])
    assert report.inserted == 4
    assert report.with_evals >= 3
    assert report.personal == 4
    terms = {r[0] for r in store.fetchall("SELECT termination FROM games")}
    assert "flag" in terms
    assert "mate" in terms
    row = store.fetchone("SELECT you_color, analysis_status, accuracy FROM games WHERE termination = 'mate'")
    assert row[0] == "black"
    assert row[1] == "complete"
    assert row[2] is not None
    data = games_table(store, "tc:all")
    assert any(r["eval_source"] == "lichess-pgn" for r in data["rows"])
    assert data["expected"] is not None
    assert any(r["user_result"] == "win" for r in data["rows"])
    groups = insights(store, "tc:all")["groups"]
    assert any(r["key"] == "mate" for r in groups["termination"])
    tree = explorer(store, uci_prefix=[])
    assert tree["moves"]
