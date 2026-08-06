function drawEvalGraph(canvas, points, ply) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#e7e1d3";
  ctx.fillRect(0, 0, w, h);
  if (!points.length) return;
  const mid = h / 2;
  ctx.strokeStyle = "#c9c0ae";
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = "#1b3a4b";
  points.forEach((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * (w - 2) + 1;
    const y = mid - ((p - 50) / 50) * (h * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  if (ply != null && points.length) {
    const i = Math.min(points.length - 1, ply);
    const x = (i / Math.max(1, points.length - 1)) * (w - 2) + 1;
    ctx.strokeStyle = "#8a2c2c";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

function formatClock(centis) {
  if (centis == null) return "";
  const s = Math.floor(centis / 100);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
