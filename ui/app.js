const state = { page: "games", q: "" };

function $(sel) {
  return document.querySelector(sel);
}

const TC_CHIPS = [
  { label: "Blitz + rapid", q: "" },
  { label: "Blitz", q: "tc:blitz" },
  { label: "Rapid", q: "tc:rapid" },
  { label: "Bullet", q: "tc:bullet" },
  { label: "Classical", q: "tc:classical" },
  { label: "All", q: "tc:all" },
];
const COLOR_CHIPS = [
  { label: "Either colour", key: "color", value: "" },
  { label: "White", key: "color", value: "white" },
  { label: "Black", key: "color", value: "black" },
];
const ASK_CHIPS = [
  { label: "Long castle", q: "castled:long" },
  { label: "KRPvKP", q: "material:KRPvKP" },
  { label: "Endgame", q: "phase:endgame" },
];

function tokenMap(q) {
  const map = {};
  String(q || "")
    .trim()
    .split(/\s+/)
    .forEach((part) => {
      const i = part.indexOf(":");
      if (i > 0) map[part.slice(0, i)] = part.slice(i + 1);
    });
  return map;
}

function setTokens(patch) {
  const map = tokenMap(state.q);
  Object.entries(patch).forEach(([k, v]) => {
    if (!v) delete map[k];
    else map[k] = v;
  });
  state.q = Object.entries(map)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  $("#q").value = state.q;
  refresh();
}

function renderFilters() {
  const map = tokenMap(state.q);
  const tcActive = map.tc == null ? "" : map.tc === "all" ? "tc:all" : "tc:" + map.tc;
  const tc = TC_CHIPS.map(
    (c) => `<button type="button" data-setq="${escapeAttr(c.q)}" class="${c.q === tcActive || (c.q === "" && !map.tc) ? "on" : ""}">${c.label}</button>`
  ).join("");
  const color = COLOR_CHIPS.map(
    (c) =>
      `<button type="button" data-color="${escapeAttr(c.value)}" class="${(map.color || "") === c.value ? "on" : ""}">${c.label}</button>`
  ).join("");
  const ask = ASK_CHIPS.map((c) => `<button type="button" data-ask="${escapeAttr(c.q)}">${c.label}</button>`).join("");
  $("#filters").innerHTML = `
    <span class="group"><span class="glabel">Time</span>${tc}</span>
    <span class="group"><span class="glabel">Colour</span>${color}</span>
    <span class="group"><span class="glabel">Ask</span>${ask}</span>
  `;
  $("#filters").querySelectorAll("[data-setq]").forEach((b) => {
    b.onclick = () => {
      const next = b.dataset.setq;
      if (next === "") setTokens({ tc: "" });
      else if (next === "tc:all") setTokens({ tc: "all" });
      else setTokens({ tc: next.slice(3) });
    };
  });
  $("#filters").querySelectorAll("[data-color]").forEach((b) => {
    b.onclick = () => setTokens({ color: b.dataset.color });
  });
  $("#filters").querySelectorAll("[data-ask]").forEach((b) => {
    b.onclick = () => {
      const [k, v] = b.dataset.ask.split(":");
      setTokens({ [k]: v });
    };
  });
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
    el.innerHTML = `${observed} game${observed === 1 ? "" : "s"} in the file ${aliases.length ? (observed === 1 ? "doesn't" : "don't") + " match alias " + aliases.map(escapeHtml).join(", ") : "have no alias set"}. Claim a name: ${chips}`;
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
    el.innerHTML = `Set your Lichess username under <button type="button" id="cue-alias">Aliases</button> so results are yours, not the opponent's.`;
    $("#cue-alias").onclick = () => $("#btn-settings").click();
    return;
  }
  el.textContent = "";
}

function show(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((el) => el.classList.toggle("on", el.id === "page-" + page));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  refresh();
}

async function refresh() {
  const q = state.q;
  renderFilters();
  try {
    if (state.page === "games") {
      const data = await api.get("/api/games?q=" + encodeURIComponent(q));
      $("#grain").textContent = grainLine(data);
      const tb = $("#games-table tbody");
      tb.innerHTML = data.rows
        .map(
          (r) => `<tr data-id="${r.game_id}">
          <td>${r.date || ""}</td><td>${r.color || ""}</td><td>${escapeHtml(r.opponent || "")}</td>
          <td>${r.rating ?? ""}</td><td>${r.tc_class || ""}</td><td>${r.eco || ""}</td>
          <td>${escapeHtml(r.opening || "")}</td><td>${r.result}</td>
          <td>${r.accuracy != null ? acc(r.accuracy) : r.analysis_status === "complete" ? "—" : ""}</td>
        </tr>`
        )
        .join("");
      tb.querySelectorAll("tr").forEach((tr) => {
        tr.onclick = async () => {
          await window.ForkSightBoard.openGame(tr.dataset.id);
          show("board");
        };
      });
    } else if (state.page === "insights") {
      const data = await api.get("/api/insights?q=" + encodeURIComponent(q));
      $("#grain").textContent = grainLine(data);
      $("#insights-sql").textContent = data.sql || "";
      const g = data.groups;
      $("#insights-root").innerHTML =
        groupTable("Colour", g.color) +
        groupTable("Time class", g.time_class) +
        groupTable("ECO family", g.eco_family) +
        groupTable("Castling", g.castling) +
        groupTable("Phase (ply grain)", g.phase) +
        materialBlock(g.material || []);
    } else if (state.page === "improve") {
      const nmin = Number($("#nmin").value || 30);
      const data = await api.get("/api/improve?q=" + encodeURIComponent(q) + "&nmin=" + nmin);
      $("#grain").textContent = grainLine(data);
      $("#improve-root").innerHTML =
        `<p class="muted">${escapeHtml(data.note || "")}</p>` +
        improveTable("Versus myself", data.vs_self) +
        improveTable("Versus peers", data.vs_peers) +
        improveTable("Accuracy gaps (own mean)", data.accuracy_gaps);
      $("#improve-root").querySelectorAll("tr[data-query]").forEach((tr) => {
        tr.onclick = () => {
          $("#q").value = tr.dataset.query;
          state.q = tr.dataset.query;
          show("games");
        };
      });
    } else if (state.page === "analyze") {
      const s = await api.get("/api/analyze/status");
      paintAnalyze(s);
    } else if (state.page === "board") {
      /* board module owns this */
    }
  } catch (err) {
    $("#grain").textContent = String(err.message || err);
  }
  await paintFooter();
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

async function paintFooter() {
  const meta = await api.get("/api/meta");
  $("#foot-db").textContent = meta.db_path;
  $("#foot-import").textContent = meta.last_import ? "imported " + meta.last_import : "no import yet";
  const sel = $("#report-depth");
  const cur = meta.report_depth;
  sel.innerHTML =
    `<option value="">auto${cur != null ? " (" + cur + ")" : ""}</option>` +
    (meta.depth_options || []).map((d) => `<option value="${d.depth}">${d.depth} · ${d.games} games</option>`).join("");
  if (cur != null) sel.value = String(cur);
  if (meta.version_drift && Object.values(meta.version_drift).some((n) => n > 0)) {
    $("#foot-import").textContent += "  ·  derivation versions differ — recompute available";
  }
  paintCue(meta);
}

document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => show(b.dataset.page);
});

$("#query-form").onsubmit = (e) => {
  e.preventDefault();
  state.q = $("#q").value.trim();
  refresh();
};

$("#pgn-files").onchange = async (e) => {
  const files = e.target.files;
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  try {
    const report = await api.post("/api/import", fd, false);
    $("#import-report").textContent =
      `inserted ${report.inserted}  ·  yours ${report.personal ?? 0}  ·  unmatched ${report.observed ?? 0}  ·  duplicates ${report.duplicates}`;
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
    statusEl.textContent =
      st.status === "running"
        ? `Analyzing… ${st.done} positions`
        : st.error || st.status;
    if (st.status === "complete" || st.status === "failed" || st.status === "idle") {
      clearInterval(tick);
      if (st.status === "complete") {
        await window.ForkSightBoard.openGame(id);
        statusEl.textContent = "Done. Step through the moves — the eval graph and move classes are filled in.";
      }
    }
  }, 1500);
};

$("#sql-run").onclick = async () => {
  try {
    const data = await api.post("/api/sql", { sql: $("#sql-text").value });
    const head = "<tr>" + data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>";
    const body = data.rows.map((r) => "<tr>" + r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("") + "</tr>").join("");
    $("#sql-out").innerHTML = `<table class="dense"><thead>${head}</thead><tbody>${body}</tbody></table>${data.truncated ? "<p class='muted'>truncated</p>" : ""}`;
  } catch (err) {
    $("#sql-out").textContent = String(err.message || err);
  }
};

$("#btn-settings").onclick = async () => {
  const s = await api.get("/api/settings");
  const f = $("#settings-form");
  f.aliases.value = (s.aliases || []).join(", ");
  f.include_observed.checked = !!s.include_observed;
  f.stockfish_path.value = s.stockfish_path || "";
  f.syzygy_path.value = s.syzygy_path || "";
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

setInterval(() => {
  if (state.page === "analyze") refresh();
}, 2000);

window.addEventListener("DOMContentLoaded", () => {
  if (window.ForkSightBoard) window.ForkSightBoard.mountBoard();
  paintFooter();
  show("games");
});
