# BlunderCheck

Find it. Fix it. Drill it. — A desktop chess app that imports your PGNs, runs local Stockfish analysis to find blunders and missed punishments, classifies them with CLAMP/K labels, and drills them via built-in spaced-repetition flashcards.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron via `electron-vite` (main / preload / renderer) |
| Language | TypeScript throughout |
| UI | React 18, Tailwind CSS 4, `chessground` (Lichess board), `chess.js`, `recharts` |
| Storage | SQLite via `better-sqlite3` (main process, DB in Electron `userData`) |
| Engine | Hybrid — bundled `stockfish` WASM (zero-config) + optional native Stockfish binary over UCI |

## Setup

```bash
# Install dependencies (postinstall rebuilds better-sqlite3 for Electron)
npm install

# Start Electron + Vite dev server
npm run dev

# Typecheck main/preload/shared and renderer
npm run typecheck

# Production build to out/
npm run build

# Run the production build
npm run start
```

### Native module notes

`better-sqlite3` is a native addon compiled against Electron's ABI. This happens automatically via `postinstall`. If it fails, run `npm run rebuild:native` manually.

## How to Use

### 1. Import games

Open the **Import** screen. Paste PGN text or click **Open .pgn File(s)** to load `.pgn` files from disk. Multi-game PGN files are split automatically. For each game, the app auto-detects which side you played based on saved username aliases (configurable in Settings). Override with the dropdown if needed, then click **Import**.

Sample PGN files are provided in `sample_pgns/` for testing.

### 2. Analyze

Go to the **Dashboard** or **Games** screen and click **Analyze Recent**. The engine evaluates every position with MultiPV 3 at the configured preset (Fast ~150 ms, Balanced ~400 ms, Deep ~1200 ms per position). Progress streams to the UI in real time.

Analysis detects:
- **Direct blunders** — your move drops eval by more than the threshold (default 1.0 pawn)
- **Missed punishments** — the opponent blundered but you didn't capitalize
- **Critical positions** — MultiPV gap identifies must-find-the-only-move situations

### 3. Review

The **Game Review** screen shows the board, move list, and evaluation graph. The OBIT panel breaks down:
- **Opening** — name and first inaccuracy
- **Blunders** — each blunder with played/best move, eval loss, engine PV, and CLAMP/K label editor
- **Interesting** — critical positions you can save as flashcards
- **Takeaway** — auto-drafted summary you can edit and save

Click **Save as Card** on any blunder or interesting position to create a flashcard.

### 4. CLAMP/K labels

Each blunder gets up to 3 suggested labels from the rule-based heuristic engine:
- **C**hecks — forcing checks in the PV
- **L**oose pieces — hanging or underdefended pieces
- **A**lignments — pins, skewers, discovered attacks
- **M**obility — trapped pieces, restricted king
- **P**assed pawns — passer-related tactics
- **K**ing safety — mate threats, pawn shield weaknesses

Confirm one primary and up to two secondary labels. These labels are used for analytics and flashcard classification.

### 5. Flashcards

The **Flashcards** screen presents due cards in a 3-step flow:
1. **Classify** — identify the CLAMP/K theme from the position
2. **Play the move** — find the best move on an interactive board
3. **Cloze** — fill in the blank about the pattern

After revealing the answer, grade yourself: **Again / Hard / Good / Easy**. The SM-2 scheduler adjusts intervals accordingly.

### 6. Analytics

The **Analytics** screen shows:
- Blunder counts by CLAMP/K category (bar chart)
- Blunders per game over time (line chart)
- Retention by category from flashcard reviews
- Filters by time control, color, date range, blunder type, and game phase

## Engine Configuration

**Default (WASM):** The bundled `stockfish` npm package runs as a Web Worker — zero configuration needed.

**Native binary:** For stronger analysis, point to a native Stockfish binary in **Settings > Engine Binary Path** (e.g. `/usr/local/bin/stockfish`). The app drives it over UCI via `child_process`. Leave the field empty to use WASM.

**Analysis presets** control time per position:
| Preset | Time/position | Use case |
|--------|--------------|----------|
| Fast | ~150 ms | Quick scan |
| Balanced | ~400 ms | Default |
| Deep | ~1200 ms | Thorough analysis |

## Architecture

```
src/
├── main/              Electron main process
│   ├── db/            SQLite schema, migrations, DAOs
│   ├── engine/        UciEngine abstraction (WASM + native)
│   ├── analysis/      Per-move eval, blunder/missed-punishment detection
│   ├── clampk/        CLAMP/K rule-based heuristics
│   ├── srs/           SM-2 spaced-repetition scheduler
│   ├── ipc/           Typed IPC handlers
│   └── pgn.ts         PGN parsing and multi-game splitting
├── preload/           Typed IPC bridge → window.api
├── renderer/          React app
│   ├── components/    ChessBoard, MoveList, EvalGraph, ClampKEditor, Sidebar
│   ├── pages/         Dashboard, Import, Games, GameReview, Flashcards, Analytics, Settings
│   └── lib/           Chess utility functions
├── shared/            Domain types and full typed IPC contract
└── sample_pgns/       Sample PGN files for testing
```

All chess logic, engine communication, and database access run in the main process. The renderer communicates through a typed preload bridge (`window.api`). Analysis progress streams back as IPC events.

## License

MIT
