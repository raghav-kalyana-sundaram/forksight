# ForkSight

ForkSight is a local analytics app for your own chess games. You can import a PGN from Lichess or Chess.com, filter it to a slice, and see where your rating points leak.

The outcome is the game score, a win is 1, and a draw is 1/2, set next to the Elo expected score from the two ratings. Accuracy, from the published Lichess formula, checks your moves in finished analyses. Improve ranks slices by extra losses per 100 games against your own score in the filter: a small sample is shrunk toward that baseline, and a row is shown only when the low end of a Wilson interval stays above zero. A rate with fewer than five games is withheld. The engine default is depth 15, a laptop limit that will miss some blitz tactics. Peer numbers appear only when population cubes are present. Filters select games; win and loss use the PGN result; accuracy and clock use only the matched plies. Every header states both counts.

Games is the ledger, including the moves in recent losses that cost the most win probability. Insights splits the current filter into slices you can open. Analyze runs Stockfish, or reads `[%eval]` comments already in a Lichess PGN. Board is the position. SQL is the same database, read-only.

A PGN is ingested into one DuckDB file (`app/ingest.py`). A small query language compiles to SQL (`app/query.py`). The rollups and the Improve ranking are in `app/stats.py`. The browser is a static page and talks only to a JSON API on `127.0.0.1`. There is no account and no telemetry. Stockfish runs as a child process you download yourself. The SQL panel uses that same connection, inside a transaction that is rolled back, and accepts one SELECT or WITH. Tests cover ingest, the query compiler, accuracy, and the phase divider.

## Run

Python 3.11 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
python -m app.server serve
```

Open http://127.0.0.1:7437. Set your Lichess username under aliases, then import a PGN. On Lichess: Profile → Games → Download. Leave the clocks on.

Stockfish is not bundled. Download the official binary with `python tools/download_stockfish.py`, or set its path in Settings. Optional 5-piece Syzygy tables go in `user_data/syzygy/`.

A desktop window, after `pip install -e ".[desktop]"`:

```bash
python -m app.server desktop
```

## Queries

Tokens are `key:value`, combined with AND. A bare word searches opening names and opponent names.

```
tc:blitz color:white
material:KRPvKP phase:endgame
castled:long
eco:B90
opening:Sicilian rating:1600-1800
pieces:me=R+P,opp=N,no=Q
entry:winning analyzed:yes
```

A game matches a ply-level token when at least one ply satisfies it. Material rows can share a game, so those counts do not add up to the filter. Chess960 stays out of ECO, the opening explorer, and castling rollups. Games that match none of your aliases are stored and stay out of personal rollups unless you include them.

## Definitions

The cutoffs below are the ones the pages use. Accuracy and the phase divider are reimplemented from Lichess’s published descriptions. The lila source is not copied. Third-party licences are in `NOTICE`.

### Time class

`estimate = B + 40 * I`, with B the initial clock in seconds and I the increment.

| Class | Rule |
| --- | --- |
| bullet | estimate < 180 |
| blitz | 180 ≤ estimate < 480 |
| rapid | 480 ≤ estimate < 1500 |
| classical | estimate ≥ 1500 |
| daily | correspondence, or B ≥ 86400 |

The default filter is blitz and rapid. 2+10 is rapid. 5+3 is blitz.

### Improve

```
extra losses per 100 = 100 * (baseline − shrunk score)
shrunk score = baseline + (n / (n + k)) * (raw score − baseline)
```

The interval is a Wilson interval on the slice score. Rank is the low end of the gap. The baseline is your score in the current filter, or the peer score when cubes exist. The default minimum is 30 analyzed games. The figure describes the games you played.

### Phase

The middlegame begins at the first ply where any of these is true: the non-king, non-pawn count is 10 or less; either back rank has fewer than four of that side’s pieces; mixedness is above 150. The endgame begins at the first later ply where that count is 6 or less. If the middlegame never starts, the whole game is opening.

Mixedness sums a score over every 2×2 region. `y` is the 1-based rank of the region’s lower edge, with the a1 side as 1. Piece counts in the region include kings. The table is implemented in `app/divider.py`.

| W\B | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1+y | y<6 ? 2+(6-y) : 0 | y<7 ? 3+(7-y) : 0 | y<7 ? 3+(7-y) : 0 |
| 1 | 1+(8-y) | 5+\|4-y\| | 4+(7-y) | 5+(7-y) | 0 |
| 2 | y>2 ? 2+(y-2) : 0 | 4+(y-1) | 7 | 0 | 0 |
| 3 | y>1 ? 3+(y-1) : 0 | 5+(y-1) | 0 | 0 | 0 |
| 4 | y>1 ? 3+(y-1) : 0 | 0 | 0 | 0 | 0 |

### Material

Stored as white versus black, pieces Q, R, B, N, P, kings implied: `KRPPvKR`. The `material:` token is from your side, mirrored when you played Black. `material_wb:` is literal. A span starts at the first ply with that signature and ends when it changes. Entry evaluation is your win percent at the first ply. Reached classes split into entered winning (70 or above), balanced, and entered losing (30 or below).

### Accuracy

```
Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
Accuracy% = 103.1668 * exp(-0.04354 * (win%_before - win%_after)) - 3.1669
```

Clamped to [0, 100]. Before and after are from the side that moved. For mate, `cp = sign * (10000 − 50 * moves_to_mate)`.

Game accuracy averages a volatility-weighted mean and a harmonic mean. The window is `clamp(plies / 10, 2, 8)`. A window’s weight is the standard deviation of win percent inside it, clamped to [0.5, 12]. The first window is repeated so every move has a weight. The starting evaluation is +15 centipawns for White.

`[%eval]` comments in a Lichess PGN are scored with this formula and count as analyzed. Report depth is the highest depth every complete game reached, unless you override it. Unfinished analyses stay out of game-level accuracy and still count in ply measures, marked partial.

Move classes are cut on win-percent loss: best under 2, good under 5, inaccuracy under 10, mistake under 20, blunder at 20 or more. MultiPV of 2 or higher also stores an only-move (best minus second above 12) and a missed win (best at least 90, played under 50).

### Rating

Peer bands run from 1200–1399 through 2200–2399, then 2400 and above. A join uses your band and your opponent’s. A missing opponent band falls back to your band alone and is labelled that way. Rating-gap rows are down 200 or more, down 80–199, even, up 80–199, and up 200 or more.

