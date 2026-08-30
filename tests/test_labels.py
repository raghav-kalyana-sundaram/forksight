from app.labels import eco_family_name, format_pgn_date, material_imbalance, score_display, term_label, user_result


def test_starting_and_equal():
    assert material_imbalance("KQRRBBNNPPPPPPPPvKQRRBBNNPPPPPPPP") == "starting position"
    assert material_imbalance("KRRPPvKRRPP") == "equal material"


def test_pawn_and_exchange():
    assert material_imbalance("KQRRBNPPPPPPPvKQRRBNPPPPPP") == "up a pawn"
    assert material_imbalance("KRPvKR") == "up a pawn"
    assert material_imbalance("KRvKB") == "up the exchange"
    assert material_imbalance("KBvKR") == "down the exchange"


def test_endgame_words():
    label = material_imbalance("KRPvK")
    assert "R" in label and "P" in label
    assert "bishop" in material_imbalance("KBvKB")


def test_eco_names():
    assert eco_family_name("C0") == "French"
    assert eco_family_name("C9") == "Spanish"
    assert eco_family_name("D5") == "Queen’s gambit declined"


def test_user_result_is_player_relative():
    assert user_result("black", "0-1") == "win"
    assert user_result("white", "0-1") == "loss"
    assert user_result("white", "1/2-1/2") == "draw"


def test_score_hidden_on_tiny_n():
    assert score_display(1.0, 1) is None
    assert score_display(0.5, 4) is None
    assert score_display(0.5, 12) == "50%"


def test_term_and_date_labels():
    assert term_label("flag") == "Time forfeit"
    assert term_label("mate") == "Checkmate"
    assert format_pgn_date("2017.07.23") == "23 Jul 2017"
    assert format_pgn_date("2016.11.05") == "5 Nov 2016"
