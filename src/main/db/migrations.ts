/**
 * Ordered list of schema migrations.
 *
 * Mechanism: each migration has a monotonically increasing `version`; the
 * current schema version is stored in SQLite's `PRAGMA user_version`. On
 * startup every migration with version > user_version runs inside a single
 * transaction, then user_version is bumped.
 *
 * To evolve the schema, append a new entry — never edit an existing one.
 */

export interface Migration {
  version: number
  name: string
  /** SQL statements executed with db.exec(). */
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE games (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        pgn              TEXT    NOT NULL,
        source           TEXT,
        date             TEXT,
        event            TEXT,
        white            TEXT,
        black            TEXT,
        user_color       TEXT    CHECK (user_color IN ('white', 'black')),
        result           TEXT,
        time_control     TEXT,
        opening_name     TEXT,
        analysis_status  TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (analysis_status IN ('pending', 'queued', 'analyzing', 'analyzed', 'error')),
        move_count       INTEGER NOT NULL DEFAULT 0,
        takeaway         TEXT,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX idx_games_analysis_status ON games (analysis_status);
      CREATE INDEX idx_games_date ON games (date);

      -- Evals are centipawns (integers) from White's perspective; mate scores
      -- clamped to +/-10000. JSON payloads are stored as TEXT.
      CREATE TABLE positions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id               INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        fen                   TEXT    NOT NULL,
        move_number           INTEGER NOT NULL,
        side_to_move          TEXT    NOT NULL CHECK (side_to_move IN ('white', 'black')),
        played_move           TEXT    NOT NULL,
        best_move             TEXT,
        engine_line           TEXT    NOT NULL DEFAULT '[]', -- JSON array of SAN moves (PV)
        eval_before           INTEGER,
        eval_after            INTEGER,
        eval_loss             INTEGER,
        is_blunder            INTEGER NOT NULL DEFAULT 0,
        is_missed_punishment  INTEGER NOT NULL DEFAULT 0,
        suggested_labels      TEXT    NOT NULL DEFAULT '[]', -- JSON: SuggestedLabel[]
        confirmed_labels      TEXT,                          -- JSON: ConfirmedLabels | null
        is_critical           INTEGER NOT NULL DEFAULT 0,
        saved_as_card         INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_positions_game_id ON positions (game_id);
      CREATE INDEX idx_positions_flagged ON positions (game_id, is_blunder, is_missed_punishment);

      CREATE TABLE flashcards (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id     INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
        fen             TEXT    NOT NULL,
        correct_move    TEXT    NOT NULL,
        accepted_moves  TEXT    NOT NULL DEFAULT '[]', -- JSON array of SAN moves
        labels          TEXT,                          -- JSON: ConfirmedLabels | null
        cloze_prompt    TEXT,
        cloze_answer    TEXT,
        takeaway        TEXT,
        interval_days   REAL    NOT NULL DEFAULT 0,
        ease            REAL    NOT NULL DEFAULT 2.5,
        due_date        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        lapses          INTEGER NOT NULL DEFAULT 0,
        state           TEXT    NOT NULL DEFAULT 'new'
                                CHECK (state IN ('new', 'learning', 'review'))
      );

      CREATE INDEX idx_flashcards_due_date ON flashcards (due_date);
      CREATE INDEX idx_flashcards_position_id ON flashcards (position_id);

      CREATE TABLE review_attempts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id         INTEGER NOT NULL REFERENCES flashcards (id) ON DELETE CASCADE,
        reviewed_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        move_attempted  TEXT,
        move_correct    INTEGER,
        labels_answer   TEXT,             -- JSON array of ClampKLabel
        labels_correct  INTEGER,
        cloze_answer    TEXT,
        rating          TEXT    NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
        time_spent_ms   INTEGER
      );

      CREATE INDEX idx_review_attempts_card_id ON review_attempts (card_id);
      CREATE INDEX idx_review_attempts_reviewed_at ON review_attempts (reviewed_at);

      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL -- JSON-encoded value
      );
    `
  },
  {
    version: 2,
    name: 'eval-cache',
    sql: `
      CREATE TABLE eval_cache (
        fen          TEXT    NOT NULL,
        preset       TEXT    NOT NULL CHECK (preset IN ('fast', 'balanced', 'deep')),
        lines_json   TEXT    NOT NULL, -- JSON: UciLine[]
        bestmove     TEXT    NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (fen, preset)
      );
    `
  },
  {
    version: 3,
    name: 'analysis-metadata-and-movetext-hash',
    sql: `
      ALTER TABLE games ADD COLUMN analysis_preset TEXT
        CHECK (analysis_preset IN ('fast', 'balanced', 'deep'));
      ALTER TABLE games ADD COLUMN analyzed_at TEXT;
      ALTER TABLE games ADD COLUMN movetext_hash TEXT;

      CREATE UNIQUE INDEX idx_games_movetext_hash ON games (movetext_hash)
        WHERE movetext_hash IS NOT NULL;
    `
  }
]
