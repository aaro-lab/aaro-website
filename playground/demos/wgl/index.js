import { setupCanvas, registerDemo } from '../shared.js';

export function init(cell) {
  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  if (!canvas) return;
  let ctx, W, H, planH, secH;
  const PLAN_RATIO = 0.55;
  let dragIdx = -1, hovIdx = -1;

  const verts = [
    { x: 0.22, y: 0.10, fh: 8.0, label: 'A' },
    { x: 0.18, y: 0.38, fh: 3.0, label: 'B' },
    { x: 0.28, y: 0.58, fh: 7.0, label: 'C' },
    { x: 0.58, y: 0.55, fh: 0.0, label: 'D' },
    { x: 0.68, y: 0.28, fh: 1.0, label: 'E' },
    { x: 0.55, y: 0.08, fh: 9.0, label: 'F' },
  ];

  function resize() {
    const s = setupCanvas(canvas);
    W = s.w; H = s.h; ctx = s.ctx;
    planH = H * PLAN_RATIO; secH = H * (1 - PLAN_RATIO);
  }
  const PLAN_SHIFT = 50;
  function toCanvas(v) { return { x: v.x * W, y: v.y * (planH - PLAN_SHIFT) + PLAN_SHIFT }; }
  function fromCanvas(cx, cy) { return { x: cx / W, y: (cy - PLAN_SHIFT) / (planH - PLAN_SHIFT) }; }
  function edgeLen(a, b) {
    const dx = (a.x - b.x) * W, dy = (a.y - b.y) * planH;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function calcMetrics() {
    let perimeter = 0, area = 0;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      perimeter += edgeLen(verts[i], verts[j]);
      const ax = verts[i].x * W, ay = verts[i].y * planH;
      const bx = verts[j].x * W, by = verts[j].y * planH;
      area += ax * by - bx * ay;
    }
    area = Math.abs(area) / 2;
    const hMin = Math.min(...verts.map(v => v.fh));
    const hMax = Math.max(...verts.map(v => v.fh));
    const scale = 0.05, perimM = perimeter * scale;
    let secArea = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const len = edgeLen(verts[i], verts[j]) * scale;
      secArea += (verts[i].fh - hMin + verts[j].fh - hMin) / 2 * len;
    }
    return { area: area * scale * scale, perimeter: perimM, secArea, hWeighted: perimM > 0 ? hMin + secArea / perimM : hMin, hMin, hMax };
  }

  function getPlanFromSecX(targetX) {
    let cumDist = 0; const n = verts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, eLen = edgeLen(verts[i], verts[j]);
      if (targetX <= cumDist + eLen + 1e-6) {
        const t = eLen > 0 ? Math.min(1, (targetX - cumDist) / eLen) : 0;
        return { x: verts[i].x + t * (verts[j].x - verts[i].x), y: verts[i].y + t * (verts[j].y - verts[i].y) };
      }
      cumDist += eLen;
    }
    return null;
  }

  function compute3mBoundaries(m) {
    const n = verts.length;
    if (m.hMax - m.hMin <= 3) return { boundaries: [], intersections: [] };
    const boundaries = [];
    for (let h = m.hMin + 3; h < m.hMax; h += 3) boundaries.push(h);
    const secPts = []; let cumDist = 0;
    for (let i = 0; i <= n; i++) {
      secPts.push({ x: cumDist, fh: verts[i % n].fh });
      if (i < n) cumDist += edgeLen(verts[i], verts[(i + 1) % n]);
    }
    const intersections = [];
    for (const bh of boundaries) {
      const pts = [];
      for (let i = 0; i < secPts.length - 1; i++) {
        const h1 = secPts[i].fh, h2 = secPts[i + 1].fh;
        if (h1 === h2) continue;
        if ((h1 < bh && h2 >= bh) || (h1 > bh && h2 <= bh)) {
          const t = (bh - h1) / (h2 - h1);
          const secX = secPts[i].x + t * (secPts[i + 1].x - secPts[i].x);
          const planPt = getPlanFromSecX(secX);
          if (planPt) pts.push({ secX, ...planPt });
        }
      }
      intersections.push({ height: bh, points: pts });
    }
    return { boundaries, intersections };
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const m = calcMetrics(), n = verts.length, b3m = compute3mBoundaries(m);

    ctx.save();
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('PLAN VIEW', 8, 14);
    ctx.beginPath();
    verts.forEach((v, i) => { const p = toCanvas(v); i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = toCanvas(verts[i]), b = toCanvas(verts[j]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      const len = edgeLen(verts[i], verts[j]) * 0.05;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.font = "400 9px 'IBM Plex Mono', monospace";
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const dx = b.x - a.x, dy = b.y - a.y, nl = Math.sqrt(dx*dx+dy*dy) || 1;
      ctx.fillText(len.toFixed(2), mx + (-dy/nl)*14, my + (dx/nl)*14);
    }
    if (b3m.intersections.length) {
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(196,119,60,0.5)'; ctx.lineWidth = 1;
      for (const inter of b3m.intersections) {
        if (inter.points.length >= 2) {
          ctx.beginPath();
          inter.points.forEach((pt, i) => { const py = pt.y * (planH-PLAN_SHIFT)+PLAN_SHIFT; i === 0 ? ctx.moveTo(pt.x * W, py) : ctx.lineTo(pt.x * W, py); });
          ctx.stroke();
          ctx.font = "400 8px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(196,119,60,0.5)';
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(inter.height.toFixed(1) + 'm', inter.points[0].x * W + 4, inter.points[0].y * (planH-PLAN_SHIFT)+PLAN_SHIFT - 4);
        }
        for (const pt of inter.points) { ctx.beginPath(); ctx.arc(pt.x * W, pt.y * (planH-PLAN_SHIFT)+PLAN_SHIFT, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(196,119,60,0.5)'; ctx.fill(); }
      }
      ctx.setLineDash([]); ctx.restore();
    }
    const cxP = verts.reduce((s, v) => s + v.x, 0) / n * W, cyP = verts.reduce((s, v) => s + v.y, 0) / n * (planH-PLAN_SHIFT) + PLAN_SHIFT;
    ctx.font = "600 14px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m.area.toFixed(2) + ' m\u00B2', cxP, cyP);

    for (let i = 0; i < n; i++) {
      const p = toCanvas(verts[i]), isH = hovIdx === i, isD = dragIdx === i;
      ctx.beginPath(); ctx.arc(p.x, p.y, isH || isD ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isD ? '#C4773C' : isH ? '#E8944A' : '#fff'; ctx.fill();
      ctx.font = "700 12px 'DM Sans', sans-serif"; ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(verts[i].label, p.x, p.y - 12);
      ctx.font = "400 10px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textBaseline = 'top'; ctx.fillText('FH:' + verts[i].fh.toFixed(2), p.x, p.y + 10);
    }
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(0, planH); ctx.lineTo(W, planH);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = "500 9px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('SECTION VIEW', 8, planH + 14);

    ctx.save(); ctx.translate(0, planH);
    const padL = 36, padR = 16, padT = 26, padB = 30;
    const sW = W - padL - padR, sH = secH - padT - padB;
    const maxFH = Math.max(...verts.map(v => v.fh), 1);
    const secPts = []; let cumDist = 0, totalPerim = 0;
    for (let i = 0; i < n; i++) totalPerim += edgeLen(verts[i], verts[(i + 1) % n]);
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      secPts.push({ x: padL + (cumDist / totalPerim) * sW, y: padT + sH - (verts[idx].fh / maxFH) * sH * 0.85, label: verts[idx].label, fh: verts[idx].fh });
      if (i < n) cumDist += edgeLen(verts[i], verts[(i + 1) % n]);
    }
    ctx.font = "400 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let h = 0; h <= maxFH; h += 1) {
      const gy = padT + sH - (h / maxFH) * sH * 0.85;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + sW, gy);
      ctx.strokeStyle = h === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = h === 0 ? 0.5 : 0.3; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText(h.toFixed(1), padL - 4, gy);
    }
    if (b3m.boundaries.length) {
      ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = 'rgba(196,119,60,0.5)'; ctx.lineWidth = 0.8;
      for (const bh of b3m.boundaries) {
        const by = padT + sH - (bh / maxFH) * sH * 0.85;
        ctx.beginPath(); ctx.moveTo(padL, by); ctx.lineTo(padL + sW, by); ctx.stroke();
        ctx.font = "500 8px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(196,119,60,0.5)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(bh.toFixed(1) + 'm', padL + sW + 3, by + 3);
      }
      for (const inter of b3m.intersections) {
        const by = padT + sH - (inter.height / maxFH) * sH * 0.85;
        for (const pt of inter.points) { const sx = padL + (pt.secX / totalPerim) * sW; ctx.beginPath(); ctx.arc(sx, by, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(196,119,60,0.5)'; ctx.fill(); }
      }
      ctx.setLineDash([]); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(secPts[0].x, padT + sH);
    secPts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(secPts[secPts.length - 1].x, padT + sH); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
    ctx.save(); ctx.clip();
    for (let hx = padL; hx < padL + sW; hx += 8) {
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx - 30, padT + sH + 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); secPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    const wglY = padT + sH - (m.hWeighted / maxFH) * sH * 0.85;
    ctx.beginPath(); ctx.setLineDash([6, 4]);
    ctx.moveTo(padL, wglY); ctx.lineTo(padL + sW, wglY);
    ctx.strokeStyle = '#C4773C'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    ctx.font = "600 9px 'IBM Plex Mono', monospace"; ctx.fillStyle = '#C4773C';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('WGL: ' + m.hWeighted.toFixed(2) + ' m', padL + sW + 3, wglY + 3);
    secPts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.font = "600 10px 'DM Sans', sans-serif"; ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(p.label, p.x, padT + sH + 5);
      ctx.font = "400 8px 'IBM Plex Mono', monospace"; ctx.fillText('FH:' + p.fh.toFixed(2), p.x, p.y - 13);
    });
    ctx.restore();
    metricsEl.textContent = `Section Area: ${m.secArea.toFixed(2)}  |  Perimeter: ${m.perimeter.toFixed(2)}  |  h_min: ${m.hMin.toFixed(2)} + (${m.secArea.toFixed(2)}/${m.perimeter.toFixed(2)}) = ${m.hWeighted.toFixed(4)}`;
  }

  function hitTest(mx, my) {
    for (let i = 0; i < verts.length; i++) { const p = toCanvas(verts[i]); if (Math.hypot(mx - p.x, my - p.y) < 14) return i; }
    return -1;
  }
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragIdx >= 0) { const nv = fromCanvas(mx, my); verts[dragIdx].x = Math.max(0.05, Math.min(0.95, nv.x)); verts[dragIdx].y = Math.max(0.05, Math.min(0.95, nv.y)); return; }
    hovIdx = hitTest(mx, my); canvas.style.cursor = hovIdx >= 0 ? 'pointer' : 'default';
  });
  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    dragIdx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (dragIdx >= 0) { canvas.style.cursor = 'grabbing'; e.preventDefault(); }
  });
  canvas.addEventListener('mouseup', () => { dragIdx = -1; canvas.style.cursor = 'default'; });
  canvas.addEventListener('mouseleave', () => { dragIdx = -1; hovIdx = -1; });
  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) { const val = prompt(`${verts[idx].label} \uB192\uC774 (FH) \uC785\uB825:`, verts[idx].fh.toFixed(2)); if (val !== null && !isNaN(+val)) verts[idx].fh = Math.max(0, +val); }
  });
  canvas.addEventListener('touchstart', e => { const t = e.touches[0], rect = canvas.getBoundingClientRect(); dragIdx = hitTest(t.clientX - rect.left, t.clientY - rect.top); if (dragIdx >= 0) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', e => { if (dragIdx < 0) return; const t = e.touches[0], rect = canvas.getBoundingClientRect(); const nv = fromCanvas(t.clientX - rect.left, t.clientY - rect.top); verts[dragIdx].x = Math.max(0.05, Math.min(0.95, nv.x)); verts[dragIdx].y = Math.max(0.05, Math.min(0.95, nv.y)); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', () => { dragIdx = -1; });

  const origVerts = verts.map(v => ({ x: v.x, y: v.y, fh: v.fh }));
  const driftTargets = verts.map(() => ({ dx: 0, dy: 0, dfh: 0 }));
  function pickTarget(i) { driftTargets[i].dx = (Math.random() - 0.5) * 0.2; driftTargets[i].dy = (Math.random() - 0.5) * 0.2; driftTargets[i].dfh = (Math.random() - 0.5) * 4; }
  verts.forEach((_, i) => pickTarget(i));
  resize(); window.addEventListener('resize', resize);

  registerDemo(cell, () => {
    if (dragIdx < 0) verts.forEach((v, i) => {
      const tx = origVerts[i].x + driftTargets[i].dx, ty = origVerts[i].y + driftTargets[i].dy, tfh = Math.max(0, origVerts[i].fh + driftTargets[i].dfh);
      v.x += (tx - v.x) * 0.012; v.y += (ty - v.y) * 0.012; v.fh += (tfh - v.fh) * 0.012;
      if (Math.abs(v.x - tx) < 0.003 && Math.abs(v.y - ty) < 0.003) pickTarget(i);
    });
    draw();
  });
}
