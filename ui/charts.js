function drawEvalGraph(canvas, points, ply, onJump) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || 104;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  const h = cssH;
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--box").trim() || "#262421";
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#bababa";
  const win = getComputedStyle(document.documentElement).getPropertyValue("--win").trim() || "#629924";
  const loss = getComputedStyle(document.documentElement).getPropertyValue("--loss").trim() || "#c33";
  const rule = getComputedStyle(document.documentElement).getPropertyValue("--rule").trim() || "#3d3a36";
  const goodSoft = getComputedStyle(document.documentElement).getPropertyValue("--good-soft").trim() || "rgba(98, 153, 36, 0.22)";
  const badSoft = getComputedStyle(document.documentElement).getPropertyValue("--bad-soft").trim() || "rgba(204, 51, 51, 0.22)";
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const mid = h / 2;
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText("White", 4, 12);
  ctx.fillText("Black", 4, h - 4);
  if (!points.length) {
    canvas.onclick = null;
    return;
  }
  const xs = points.map((_, i) => (i / Math.max(1, points.length - 1)) * (w - 2) + 1);
  const ys = points.map((p) => mid - ((p - 50) / 50) * (h * 0.42));
  ctx.beginPath();
  ctx.moveTo(xs[0], mid);
  points.forEach((p, i) => {
    ctx.lineTo(xs[i], ys[i]);
  });
  ctx.lineTo(xs[xs.length - 1], mid);
  ctx.closePath();
  ctx.fillStyle = goodSoft;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, mid, w, h - mid);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(xs[0], mid);
  points.forEach((_, i) => ctx.lineTo(xs[i], ys[i]));
  ctx.lineTo(xs[xs.length - 1], mid);
  ctx.closePath();
  ctx.fillStyle = badSoft;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  points.forEach((_, i) => {
    if (i === 0) ctx.moveTo(xs[i], ys[i]);
    else ctx.lineTo(xs[i], ys[i]);
  });
  ctx.stroke();
  if (ply != null && points.length) {
    const i = Math.min(points.length - 1, Math.max(0, ply));
    ctx.strokeStyle = loss;
    ctx.beginPath();
    ctx.moveTo(xs[i], 0);
    ctx.lineTo(xs[i], h);
    ctx.stroke();
  }
  canvas.onclick = (ev) => {
    if (!onJump || !points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const i = Math.round((x / Math.max(1, rect.width)) * (points.length - 1));
    onJump(Math.max(0, Math.min(points.length - 1, i)));
  };
}

function formatClock(centis) {
  if (centis == null) return "";
  const s = Math.floor(centis / 100);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
