const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body, isJson = true) {
    const opts = { method: "POST", headers: { "X-ForkSight-Request": "1" } };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (isJson) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body ?? {});
    }
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

function grainLine(s) {
  const depth = s.report_depth != null ? s.report_depth : "—";
  const plies = (s.plies ?? 0).toLocaleString();
  const complete = (s.complete_at_depth ?? 0).toLocaleString();
  return `${plies} plies in this filter  ·  ${complete} analyzed at depth ${depth}`;
}

function tokenMap(q) {
  const map = {};
  const re = /([a-zA-Z_]+):("([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(String(q || "")))) {
    map[m[1].toLowerCase()] = m[3] != null ? m[3] : m[4];
  }
  return map;
}

function formatTokens(map) {
  return Object.entries(map)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => (/\s/.test(String(v)) ? `${k}:"${v}"` : `${k}:${v}`))
    .join(" ");
}

function pct(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return (Number(v) * 100).toFixed(1) + "%";
}

function scoreCell(row) {
  const n = row.n ?? 0;
  if (row.score == null || n < 5) return "—";
  const pct = row.score * 100;
  return n < 20 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
}

function wdl(row) {
  if (row.wins == null && row.draws == null && row.losses == null) return "—";
  return `${row.wins ?? 0}–${row.draws ?? 0}–${row.losses ?? 0}`;
}

function acc(v, n) {
  if (v == null) return "—";
  if (n != null && n < 3) return "—";
  if (n != null && n < 10) return Number(v).toFixed(0);
  return Number(v).toFixed(1);
}

function resultLabel(r) {
  if (r === "win") return "Win";
  if (r === "draw") return "Draw";
  if (r === "loss") return "Loss";
  return r || "—";
}

function groupTable(title, rows, { nLabel = "games", extra = "", wide = false } = {}) {
  if (!rows || !rows.length) return `<section class="block${wide ? " wide" : ""}"><h3>${title}</h3><p class="muted">Nothing in this filter.</p></section>`;
  const showWdl = rows.some((r) => r.wins != null);
  const showScore = rows.some((r) => r.score != null);
  const showAcc = rows.some((r) => r.accuracy != null);
  const body = rows
    .map((r) => {
      const label = r.label ?? r.key ?? "—";
      const q = r.query || "";
      const thin = (r.n ?? 0) < 5 ? " thin" : "";
      return `<tr class="${thin}" data-query="${escapeAttr(q)}">
        <td>${escapeHtml(String(label))}</td>
        <td class="num">${r.n ?? r.plies ?? 0}</td>
        ${showWdl ? `<td class="num">${wdl(r)}</td>` : ""}
        ${showScore ? `<td class="num">${scoreCell(r)}</td>` : ""}
        ${showAcc ? `<td class="num">${acc(r.accuracy, r.n)}</td>` : ""}
        ${r.blunder_rate != null ? `<td class="num">${(r.blunder_rate * 100).toFixed(0)}%</td>` : ""}
      </tr>`;
    })
    .join("");
  const blunderHead = rows.some((r) => r.blunder_rate != null) ? `<th data-sort="num">Blunders</th>` : "";
  return `<section class="block${wide ? " wide" : ""}">
    <h3>${title}</h3>
    ${extra}
    <table class="dense sortable">
      <thead><tr>
        <th data-sort="label"></th>
        <th data-sort="num" title="${escapeAttr(nLabel)}">n</th>
        ${showWdl ? `<th data-sort="label">W–D–L</th>` : ""}
        ${showScore ? `<th data-sort="num">Score</th>` : ""}
        ${showAcc ? `<th data-sort="num">Acc</th>` : ""}
        ${blunderHead}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="n-note muted">n = ${escapeHtml(nLabel)}</p>
  </section>`;
}

function materialBlock(rows) {
  rows = (rows || []).filter((r) => (r.n || 0) >= 2 || !String(r.label || "").includes(" vs "));
  if (!rows.length) return "<h3>Material</h3><p class='muted'>No imbalances in this filter.</p>";
  const body = rows
    .map(
      (r) => `<tr data-query="${escapeAttr(r.query || "")}">
        <td>${escapeHtml(r.label || r.key)}</td>
        <td class="num">${r.n}</td>
        <td class="num">${wdl(r)}</td>
        <td class="num">${scoreCell(r)}</td>
      </tr>`
    )
    .join("");
  return `<section class="block wide">
    <h3>Material</h3>
    <p class="muted">n is games that reached this imbalance. One game can land in several rows — do not add the n column.</p>
    <table class="dense sortable">
      <thead><tr><th data-sort="label">Imbalance</th><th data-sort="num">n</th><th data-sort="label">W–D–L</th><th data-sort="num">Score</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function phaseBlock(rows) {
  if (!rows.length) return "";
  const body = rows
    .map(
      (r) => `<tr data-query="${escapeAttr(r.query || "")}">
        <td>${escapeHtml(r.label || r.key)}</td>
        <td class="num">${r.n}</td>
        <td class="num">${r.plies ?? "—"}</td>
        <td class="num">${acc(r.accuracy, r.n)}</td>
      </tr>`
    )
    .join("");
  return `<section class="block">
    <h3>Phase</h3>
    <p class="muted">n is games that reached the phase. Accuracy is your moves in finished analyses only.</p>
    <table class="dense sortable">
      <thead><tr><th data-sort="label"></th><th data-sort="num">Games</th><th data-sort="num">Plies</th><th data-sort="num">Acc</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function improveTable(title, rows) {
  if (!rows || !rows.length) return "";
  const body = rows
    .map((r) => {
      const iv = r.interval ? `${r.interval[0].toFixed(1)} to ${r.interval[1].toFixed(1)}` : "";
      return `<tr data-query="${escapeAttr(r.query || r.slice || "")}">
        <td>${escapeHtml(r.slice || r.label || r.key || "")}</td>
        <td class="num">${r.n}</td>
        <td class="num">${(r.extra_losses_per_100 ?? 0).toFixed(1)}</td>
        <td class="num muted">${r.conservative != null ? r.conservative.toFixed(1) : ""}</td>
        <td class="num muted">${iv}</td>
      </tr>`;
    })
    .join("");
  return `<section class="block">
    <h3>${title}</h3>
    <p class="muted">Sorted by the lower bound of extra losses per 100 games. Only rows whose interval stays above zero.</p>
    <table class="dense">
      <thead><tr>
        <th></th><th>games</th><th>Extra losses / 100 games</th><th>Lower bound</th><th>Interval</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function barChart(rows, { value = (r) => (r.score != null ? r.score * 100 : 0), max = 100 } = {}) {
  if (!rows || !rows.length) return "";
  return `<div class="bars" role="img">
    ${rows
      .map((r) => {
        const v = value(r);
        const w = Math.max(0, Math.min(100, (v / max) * 100));
        return `<div class="bar-row">
          <span class="bar-label">${escapeHtml(String(r.label || r.key || ""))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${w}%"></span></span>
          <span class="bar-val num">${scoreCell(r)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function cellSortValue(td, kind) {
  const text = (td.textContent || "").trim();
  if (kind === "num") {
    if (!text || text === "—" || text === "-") return null;
    const n = parseFloat(text.replace(/,/g, "").replace(/%/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return text;
}

function bindTableSort() {
  if (bindTableSort.bound) return;
  bindTableSort.bound = true;
  document.addEventListener("click", (e) => {
    const th = e.target.closest("table.sortable thead th");
    if (!th) return;
    e.stopPropagation();
    const table = th.closest("table");
    const headers = [...table.tHead.rows[0].cells];
    const col = headers.indexOf(th);
    if (col < 0) return;
    const kind = th.dataset.sort === "num" ? "num" : "label";
    const same = table.dataset.sortCol === String(col);
    const dir = same ? Number(table.dataset.sortDir) * -1 : kind === "num" ? -1 : 1;
    table.dataset.sortCol = String(col);
    table.dataset.sortDir = String(dir);
    const body = table.tBodies[0];
    const rows = [...body.rows];
    rows.sort((a, b) => {
      const va = cellSortValue(a.cells[col], kind);
      const vb = cellSortValue(b.cells[col], kind);
      const aMiss = va == null || va === "";
      const bMiss = vb == null || vb === "";
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;
      if (bMiss) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dir;
    });
    rows.forEach((row) => body.appendChild(row));
    headers.forEach((h, i) => {
      h.classList.toggle("sort-on", i === col);
      let mark = h.querySelector(".dir");
      if (!mark) {
        mark = document.createElement("span");
        mark.className = "dir";
        h.appendChild(mark);
      }
      mark.textContent = i === col ? (dir === 1 ? "▲" : "▼") : "";
    });
  });
}

bindTableSort();

window.api = api;
