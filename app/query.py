from __future__ import annotations

import re
from dataclasses import dataclass, field

TOKEN_RE = re.compile(r'([a-zA-Z_]+):("([^"]*)"|(\S+))')
BARE_RE = re.compile(r'"([^"]+)"|\S+')

GAME_TOKENS = {
    "tc",
    "color",
    "eco",
    "opening",
    "analyzed",
    "result",
    "rating",
    "opprating",
    "opponent",
    "year",
    "since",
    "until",
    "castled",
    "length",
    "ratediff",
    "tod",
    "term",
    "evalsrc",
}
PLY_TOKENS = {"material", "material_wb", "pieces", "phase", "entry", "fen"}


@dataclass
class Query:
    raw: str
    tokens: dict[str, str] = field(default_factory=dict)
    bare: list[str] = field(default_factory=list)

    @property
    def has_ply_filter(self) -> bool:
        return any(k in self.tokens for k in PLY_TOKENS) or "castled" in self.tokens


def parse_query(text: str) -> Query:
    text = (text or "").strip()
    tokens: dict[str, str] = {}
    consumed = [0] * len(text)
    for m in TOKEN_RE.finditer(text):
        key = m.group(1).lower()
        val = m.group(3) if m.group(3) is not None else m.group(4)
        tokens[key] = val
        for i in range(m.start(), m.end()):
            consumed[i] = 1
    leftover = "".join(ch if not consumed[i] else " " for i, ch in enumerate(text))
    bare = [m.group(1) or m.group(0) for m in BARE_RE.finditer(leftover) if m.group(0).strip()]
    return Query(raw=text, tokens=tokens, bare=bare)


def _range(val: str) -> tuple[int | None, int | None]:
    if "-" in val:
        a, b = val.split("-", 1)
        return _int(a), _int(b)
    n = _int(val)
    return n, n


def _int(s: str) -> int | None:
    try:
        return int(s)
    except ValueError:
        return None


def _pieces_clause(spec: str) -> tuple[str, list]:
    """pieces:me=R+P,opp=N,no=Q"""
    me = opp = no = ""
    for part in spec.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k, v = k.strip().lower(), v.strip().upper().replace("+", "")
        if k == "me":
            me = v
        elif k in ("opp", "op"):
            opp = v
        elif k == "no":
            no = v
    letter_col = {
        "Q": ("q_w", "q_b"),
        "R": ("r_w", "r_b"),
        "B": ("b_w", "b_b"),
        "N": ("n_w", "n_b"),
        "P": ("p_w", "p_b"),
    }
    clauses = []
    params: list = []
    # Presence is applied after joining you_color: we pick columns in SQL via CASE.
    if me:
        clauses.append("/*me*/ " + " AND ".join(["1=1"] * len(me)))
    return spec, [me, opp, no]


def user_result_sql() -> str:
    return """
    CASE
      WHEN g.you_color = 'white' AND g.result = '1-0' THEN 'win'
      WHEN g.you_color = 'black' AND g.result = '0-1' THEN 'win'
      WHEN g.result = '1/2-1/2' THEN 'draw'
      WHEN g.you_color IS NOT NULL AND g.result IN ('1-0', '0-1') THEN 'loss'
      ELSE g.result
    END
    """


def compile_query(
    q: Query,
    *,
    include_observed: bool,
    default_tc: tuple[str, ...] = (),
    report_depth: int | None,
) -> tuple[str, list, str]:
    """Return (sql selecting matched game_id, ply, params, explanation)."""
    wheres = ["1=1"]
    params: list = []

    if not include_observed:
        wheres.append("g.you_color IS NOT NULL")

    if tc := q.tokens.get("tc"):
        if tc.lower() not in ("all", "*"):
            wheres.append("g.tc_class = ?")
            params.append(tc.lower())
    elif default_tc:
        placeholders = ", ".join(["?"] * len(default_tc))
        wheres.append(f"g.tc_class IN ({placeholders})")
        params.extend(default_tc)

    if color := q.tokens.get("color"):
        wheres.append("g.you_color = ?")
        params.append(color.lower())

    if eco := q.tokens.get("eco"):
        if len(eco) <= 2:
            wheres.append("g.eco_family = ?")
            params.append(eco.upper())
        else:
            wheres.append("g.eco = ?")
            params.append(eco.upper())

    if opening := q.tokens.get("opening"):
        wheres.append("lower(g.opening_name) LIKE ?")
        params.append(f"%{opening.lower()}%")

    if opponent := q.tokens.get("opponent"):
        wheres.append(
            """
            ((g.you_color = 'white' AND lower(g.black) LIKE ?)
              OR (g.you_color = 'black' AND lower(g.white) LIKE ?)
              OR (g.you_color IS NULL AND (lower(g.white) LIKE ? OR lower(g.black) LIKE ?)))
            """
        )
        like = f"%{opponent.lower()}%"
        params.extend([like, like, like, like])

    if year := q.tokens.get("year"):
        wheres.append("CAST(substr(replace(g.utc_date, '.', '-'), 1, 4) AS INTEGER) = ?")
        params.append(int(year))

    if since := q.tokens.get("since"):
        wheres.append("replace(COALESCE(g.utc_date, ''), '.', '-') >= ?")
        params.append(since.replace(".", "-")[:10])

    if until := q.tokens.get("until"):
        wheres.append("replace(COALESCE(g.utc_date, ''), '.', '-') <= ?")
        params.append(until.replace(".", "-")[:10])

    if length := q.tokens.get("length"):
        band = length.lower()
        if band in ("short", "<20"):
            wheres.append("g.ply_count IS NOT NULL AND (g.ply_count + 1) / 2 < 20")
        elif band in ("medium", "20-39"):
            wheres.append("g.ply_count IS NOT NULL AND (g.ply_count + 1) / 2 BETWEEN 20 AND 39")
        elif band in ("long", "40+"):
            wheres.append("g.ply_count IS NOT NULL AND (g.ply_count + 1) / 2 >= 40")

    if rd := q.tokens.get("ratediff"):
        diff_sql = """
            CASE
              WHEN g.you_color = 'white' THEN g.white_elo - g.black_elo
              WHEN g.you_color = 'black' THEN g.black_elo - g.white_elo
            END
        """
        key = rd.lower().replace(" ", "")
        if key in ("down200", "down200+", "-200"):
            wheres.append(f"({diff_sql}) <= -200")
        elif key in ("down", "down80"):
            wheres.append(f"({diff_sql}) <= -80 AND ({diff_sql}) > -200")
        elif key in ("even", "0"):
            wheres.append(f"({diff_sql}) > -80 AND ({diff_sql}) < 80")
        elif key in ("up", "up80"):
            wheres.append(f"({diff_sql}) >= 80 AND ({diff_sql}) < 200")
        elif key in ("up200", "up200+", "+200"):
            wheres.append(f"({diff_sql}) >= 200")

    if tod := q.tokens.get("tod"):
        hour_sql = "TRY_CAST(split_part(COALESCE(g.utc_time, ''), ':', 1) AS INTEGER)"
        key = tod.lower()
        if key == "night":
            wheres.append(f"({hour_sql}) < 6")
        elif key == "morning":
            wheres.append(f"({hour_sql}) >= 6 AND ({hour_sql}) < 12")
        elif key == "afternoon":
            wheres.append(f"({hour_sql}) >= 12 AND ({hour_sql}) < 18")
        elif key == "evening":
            wheres.append(f"({hour_sql}) >= 18")

    if term := q.tokens.get("term"):
        t = term.lower()
        if t in ("flag", "mate", "resign", "abandon", "normal"):
            wheres.append("g.termination = ?")
            params.append(t)

    if evalsrc := q.tokens.get("evalsrc"):
        key = evalsrc.lower()
        if key in ("pgn", "lichess", "lichess-pgn"):
            wheres.append(
                "EXISTS (SELECT 1 FROM evaluations e WHERE e.game_id = g.game_id AND e.engine_version = 'lichess-pgn')"
            )
        elif key in ("stockfish", "engine"):
            wheres.append(
                "EXISTS (SELECT 1 FROM evaluations e WHERE e.game_id = g.game_id AND COALESCE(e.engine_version, '') <> 'lichess-pgn')"
            )
        elif key in ("none", "no"):
            wheres.append("NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.game_id = g.game_id)")

    if rating := q.tokens.get("rating"):
        lo, hi = _range(rating)
        wheres.append(
            """
            ((g.you_color = 'white' AND g.white_elo BETWEEN ? AND ?)
              OR (g.you_color = 'black' AND g.black_elo BETWEEN ? AND ?))
            """
        )
        params.extend([lo, hi, lo, hi])

    if oppr := q.tokens.get("opprating"):
        lo, hi = _range(oppr)
        wheres.append(
            """
            ((g.you_color = 'white' AND g.black_elo BETWEEN ? AND ?)
              OR (g.you_color = 'black' AND g.white_elo BETWEEN ? AND ?))
            """
        )
        params.extend([lo, hi, lo, hi])

    if result := q.tokens.get("result"):
        r = result.lower()
        if r in ("win", "loss", "draw"):
            wheres.append(f"({user_result_sql()}) = ?")
            params.append(r)
        else:
            wheres.append("g.result = ?")
            params.append(result)

    if q.tokens.get("analyzed") == "yes" and report_depth is not None:
        wheres.append("g.analysis_status = 'complete' AND g.analysis_depth >= ?")
        params.append(report_depth)

    if variant_standard := True:
        if "variant" not in q.tokens:
            pass  # stored; default views still include all unless opening stats

    for word in q.bare:
        like = f"%{word.lower()}%"
        wheres.append("(lower(g.opening_name) LIKE ? OR lower(g.white) LIKE ? OR lower(g.black) LIKE ?)")
        params.extend([like, like, like])

    ply_wheres = ["1=1"]
    if phase := q.tokens.get("phase"):
        ply_wheres.append("m.phase = ?")
        params.append(phase.lower())

    if mat := q.tokens.get("material"):
        ply_wheres.append("m.material_you = ?")
        params.append(classify_sig(mat))

    if mat_wb := q.tokens.get("material_wb"):
        ply_wheres.append("m.material_wb = ?")
        params.append(classify_sig(mat_wb))

    if pieces := q.tokens.get("pieces"):
        clause, extra = pieces_sql(pieces)
        ply_wheres.append(clause)
        params.extend(extra)

    if "fen" in q.tokens:
        norm = fen_norm_token(q.tokens["fen"])
        if norm is None:
            ply_wheres.append("1=0")
        else:
            ply_wheres.append("m.fen_norm = ?")
            params.append(norm)

    if castled := q.tokens.get("castled"):
        kind = castled.lower()
        if kind == "opposite":
            wheres.append("g.opposite_side = TRUE")
        else:
            wheres.append("g.user_castled = ?")
            params.append(kind)
        ply_wheres.append("(g.user_castle_ply IS NULL OR m.ply >= g.user_castle_ply)")

    if entry := q.tokens.get("entry"):
        band = entry.lower()
        if band == "winning":
            ply_wheres.append(
                """
                EXISTS (
                  SELECT 1 FROM spans s
                  WHERE s.game_id = m.game_id AND m.ply BETWEEN s.start_ply AND s.end_ply
                    AND s.entry_winpct >= 70
                    AND ( ? IS NULL OR s.material_you = ? )
                )
                """
            )
            mat_you = classify_sig(q.tokens["material"]) if "material" in q.tokens else None
            params.extend([mat_you, mat_you])
        elif band == "losing":
            ply_wheres.append(
                """
                EXISTS (
                  SELECT 1 FROM spans s
                  WHERE s.game_id = m.game_id AND m.ply BETWEEN s.start_ply AND s.end_ply
                    AND s.entry_winpct <= 30
                    AND ( ? IS NULL OR s.material_you = ? )
                )
                """
            )
            mat_you = classify_sig(q.tokens["material"]) if "material" in q.tokens else None
            params.extend([mat_you, mat_you])
        elif band == "balanced":
            ply_wheres.append(
                """
                EXISTS (
                  SELECT 1 FROM spans s
                  WHERE s.game_id = m.game_id AND m.ply BETWEEN s.start_ply AND s.end_ply
                    AND s.entry_winpct > 30 AND s.entry_winpct < 70
                    AND ( ? IS NULL OR s.material_you = ? )
                )
                """
            )
            mat_you = classify_sig(q.tokens["material"]) if "material" in q.tokens else None
            params.extend([mat_you, mat_you])

    game_where = " AND ".join(wheres)
    ply_where = " AND ".join(ply_wheres)
    sql = f"""
    SELECT m.game_id, m.ply
    FROM moves m
    JOIN games g ON g.game_id = m.game_id
    WHERE {game_where} AND {ply_where}
    """
    return sql, params, sql


def classify_sig(token: str) -> str:
    t = token.replace(" ", "").upper()
    parts = re.split(r"V", t, maxsplit=1)
    if len(parts) == 2:
        return f"{parts[0]}v{parts[1]}"
    return t


def fen_norm_token(raw: str) -> str | None:
    """Normalize a FEN query value to moves.fen_norm. None if it cannot be parsed."""
    import chess

    from app.classify import fen_norm

    text = (raw or "").strip()
    if not text:
        return None
    try:
        return fen_norm(chess.Board(text))
    except Exception:
        return None


_PIECE_COL = {"Q": "q", "R": "r", "B": "b", "N": "n", "P": "p"}


def _piece_atoms(raw: str) -> list[tuple[str, str]]:
    """Parse Q, R+P, 0Q, or !Q into (letter, 'has'|'zero')."""
    s = raw.upper().replace(" ", "")
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(s):
        if s[i] == "+":
            i += 1
            continue
        kind = "has"
        if s[i] in ("0", "!"):
            kind = "zero"
            i += 1
        if i >= len(s) or s[i] not in _PIECE_COL:
            i += 1
            continue
        out.append((s[i], kind))
        i += 1
    return out


def pieces_sql(spec: str) -> tuple[str, list]:
    """pieces:me=R+P,opp=N,no=Q

    me/opp letters mean that side has at least one. Prefix 0 or ! means that
    side has zero (opp=0Q, opp=!Q). no= still means both sides have zero.
    """
    me = opp = no = ""
    for part in spec.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k, v = k.strip().lower(), v.strip()
        if k == "me":
            me = v
        elif k in ("opp", "op"):
            opp = v
        elif k == "no":
            no = v

    def side_expr(letter: str, mine: bool) -> str:
        c = _PIECE_COL[letter]
        if mine:
            return f"CASE WHEN g.you_color = 'black' THEN m.{c}_b ELSE m.{c}_w END"
        return f"CASE WHEN g.you_color = 'black' THEN m.{c}_w ELSE m.{c}_b END"

    bits = ["1=1"]
    for letter, kind in _piece_atoms(me):
        op = ">= 1" if kind == "has" else "= 0"
        bits.append(f"{side_expr(letter, True)} {op}")
    for letter, kind in _piece_atoms(opp):
        op = ">= 1" if kind == "has" else "= 0"
        bits.append(f"{side_expr(letter, False)} {op}")
    for letter, _kind in _piece_atoms(no):
        bits.append(f"(m.{_PIECE_COL[letter]}_w + m.{_PIECE_COL[letter]}_b) = 0")
    return "(" + " AND ".join(bits) + ")", []
