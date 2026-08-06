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
  const games = (s.games ?? 0).toLocaleString();
  const plies = (s.plies ?? 0).toLocaleString();
  const complete = (s.complete_at_depth ?? 0).toLocaleString();
  return `${games} games  ·  ${plies} matched plies  ·  ${complete} games complete at depth ${depth}`;
}

function scoreCell(row) {
  if (row.score == null || !row.n) return "—";
  return `${(row.score * 100).toFixed(1)}%`;
}

function wdl(row) {
  return `${row.wins ?? 0}–${row.draws ?? 0}–${row.losses ?? 0}`;
}

function acc(v) {
  return v == null ? "—" : Number(v).toFixed(1);
}

function groupTable(title, rows, { onClick } = {}) {
  if (!rows || !rows.length) return `<h3>${title}</h3><p class="muted">No rows.</p>`;
  const body = rows
    .map((r) => {
      const key = r.key ?? r.slice ?? "—";
      return `<tr data-key="${escapeAttr(String(key))}">
        <td>${escapeHtml(String(key))}</td>
        <td>${r.n ?? r.plies ?? 0}</td>
        <td>${wdl(r)}</td>
        <td>${scoreCell(r)}</td>
        <td>${acc(r.accuracy)}</td>
      </tr>`;
    })
    .join("");
  return `<h3>${title}</h3>
    <table class="dense"><thead><tr><th>Slice</th><th>n</th><th>W–D–L</th><th>Score</th><th>Acc</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

function materialBlock(rows) {
  if (!rows.length) return "<h3>Material class</h3><p class='muted'>No rows.</p>";
  return `<h3>Material class</h3>
    <p class="muted">Combined W/D/L mixes position selection with play. Bands sit under each class.</p>
    ${rows
      .map((r) => {
        const bands = (r.bands || [])
          .map(
            (b) =>
              `<tr class="muted"><td>entered ${escapeHtml(b.band)}</td><td>${b.n}</td><td>${wdl(b)}</td><td>${scoreCell(b)}</td><td></td></tr>`
          )
          .join("");
        return `<table class="dense"><tbody>
          <tr data-query="material:${escapeAttr(r.key)}">
            <td>${escapeHtml(r.key)} <span class="muted">${r.spans} spans</span></td>
            <td>${r.n}</td><td>${wdl(r)}</td><td>${scoreCell(r)}</td><td></td>
          </tr>${bands}
        </tbody></table>`;
      })
      .join("")}`;
}

function improveTable(title, rows) {
  if (!rows || !rows.length) return `<h3>${title}</h3><p class="muted">No slices yet.</p>`;
  const body = rows
    .map((r) => {
      const cls = r.crosses_zero || r.below_nmin ? "greyed" : "";
      const iv = r.interval ? `${r.interval[0].toFixed(1)} to ${r.interval[1].toFixed(1)}` : "";
      return `<tr class="${cls}" data-query="${escapeAttr(r.slice || "")}">
        <td>${escapeHtml(r.slice || r.key || "")}</td>
        <td>${r.n}</td>
        <td>${(r.extra_losses_per_100 ?? 0).toFixed(1)}</td>
        <td>${iv}</td>
      </tr>`;
    })
    .join("");
  return `<h3>${title}</h3>
    <table class="dense"><thead><tr><th>Slice</th><th>n</th><th>Extra losses / 100</th><th>Interval</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
