import chess

from app.divider import backrank_sparse, divide, majors_and_minors, mixedness, mixedness_score


def test_mixedness_table_cells():
    assert mixedness_score(1, 0, 0) == 0
    assert mixedness_score(3, 1, 0) == 1 + (8 - 3)
    assert mixedness_score(2, 2, 0) == 0
    assert mixedness_score(4, 2, 0) == 2 + (4 - 2)
    assert mixedness_score(1, 4, 0) == 0
    assert mixedness_score(3, 4, 0) == 3 + (3 - 1)
    assert mixedness_score(2, 0, 1) == 1 + 2
    assert mixedness_score(3, 1, 1) == 5 + abs(4 - 3)
    assert mixedness_score(5, 2, 2) == 7
    assert mixedness_score(6, 0, 2) == 0
    assert mixedness_score(4, 0, 2) == 2 + (6 - 4)


def test_start_position_not_middlegame():
    board = chess.Board()
    assert majors_and_minors(board) == 14
    assert not backrank_sparse(board)
    assert mixedness(board) <= 150
    div = divide([board])
    assert div.middle is None


def test_sparse_backrank_triggers():
    board = chess.Board("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/4K3 w kq - 0 1")
    assert backrank_sparse(board)


def test_endgame_six_minors():
    start = chess.Board()
    # 8 majors/minors → middlegame, not yet endgame
    mid = chess.Board("r2qk2r/ppp2ppp/2n5/3pp3/3PP3/2N5/PPP2PPP/R2QK2R w KQkq - 0 8")
    end = chess.Board("4k3/4p3/8/8/8/8/4P3/4K2R w - - 0 1")
    assert majors_and_minors(mid) == 8
    assert majors_and_minors(end) == 1
    div = divide([start, mid, end])
    assert div.middle == 1
    assert div.end == 2
    assert div.phase_for_ply(0) == "opening"
    assert div.phase_for_ply(1) == "middlegame"
    assert div.phase_for_ply(2) == "endgame"
