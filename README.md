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
