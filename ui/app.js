const state = { page: "games", q: "" };

function $(sel) {
  return document.querySelector(sel);
}

function show(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((el) => el.classList.toggle("on", el.id === "page-" + page));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  refresh();
}

async function refresh() {
  const q = state.q;
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
  const eta = s.eta_s != null ? Math.round(s.eta_s / 60) + " min" : "—";
  $("#analyze-status").innerHTML = `
    <div>status ${s.status}  ·  ${s.done} done  ·  ${s.remaining} remaining  ·  ${(s.rate || 0).toFixed(2)} pos/s  ·  ETA ${eta}</div>
  `;
  $("#analyze-log").innerHTML = (s.log || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
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
      `inserted ${report.inserted}  ·  duplicates ${report.duplicates}  ·  aborted ${report.dropped_aborted}  ·  unparseable ${report.dropped_unparseable}`;
    refresh();
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
$("#btn-bench").onclick = async () => {
  const fd = new FormData($("#analyze-form"));
  const body = { mode: fd.get("mode"), depth: Number(fd.get("depth")), movetime_ms: Number(fd.get("movetime_ms")), multipv: 1 };
  const r = await api.post("/api/analyze/benchmark", body);
  $("#analyze-status").textContent = `benchmark ${r.positions} pos in ${r.seconds.toFixed(1)}s · ${r.rate.toFixed(2)} pos/s · ETA ${r.eta_s ? Math.round(r.eta_s / 60) + " min" : "—"}`;
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
