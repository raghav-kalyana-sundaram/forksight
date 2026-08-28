"""Pull a user's PGN from the public Lichess export API."""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request

LICHESS_UA = "ForkSight/1.1 (local chess notebook)"


def fetch_user_pgn(username: str, max_games: int = 200) -> bytes:
    name = (username or "").strip()
    if not name:
        raise ValueError("username required")
    max_games = max(1, min(int(max_games), 500))
    qs = urllib.parse.urlencode(
        {
            "max": str(max_games),
            "clocks": "true",
            "opening": "true",
            "evals": "false",
            "literate": "false",
        }
    )
    url = f"https://lichess.org/api/games/user/{urllib.parse.quote(name)}?{qs}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/x-chess-pgn", "User-Agent": LICHESS_UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError(f"Lichess user {name!r} not found") from exc
        if exc.code == 429:
            raise ValueError("Lichess rate-limited the request. Wait a minute and try again.") from exc
        raise ValueError(f"Lichess returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Could not reach Lichess: {exc.reason}") from exc
