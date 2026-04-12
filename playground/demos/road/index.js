/**
 * Road Network playground demo.
 * Interactive road generation with fillet, sidewalk, parking, direction arrows.
 */
import { setupCanvas, registerDemo } from '../shared.js';
import { dist, offsetPolyline } from './geometry.js';
import { generateRoads } from './roads.js';
import { generateParking, resolveParkingCollisions } from './parking.js';

/* ── Config constants ─────────────────────────────────────────── */
const ROAD_W = 6, SIDEWALK_W = 1.5, TURNING_R = 5, CORNER_R = 3;
const SPOT_W = 2.5, SPOT_D = 5.0, FILL_PCT = 80, JUNCTION_SB = 5;
const COINCIDENCE_THRESH = 0.5;
const HIT_THRESH   = 12;    // px — vertex hit-test radius
const DRIFT_SPEED  = 0.03;  // lerp factor per frame
const DRIFT_RANGE  = 18;    // metres — random drift target range
const PAUSE_SECS   = 2.5;   // seconds between drift cycles
const RECOMPUTE_EVERY = 6;  // frames between road recomputation during drift

/* ══════════════════════════════════════════════════════════════════
   DEMO INIT
   ══════════════════════════════════════════════════════════════════ */
export function init(cell) {
  let PC = null;
  import('https://esm.sh/polygon-clipping@0.15.7')
    .then(mod => { PC = mod.default; recompute(); })
    .catch(() => { /* fallback to strip-based rendering */ });

  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  if (!canvas) return;

  let ctx, W, H;
  let camX = 0, camY = 0, camZoom = 8;
  let panning = false, panLX = 0, panLY = 0;
  let parkingOn = false;
  let polylines = [];
  let roadResult = { segments: [], nodes: [], outline: null, filletOutline: null, sidewalkOutline: null, arrows: [] };
  let parkingSpots = [];
  let drawing = false, drawPts = [];
  let dragGroup = [], hovPl = -1, hovVi = -1;

  // ── Coordinate transforms (Y-up) ─────────────────────────────
  const w2s = (x, y) => [W / 2 + (x - camX) * camZoom, H / 2 - (y - camY) * camZoom];
  const s2w = (sx, sy) => [(sx - W / 2) / camZoom + camX, -(sy - H / 2) / camZoom + camY];

  // ── Defaults: 3 intersecting lines ────────────────────────────
  function initDefaults() {
    polylines = [
      [[-35, -8], [35, -8]],
      [[-20, 22], [20, -22]],
      [[-5, -28], [5, 28]],
    ];
  }

  function recompute() {
    const showSidewalk = !parkingOn && SIDEWALK_W > 0;
    roadResult = generateRoads(polylines, {
      roadWidth: ROAD_W, chaikinIter: 2, turningRadius: TURNING_R,
      cornerRadius: CORNER_R, sidewalkWidth: showSidewalk ? SIDEWALK_W : 0, PC,
    });
    parkingSpots = parkingOn
      ? resolveParkingCollisions(generateParking(roadResult.segments, SPOT_W, SPOT_D, FILL_PCT, JUNCTION_SB), roadResult.filletOutline || roadResult.outline)
      : [];
  }

  function resize() {
    const s = setupCanvas(canvas); W = s.w; H = s.h; ctx = s.ctx;
    camZoom = Math.min(W, H) / 80;
  }

  // ── Hit test / coincident vertex grouping ─────────────────────
  function hitVertex(sx, sy) {
    for (let pi = 0; pi < polylines.length; pi++)
      for (let vi = 0; vi < polylines[pi].length; vi++) {
        const [px, py] = w2s(polylines[pi][vi][0], polylines[pi][vi][1]);
        if (Math.hypot(sx - px, sy - py) < HIT_THRESH) return { pi, vi };
      }
    return null;
  }

  function findCoincident(pi, vi) {
    const pos = polylines[pi][vi];
    const group = [{ pi, vi }];
    for (let p = 0; p < polylines.length; p++)
      for (let v = 0; v < polylines[p].length; v++) {
        if (p === pi && v === vi) continue;
        if (dist(polylines[p][v], pos) < COINCIDENCE_THRESH) group.push({ pi: p, vi: v });
      }
    return group;
  }

  function commitDrawing() {
    if (drawPts.length < 2) return;
    polylines.push([...drawPts]);
    recompute(); initDrift();
    drawPts = []; drawing = false;
    canvas.style.cursor = 'default';
  }

  // ── Draw sub-functions ────────────────────────────────────────
  function drawPolyPath(pts) {
    const [x0, y0] = w2s(pts[0][0], pts[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) { const [x, y] = w2s(pts[i][0], pts[i][1]); ctx.lineTo(x, y); }
  }

  function drawRingSet(rings, fill, stroke, lw, alpha = 1) {
    if (!rings || !rings.length) return;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const ring of rings) { if (ring.length < 3) continue; drawPolyPath(ring); ctx.closePath(); }
    ctx.fill('evenodd');
    ctx.restore();
    if (stroke) {
      ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.lineJoin = 'round';
      for (const ring of rings) { if (ring.length < 3) continue; ctx.beginPath(); drawPolyPath(ring); ctx.closePath(); ctx.stroke(); }
      ctx.restore();
    }
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    const step = camZoom < 3 ? 20 : camZoom < 6 ? 10 : 5;
    const [wl] = s2w(0, 0), [wr] = s2w(W, 0), wb = s2w(0, H)[1], wt = s2w(0, 0)[1];
    for (let x = Math.floor(wl / step) * step; x <= wr + step; x += step) {
      const [x1, y1] = w2s(x, wt + step), [x2, y2] = w2s(x, wb - step);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (let y = Math.floor(Math.min(wt, wb) / step) * step; y <= Math.max(wt, wb) + step; y += step) {
      const [x1, y1] = w2s(wl - step, y), [x2, y2] = w2s(wr + step, y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  function drawSidewalk() {
    if (parkingOn) return;
    if (roadResult.sidewalkOutline) {
      drawRingSet(roadResult.sidewalkOutline, 'rgb(225,222,210)', 'rgba(110,100,80,0.55)', 1, 0.85);
    }
    // No fallback — sidewalk only renders when polygon-clipping produces
    // a proper difference (row − road). The fallback wider-strip approach
    // draws on top of the road surface, which is wrong.
  }

  function drawRoadSurface() {
    const roadOutline = roadResult.filletOutline || roadResult.outline;
    if (roadOutline && roadOutline.length > 0) {
      drawRingSet(roadOutline, 'rgb(180,180,180)', 'rgba(100,100,100,0.35)', 1.5, 0.45);
    }
    // Always draw per-segment strips as base layer — ensures road is
    // visible even when polygon-clipping union fails on degenerate geometry
    ctx.save(); ctx.globalAlpha = roadOutline ? 0.08 : 0.35;
    for (const seg of roadResult.segments) {
      if (seg.strip.length < 3) continue;
      ctx.beginPath(); drawPolyPath(seg.strip); ctx.closePath();
      ctx.fillStyle = 'rgb(180,180,180)'; ctx.fill();
    }
    // Junction discs fill gaps between strips
    for (const node of roadResult.nodes) {
      if (node.type !== 'junction') continue;
      const [cx, cy] = w2s(node.position[0], node.position[1]);
      ctx.beginPath(); ctx.arc(cx, cy, ROAD_W / 2 * camZoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(180,180,180)'; ctx.fill();
    }
    ctx.restore();
  }

  function drawParkingSpots() {
    if (!parkingOn || !parkingSpots.length) return;
    ctx.save(); ctx.fillStyle = 'rgba(70,130,180,0.35)'; ctx.strokeStyle = 'rgba(70,130,180,0.6)'; ctx.lineWidth = 1;
    for (const spot of parkingSpots) {
      ctx.beginPath(); drawPolyPath(spot.corners); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawArrows() {
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = 'rgba(255,255,255,1.0)'; ctx.lineWidth = 0.3; ctx.lineJoin = 'round';
    for (const arrow of roadResult.arrows) {
      ctx.beginPath(); drawPolyPath(arrow); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCenterlines() {
    ctx.save(); ctx.setLineDash([8, 5]); ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 1.5;
    for (const seg of roadResult.segments) {
      if (seg.centerline.length < 2) continue;
      ctx.beginPath(); drawPolyPath(seg.centerline); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }

  function drawUserPolylines() {
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.lineWidth = 1;
    for (const pl of polylines) { if (pl.length < 2) continue; ctx.beginPath(); drawPolyPath(pl); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
  }

  function drawPreview() {
    if (!drawing || drawPts.length < 1) return;
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(196,119,60,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); drawPolyPath(drawPts); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    for (const pt of drawPts) { const [px, py] = w2s(pt[0], pt[1]); ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = '#C4773C'; ctx.fill(); }
  }

  function drawNodes() {
    for (const node of roadResult.nodes) {
      const [nx, ny] = w2s(node.position[0], node.position[1]);
      const isJ = node.type === 'junction';
      ctx.beginPath(); ctx.arc(nx, ny, isJ ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isJ ? '#ef4444' : '#3b82f6'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  function drawVertices() {
    for (let pi = 0; pi < polylines.length; pi++) {
      for (let vi = 0; vi < polylines[pi].length; vi++) {
        const [vx, vy] = w2s(polylines[pi][vi][0], polylines[pi][vi][1]);
        const isDrag = dragGroup.some(g => g.pi === pi && g.vi === vi);
        const isHov = hovPl === pi && hovVi === vi;
        ctx.beginPath(); ctx.arc(vx, vy, isDrag ? 6 : isHov ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isDrag ? '#C4773C' : isHov ? '#E8944A' : '#1a1a1a'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }

  function updateMetrics() {
    const nSeg = roadResult.segments.length;
    const nJ = roadResult.nodes.filter(n => n.type === 'junction').length;
    const nE = roadResult.nodes.filter(n => n.type === 'entry').length;
    metricsEl.textContent = `Seg: ${nSeg}  |  J: ${nJ}  E: ${nE}  |  Lines: ${polylines.length}  |  P: ${parkingOn ? parkingSpots.length : 'off'}`;
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawSidewalk();
    drawRoadSurface();
    drawParkingSpots();
    drawArrows();
    drawCenterlines();
    drawUserPolylines();
    drawPreview();
    drawNodes();
    drawVertices();
    updateMetrics();
  }

  // ── Interaction ───────────────────────────────────────────────
  function getXY(e) { const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { sx: t.clientX - r.left, sy: t.clientY - r.top }; }

  canvas.addEventListener('mousedown', e => {
    const { sx, sy } = getXY(e);
    const hit = hitVertex(sx, sy);
    if (hit && !drawing) { dragGroup = findCoincident(hit.pi, hit.vi); canvas.style.cursor = 'grabbing'; e.preventDefault(); return; }
    if (drawing) return;
    panning = true; panLX = e.clientX; panLY = e.clientY; canvas.style.cursor = 'move'; e.preventDefault();
  });
  canvas.addEventListener('mousemove', e => {
    const { sx, sy } = getXY(e);
    if (dragGroup.length) { const [wx, wy] = s2w(sx, sy); for (const g of dragGroup) polylines[g.pi][g.vi] = [wx, wy]; recompute(); return; }
    if (panning) { camX -= (e.clientX - panLX) / camZoom; camY += (e.clientY - panLY) / camZoom; panLX = e.clientX; panLY = e.clientY; return; }
    const hit = hitVertex(sx, sy);
    if (hit) { hovPl = hit.pi; hovVi = hit.vi; canvas.style.cursor = 'pointer'; }
    else { hovPl = -1; hovVi = -1; canvas.style.cursor = drawing ? 'crosshair' : 'default'; }
  });
  canvas.addEventListener('mouseup', () => { if (dragGroup.length) dragGroup = []; panning = false; canvas.style.cursor = drawing ? 'crosshair' : 'default'; });
  canvas.addEventListener('mouseleave', () => { dragGroup = []; panning = false; hovPl = -1; hovVi = -1; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); camZoom = Math.max(1, Math.min(30, camZoom * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });
  canvas.addEventListener('click', e => { if (dragGroup.length || panning || !drawing) return; const { sx, sy } = getXY(e); drawPts.push(s2w(sx, sy)); });
  canvas.addEventListener('dblclick', e => { if (!drawing) return; e.preventDefault(); commitDrawing(); });

  // Touch
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const hit = hitVertex(t.clientX - r.left, t.clientY - r.top);
    if (hit) { dragGroup = findCoincident(hit.pi, hit.vi); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!dragGroup.length) return;
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const [wx, wy] = s2w(t.clientX - r.left, t.clientY - r.top);
    for (const g of dragGroup) polylines[g.pi][g.vi] = [wx, wy];
    recompute(); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { dragGroup = []; });

  // Keyboard — scoped to cell (focusable via tabindex)
  cell.setAttribute('tabindex', '0');
  cell.style.outline = 'none';
  cell.addEventListener('keydown', e => {
    if (e.key === 'd' || e.key === 'D') { if (!drawing) { drawing = true; drawPts = []; canvas.style.cursor = 'crosshair'; } }
    if (e.key === 'Escape' && drawing) { drawing = false; drawPts = []; canvas.style.cursor = 'default'; }
    if (e.key === 'Enter') commitDrawing();
    if (e.key === 'p' || e.key === 'P') { parkingOn = !parkingOn; if (parkingToggle) parkingToggle.checked = parkingOn; recompute(); }
    if (e.key === 'Backspace' && !drawing && polylines.length > 0) { e.preventDefault(); polylines.pop(); recompute(); initDrift(); }
  });
  // Focus cell on mouse enter so keyboard shortcuts work without explicit click
  cell.addEventListener('mouseenter', () => cell.focus());

  // Parking toggle control
  const hintEl = cell.querySelector('.pg-cell__hint');
  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'pg-ctrl';
  toggleSpan.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px';
  const parkingToggle = document.createElement('input');
  parkingToggle.type = 'checkbox';
  parkingToggle.id = 'roadParkingToggle_' + Math.random().toString(36).slice(2, 6);
  parkingToggle.checked = parkingOn;
  parkingToggle.style.cssText = 'accent-color:#C4773C;cursor:pointer';
  parkingToggle.addEventListener('change', () => { parkingOn = parkingToggle.checked; recompute(); });
  const toggleLbl = document.createElement('label');
  toggleLbl.textContent = 'Parking'; toggleLbl.htmlFor = parkingToggle.id;
  toggleLbl.style.cssText = 'cursor:pointer;font-size:10px;opacity:0.7';
  toggleSpan.appendChild(parkingToggle); toggleSpan.appendChild(toggleLbl);
  if (hintEl) hintEl.appendChild(toggleSpan);

  // ── Drift animation ───────────────────────────────────────────
  let origPts = [], driftTargets = [];
  let driftState = 'moving', pauseTimer = 0, driftFrames = 0;

  function initDrift() {
    origPts = polylines.map(pl => pl.map(p => [...p]));
    driftTargets = polylines.map(pl => pl.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]));
    driftState = 'moving'; driftFrames = 0;
  }

  function tickDrift() {
    if (dragGroup.length || panning || drawing) return;
    if (driftState === 'paused') {
      pauseTimer += 0.016;
      if (pauseTimer >= PAUSE_SECS) {
        driftState = 'moving'; driftFrames = 0;
        driftTargets = polylines.map(pl => pl.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]));
      }
      return;
    }
    let allDone = true;
    for (let pi = 0; pi < polylines.length && pi < origPts.length; pi++) {
      for (let vi = 0; vi < polylines[pi].length && vi < origPts[pi].length; vi++) {
        if (!driftTargets[pi]?.[vi]) continue;
        const tx = origPts[pi][vi][0] + driftTargets[pi][vi][0];
        const ty = origPts[pi][vi][1] + driftTargets[pi][vi][1];
        polylines[pi][vi][0] += (tx - polylines[pi][vi][0]) * DRIFT_SPEED;
        polylines[pi][vi][1] += (ty - polylines[pi][vi][1]) * DRIFT_SPEED;
        if (Math.abs(polylines[pi][vi][0] - tx) > 0.3 || Math.abs(polylines[pi][vi][1] - ty) > 0.3) allDone = false;
      }
    }
    driftFrames++;
    if (driftFrames % RECOMPUTE_EVERY === 0) recompute();
    if (allDone) { driftState = 'paused'; pauseTimer = 0; recompute(); }
  }

  // ── Boot ──────────────────────────────────────────────────────
  initDefaults();
  resize();
  recompute();
  initDrift();

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  const cleanup = registerDemo(cell, () => { tickDrift(); draw(); });

  // Return cleanup for lifecycle management
  return () => {
    cleanup();
    window.removeEventListener('resize', onResize);
  };
}
