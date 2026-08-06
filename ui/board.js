import { Chessground } from "https://cdn.jsdelivr.net/npm/chessground@9.1.1/+esm";

let ground = null;
let game = null;
let ply = 0;

function destsFromFen(fen) {
  return new Map();
}

export function mountBoard() {
  const el = document.getElementById("board");
  ground = Chessground(el, {
    viewOnly: true,
    coordinates: true,
    animation: { enabled: false },
  });
}

export async function openGame(id) {
  game = await api.get("/api/game/" + encodeURIComponent(id));
  ply = 0;
  render();
}

function fenAt(p) {
  if (!game) return "start";
  if (p <= 0) return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  return game.moves[p - 1].fen;
}

function render() {
  if (!ground || !game) return;
  const g = game.game;
  ground.set({
    fen: fenAt(ply),
    orientation: g.you_color === "black" ? "black" : "white",
    lastMove: ply > 0 ? uciSquares(game.moves[ply - 1].uci) : undefined,
  });
  const facts = document.getElementById("board-facts");
  const mv = ply > 0 ? game.moves[ply - 1] : null;
  const clock = mv ? formatClock(mv.clock_centis) : "";
  facts.innerHTML = `
    <div>${g.white} — ${g.black}  ·  ${g.result}</div>
    <div>${g.opening_name || "—"}  ·  ${g.eco || ""}  ·  ${g.tc_class}</div>
    <div>phase ${mv?.phase || "opening"}  ·  ${mv?.material || ""}  ·  ${mv?.tb_wdl || ""} ${clock}</div>
    <div>${mv?.move_class || ""} ${mv?.accuracy != null ? acc(mv.accuracy) : ""}</div>
  `;
  const list = document.getElementById("movelist");
  list.innerHTML = game.moves
    .map((m, i) => {
      const num = m.mover === "white" ? `${Math.ceil(m.ply / 2)}.` : "";
      return `<li data-ply="${m.ply}" class="${m.ply === ply ? "on" : ""}">${num} ${m.san}</li>`;
    })
    .join("");
  list.querySelectorAll("li").forEach((li) => {
    li.onclick = () => {
      ply = Number(li.dataset.ply);
      render();
    };
  });
  const pts = [];
  if (game.start_eval?.winpct != null) pts.push(game.start_eval.winpct);
  game.moves.forEach((m) => {
    if (m.winpct != null) pts.push(m.winpct);
  });
  drawEvalGraph(document.getElementById("eval-graph"), pts, ply);
}

function uciSquares(uci) {
  if (!uci || uci.length < 4) return undefined;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

window.ForkSightBoard = { mountBoard, openGame };

document.addEventListener("keydown", (e) => {
  if (!game) return;
  if (e.key === "ArrowRight") {
    ply = Math.min(game.moves.length, ply + 1);
    render();
  }
  if (e.key === "ArrowLeft") {
    ply = Math.max(0, ply - 1);
    render();
  }
});
