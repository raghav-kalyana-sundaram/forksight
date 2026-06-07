import math

from app.accuracy import game_accuracy, move_accuracy, score_moves, winpct_from_cp, MoveEval


def test_per_move_formula_to_tenth():
    # Hand-computed: cp 0 -> 50 win%, cp -200 after a white move.
    before = winpct_from_cp(0)
    after = winpct_from_cp(-200)
    assert abs(before - 50.0) < 0.01
    expected_loss = before - after
    expected = 103.1668 * math.exp(-0.04354 * expected_loss) - 3.1669
    got = move_accuracy(before, after)
    assert abs(got - expected) < 0.1
    assert 0 <= got <= 100


def test_aggregation_below_plain_mean_with_one_blunder():
    moves = [
        MoveEval(1, True, 15, 20),
        MoveEval(2, False, 20, 15),
        MoveEval(3, True, 15, 20),
        MoveEval(4, False, 20, 15),
        MoveEval(5, True, 15, 20),
        MoveEval(6, False, 20, 15),
        MoveEval(7, True, 15, -400),  # blunder
        MoveEval(8, False, -400, -390),
    ]
    scored = score_moves(moves)
    white = [s for s in scored if s.mover_is_white]
    plain = sum(s.accuracy for s in white) / len(white)
    game_w, _ = game_accuracy(scored)
    assert game_w is not None
    assert game_w < plain


def test_move_classes():
    scored = score_moves([MoveEval(1, True, 0, 0), MoveEval(2, True, 0, -80), MoveEval(3, True, 0, -400)])
    assert scored[0].move_class == "best"
    assert scored[2].move_class == "blunder"
