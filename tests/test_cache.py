import chess

from app.classify import is_history_sensitive, repetition_key


def test_repetition_is_history_sensitive():
    board = chess.Board()
    seen = {}
    assert not is_history_sensitive(board, seen)
    seen[repetition_key(board)] = 1
    assert is_history_sensitive(board, seen)


def test_halfmove_80_is_history_sensitive():
    board = chess.Board()
    board.halfmove_clock = 80
    assert is_history_sensitive(board, {})
    board.halfmove_clock = 79
    assert not is_history_sensitive(board, {})
