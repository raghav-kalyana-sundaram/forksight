import { Chessground } from "https://cdn.jsdelivr.net/npm/chessground@9.1.1/+esm";

let ground = null;
let game = null;
let ply = 0;
let flipped = false;

const GLYPH = {
  best: "",
  good: "",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

export function mountBoard() {
  const el = document.getElementById("board");
  ground = Chessground(el, {
    viewOnly: true,
    coordinates: true,
    animation: { enabled: false },
    drawable: { enabled: false },
  });
}

export async function openGame(id, atPly) {
  game = await api.get("/api/game/" + encodeURIComponent(id));
  ply = atPly != null ? Number(atPly) : 0;
  flipped = game.game.you_color === "black";
  const empty = document.getElementById("board-empty");
  const wrap = document.getElementById("board-wrap");
  if (empty) empty.classList.add("hidden");
  if (wrap) wrap.classList.remove("hidden");
  render();
}

function fenAt(p) {
  if (!game) return "start";
  if (p <= 0) return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  return game.moves[p - 1].fen;
}

function currentEval() {
  if (!game) return null;
  if (ply <= 0) return game.start_eval;
  const mv = game.moves[ply - 1];
  if (mv?.eval_cp == null && mv?.winpct == null) return null;
  return { eval_cp: mv.eval_cp, winpct: mv.winpct };
}

function formatEval(ev) {
  if (!ev || ev.eval_cp == null) return "—";
  const cp = ev.eval_cp;
  if (Math.abs(cp) >= 9000) {
    const mate = Math.sign(cp) * Math.round((10000 - Math.abs(cp)) / 50);
    return mate > 0 ? `M${mate}` : `-M${-mate}`;
  }
  const pawns = (cp / 100).toFixed(1);
  return cp > 0 ? `+${pawns}` : pawns;
}

function userResultLabel(g) {
  if (g.user_result === "win") return "you won";
  if (g.user_result === "draw") return "draw";
  if (g.user_result === "loss") return "you lost";
  return g.result || "";
}

function render() {
  if (!ground || !game) return;
  const g = game.game;
  const mv = ply > 0 ? game.moves[ply - 1] : null;
  const orientation = flipped ? (g.you_color === "black" ? "white" : "black") : g.you_color === "black" ? "black" : "white";
  ground.set({
    fen: fenAt(ply),
    orientation,
    lastMove: ply > 0 ? uciSquares(game.moves[ply - 1].uci) : undefined,
  });
  const ev = currentEval();
  const phase = mv?.phase || "opening";
  const src =
    g.eval_source === "lichess-pgn" ? "Lichess eval" : g.eval_source ? "Stockfish" : "";
  const facts = document.getElementById("board-facts");
  facts.innerHTML = `
    <div class="who">${escapeHtml(g.white)} — ${escapeHtml(g.black)}
      <span class="result ${g.user_result || ""}">${userResultLabel(g)}</span>
    </div>
    <div>${escapeHtml(g.opening_name || "—")}  ·  ${g.eco || ""}  ·  ${g.tc_class || ""}  ·  ${escapeHtml(g.termination_label || "")}</div>
    <div class="mono">${phase}${mv?.material_label ? " · " + escapeHtml(mv.material_label) : mv?.material ? " · " + escapeHtml(materialHint(mv.material)) : ""}</div>
    <div class="eval-line">Eval (White) <strong class="mono">${formatEval(ev)}</strong>
      ${src ? `<span class="badge ${g.eval_source === "lichess-pgn" ? "pgn" : "engine"}">${src}</span>` : ""}
      ${mv?.move_class ? `<span class="cls ${mv.move_class}">${mv.move_class}${GLYPH[mv.move_class] ? " " + GLYPH[mv.move_class] : ""}</span>` : ""}
      ${mv?.accuracy != null ? `<span class="muted">acc ${acc(mv.accuracy)}</span>` : ""}
    </div>
  `;
  paintClocks();
  const list = document.getElementById("movelist");
  const pairs = [];
  for (let i = 0; i < game.moves.length; i += 2) {
    pairs.push([game.moves[i], game.moves[i + 1]]);
  }
  list.innerHTML = pairs
    .map(([w, b]) => {
      const num = Math.ceil(w.ply / 2);
      return `<li>
        <span class="n">${num}.</span>
        ${moveSpan(w)}
        ${b ? moveSpan(b) : "<span class='san'></span>"}
      </li>`;
    })
    .join("");
  list.querySelectorAll("[data-ply]").forEach((el) => {
    el.onclick = () => {
      ply = Number(el.dataset.ply);
      render();
    };
  });
  const on = list.querySelector(`[data-ply="${ply}"]`);
  if (on) on.scrollIntoView({ block: "nearest" });

  const turns = (game.moves || [])
    .filter((m) => isYourMove(g, m) && ["inaccuracy", "mistake", "blunder"].includes(m.move_class))
    .sort((a, b) => (b.winpct_loss || 0) - (a.winpct_loss || 0))
    .slice(0, 3);
  const box = document.getElementById("turning-inline");
  if (box) {
    if (!turns.length) {
      box.innerHTML = g.analysis_status === "complete" ? "" : `<p class="muted">Analyze this game to mark the turning points.</p>`;
    } else {
      box.innerHTML =
        `<p class="turn-head">Turning points</p>` +
        turns
          .map(
            (m) =>
              `<button type="button" class="turn ${m.move_class}" data-ply="${m.ply}">${Math.ceil(m.ply / 2)}. ${escapeHtml(m.san)} ${GLYPH[m.move_class] || ""} · −${(m.winpct_loss || 0).toFixed(0)}%</button>`
          )
          .join("");
      box.querySelectorAll("[data-ply]").forEach((b) => {
        b.onclick = () => {
          ply = Number(b.dataset.ply);
          render();
        };
      });
    }
  }

  const pts = [];
  if (game.start_eval?.winpct != null) pts.push(game.start_eval.winpct);
  game.moves.forEach((m) => {
    if (m.winpct != null) pts.push(m.winpct);
  });
  drawEvalGraph(document.getElementById("eval-graph"), pts, ply, (i) => {
    ply = i;
    render();
  });

  const url = lichessUrl();
  const link = document.getElementById("btn-lichess");
  const copy = document.getElementById("btn-copy-link");
  if (link) {
    if (url) {
      link.href = url;
      link.classList.remove("hidden");
    } else {
      link.classList.add("hidden");
    }
  }
  if (copy) copy.classList.toggle("hidden", !url);
}

function clocksAt(p) {
  let white = null;
  let black = null;
  if (!game) return { white, black };
  for (const m of game.moves) {
    if (m.ply > p) break;
    if (m.clock_centis == null) continue;
    if (m.mover === "white") white = m.clock_centis;
    else black = m.clock_centis;
  }
  return { white, black };
}

function paintClocks() {
  const el = document.getElementById("clocks");
  if (!el || !game) return;
  const c = clocksAt(ply);
  if (c.white == null && c.black == null) {
    el.innerHTML = "";
    return;
  }
  const low = (centis) => (centis != null && centis < 3000 ? "low" : "");
  const top = flipped ? "white" : game.game.you_color === "black" ? "white" : "black";
  const bot = top === "white" ? "black" : "white";
  const name = (side) => (side === "white" ? game.game.white : game.game.black);
  el.innerHTML = `
    <span class="${low(c[top])}">${escapeHtml(name(top))} ${formatClock(c[top]) || "—"}</span>
    <span class="${low(c[bot])}">${escapeHtml(name(bot))} ${formatClock(c[bot]) || "—"}</span>
  `;
}

function lichessUrl() {
  const id = game && game.game && game.game.site_id;
  if (id && /^[A-Za-z0-9]{8}$/.test(String(id))) return "https://lichess.org/" + id;
  return "";
}

function isYourMove(g, m) {
  return g.you_color && m.mover === g.you_color;
}

function moveSpan(m) {
  const glyph = GLYPH[m.move_class] || "";
  const cls = [m.ply === ply ? "on" : "", m.move_class || "", isYourMove(game.game, m) ? "you" : ""].filter(Boolean).join(" ");
  return `<button type="button" class="san ${cls}" data-ply="${m.ply}">${escapeHtml(m.san)}${glyph ? `<sup>${glyph}</sup>` : ""}</button>`;
}

function materialHint(sig) {
  if (!sig || !sig.includes("v")) return sig || "";
  const [me, opp] = sig.split("v");
  if (me === opp) return me === "KQRRBBNNPPPPPPPP" ? "starting position" : "equal material";
  return sig;
}

function uciSquares(uci) {
  if (!uci || uci.length < 4) return undefined;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

function go(delta) {
  if (!game) return;
  ply = Math.max(0, Math.min(game.moves.length, ply + delta));
  render();
}

window.ForkSightBoard = {
  mountBoard,
  openGame,
  currentId: () => (game && game.game ? game.game.game_id : null),
  currentPgn: () => (game && game.game ? game.game.pgn : ""),
  currentFen: () => fenAt(ply),
  lichessUrl,
  go,
  flip: () => {
    flipped = !flipped;
    render();
  },
};

document.addEventListener("keydown", (e) => {
  if (!game) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    go(1);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    go(-1);
  }
  if (e.key === "Home") {
    e.preventDefault();
    ply = 0;
    render();
  }
  if (e.key === "End") {
    e.preventDefault();
    ply = game.moves.length;
    render();
  }
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    flipped = !flipped;
    render();
  }
});
