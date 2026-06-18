from app.classify import parse_time_control, rating_band, you_color


def test_lichess_estimator_reclassifies_increment():
    assert parse_time_control("60+0").tc_class == "bullet"
    assert parse_time_control("120+1").tc_class == "bullet"
    assert parse_time_control("180+0").tc_class == "blitz"
    assert parse_time_control("180+2").tc_class == "blitz"
    assert parse_time_control("300+3").tc_class == "blitz"  # 5+3 = 420
    assert parse_time_control("120+10").tc_class == "rapid"  # 2+10 = 520
    assert parse_time_control("600+0").tc_class == "rapid"
    assert parse_time_control("1800+0").tc_class == "classical"
    assert parse_time_control("86400+0").tc_class == "daily"
    assert parse_time_control("").tc_class == "unknown"


def test_rating_bands():
    assert rating_band(1199) == "0-1199"
    assert rating_band(1200) == "1200-1399"
    assert rating_band(1610) == "1600-1799"
    assert rating_band(2400) == "2400+"
    assert rating_band(None) is None


def test_aliases_both_sides_observed():
    assert you_color("Alice", "Bob", ["alice"]) == "white"
    assert you_color("Bob", "Alice", ["alice"]) == "black"
    assert you_color("Alice", "Alice", ["alice"]) is None
    assert you_color("X", "Y", ["alice"]) is None
