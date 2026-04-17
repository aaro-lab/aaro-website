/**
 * Plant Algorithm (조경 배치) playground demo.
 * SVG plan-view tree symbols with circle packing simulation.
 * Trees persist when polygon moves — only re-generated via Run button.
 * Movement arrows shown during packing simulation.
 *
 * Based on: https://github.com/aaro-lab/plant_algorithm
 */
import { setupCanvas, pointInPolygon as pip, registerDemo } from '../shared.js';

/* ── Species database ────────────────────────────────────────── */
const SPECIES = [
  { id: 'zelkova', name: '느티나무', radius: 5,   color: '#4CAF50', layer: 'infrastructure' },
  { id: 'pine',    name: '소나무',   radius: 4.5, color: '#2E7D32', layer: 'infrastructure' },
  { id: 'cherry',  name: '벚나무',   radius: 3.5, color: '#F48FB1', layer: 'filler_large' },
  { id: 'maple',   name: '단풍나무', radius: 2.5, color: '#FF8A65', layer: 'filler_medium' },
  { id: 'shrub',   name: '철쭉',     radius: 1.2, color: '#AED581', layer: 'decorative' },
];

const LAYER_RATIOS = {
  infrastructure: 0.35, filler_large: 0.25, filler_medium: 0.25, decorative: 0.15,
};

/* ── SVG symbol cache (tinted per species color) ─────────────── */
const svgImageCache = new Map(); // key: "speciesId::color" → HTMLImageElement

async function loadTintedSvg(speciesId, color) {
  const key = `${speciesId}::${color}`;
  if (svgImageCache.has(key)) return svgImageCache.get(key);

  const basePath = import.meta.url ? new URL(`trees/${speciesId}.svg`, import.meta.url).href
    : `demos/plant/trees/${speciesId}.svg`;

  try {
    const resp = await fetch(basePath);
    let svgText = await resp.text();
    // Inject color via style on root <svg> so currentColor resolves
    svgText = svgText.replace('<svg ', `<svg style="color:${color}" `);
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    svgImageCache.set(key, img);
    return img;
  } catch {
    svgImageCache.set(key, null);
    return null;
  }
}

export function init(cell) {
  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  const coverageSlider = cell.querySelector('#plantCoverageSlider');
  const runBtn = cell.querySelector('#plantRunBtn');
  if (!canvas) return;

  let ctx, W, H;
  let dragIdx = -1, hovIdx = -1;
  let vpCx = 40, vpCy = 40, vpZoom = 0.85;
  let panning = false, panLX = 0, panLY = 0;

  /* ── Site boundary (world coords, ~80×80 space) ──────────── */
  const bdy = [
    { x: 12, y: 10 }, { x: 8, y: 45 }, { x: 15, y: 65 },
    { x: 45, y: 72 }, { x: 68, y: 55 }, { x: 70, y: 20 },
  ];

  /* ── Tree state ──────────────────────────────────────────── */
  let trees = [];          // { cx, cy, prevCx, prevCy, radius, species, id, svgImg }
  let targetCoverage = 0.4;
  let simRunning = false;
  let simIteration = 0;
  const MAX_SIM_ITER = 300;
  const MIN_CLEARANCE = 0.3;

  // Movement vectors for arrow display
  let movements = [];      // { fromX, fromY, toX, toY, magnitude }

  /* ── Preload all SVG symbols ─────────────────────────────── */
  const svgReady = Promise.all(
    SPECIES.map(sp => loadTintedSvg(sp.id, sp.color))
  );

  /* ── Coordinate transforms ────────────────────────────────── */
  function w2s(x, y) {
    const s = Math.min(W, H) * vpZoom / 80;
    return { x: W / 2 + (x - vpCx) * s, y: H / 2 + (y - vpCy) * s };
  }
  function s2w(x, y) {
    const s = Math.min(W, H) * vpZoom / 80;
    return { x: vpCx + (x - W / 2) / s, y: vpCy + (y - H / 2) / s };
  }

  function polyArea(p) {
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      a += p[i].x * p[j].y - p[j].x * p[i].y;
    return Math.abs(a) / 2;
  }

  function nearestOnBoundary(pt, poly) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
      const px = a.x + t * dx, py = a.y + t * dy;
      const d = Math.hypot(pt.x - px, pt.y - py);
      if (d < bestD) { bestD = d; best = { x: px, y: py }; }
    }
    return best;
  }

  /* ── Generate trees (only on Run button or initial boot) ──── */
  async function generateTrees() {
    await svgReady;
    const area = polyArea(bdy);
    const targetCanopyArea = area * targetCoverage;
    const newTrees = [];
    let id = 0;

    // Bounding box (compute once)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of bdy) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }

    for (const sp of SPECIES) {
      const ratio = LAYER_RATIOS[sp.layer] || 0.1;
      const layerArea = targetCanopyArea * ratio;
      const treeArea = Math.PI * sp.radius * sp.radius;
      const count = Math.max(0, Math.round(layerArea / treeArea));
      const svgImg = svgImageCache.get(`${sp.id}::${sp.color}`) || null;

      for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const rx = minX + Math.random() * (maxX - minX);
          const ry = minY + Math.random() * (maxY - minY);
          if (pip(rx, ry, bdy)) {
            newTrees.push({
              cx: rx, cy: ry,
              prevCx: rx, prevCy: ry,
              radius: sp.radius, species: sp, id: id++, svgImg,
            });
            break;
          }
        }
      }
    }

    trees = newTrees;
    movements = [];
    simIteration = 0;
    simRunning = true;
  }

  /* ── Circle packing simulation step ───────────────────────── */
  function simStep() {
    if (!simRunning || trees.length === 0) return;
    if (simIteration >= MAX_SIM_ITER) { simRunning = false; return; }

    const len = trees.length;

    // Save previous positions for movement arrows
    for (let i = 0; i < len; i++) {
      trees[i].prevCx = trees[i].cx;
      trees[i].prevCy = trees[i].cy;
    }

    // Spatial grid
    const cellSize = 12;
    const grid = new Map();
    for (let i = 0; i < len; i++) {
      const key = Math.floor(trees[i].cx / cellSize) + ',' + Math.floor(trees[i].cy / cellSize);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }

    // Accumulate separation forces
    const dx = new Float64Array(len);
    const dy = new Float64Array(len);
    let anyOverlap = false;

    for (let i = 0; i < len; i++) {
      const ci = trees[i];
      const col = Math.floor(ci.cx / cellSize);
      const row = Math.floor(ci.cy / cellSize);

      for (let dc = -2; dc <= 2; dc++) {
        for (let dr = -2; dr <= 2; dr++) {
          const bucket = grid.get((col + dc) + ',' + (row + dr));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const cj = trees[j];
            const ex = cj.cx - ci.cx, ey = cj.cy - ci.cy;
            const dist = Math.sqrt(ex * ex + ey * ey);
            const minDist = ci.radius + cj.radius + MIN_CLEARANCE;

            if (dist < minDist && dist > 0.001) {
              const overlap = minDist - dist;
              const move = overlap * 0.5;
              const nx = ex / dist, ny = ey / dist;
              const totalR = ci.radius + cj.radius;
              const ratioI = cj.radius / totalR;
              const ratioJ = ci.radius / totalR;
              dx[i] -= nx * move * ratioI;
              dy[i] -= ny * move * ratioI;
              dx[j] += nx * move * ratioJ;
              dy[j] += ny * move * ratioJ;
              anyOverlap = true;
            } else if (dist <= 0.001) {
              const angle = Math.random() * Math.PI * 2;
              const nudge = minDist * 0.5;
              dx[i] -= Math.cos(angle) * nudge * 0.5;
              dy[i] -= Math.sin(angle) * nudge * 0.5;
              dx[j] += Math.cos(angle) * nudge * 0.5;
              dy[j] += Math.sin(angle) * nudge * 0.5;
              anyOverlap = true;
            }
          }
        }
      }
    }

    // Apply forces with clamping
    const maxStep = 0.6;
    let totalMovement = 0;
    for (let i = 0; i < len; i++) {
      const mag = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (mag > maxStep) {
        const s = maxStep / mag;
        dx[i] *= s; dy[i] *= s;
      }
      trees[i].cx += dx[i];
      trees[i].cy += dy[i];
      totalMovement += Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);

      // Boundary projection
      if (!pip(trees[i].cx, trees[i].cy, bdy)) {
        const nearest = nearestOnBoundary({ x: trees[i].cx, y: trees[i].cy }, bdy);
        if (nearest) {
          trees[i].cx += (nearest.x - trees[i].cx) * 0.3;
          trees[i].cy += (nearest.y - trees[i].cy) * 0.3;
        }
      }
    }

    // Build movement vectors for arrow display
    movements = [];
    for (let i = 0; i < len; i++) {
      const mx = trees[i].cx - trees[i].prevCx;
      const my = trees[i].cy - trees[i].prevCy;
      const m = Math.sqrt(mx * mx + my * my);
      if (m > 0.01) {
        movements.push({
          fromX: trees[i].prevCx, fromY: trees[i].prevCy,
          toX: trees[i].cx, toY: trees[i].cy,
          magnitude: m,
        });
      }
    }

    simIteration++;
    if (totalMovement < 0.01 || !anyOverlap) {
      simRunning = false;
      movements = [];
    }
  }

  /* ── Re-pack existing trees into changed polygon ─────────── */
  function repackExisting() {
    // Push trees outside boundary back inside
    for (const t of trees) {
      if (!pip(t.cx, t.cy, bdy)) {
        const nearest = nearestOnBoundary({ x: t.cx, y: t.cy }, bdy);
        if (nearest) { t.cx = nearest.x; t.cy = nearest.y; }
      }
    }
    simIteration = 0;
    simRunning = true;
  }

  function computeCoverage() {
    const area = polyArea(bdy);
    if (area < 1) return 0;
    let canopy = 0;
    for (const t of trees) canopy += Math.PI * t.radius * t.radius;
    return Math.min(canopy / area, 1.0);
  }

  function resize() {
    const s = setupCanvas(canvas);
    W = s.w; H = s.h; ctx = s.ctx;
  }

  /* ── Draw arrow helper ────────────────────────────────────── */
  function drawArrow(fromS, toS, color, lineW, headSize) {
    const adx = toS.x - fromS.x, ady = toS.y - fromS.y;
    const alen = Math.hypot(adx, ady);
    if (alen < 2) return;
    const nx = adx / alen, ny = ady / alen;

    ctx.beginPath();
    ctx.moveTo(fromS.x, fromS.y);
    ctx.lineTo(toS.x, toS.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(toS.x, toS.y);
    ctx.lineTo(toS.x - nx * headSize - ny * headSize * 0.5,
               toS.y - ny * headSize + nx * headSize * 0.5);
    ctx.lineTo(toS.x - nx * headSize + ny * headSize * 0.5,
               toS.y - ny * headSize - nx * headSize * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* ── Drawing ──────────────────────────────────────────────── */
  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min(W, H) * vpZoom / 80;

    // Label
    ctx.font = "500 9px 'IBM Plex Mono',monospace";
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('PLANT LAYOUT', 8, 14);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    for (let x = 0; x <= 80; x += 10) {
      const p1 = w2s(x, 0), p2 = w2s(x, 80);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    for (let y = 0; y <= 80; y += 10) {
      const p1 = w2s(0, y), p2 = w2s(80, y);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    // Draw trees — SVG symbols
    for (const t of trees) {
      const p = w2s(t.cx, t.cy);
      const r = t.radius * scale;
      const displayR = Math.max(r, 14); // minimum screen size

      if (t.svgImg) {
        // Draw SVG symbol
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(t.svgImg, p.x - displayR, p.y - displayR, displayR * 2, displayR * 2);
        ctx.restore();
      } else {
        // Fallback: canopy circle + trunk
        ctx.beginPath();
        ctx.arc(p.x, p.y, displayR, 0, Math.PI * 2);
        ctx.fillStyle = t.species.color + '20';
        ctx.fill();
        ctx.strokeStyle = t.species.color + '60';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.5, displayR * 0.08), 0, Math.PI * 2);
        ctx.fillStyle = t.species.color + 'CC';
        ctx.fill();
      }

      // Canopy outline circle (subtle, behind SVG)
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = t.species.color + '30';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Movement arrows (during simulation)
    if (simRunning && movements.length > 0) {
      for (const mv of movements) {
        // Scale arrow for visibility: amplify direction
        const adx = mv.toX - mv.fromX, ady = mv.toY - mv.fromY;
        const mag = Math.sqrt(adx * adx + ady * ady);
        if (mag < 0.005) continue;
        const arrowLen = Math.min(Math.max(mag * 8, 0.8), 3.0); // world units
        const nx = adx / mag, ny = ady / mag;
        const fromS = w2s(mv.fromX, mv.fromY);
        const toS = w2s(mv.fromX + nx * arrowLen, mv.fromY + ny * arrowLen);
        drawArrow(fromS, toS, 'rgba(30,120,200,0.75)', 1.2, 4);
      }
    }

    // Polygon boundary
    ctx.beginPath();
    bdy.forEach((v, i) => {
      const p = w2s(v.x, v.y);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,140,140,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Edge lengths
    for (let i = 0; i < bdy.length; i++) {
      const j = (i + 1) % bdy.length;
      const a = w2s(bdy[i].x, bdy[i].y), b = w2s(bdy[j].x, bdy[j].y);
      const len = Math.hypot(bdy[j].x - bdy[i].x, bdy[j].y - bdy[i].y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const edx = b.x - a.x, edy = b.y - a.y;
      const nl = Math.hypot(edx, edy) || 1;
      ctx.font = "400 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(len.toFixed(1) + 'm', mx + (-edy / nl) * 14, my + (edx / nl) * 14);
    }

    // Vertex handles
    for (let i = 0; i < bdy.length; i++) {
      const p = w2s(bdy[i].x, bdy[i].y);
      const isH = hovIdx === i, isD = dragIdx === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isH || isD ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isD ? '#C4773C' : isH ? '#E8944A' : '#fff';
      ctx.fill();
    }

    // Species legend (bottom-left)
    const usedSpecies = new Map();
    for (const t of trees) usedSpecies.set(t.species.id, (usedSpecies.get(t.species.id) || 0) + 1);
    let ly = H - 8;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (const sp of [...SPECIES].reverse()) {
      const cnt = usedSpecies.get(sp.id) || 0;
      if (cnt === 0) continue;
      // Draw mini SVG icon if available
      const svgImg = svgImageCache.get(`${sp.id}::${sp.color}`);
      if (svgImg) {
        ctx.save(); ctx.globalAlpha = 0.8;
        ctx.drawImage(svgImg, 6, ly - 12, 14, 14);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(14, ly - 4, 4, 0, Math.PI * 2);
        ctx.fillStyle = sp.color + '99'; ctx.fill();
      }
      ctx.font = "400 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`${sp.name} ×${cnt}`, 24, ly);
      ly -= 16;
    }

    // Simulation status indicator
    if (simRunning) {
      ctx.font = "500 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = 'rgba(30,120,200,0.7)';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(`SEPARATING — ${movements.length} trees moving`, W - 8, 8);
    }

    // Metrics
    const areaVal = polyArea(bdy);
    const cov = computeCoverage();
    metricsEl.textContent =
      `Trees: ${trees.length}  |  Area: ${areaVal.toFixed(0)} m²  |  ` +
      `Coverage: ${(cov * 100).toFixed(1)}% / ${(targetCoverage * 100).toFixed(0)}%  |  ` +
      (simRunning ? `Packing: ${simIteration}/${MAX_SIM_ITER}` : 'Converged');
  }

  /* ── Interaction ──────────────────────────────────────────── */
  function hit(mx, my) {
    for (let i = 0; i < bdy.length; i++) {
      const p = w2s(bdy[i].x, bdy[i].y);
      if (Math.hypot(mx - p.x, my - p.y) < 14) return i;
    }
    return -1;
  }

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragIdx >= 0) {
      const w = s2w(mx, my);
      bdy[dragIdx].x = w.x; bdy[dragIdx].y = w.y;
      // Existing trees stay — just repack into boundary
      repackExisting();
      return;
    }
    if (panning) {
      const s = Math.min(W, H) * vpZoom / 80;
      vpCx -= (e.clientX - panLX) / s;
      vpCy -= (e.clientY - panLY) / s;
      panLX = e.clientX; panLY = e.clientY;
      return;
    }
    hovIdx = hit(mx, my);
    canvas.style.cursor = hovIdx >= 0 ? 'pointer' : 'default';
  });

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    dragIdx = hit(mx, my);
    if (dragIdx >= 0) {
      canvas.style.cursor = 'grabbing'; e.preventDefault();
    } else {
      panning = true; panLX = e.clientX; panLY = e.clientY;
      canvas.style.cursor = 'move'; e.preventDefault();
    }
  });

  canvas.addEventListener('mouseup', () => {
    dragIdx = -1; panning = false; canvas.style.cursor = 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    dragIdx = -1; panning = false; hovIdx = -1;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    vpZoom *= e.deltaY > 0 ? 0.92 : 1.08;
    vpZoom = Math.max(0.3, Math.min(5, vpZoom));
  }, { passive: false });

  // Double-click: add/remove vertex (keep existing trees, repack)
  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const idx = hit(mx, my);
    if (idx >= 0 && bdy.length > 3) {
      bdy.splice(idx, 1);
      repackExisting();
      return;
    }
    if (idx < 0) {
      const w = s2w(mx, my);
      let bD = Infinity, bE = 0;
      for (let i = 0; i < bdy.length; i++) {
        const j = (i + 1) % bdy.length;
        const a = bdy[i], b = bdy[j];
        const edx = b.x - a.x, edy = b.y - a.y;
        const t = Math.max(0, Math.min(1,
          ((w.x - a.x) * edx + (w.y - a.y) * edy) / (edx * edx + edy * edy)));
        const d = Math.hypot(w.x - (a.x + t * edx), w.y - (a.y + t * edy));
        if (d < bD) { bD = d; bE = i; }
      }
      bdy.splice(bE + 1, 0, w);
      repackExisting();
    }
  });

  // Touch support
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0], rect = canvas.getBoundingClientRect();
    dragIdx = hit(t.clientX - rect.left, t.clientY - rect.top);
    if (dragIdx >= 0) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (dragIdx < 0) return;
    const t = e.touches[0], rect = canvas.getBoundingClientRect();
    const w = s2w(t.clientX - rect.left, t.clientY - rect.top);
    bdy[dragIdx].x = w.x; bdy[dragIdx].y = w.y;
    repackExisting();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { dragIdx = -1; });

  // Coverage slider → regenerate on change
  if (coverageSlider) {
    coverageSlider.addEventListener('input', () => {
      targetCoverage = parseInt(coverageSlider.value) / 100;
      generateTrees();
    });
  }

  // Run button → fresh generation
  if (runBtn) {
    runBtn.addEventListener('click', () => generateTrees());
  }

  /* ── Auto-drift (idle animation) ──────────────────────────── */
  const orig = bdy.map(v => ({ x: v.x, y: v.y }));
  const dt = bdy.map(() => ({ dx: 0, dy: 0 }));
  function pickD(i) { dt[i].dx = (Math.random() - 0.5) * 20; dt[i].dy = (Math.random() - 0.5) * 20; }
  bdy.forEach((_, i) => pickD(i));
  let dState = 'moving', pTimer = 0, driftFrames = 0;

  /* ── Boot ─────────────────────────────────────────────────── */
  resize();
  generateTrees();
  window.addEventListener('resize', resize);

  registerDemo(cell, () => {
    // Run 2 simulation sub-steps per frame
    if (simRunning) {
      for (let s = 0; s < 2; s++) simStep();
    }

    // Auto-drift when idle (trees move with polygon, not regenerated)
    if (dragIdx < 0 && !panning) {
      if (dState === 'paused') {
        pTimer += 0.016;
        if (pTimer >= 3) {
          dState = 'moving'; driftFrames = 0;
          bdy.forEach((_, i) => { if (i < orig.length) pickD(i); });
        }
      } else {
        let allOk = true;
        bdy.forEach((v, i) => {
          if (i >= orig.length) return;
          const tx = Math.max(8, Math.min(72, orig[i].x + dt[i].dx));
          const ty = Math.max(8, Math.min(72, orig[i].y + dt[i].dy));
          v.x += (tx - v.x) * 0.04;
          v.y += (ty - v.y) * 0.04;
          if (Math.abs(v.x - tx) > 0.5 || Math.abs(v.y - ty) > 0.5) allOk = false;
        });
        driftFrames++;
        if (driftFrames % 12 === 0) repackExisting();
        if (allOk) {
          dState = 'paused'; pTimer = 0;
          repackExisting();
        }
      }
    }

    draw();
  });
}
