from __future__ import annotations

import math
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import chess
import chess.engine
import chess.pgn
import chess.syzygy

from app import accuracy, classify
from app.evalcache import EngineId, lookup, store_eval
from app.power import SleepInhibitor, notify
from app.store import Store


@dataclass
class JobSettings:
    mode: str = "depth"
    depth: int = 15
    movetime_ms: int = 200
    multipv: int = 1
    threads: int | None = None
    hash_mb: int | None = None
    skip_book: bool = True
    only_unanalyzed: bool = True
    eco: bool = False
    game_id: str | None = None


@dataclass
class JobState:
    job_id: str = ""
    status: str = "idle"
    settings: JobSettings = field(default_factory=JobSettings)
    remaining: int = 0
    done: int = 0
    rate_ema: float = 0.0
    eta_s: float | None = None
    elapsed_s: float = 0.0
    log: list[str] = field(default_factory=list)
    error: str | None = None
    stop_after_game: bool = False
    current_game: str | None = None
    pause_event: threading.Event = field(default_factory=threading.Event)


class Analyzer:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.state = JobState()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._engine: chess.engine.SimpleEngine | None = None
        self._tb: chess.syzygy.Tablebase | None = None
        self._inhibitor = SleepInhibitor()

    def snapshot(self) -> dict[str, Any]:
        s = self.state
        return {
            "job_id": s.job_id,
            "status": s.status,
            "remaining": s.remaining,
            "done": s.done,
            "rate": s.rate_ema,
            "eta_s": s.eta_s,
            "elapsed_s": s.elapsed_s,
            "log": s.log[-20:],
            "error": s.error,
            "stop_after_game": s.stop_after_game,
            "settings": s.settings.__dict__,
            "engine": self.engine_info(),
            "current_game": s.current_game,
        }

    def engine_info(self) -> dict[str, Any]:
        try:
            path = self._engine_path()
            return {"found": True, "path": path}
        except FileNotFoundError as exc:
            return {"found": False, "error": str(exc)}

    def start(self, settings: JobSettings) -> dict[str, Any]:
        if self.state.status == "running":
            return self.snapshot()
        info = self.engine_info()
        if not info["found"]:
            self.state = JobState(status="failed", settings=settings, error=info["error"])
            return self.snapshot()
        self.state = JobState(job_id=uuid.uuid4().hex[:8], status="running", settings=settings)
        self.state.pause_event.set()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self.snapshot()

    def pause(self) -> dict[str, Any]:
        if self.state.status == "running":
            self.state.status = "paused"
            self.state.pause_event.clear()
            self._inhibitor.release()
        return self.snapshot()

    def resume(self) -> dict[str, Any]:
        if self.state.status == "paused":
            self.state.status = "running"
            self.state.pause_event.set()
            self._inhibitor.acquire()
        return self.snapshot()

    def stop_after_this_game(self) -> dict[str, Any]:
        self.state.stop_after_game = True
        return self.snapshot()

    def _engine_path(self) -> str:
        path = self.store.setting("stockfish_path", "") or ""
        if path and os.path.isfile(path):
            return path
        from app.paths import STOCKFISH_DIR

        if STOCKFISH_DIR.exists():
            for cand in STOCKFISH_DIR.rglob("*"):
                if cand.is_file() and cand.name.lower().startswith("stockfish") and os.access(cand, os.X_OK):
                    return str(cand)
        which = _which("stockfish")
        if which:
            return which
        raise FileNotFoundError("Stockfish is not installed. Use Download Stockfish on the Analyze page.")

    def _open_engine(self, settings: JobSettings) -> EngineId:
        path = self._engine_path()
        self._engine = chess.engine.SimpleEngine.popen_uci(path)
        cores = os.cpu_count() or 2
        threads = settings.threads if settings.threads is not None else max(1, cores - 1)
        if settings.eco:
            threads = max(1, threads // 2)
        hash_mb = settings.hash_mb
        if hash_mb is None:
            hash_mb = min(1024, max(16, _free_ram_mb() // 4))
        self._engine.configure({"Threads": threads, "Hash": hash_mb})
        version = self._engine.id.get("name", "stockfish")
        net = ""
        opt = self._engine.options.get("EvalFile")
        if opt is not None:
            net = str(opt.default or opt.value or "")
        return EngineId(version=version, net_hash=net or "default", multipv=settings.multipv, threads=threads)

    def _open_tb(self) -> None:
        path = self.store.setting("syzygy_path", "") or ""
        if path and os.path.isdir(path):
            self._tb = chess.syzygy.open_tablebase(path)

    def _limit(self, settings: JobSettings) -> chess.engine.Limit:
        if settings.mode == "movetime":
            return chess.engine.Limit(time=settings.movetime_ms / 1000.0)
        return chess.engine.Limit(depth=settings.depth)

    def benchmark(self, settings: JobSettings, n: int = 100) -> dict[str, Any]:
        engine_id = self._open_engine(settings)
        assert self._engine
        fens = self.store.fetchall(
            "SELECT fen_norm FROM moves WHERE fen_norm IS NOT NULL LIMIT ?",
            (n,),
        )
        if len(fens) < n:
            board = chess.Board()
            extra = []
            for mv in board.legal_moves:
                b = board.copy()
                b.push(mv)
                extra.append((classify.fen_norm(b),))
                if len(fens) + len(extra) >= n:
                    break
            fens = list(fens) + extra
        t0 = time.perf_counter()
        done = 0
        for (fen,) in fens[:n]:
            board = chess.Board()
            # fen_norm lacks clocks; python-chess accepts 4-field FEN
            board.set_fen(fen + " 0 1")
            self._engine.analyse(board, self._limit(settings), multipv=settings.multipv)
            done += 1
        dt = max(1e-6, time.perf_counter() - t0)
        rate = done / dt
        remaining = self._count_remaining(settings, engine_id)
        if self._engine:
            self._engine.quit()
            self._engine = None
        return {
            "positions": done,
            "seconds": dt,
            "rate": rate,
            "remaining": remaining,
            "eta_s": remaining / rate if rate else None,
            "engine": engine_id.version,
        }

    def _count_remaining(self, settings: JobSettings, engine_id: EngineId) -> int:
        if settings.game_id:
            row = self.store.fetchone("SELECT COUNT(*) FROM moves WHERE game_id = ?", (settings.game_id,))
            return int(row[0] or 0)
        if settings.only_unanalyzed:
            row = self.store.fetchone(
                """
                SELECT COUNT(*) FROM moves m
                JOIN games g ON g.game_id = m.game_id
                WHERE g.analysis_status <> 'complete' OR g.analysis_depth IS NULL OR g.analysis_depth < ?
                """,
                (settings.depth,),
            )
        else:
            row = self.store.fetchone("SELECT COUNT(*) FROM moves")
        return int(row[0] or 0)

    def _run(self) -> None:
        settings = self.state.settings
        self._inhibitor.acquire()
        t0 = time.time()
        try:
            engine_id = self._open_engine(settings)
            self._open_tb()
            remaining = self._count_remaining(settings, engine_id)
            self.state.remaining = remaining
            if settings.game_id:
                games = [(settings.game_id,)]
            else:
                games = self.store.fetchall(
                    """
                    SELECT game_id FROM games
                    WHERE (? = 0) OR analysis_status <> 'complete' OR analysis_depth IS NULL OR analysis_depth < ?
                    ORDER BY utc_date
                    """,
                    (1 if settings.only_unanalyzed else 0, settings.depth),
                )
            for (game_id,) in games:
                self.state.current_game = game_id
                self.state.pause_event.wait()
                if self.state.status not in ("running", "paused"):
                    break
                self.store.execute(
                    "UPDATE games SET analysis_status = 'running' WHERE game_id = ?",
                    (game_id,),
                )
                try:
                    npos = self._analyze_game(game_id, settings, engine_id)
                except chess.engine.EngineTerminatedError:
                    self.store.execute(
                        "UPDATE games SET analysis_status = 'failed' WHERE game_id = ?",
                        (game_id,),
                    )
                    self.state.log.append(f"{game_id} engine crash")
                    self._open_engine(settings)
                    continue
                except Exception as exc:
                    self.store.execute(
                        "UPDATE games SET analysis_status = 'failed' WHERE game_id = ?",
                        (game_id,),
                    )
                    self.state.log.append(f"{game_id} failed: {exc}")
                    continue
                self.state.done += npos
                self.state.remaining = max(0, self.state.remaining - npos)
                self.state.elapsed_s = time.time() - t0
                if self.state.elapsed_s > 0:
                    inst = self.state.done / self.state.elapsed_s
                    self.state.rate_ema = inst if not self.state.rate_ema else (0.3 * inst + 0.7 * self.state.rate_ema)
                    if self.state.rate_ema:
                        self.state.eta_s = self.state.remaining / self.state.rate_ema
                self.state.log.append(f"{game_id} complete ({npos} positions)")
                if self.state.stop_after_game:
                    self.state.status = "paused"
                    self.state.pause_event.clear()
                    self.state.stop_after_game = False
            if self.state.status == "running":
                self.state.status = "complete"
                notify("ForkSight", "Analysis job finished.")
        except Exception as exc:
            self.state.status = "failed"
            self.state.error = str(exc)
        finally:
            if self._engine:
                try:
                    self._engine.quit()
                except Exception:
                    pass
                self._engine = None
            if self._tb:
                self._tb.close()
                self._tb = None
            self._inhibitor.release()

    def _analyze_game(self, game_id: str, settings: JobSettings, engine_id: EngineId) -> int:
        assert self._engine
        meta = self.store.fetchone(
            "SELECT book_depth, you_color, ply_count FROM games WHERE game_id = ?",
            (game_id,),
        )
        book_depth = int(meta[0] or 0)
        you_color = meta[1]
        rows = self.store.fetchall(
            """
            SELECT ply, fen, fen_norm, mover, is_book, halfmove, san
            FROM moves WHERE game_id = ? ORDER BY ply
            """,
            (game_id,),
        )
        # Reconstruct boards with history for the sensitive path.
        import io

        game = chess.pgn.read_game(io.StringIO(
            self.store.fetchone("SELECT pgn FROM games WHERE game_id = ?", (game_id,))[0]
        ))
        board = game.board() if game else chess.Board()
        seen: dict[tuple, int] = {}
        evals: dict[int, tuple[int, int | None, bool]] = {}
        scored_n = 0

        start_fen = classify.fen_norm(board)
        start_hist = classify.is_history_sensitive(board, seen)
        ev = self._eval_position(board, start_fen, start_hist, settings, engine_id)
        evals[0] = (*ev, start_hist)
        seen[classify.repetition_key(board)] = seen.get(classify.repetition_key(board), 0) + 1
        scored_n += 1

        for ply, fen, fen_n, mover, is_book, halfmove, san in rows:
            if game:
                board.push_san(san)
            else:
                board = chess.Board(fen)
            hist = classify.is_history_sensitive(board, seen)
            skip_score = bool(settings.skip_book and is_book)
            need = True
            if skip_score and ply < book_depth:
                # still need the boundary position (ply == book_depth)
                need = False
            if need:
                ev = self._eval_position(board, fen_n, hist, settings, engine_id)
                evals[ply] = (*ev, hist)
                scored_n += 1
            seen[classify.repetition_key(board)] = seen.get(classify.repetition_key(board), 0) + 1

        # Score moves that have both sides of the eval.
        move_evals = []
        for ply, fen, fen_n, mover, is_book, halfmove, san in rows:
            if settings.skip_book and is_book:
                continue
            if (ply - 1) not in evals or ply not in evals:
                # ensure before exists (skip-book boundary)
                if ply - 1 not in evals:
                    continue
                if ply not in evals:
                    continue
            cp_b, cp2_b, _ = evals[ply - 1]
            cp_a, cp2_a, hist = evals[ply]
            move_evals.append(
                accuracy.MoveEval(
                    ply=ply,
                    mover_is_white=(mover == "white"),
                    cp_before=cp_b,
                    cp_after=cp_a,
                    cp_second=cp2_b,
                )
            )
        scored = accuracy.score_moves(move_evals, multipv=settings.multipv)
        by_ply = {s.ply: s for s in scored}
        ev_rows = []
        for ply, (cp, cp2, hist) in evals.items():
            s = by_ply.get(ply)
            ev_rows.append(
                (
                    game_id,
                    ply,
                    settings.depth,
                    engine_id.version,
                    engine_id.net_hash,
                    settings.multipv,
                    cp,
                    accuracy.winpct_from_cp(cp),
                    s.move_class if s else None,
                    s.winpct_loss if s else None,
                    s.accuracy if s else None,
                    s.only_move if s else None,
                    s.missed_win if s else None,
                    self._tb_wdl(chess.Board(self.store.fetchone(
                        "SELECT fen FROM moves WHERE game_id = ? AND ply = ?", (game_id, ply)
                    )[0]) if ply else chess.Board()),
                    hist,
                )
            )
        self.store.execute("DELETE FROM evaluations WHERE game_id = ?", (game_id,))
        self.store.executemany(
            """
            INSERT INTO evaluations (
              game_id, ply, depth, engine_version, net_hash, multipv, eval_cp, winpct,
              move_class, winpct_loss, accuracy, only_move, missed_win, tb_wdl, history_sensitive
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            ev_rows,
        )
        white_acc, black_acc = accuracy.game_accuracy(scored)
        user_acc = accuracy.user_accuracy(scored, you_color)
        self.store.execute(
            """
            UPDATE games SET analysis_status = 'complete', analysis_depth = ?,
              accuracy = ?, accuracy_white = ?, accuracy_black = ?, accuracy_version = ?
            WHERE game_id = ?
            """,
            (settings.depth, user_acc, white_acc, black_acc, accuracy.VERSION, game_id),
        )
        self._fill_span_entries(game_id, you_color)
        return scored_n

    def _eval_position(
        self,
        board: chess.Board,
        fen_n: str,
        history_sensitive: bool,
        settings: JobSettings,
        engine_id: EngineId,
    ) -> tuple[int, int | None]:
        assert self._engine
        if not history_sensitive:
            cached = lookup(self.store, fen_n, settings.depth, engine_id)
            if cached:
                return cached.eval_cp, cached.eval_cp_2
            fresh = chess.Board(fen_n + " 0 1")
            infos = self._engine.analyse(fresh, self._limit(settings), multipv=max(1, settings.multipv))
            cp, cp2 = _parse_infos(infos)
            store_eval(self.store, fen_n, settings.depth, engine_id, cp, cp2)
            return cp, cp2
        infos = self._engine.analyse(board, self._limit(settings), multipv=max(1, settings.multipv))
        return _parse_infos(infos)

    def _tb_wdl(self, board: chess.Board) -> str | None:
        if self._tb is None:
            return None
        if chess.popcount(board.occupied) > 5 or board.castling_rights:
            return None
        try:
            wdl = self._tb.probe_wdl(board)
        except Exception:
            return None
        return {2: "win", 1: "cursed_win", 0: "draw", -1: "blessed_loss", -2: "loss"}.get(wdl)

    def _fill_span_entries(self, game_id: str, you_color: str | None) -> None:
        spans = self.store.fetchall(
            "SELECT span_id, start_ply FROM spans WHERE game_id = ?",
            (game_id,),
        )
        for span_id, start_ply in spans:
            row = self.store.fetchone(
                "SELECT eval_cp, tb_wdl FROM evaluations WHERE game_id = ? AND ply = ?",
                (game_id, start_ply),
            )
            if not row:
                continue
            cp, tb = row
            wp = accuracy.winpct_from_cp(int(cp))
            if you_color == "black":
                wp = 100.0 - wp
            if tb:
                # tablebase overrides for classification
                if (tb == "win" and you_color == "white") or (tb == "loss" and you_color == "black"):
                    wp = 100.0
                elif (tb == "loss" and you_color == "white") or (tb == "win" and you_color == "black"):
                    wp = 0.0
                elif tb in ("draw", "cursed_win", "blessed_loss"):
                    wp = 50.0
            self.store.execute(
                "UPDATE spans SET entry_winpct = ?, entry_tb = ? WHERE span_id = ?",
                (wp, tb, span_id),
            )


def _parse_infos(infos) -> tuple[int, int | None]:
    if isinstance(infos, dict):
        infos = [infos]
    def cp_of(info) -> int:
        score = info["score"].white()
        if score.is_mate():
            mate = score.mate()
            return accuracy.mate_to_cp(mate or 0)
        return int(score.score())
    cp = cp_of(infos[0])
    cp2 = cp_of(infos[1]) if len(infos) > 1 else None
    return cp, cp2


def _which(name: str) -> str | None:
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        cand = os.path.join(folder, name)
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _free_ram_mb() -> int:
    try:
        page = os.sysconf("SC_PAGE_SIZE")
        avail = os.sysconf("SC_AVPHYS_PAGES")
        return int(page * avail / 1024 / 1024)
    except (ValueError, OSError):
        return 4096
