const state = {
  page: "games",
  q: "",
  sort: { key: "date", dir: -1 },
  lastSql: null,
  offset: 0,
  limit: 50,
  total: 0,
  years: [],
  treePrefix: [],
};

const CHROME_PAGES = new Set(["games", "insights", "improve"]);

function $(sel) {
  return document.querySelector(sel);
}

const TC_CHIPS = [
  { label: "All", q: "" },
  { label: "Blitz", q: "tc:blitz" },
  { label: "Rapid", q: "tc:rapid" },
  { label: "Bullet", q: "tc:bullet" },
  { label: "Classical", q: "tc:classical" },
];
const COLOR_CHIPS = [
  { label: "Either", key: "color", value: "" },
  { label: "White", key: "color", value: "white" },
  { label: "Black", key: "color", value: "black" },
];
const RESULT_CHIPS = [
  { label: "Any result", value: "" },
  { label: "Wins", value: "win" },
  { label: "Draws", value: "draw" },
  { label: "Losses", value: "loss" },
];
const TERM_CHIPS = [
  { label: "Any end", value: "" },
  { label: "Mate", value: "mate" },
  { label: "Flag", value: "flag" },
  { label: "Resign", value: "resign" },
  { label: "Abandon", value: "abandon" },
  { label: "Normal", value: "normal" },
];
const PHASE_CHIPS = [
  { label: "Any", value: "" },
  { label: "Opening", value: "opening" },
  { label: "Middlegame", value: "middlegame" },
  { label: "Endgame", value: "endgame" },
];
const PIECE_LETTERS = ["Q", "R", "B", "N", "P"];
const PIECE_GROUPS = [
  { key: "me", label: "You have" },
  { key: "opp", label: "They have" },
  { key: "no", label: "Off the board" },
];

function parsePieces(spec) {
  const groups = { me: new Set(), opp: new Set(), no: new Set() };
  String(spec || "")
    .split(",")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      let key = part.slice(0, i).trim().toLowerCase();
      if (key === "op") key = "opp";
      if (!groups[key]) return;
      part
        .slice(i + 1)
        .toUpperCase()
        .replace(/\+/g, "")
        .split("")
        .forEach((ch) => {
          if (PIECE_LETTERS.includes(ch)) groups[key].add(ch);
        });
    });
  return groups;
}

function piecesToken(groups) {
  return PIECE_GROUPS.map(({ key }) => {
    const letters = PIECE_LETTERS.filter((p) => groups[key].has(p)).join("");
    return letters ? `${key}=${letters}` : "";
  })
    .filter(Boolean)
    .join(",");
}

function todayISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const z = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function dateChips() {
  const y = new Date().getFullYear();
  const years = (state.years || []).slice(0, 8);
  return [
    { label: "Any date", year: "", since: "", until: "" },
    ...years.map((yr) => ({ label: String(yr), year: String(yr), since: "", until: "" })),
    { label: "Last 7 days", year: "", since: daysAgo(7), until: todayISO() },
    { label: "Last 30 days", year: "", since: daysAgo(30), until: todayISO() },
    { label: `This year (${y})`, year: "", since: `${y}-01-01`, until: todayISO() },
  ];
}

function setTokens(patch, { resetPage = true } = {}) {
  const map = tokenMap(state.q);
  Object.entries(patch).forEach(([k, v]) => {
    if (!v) delete map[k];
    else map[k] = v;
  });
  state.q = formatTokens(map);
  $("#q").value = state.q;
  if (resetPage) state.offset = 0;
  refresh();
}

function mergeQuery(extra) {
  const next = { ...tokenMap(state.q), ...tokenMap(extra) };
  state.q = formatTokens(next);
  $("#q").value = state.q;
  state.offset = 0;
  show("games");
}

function renderFilters() {
  const map = tokenMap(state.q);
  const tcActive = map.tc == null || map.tc === "all" ? "" : "tc:" + map.tc;
  const tc = TC_CHIPS.map(
    (c) =>
      `<button type="button" data-setq="${escapeAttr(c.q)}" class="${c.q === tcActive ? "on" : ""}">${c.label}</button>`
  ).join("");
  const color = COLOR_CHIPS.map(
    (c) =>
      `<button type="button" data-color="${escapeAttr(c.value)}" class="${(map.color || "") === c.value ? "on" : ""}">${c.label}</button>`
  ).join("");
  const result = RESULT_CHIPS.map(
    (c) =>
      `<button type="button" data-result="${escapeAttr(c.value)}" class="${(map.result || "") === c.value ? "on" : ""}">${c.label}</button>`
  ).join("");
  const term = TERM_CHIPS.map(
    (c) =>
      `<button type="button" data-term="${escapeAttr(c.value)}" class="${(map.term || "") === c.value ? "on" : ""}">${c.label}</button>`
  ).join("");
  const dates = dateChips()
    .map((c) => {
      const on = c.year ? map.year === c.year : !map.year && (map.since || "") === c.since;
      return `<button type="button" data-year="${escapeAttr(c.year)}" data-since="${escapeAttr(c.since)}" data-until="${escapeAttr(c.until)}" class="${on ? "on" : ""}">${c.label}</button>`;
    })
    .join("");
  const phase = PHASE_CHIPS.map(
    (c) =>
      `<button type="button" data-phase="${escapeAttr(c.value)}" class="${(map.phase || "") === c.value ? "on" : ""}">${c.label}</button>`
  ).join("");
  const picked = parsePieces(map.pieces);
  const pieces = PIECE_GROUPS.map(({ key, label }) => {
    const buttons = PIECE_LETTERS.map(
      (letter) =>
        `<button type="button" data-piece-group="${key}" data-piece="${letter}" class="${picked[key].has(letter) ? "on" : ""}" aria-pressed="${picked[key].has(letter)}">${letter}</button>`
    ).join("");
    return `<span class="group" role="group" aria-label="${escapeAttr(label)}">${chipLabel(label)}${buttons}</span>`;
  }).join("");
  $("#filters").innerHTML = `
    <span class="group" role="radiogroup" aria-label="Time control">${chipLabel("Time")}${tc}</span>
    <span class="group" role="radiogroup" aria-label="Color">${chipLabel("Color")}${color}</span>
    <span class="group" role="radiogroup" aria-label="Result">${chipLabel("Result")}${result}</span>
    <span class="group" role="radiogroup" aria-label="How it ended">${chipLabel("Ended")}${term}</span>
    <span class="group" role="radiogroup" aria-label="Date">${chipLabel("When")}${dates}</span>
    <span class="group opp-wrap">${chipLabel("Opponent")}<input id="opp-search" type="search" placeholder="name" value="${escapeAttr(map.opponent || "")}"></span>
    <span class="group" role="radiogroup" aria-label="Phase">${chipLabel("Phase")}${phase}</span>
    ${pieces}
    <span class="group">${chipLabel("Position")}<input id="fen-search" type="text" placeholder="Paste a FEN" spellcheck="false" value="${escapeAttr(map.fen || "")}" style="width:18rem;max-width:100%"></span>
  `;
  $("#filters").querySelectorAll("[data-setq]").forEach((b) => {
    b.onclick = () => {
      const next = b.dataset.setq;
      if (next === "") setTokens({ tc: "" });
      else setTokens({ tc: next.slice(3) });
    };
  });
  $("#filters").querySelectorAll("[data-color]").forEach((b) => {
    b.onclick = () => setTokens({ color: b.dataset.color });
  });
  $("#filters").querySelectorAll("[data-result]").forEach((b) => {
    b.onclick = () => setTokens({ result: b.dataset.result });
  });
  $("#filters").querySelectorAll("[data-term]").forEach((b) => {
    b.onclick = () => setTokens({ term: b.dataset.term });
  });
  $("#filters").querySelectorAll("[data-since]").forEach((b) => {
    b.onclick = () => setTokens({ year: b.dataset.year, since: b.dataset.since, until: b.dataset.until });
  });
  const opp = $("#opp-search");
  if (opp) {
    opp.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        setTokens({ opponent: opp.value.trim() });
      }
    };
    opp.onchange = () => setTokens({ opponent: opp.value.trim() });
  }
  $("#filters").querySelectorAll("[data-phase]").forEach((b) => {
    b.onclick = () => setTokens({ phase: b.dataset.phase });
  });
  $("#filters").querySelectorAll("[data-piece]").forEach((b) => {
    b.onclick = () => {
      const groups = parsePieces(tokenMap(state.q).pieces);
      const key = b.dataset.pieceGroup;
      const letter = b.dataset.piece;
      if (groups[key].has(letter)) groups[key].delete(letter);
      else groups[key].add(letter);
      setTokens({ pieces: piecesToken(groups) });
    };
  });
  const fen = $("#fen-search");
  if (fen) {
    const applyFen = () => setTokens({ fen: fen.value.trim() });
    fen.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyFen();
      }
    };
    fen.onchange = applyFen;
  }
}

function chipLabel(t) {
  return `<span class="glabel">${t}</span>`;
}

function paintWdl(data) {
  const el = $("#wdl");
  if (!data || data.games == null) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const perf = data.performance;
  const perfCls = perf == null ? "" : perf >= 0 ? "plus" : "minus";
  const perfTxt = perf == null ? "—" : (perf >= 0 ? "+" : "") + (perf * 100).toFixed(1) + " vs exp";
  el.innerHTML = `
    <div class="stats">
      <span class="stat"><b>${data.games}</b> games</span>
      <span class="stat win"><b>${data.wins ?? 0}</b> W</span>
      <span class="stat draw"><b>${data.draws ?? 0}</b> D</span>
      <span class="stat loss"><b>${data.losses ?? 0}</b> L</span>
      <span class="stat">Score <b>${pct(data.score)}</b></span>
      <span class="stat">Expected <b>${pct(data.expected)}</b></span>
      <span class="stat ${perfCls}"><b>${perfTxt}</b></span>
    </div>
    <div class="wdl-bar" aria-hidden="true">
      <span class="w" style="flex:${Math.max(data.wins || 0, 0)}"></span>
      <span class="d" style="flex:${Math.max(data.draws || 0, 0)}"></span>
      <span class="l" style="flex:${Math.max(data.losses || 0, 0)}"></span>
    </div>
  `;
}

function paintCue(meta, importExtra) {
  const el = $("#cue");
  if (importExtra) {
    el.innerHTML = importExtra;
    return;
  }
  const aliases = meta.aliases || [];
  const observed = meta.observed_games || 0;
  const names = meta.observed_names || [];
  if (observed > 0 && names.length) {
    const chips = names
      .map((n) => `<button type="button" data-alias="${escapeAttr(n)}">${escapeHtml(n)}</button>`)
      .join(" · ");
    el.innerHTML = `${observed} game${observed === 1 ? "" : "s"} ${aliases.length ? "do not match " + aliases.map(escapeHtml).join(", ") : "have no name set"}. Claim a name: ${chips}`;
    el.querySelectorAll("[data-alias]").forEach((b) => {
      b.onclick = async () => {
        const s = await api.get("/api/settings");
        const next = Array.from(new Set([...(s.aliases || []), b.dataset.alias]));
        await api.post("/api/settings", { aliases: next });
        refresh();
      };
    });
    return;
  }
  if (!aliases.length) {
    el.innerHTML = `Set your Lichess username under <button type="button" id="cue-alias">Your name</button> so wins and losses are yours.`;
    $("#cue-alias").onclick = () => $("#btn-settings").click();
    return;
  }
  el.textContent = "";
}

function show(page) {
  state.page = page;
  document.body.dataset.page = page;
  document.querySelectorAll(".page").forEach((el) => el.classList.toggle("on", el.id === "page-" + page));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  document.querySelectorAll(".page-chrome").forEach((el) => el.classList.toggle("hidden", !CHROME_PAGES.has(page)));
  refresh();
}

function bindQueryRows(root) {
  root.querySelectorAll("tr[data-query]").forEach((tr) => {
    if (!tr.dataset.query) return;
    tr.onclick = () => mergeQuery(tr.dataset.query);
  });
}

function sortRows(rows) {
  const { key, dir } = state.sort;
  const copy = rows.slice();
  copy.sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (key === "date") {
      va = (a.date || "").replace(/\./g, "-");
      vb = (b.date || "").replace(/\./g, "-");
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
  return copy;
}

function paintSortHeads() {
  document.querySelectorAll("#games-table thead [data-sort]").forEach((th) => {
    const on = th.dataset.sort === state.sort.key;
    th.classList.toggle("sort-on", on);
    let dir = th.querySelector(".dir");
    if (!dir) {
      dir = document.createElement("span");
      dir.className = "dir";
      th.appendChild(dir);
    }
    dir.textContent = on ? (state.sort.dir === 1 ? "▲" : "▼") : "";
  });
}

function paintPager() {
  const total = state.total;
  const from = total ? state.offset + 1 : 0;
  const to = Math.min(state.offset + state.limit, total);
  const html =
    total > state.limit
      ? `<button type="button" id="pg-prev" ${state.offset <= 0 ? "disabled" : ""}>Prev</button>
         <span>${from}–${to} of ${total}</span>
         <button type="button" id="pg-next" ${state.offset + state.limit >= total ? "disabled" : ""}>Next</button>`
      : total
        ? `<span>${total} game${total === 1 ? "" : "s"}</span>`
        : "";
  ["#pager", "#pager-bottom"].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle("hidden", !html);
    const prev = el.querySelector("#pg-prev");
    const next = el.querySelector("#pg-next");
    if (prev)
      prev.onclick = () => {
        state.offset = Math.max(0, state.offset - state.limit);
        refresh();
      };
    if (next)
      next.onclick = () => {
        state.offset += state.limit;
        refresh();
      };
  });
}

function evalBadge(src) {
  if (src === "lichess-pgn") return `<span class="badge pgn">Lichess</span>`;
  if (src) return `<span class="badge engine">Stockfish</span>`;
  return "";
}

function paintGames(data) {
  $("#grain").textContent = grainLine(data);
  paintWdl(data);
  state.total = data.total ?? data.games ?? data.rows.length;
  const empty = $("#games-empty");
  const table = $("#games-table");
  if (!data.rows.length) {
    empty.classList.remove("hidden");
    table.classList.add("hidden");
    const hiddenHint =
      data.games === 0 && (state.years || []).length
        ? `<p>No games in this filter. Year chips follow the corpus — “this year” is empty if you last played in ${(state.years || [])[0]}.</p>`
        : `<p>No games in this filter. Pull from Lichess or import a PGN to start.</p>`;
    empty.innerHTML = hiddenHint;
  } else {
    empty.classList.add("hidden");
    table.classList.remove("hidden");
  }
  const rows = sortRows(data.rows);
  const tb = $("#games-table tbody");
  tb.innerHTML = rows
    .map((r) => {
      const ur = r.user_result;
      const accCell =
        r.accuracy != null ? acc(r.accuracy) : r.analysis_status === "complete" ? "—" : "<span class='muted'>…</span>";
      const diff = r.rating_diff == null ? "" : (r.rating_diff > 0 ? "+" : "") + r.rating_diff;
      const exp = r.expected == null ? "" : (r.expected * 100).toFixed(0) + "%";
      return `<tr data-id="${r.game_id}">
        <td class="num">${escapeHtml(r.date_label || r.date || "")}</td>
        <td>${r.color === "white" ? "White" : r.color === "black" ? "Black" : "—"}</td>
        <td>${escapeHtml(r.opponent || "")}</td>
        <td class="num">${r.you_elo ?? ""}</td>
        <td class="num">${r.opp_elo ?? ""}</td>
        <td class="num">${diff}</td>
        <td class="num">${exp}</td>
        <td>${r.tc_class || ""}</td>
        <td>${escapeHtml(r.opening || "")}</td>
        <td><span class="pill ${ur || ""}">${resultLabel(ur)}</span></td>
        <td>${escapeHtml(r.termination_label || r.termination || "")} ${evalBadge(r.eval_source)}</td>
        <td class="num" title="Lichess accuracy, finished analyses only">${accCell}</td>
      </tr>`;
    })
    .join("");
  tb.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = async () => {
      await window.ForkSightBoard.openGame(tr.dataset.id);
      show("board");
    };
  });
  paintSortHeads();
  paintPager();
}

function paintReview(data) {
  const root = $("#review-root");
  const losses = data.recent_losses || data.losses || [];
  if (!losses.length && !data.unanalyzed) {
    root.innerHTML = "";
    return;
  }
  const need = data.unanalyzed
    ? `<div class="banner">
        <p>${data.unanalyzed} game${data.unanalyzed === 1 ? "" : "s"} in this filter still need analysis. Accuracy, turning points, and Improve stay empty until Stockfish runs — unless the PGN already has Lichess evals.</p>
        <button type="button" id="review-analyze">Analyze them</button>
      </div>`
    : "";
  const cards = losses
    .map((g) => {
      const points = g.turning_points.length
        ? g.turning_points
            .map(
              (t) =>
                `<button type="button" class="turn ${t.move_class}" data-id="${g.game_id}" data-ply="${t.ply}">${Math.ceil(t.ply / 2)}. ${escapeHtml(t.san)} ${t.move_class === "blunder" ? "??" : t.move_class === "mistake" ? "?" : "?!"} · −${(t.winpct_loss || 0).toFixed(0)}% win</button>`
            )
            .join("")
        : g.analysis_status === "complete"
          ? `<span class="muted">No single move lost more than 10%.</span>`
          : `<span class="muted">Analyze to see the moves that lost this.</span>`;
      return `<article class="loss-card">
        <header>
          <button type="button" class="open-game" data-id="${g.game_id}">
            ${escapeHtml(g.date_label || "")} · ${escapeHtml(g.opponent || "opponent")}${g.opp_elo ? " " + g.opp_elo : ""}
          </button>
          <span class="muted">${escapeHtml(g.opening || "")} · ${g.tc_class || ""} · ${escapeHtml(g.termination_label || "")}</span>
        </header>
        <div class="turns">${points}</div>
      </article>`;
    })
    .join("");
  root.innerHTML =
    need +
    (losses.length
      ? `<section class="review"><h3>Recent losses</h3><p class="muted">The three moves that cost the most win probability. Click one to stand on that square.</p><div class="loss-grid">${cards}</div></section>`
      : "");
  const goAnalyze = $("#review-analyze");
  if (goAnalyze) goAnalyze.onclick = () => show("analyze");
  root.querySelectorAll(".open-game, .turn[data-id]").forEach((b) => {
    b.onclick = async () => {
      await window.ForkSightBoard.openGame(b.dataset.id, b.dataset.ply);
      show("board");
    };
  });
}

function paintInsights(data) {
  $("#grain").textContent = grainLine(data);
  paintWdl(data);
  $("#insights-sql").textContent = data.sql || "";
  const g = data.groups || {};
  const positions =
    g.positions && g.positions.length
      ? groupTable("Positions you reached", g.positions, { nLabel: "games", wide: true })
      : "";
  const pieces =
    g.pieces && g.pieces.length
      ? groupTable("Pieces on the board", g.pieces, { nLabel: "games", wide: true })
      : "";
  $("#insights-root").innerHTML =
    positions +
    pieces +
    groupTable("Year", g.year, { nLabel: "games" }) +
    groupTable("Color", g.color, { nLabel: "games" }) +
    groupTable("Time control", g.time_class, { nLabel: "games" }) +
    groupTable("How it ended", g.termination, { nLabel: "games" }) +
    `<section class="block"><h3>Rating differential</h3>${barChart(g.rating_diff || [])}</section>` +
    groupTable("Time of day (UTC)", g.time_of_day, { nLabel: "games" }) +
    groupTable("Game length", g.game_length, { nLabel: "games" }) +
    groupTable("In the session", g.session, { nLabel: "games" }) +
    groupTable("When you were winning or losing", g.conversion, { nLabel: "games" }) +
    groupTable("Time trouble", g.time_trouble, { nLabel: "your moves" }) +
    groupTable("Opening", g.opening, { nLabel: "games", wide: true }) +
    groupTable("Opponents", g.opponent, { nLabel: "games", wide: true }) +
    groupTable("Your castle", g.your_castle, { nLabel: "games" }) +
    groupTable("Both kings", g.kings, { nLabel: "games" }) +
    phaseBlock(g.phase || []) +
    materialBlock(g.material || []);
  bindQueryRows($("#insights-root"));
}

async function paintOpeningTree() {
  const root = $("#opening-tree");
  if (!root) return;
  try {
    const data = await api.post("/api/explorer", { uci_prefix: state.treePrefix });
    const path = state.treePrefix.length ? state.treePrefix.join(" ") : "starting position";
    const back = state.treePrefix.length ? `<button type="button" id="tree-back">Back</button>` : "";
    const moves = (data.moves || [])
      .slice(0, 16)
      .map(
        (m) =>
          `<button type="button" data-uci="${escapeAttr(m.uci)}">${escapeHtml(m.san)} · ${m.n} · ${wdl(m)} · ${scoreCell(m)}</button>`
      )
      .join("");
    root.innerHTML = `<p class="tree-path">${escapeHtml(path)} ${back}</p><div class="tree-moves">${moves || "<span class='muted'>No moves from this position in your games.</span>"}</div>`;
    const backBtn = $("#tree-back");
    if (backBtn)
      backBtn.onclick = () => {
        state.treePrefix = state.treePrefix.slice(0, -1);
        paintOpeningTree();
      };
    root.querySelectorAll("[data-uci]").forEach((b) => {
      b.onclick = () => {
        state.treePrefix = state.treePrefix.concat([b.dataset.uci]);
        paintOpeningTree();
      };
    });
  } catch (err) {
    root.textContent = String(err.message || err);
  }
}

function paintImprove(data) {
  $("#grain").textContent = grainLine(data);
  paintWdl(data);
  const have = data.analyzed ?? 0;
  const need = data.needed ?? data.nmin ?? 30;
  const pctBar = Math.min(100, Math.round((have / need) * 100));
  if (!data.ready) {
    $("#improve-gate").innerHTML = `<div class="gate">
      <p>This list waits until a slice can be more than noise. You need about <strong>${need}</strong> analyzed games. You have <strong>${have}</strong>.</p>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${have}"><span style="width:${pctBar}%"></span></div>
      <p class="muted">Meanwhile: import more games, run Analyze, and use Insights for counts you can trust. Lichess PGN evals count as analyzed.</p>
    </div>`;
    $("#improve-root").innerHTML = "";
    return;
  }
  $("#improve-gate").innerHTML = data.vs_self.length
    ? `<p class="lede">${escapeHtml(data.note || "")}</p>`
    : `<p class="lede">Enough games to look — and nothing here is worse than your overall score with an interval that stays above zero.</p>`;
  $("#improve-root").innerHTML =
    improveTable("Where you leak points", data.vs_self) +
    (data.vs_peers && data.vs_peers.length ? improveTable("Versus peers", data.vs_peers) : "");
  bindQueryRows($("#improve-root"));
}

async function refresh() {
  await paintFooter();
  const q = state.q;
  renderFilters();
  try {
    if (state.page === "games") {
      const data = await api.get(
        "/api/games?q=" + encodeURIComponent(q) + "&limit=" + state.limit + "&offset=" + state.offset
      );
      paintGames(data);
      paintReview(data);
    } else if (state.page === "insights") {
      paintInsights(await api.get("/api/insights?q=" + encodeURIComponent(q)));
      await paintOpeningTree();
    } else if (state.page === "improve") {
      const nmin = Number($("#nmin").value || 30);
      paintImprove(await api.get("/api/improve?q=" + encodeURIComponent(q) + "&nmin=" + nmin));
    } else if (state.page === "analyze") {
      paintAnalyze(await api.get("/api/analyze/status"));
    } else if (state.page === "sql") {
      if (!$("#sql-schema").dataset.ready) await paintSqlSchema();
    }
  } catch (err) {
    $("#grain").textContent = String(err.message || err);
  }
}

function paintAnalyze(s) {
  const eng = s.engine || {};
  const line = $("#engine-line");
  if (line) {
    line.textContent = eng.found ? `Stockfish: ${eng.path}` : "Stockfish is not installed. Download it once, then analyze.";
  }
  if (s.error) {
    $("#analyze-status").textContent = s.error;
  } else {
    const eta = s.eta_s != null ? Math.round(s.eta_s / 60) + " min" : "—";
    $("#analyze-status").innerHTML = `
      <div>${s.status}  ·  ${s.done} positions done  ·  ${s.remaining} remaining  ·  ${(s.rate || 0).toFixed(2)} pos/s  ·  ETA ${eta}</div>
    `;
  }
  $("#analyze-log").innerHTML = (s.log || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  const running = s.status === "running";
  const paused = s.status === "paused";
  $("#btn-pause").classList.toggle("hidden", !running);
  $("#btn-resume").classList.toggle("hidden", !paused);
  $("#btn-stop").classList.toggle("hidden", !running);
  const dl = $("#btn-download-sf");
  if (dl) dl.classList.toggle("hidden", !!eng.found);
}

const SQL_EXAMPLES = [
  { label: "Results by time control", sql: "SELECT tc_class, COUNT(*) AS n FROM v_games GROUP BY 1 ORDER BY n DESC" },
  { label: "How games ended", sql: "SELECT termination, COUNT(*) AS n FROM v_games GROUP BY 1 ORDER BY n DESC" },
  { label: "Your wins", sql: "SELECT utc_date, white, black, result FROM v_games WHERE (you_color = 'white' AND result = '1-0') OR (you_color = 'black' AND result = '0-1') ORDER BY utc_date DESC LIMIT 50" },
  { label: "Blunders with clock", sql: "SELECT m.game_id, m.ply, m.san, m.clock_centis FROM v_moves m JOIN evaluations e ON e.game_id = m.game_id AND e.ply = m.ply WHERE e.move_class = 'blunder' LIMIT 50" },
  { label: "Score by year", sql: "SELECT substr(replace(utc_date, '.', '-'), 1, 4) AS year, COUNT(*) AS n FROM v_games GROUP BY 1 ORDER BY 1" },
];

async function paintSqlSchema() {
  try {
    const data = await api.get("/api/sql/schema");
    $("#sql-schema").dataset.ready = "1";
    $("#sql-schema").innerHTML = Object.entries(data.views)
      .map(([name, cols]) => {
        return `<details><summary><code>${name}</code></summary><p class="mono muted">${cols.map((c) => c.name).join(" · ")}</p></details>`;
      })
      .join("");
    $("#sql-examples").innerHTML = SQL_EXAMPLES.map(
      (ex) => `<button type="button" data-sql="${escapeAttr(ex.sql)}">${escapeHtml(ex.label)}</button>`
    ).join("");
    $("#sql-examples").querySelectorAll("[data-sql]").forEach((b) => {
      b.onclick = () => {
        $("#sql-text").value = b.dataset.sql;
      };
    });
  } catch (err) {
    $("#sql-schema").textContent = String(err.message || err);
  }
}

async function paintFooter() {
  const meta = await api.get("/api/meta");
  state.years = meta.years || [];
  const n = meta.game_count ?? 0;
  $("#foot-games").textContent = `${n} game${n === 1 ? "" : "s"} local`;
  $("#foot-import").textContent = meta.last_import ? "imported " + meta.last_import : "no import yet";
  const sel = $("#report-depth");
  const cur = meta.report_depth;
  sel.innerHTML =
    `<option value="">auto${cur != null ? " (" + cur + ")" : ""}</option>` +
    (meta.depth_options || []).map((d) => `<option value="${d.depth}">${d.depth} · ${d.games} games</option>`).join("");
  if (cur != null) sel.value = String(cur);
  if (meta.version_drift && Object.values(meta.version_drift).some((n) => n > 0)) {
    $("#foot-import").textContent += "  ·  recompute available";
  }
  paintCue(meta);
}

document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => show(b.dataset.page);
});

$("#query-form").onsubmit = (e) => {
  e.preventDefault();
  state.q = $("#q").value.trim();
  state.offset = 0;
  refresh();
};

$("#btn-clear").onclick = () => {
  state.q = "";
  $("#q").value = "";
  state.offset = 0;
  refresh();
};

async function importFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  try {
    const report = await api.post("/api/import", fd, false);
    $("#import-report").textContent =
      `inserted ${report.inserted}  ·  yours ${report.personal ?? 0}  ·  unmatched ${report.observed ?? 0}  ·  duplicates ${report.duplicates}  ·  evals ${report.with_evals ?? 0}`;
    await refresh();
  } catch (err) {
    $("#import-report").textContent = String(err.message || err);
  }
}

$("#pgn-files").onchange = (e) => importFiles([...e.target.files]);

const drop = $("#drop-zone");
;["dragenter", "dragover"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
});
;["dragleave", "drop"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  });
});
drop.addEventListener("drop", (e) => {
  importFiles([...e.dataTransfer.files]);
});

$("#lichess-form").onsubmit = async (e) => {
  e.preventDefault();
  const username = $("#lichess-user").value.trim();
  if (!username) {
    $("#import-report").textContent = "Enter a Lichess username.";
    return;
  }
  $("#import-report").textContent = "Pulling from Lichess…";
  try {
    const report = await api.post("/api/import/lichess", {
      username,
      max_games: Number($("#lichess-max").value || 200),
    });
    $("#import-report").textContent =
      `inserted ${report.inserted}  ·  yours ${report.personal ?? 0}  ·  unmatched ${report.observed ?? 0}  ·  duplicates ${report.duplicates}  ·  evals ${report.with_evals ?? 0}`;
    await refresh();
  } catch (err) {
    $("#import-report").textContent = String(err.message || err);
  }
};

$("#analyze-form").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    mode: fd.get("mode"),
    depth: Number(fd.get("depth")),
    movetime_ms: Number(fd.get("movetime_ms")),
    multipv: Number(fd.get("multipv")),
    skip_book: fd.has("skip_book"),
    only_unanalyzed: fd.has("only_unanalyzed"),
    eco: fd.has("eco"),
  };
  paintAnalyze(await api.post("/api/analyze/start", body));
};

$("#btn-pause").onclick = () => api.post("/api/analyze/pause").then(paintAnalyze);
$("#btn-resume").onclick = () => api.post("/api/analyze/resume").then(paintAnalyze);
$("#btn-stop").onclick = () => api.post("/api/analyze/stop-after").then(paintAnalyze);

$("#btn-download-sf").onclick = async () => {
  $("#engine-line").textContent = "Downloading Stockfish…";
  try {
    const info = await api.post("/api/analyze/download-stockfish", {});
    $("#engine-line").textContent = info.found ? `Stockfish: ${info.path}` : info.error || "Download failed.";
  } catch (err) {
    $("#engine-line").textContent = String(err.message || err);
  }
};

$("#btn-analyze-game").onclick = async () => {
  const id = window.ForkSightBoard && window.ForkSightBoard.currentId();
  const statusEl = $("#board-analyze-status");
  if (!id) {
    statusEl.textContent = "Open a game from the Games table first.";
    return;
  }
  const eng = await api.get("/api/analyze/engine");
  if (!eng.found) {
    statusEl.textContent = "Stockfish isn’t installed yet — download it on the Analyze page, then come back.";
    show("analyze");
    return;
  }
  statusEl.textContent = "Analyzing this game…";
  const s = await api.post("/api/analyze/start", {
    mode: "depth",
    depth: 15,
    skip_book: true,
    only_unanalyzed: false,
    game_id: id,
  });
  if (s.error) {
    statusEl.textContent = s.error;
    return;
  }
  const tick = setInterval(async () => {
    const st = await api.get("/api/analyze/status");
    statusEl.textContent = st.status === "running" ? `Analyzing… ${st.done} positions` : st.error || st.status;
    if (st.status === "complete" || st.status === "failed" || st.status === "idle") {
      clearInterval(tick);
      if (st.status === "complete") {
        await window.ForkSightBoard.openGame(id);
        statusEl.textContent = "Done. Turning points and move marks are on the list.";
      }
    }
  }, 1500);
};

$("#sql-run").onclick = async () => {
  try {
    const data = await api.post("/api/sql", { sql: $("#sql-text").value });
    state.lastSql = data;
    const head = "<tr>" + data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>";
    const body = data.rows.map((r) => "<tr>" + r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("") + "</tr>").join("");
    $("#sql-out").innerHTML = `<div class="sql-results"><table class="dense"><thead>${head}</thead><tbody>${body}</tbody></table>${data.truncated ? "<p class='muted'>truncated at 500 rows</p>" : ""}</div>`;
    $("#sql-csv").classList.remove("hidden");
  } catch (err) {
    $("#sql-out").textContent = String(err.message || err);
    $("#sql-csv").classList.add("hidden");
  }
};

$("#sql-csv").onclick = () => {
  if (!state.lastSql) return;
  const lines = [state.lastSql.columns.join(",")].concat(
    state.lastSql.rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
  );
  navigator.clipboard.writeText(lines.join("\n"));
  $("#sql-csv").textContent = "Copied";
  setTimeout(() => {
    $("#sql-csv").textContent = "Copy CSV";
  }, 1200);
};

$("#btn-settings").onclick = async () => {
  const s = await api.get("/api/settings");
  const f = $("#settings-form");
  f.aliases.value = (s.aliases || []).join(", ");
  f.include_observed.checked = !!s.include_observed;
  f.stockfish_path.value = s.stockfish_path || "";
  f.syzygy_path.value = s.syzygy_path || "";
  $("#lichess-user").value = (s.aliases || [])[0] || $("#lichess-user").value;
  $("#settings-dialog").showModal();
};

$("#settings-save").onclick = async (e) => {
  e.preventDefault();
  const f = $("#settings-form");
  await api.post("/api/settings", {
    aliases: f.aliases.value.split(",").map((s) => s.trim()).filter(Boolean),
    include_observed: f.include_observed.checked,
    stockfish_path: f.stockfish_path.value,
    syzygy_path: f.syzygy_path.value,
  });
  $("#settings-dialog").close();
  refresh();
};

$("#report-depth").onchange = async () => {
  await api.post("/api/settings", { report_depth: $("#report-depth").value });
  refresh();
};

$("#nmin").onchange = () => {
  if (state.page === "improve") refresh();
};

$("#games-table thead").onclick = (e) => {
  const th = e.target.closest("[data-sort]");
  if (!th) return;
  const key = th.dataset.sort;
  if (state.sort.key === key) state.sort.dir *= -1;
  else state.sort = { key, dir: key === "date" ? -1 : 1 };
  refresh();
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("forksight-theme", theme);
  $("#btn-theme").textContent = theme === "dark" ? "Light" : "Dark";
}

$("#btn-theme").onclick = () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
};

$("#btn-start").onclick = () => window.ForkSightBoard && window.ForkSightBoard.go(-999);
$("#btn-prev").onclick = () => window.ForkSightBoard && window.ForkSightBoard.go(-1);
$("#btn-next").onclick = () => window.ForkSightBoard && window.ForkSightBoard.go(1);
$("#btn-end").onclick = () => window.ForkSightBoard && window.ForkSightBoard.go(999);
$("#btn-flip").onclick = () => window.ForkSightBoard && window.ForkSightBoard.flip();
$("#btn-fen").onclick = async () => {
  const fen = window.ForkSightBoard && window.ForkSightBoard.currentFen();
  if (fen) await navigator.clipboard.writeText(fen);
};
$("#btn-pgn").onclick = async () => {
  const pgn = window.ForkSightBoard && window.ForkSightBoard.currentPgn();
  if (pgn) await navigator.clipboard.writeText(pgn);
};
$("#btn-copy-link").onclick = async () => {
  const url = window.ForkSightBoard && window.ForkSightBoard.lichessUrl();
  if (url) {
    await navigator.clipboard.writeText(url);
    $("#btn-copy-link").textContent = "Copied";
    setTimeout(() => {
      $("#btn-copy-link").textContent = "Copy link";
    }, 1200);
  }
};

setInterval(() => {
  if (state.page === "analyze") refresh();
}, 2000);

window.addEventListener("DOMContentLoaded", async () => {
  applyTheme(localStorage.getItem("forksight-theme") || "light");
  if (window.ForkSightBoard) window.ForkSightBoard.mountBoard();
  try {
    const s = await api.get("/api/settings");
    if ((s.aliases || [])[0]) $("#lichess-user").value = s.aliases[0];
  } catch (_) {
    /* first paint */
  }
  await paintFooter();
  show("games");
});
