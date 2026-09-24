import chess

from app.classify import fen_norm
from app.ingest import ingest_files
from app.query import compile_query, parse_query, pieces_sql
from app.stats import insights, run_query


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


def test_quoted_opening_and_term():
    q = parse_query('opening:"French Defense: Réti-Spielmann Attack" term:flag year:2017')
    assert q.tokens["opening"] == "French Defense: Réti-Spielmann Attack"
    assert q.tokens["term"] == "flag"
    assert q.tokens["year"] == "2017"


def _compile(text: str) -> tuple[str, list]:
    q = parse_query(text)
    sql, params, _generated = compile_query(q, include_observed=True, report_depth=None)
    return sql, params


def test_fen_token_compiles_to_fen_norm():
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e6 0 1"
    sql, params = _compile(f'fen:"{fen}"')
    expected = fen_norm(chess.Board(fen))
    assert "m.fen_norm = ?" in sql
    assert expected in params
    assert expected == fen_norm(chess.Board(fen.replace("0 1", "7 12")))
    sql_clocks, params_clocks = _compile(f'fen:"{fen.replace("0 1", "7 12")}"')
    assert params_clocks == params
    assert "m.fen_norm = ?" in sql_clocks
    assert parse_query(f'fen:"{fen}"').has_ply_filter


def test_invalid_fen_does_not_throw():
    sql, params = _compile('fen:"not a fen"')
    assert "1=0" in sql
    assert not any(isinstance(p, str) and " " in p for p in params)
    sql_empty, _ = _compile('fen:""')
    assert "1=0" in sql_empty


def test_pieces_sql_side_counts():
    sql, _params = _compile("pieces:me=R+P,opp=N,no=Q")
    assert "CASE WHEN g.you_color = 'black' THEN m.r_b ELSE m.r_w END >= 1" in sql
    assert "CASE WHEN g.you_color = 'black' THEN m.p_b ELSE m.p_w END >= 1" in sql
    assert "CASE WHEN g.you_color = 'black' THEN m.n_w ELSE m.n_b END >= 1" in sql
    assert "(m.q_w + m.q_b) = 0" in sql
    only, _ = pieces_sql("me=Q,opp=0Q")
    assert "CASE WHEN g.you_color = 'black' THEN m.q_b ELSE m.q_w END >= 1" in only
    assert "CASE WHEN g.you_color = 'black' THEN m.q_w ELSE m.q_b END = 0" in only
    bang, _ = pieces_sql("opp=!Q")
    assert "CASE WHEN g.you_color = 'black' THEN m.q_w ELSE m.q_b END = 0" in bang


def test_insights_positions_and_pieces(store):
    games = []
    results = ("1-0", "0-1", "1/2-1/2")
    for i, result in enumerate(results):
        games.append(
            (
                f"g{i}.pgn",
                (
                    f'[White "Alice"]\n[Black "Bob{i}"]\n[Result "{result}"]\n'
                    f'[Site "https://lichess.org/pos{i}"]\n[UTCDate "2025.01.0{i+1}"]\n'
                    f'[TimeControl "300+0"]\n\n1. e4 e5 2. Nf3 Nc6 {result}\n'
                ).encode(),
            )
        )
    ingest_files(store, games, aliases=["Alice"])
    groups = insights(store, "")["groups"]
    positions = groups["positions"]
    assert positions
    assert len(positions) <= 30
    assert all(row["n"] >= 3 for row in positions)
    assert all(row["query"] == f'fen:"{row["key"]}"' for row in positions)
    assert positions[0]["n"] >= positions[-1]["n"]
    assert "to move" in positions[0]["label"]
    assert "ply " in positions[0]["label"]
    start = fen_norm(chess.Board())
    assert all(row["key"] != start for row in positions)
    pieces = groups["pieces"]
    both = next(row for row in pieces if row["query"] == "pieces:me=Q,opp=Q")
    assert both["n"] == 3
    assert both["wins"] + both["draws"] + both["losses"] == 3
    assert {row["query"] for row in pieces} <= {
        "pieces:no=Q",
        "pieces:me=Q,opp=0Q",
        "pieces:opp=Q,me=0Q",
        "pieces:me=Q,opp=Q",
        "pieces:no=QBN,me=R,opp=R",
        "pieces:no=QR",
    }
    assert all(row["n"] > 0 for row in pieces)
    material_queries = [row["query"] for row in groups["material"] if row.get("query")]
    assert material_queries
    assert all(q.startswith("material:") for q in material_queries)


def test_grain_counts(store, fixtures):
    ingest_files(store, [("short.pgn", (fixtures / "short.pgn").read_bytes())], aliases=["Alice"])
    whole = run_query(store, "color:white")
    assert whole["games"] == 1
    assert whole["plies"] == store.fetchone("SELECT ply_count FROM games")[0]
    windowed = run_query(store, "phase:opening color:white")
    assert windowed["games"] == 1
    assert windowed["plies"] <= whole["plies"]
