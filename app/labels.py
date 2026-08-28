"""Chess-language labels. Signatures and ECO stems stay in the store; this is display."""

from __future__ import annotations

from datetime import datetime

PIECE_VALUE = {"Q": 9, "R": 5, "B": 3, "N": 3, "P": 1}
PIECE_ORDER = ("Q", "R", "B", "N", "P")

# First two characters of ECO, which is how eco_family is stored.
ECO_FAMILY_NAMES = {
    "A0": "Irregular / Polish",
    "A1": "English",
    "A2": "English",
    "A3": "English",
    "A4": "English / Queen’s pawn",
    "A5": "English / Indian",
    "A6": "Benoni / Indian",
    "A7": "Benoni",
    "A8": "Dutch",
    "A9": "Dutch",
    "B0": "King’s pawn / uncommon",
    "B1": "Caro-Kann",
    "B2": "Sicilian",
    "B3": "Sicilian",
    "B4": "Sicilian",
    "B5": "Sicilian",
    "B6": "Sicilian",
    "B7": "Sicilian",
    "B8": "Sicilian",
    "B9": "Sicilian",
    "C0": "French",
    "C1": "French",
    "C2": "King’s pawn open",
    "C3": "King’s gambit",
    "C4": "King’s knight",
    "C5": "Italian",
    "C6": "Spanish",
    "C7": "Spanish",
    "C8": "Spanish",
    "C9": "Spanish",
    "D0": "Queen’s pawn",
    "D1": "Slav",
    "D2": "Queen’s gambit accepted",
    "D3": "Queen’s gambit declined",
    "D4": "Queen’s gambit declined",
    "D5": "Queen’s gambit declined",
    "D6": "Queen’s gambit declined",
    "D7": "Grünfeld",
    "D8": "Grünfeld",
    "D9": "Grünfeld",
    "E0": "Queen’s pawn / Indian",
    "E1": "Queen’s Indian / Catalan",
    "E2": "Nimzo-Indian / Queen’s Indian",
    "E3": "Nimzo-Indian",
    "E4": "Nimzo-Indian",
    "E5": "Nimzo-Indian",
    "E6": "King’s Indian",
    "E7": "King’s Indian",
    "E8": "King’s Indian",
    "E9": "King’s Indian",
}

MOVE_GLYPH = {
    "best": "",
    "good": "",
    "inaccuracy": "?!",
    "mistake": "?",
    "blunder": "??",
}


def counts_from_signature(side: str) -> dict[str, int]:
    return {p: side.count(p) for p in PIECE_ORDER}


def _side_short(counts: dict[str, int]) -> str:
    parts = [p for p in PIECE_ORDER if counts.get(p)]
    if counts.get("P"):
        n = counts["P"]
        parts = [p for p in parts if p != "P"] + ([f"{n}P" if n > 1 else "P"])
    return "+".join(parts) if parts else "K"


def _value(counts: dict[str, int]) -> int:
    return sum(PIECE_VALUE[p] * counts.get(p, 0) for p in PIECE_ORDER)


def parse_material_you(sig: str | None) -> tuple[dict[str, int], dict[str, int]] | None:
    if not sig or "v" not in sig:
        return None
    left, _, right = sig.partition("v")
    return counts_from_signature(left), counts_from_signature(right)


def material_imbalance(sig: str | None) -> str:
    """Human label: 'up a pawn', 'R+P vs R', 'equal material'."""
    parsed = parse_material_you(sig)
    if not parsed:
        return "unknown"
    me, opp = parsed
    if me == opp:
        if me == {"Q": 1, "R": 2, "B": 2, "N": 2, "P": 8}:
            return "starting position"
        if me["B"] == 1 and me["Q"] == me["R"] == me["N"] == 0:
            extra = f" + {me['P']}P" if me["P"] else ""
            return f"bishop ending{extra}"
        return "equal material"

    dv = _value(me) - _value(opp)
    dq = me["Q"] - opp["Q"]
    dr = me["R"] - opp["R"]
    db = me["B"] - opp["B"]
    dn = me["N"] - opp["N"]
    dp = me["P"] - opp["P"]
    d_minor = db + dn

    # Opposite-colour bishops: each side one bishop, no other minors/queens, rooks equal.
    if me["B"] == 1 and opp["B"] == 1 and me["Q"] == opp["Q"] == 0 and me["N"] == opp["N"] == 0 and me["R"] == opp["R"]:
        extra = " + pawn" if dp == 1 else " + pawns" if dp > 1 else " − pawn" if dp == -1 else " − pawns" if dp < -1 else ""
        return f"opposite-colour bishops{extra}"

    if dq == 0 and dr == 1 and d_minor == -1 and abs(dp) <= 1:
        return "up the exchange" if dp >= 0 else "up the exchange, down a pawn"
    if dq == 0 and dr == -1 and d_minor == 1 and abs(dp) <= 1:
        return "down the exchange" if dp <= 0 else "down the exchange, up a pawn"

    if dq == 0 and dr == 0 and d_minor == 0:
        if dp == 1:
            return "up a pawn"
        if dp == -1:
            return "down a pawn"
        if dp > 1:
            return f"up {dp} pawns"
        if dp < -1:
            return f"down {-dp} pawns"

    if dq == 0 and dr == 0 and d_minor == 1 and dp == 0:
        return "up a piece"
    if dq == 0 and dr == 0 and d_minor == -1 and dp == 0:
        return "down a piece"
    if dq == 0 and dr == 0 and d_minor == 1 and dp < 0:
        return f"up a piece, down {-dp} pawn" + ("s" if dp < -1 else "")
    if dq == 0 and dr == 0 and d_minor == -1 and dp > 0:
        return f"down a piece, up {dp} pawn" + ("s" if dp > 1 else "")

    me_s = _side_short(me)
    opp_s = _side_short(opp)
    if me_s == opp_s:
        if dv > 0:
            return f"{me_s} vs {opp_s}, up {dv}"
        if dv < 0:
            return f"{me_s} vs {opp_s}, down {-dv}"
    return f"{me_s} vs {opp_s}"


def material_class_key(sig: str | None) -> str:
    """Coarse bucket for grouping — not the raw 33-character signature."""
    return material_imbalance(sig)


def eco_family_name(family: str | None) -> str:
    if not family:
        return "Unknown"
    return ECO_FAMILY_NAMES.get(family.upper(), family)


def opening_label(name: str | None, eco: str | None, family: str | None) -> str:
    if name:
        return name
    if eco:
        fam = eco_family_name(family or eco[:2])
        return f"{fam} ({eco})"
    return eco_family_name(family)


def user_result(you_color: str | None, pgn_result: str | None) -> str | None:
    if pgn_result == "1/2-1/2":
        return "draw"
    if you_color == "white" and pgn_result == "1-0":
        return "win"
    if you_color == "black" and pgn_result == "0-1":
        return "win"
    if you_color in ("white", "black") and pgn_result in ("1-0", "0-1"):
        return "loss"
    return None


def format_pgn_date(raw: str | None) -> str:
    if not raw:
        return ""
    text = raw.strip().replace(".", "-")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).strftime("%-d %b %Y")
        except ValueError:
            continue
    return raw


def format_clock(centis: int | None) -> str:
    if centis is None:
        return ""
    s = max(0, int(centis) // 100)
    return f"{s // 60}:{s % 60:02d}"


def rating_diff_band(diff: int | None) -> str | None:
    if diff is None:
        return None
    if diff <= -200:
        return "down 200+"
    if diff <= -80:
        return "down 80–199"
    if diff < 80:
        return "even"
    if diff < 200:
        return "up 80–199"
    return "up 200+"


def hour_band(utc_time: str | None) -> str | None:
    if not utc_time:
        return None
    try:
        hour = int(str(utc_time).split(":")[0])
    except ValueError:
        return None
    if hour < 6:
        return "night (00–06)"
    if hour < 12:
        return "morning (06–12)"
    if hour < 18:
        return "afternoon (12–18)"
    return "evening (18–24)"


def length_band(ply_count: int | None) -> str | None:
    if ply_count is None:
        return None
    moves = (int(ply_count) + 1) // 2
    if moves < 20:
        return "short (<20 moves)"
    if moves < 40:
        return "medium (20–39)"
    return "long (40+)"


def castle_relationship(user: str | None, opp: str | None) -> str:
    if user and opp:
        if user != opp:
            return "opposite-side"
        return f"both {user}"
    if user:
        return f"you {user}, they none"
    if opp:
        return f"you none, they {opp}"
    return "neither castled"


def score_display(score: float | None, n: int) -> str | None:
    """Refuse fake precision on tiny n."""
    if score is None or n <= 0:
        return None
    if n < 5:
        return None
    pct = score * 100
    if n < 20:
        return f"{pct:.0f}%"
    return f"{pct:.1f}%"


def acc_display(acc: float | None, n: int | None = None) -> str | None:
    if acc is None:
        return None
    if n is not None and n < 3:
        return None
    if n is not None and n < 10:
        return f"{acc:.0f}"
    return f"{acc:.1f}"
