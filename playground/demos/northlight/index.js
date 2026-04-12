/**
 * Northlight Regulation (정북일조) playground demo.
 * Dual-view: top-view (left) + isometric wireframe (right) in one canvas.
 * Dark theme. Iso view supports mouse drag rotation.
 */
import { setupCanvas, registerDemo } from '../shared.js';
import {
  generateVolume, computeEdgeProfiles, polygonArea, polygonCentroid,
  ensureCCW, DEFAULT_PARAMS,
} from './engine.js';

/* ── Dark theme colors ───────────────────────────────────────── */
const FLOOR_COLORS = [
  '#64B5F6','#42A5F5','#2196F3','#1E88E5',
  '#4FC3F7','#29B6F6','#26C6DA','#26A69A',
  '#66BB6A','#9CCC65','#D4E157','#FFEE58',
];
const STEP_COLOR   = '#ef5350';
const SITE_COLOR   = 'rgba(255,255,255,0.8)';
const NORTH_EDGE   = 'rgba(255,80,80,0.85)';
const NORTH_COLOR  = '#ff5252';
const GRID_MINOR   = 'rgba(255,255,255,0.04)';
const GRID_MAJOR   = 'rgba(255,255,255,0.08)';
const BG_LEFT      = '#111';
const BG_RIGHT     = '#0D0D0D';
const TEXT_COLOR   = 'rgba(255,255,255,0.7)';
const TEXT_DIM     = 'rgba(255,255,255,0.4)';
const LABEL_BG     = 'rgba(0,0,0,0.7)';
const VERTEX_COLOR = '#fff';
const HIT_R        = 12;
const DRIFT_SPEED  = 0.025;
const DRIFT_RANGE  = 4;
const PAUSE_SECS   = 2.0;
const RECOMP_EVERY = 8;

/* ── Default lot polygon (L-shape ~20×30m) ───────────────────── */
const DEFAULT_LOT = [
  [0, 0], [20, 0], [20, 20], [12, 20], [12, 30], [0, 30],
];

export function init(cell) {
  let PC = null;
  import('https://esm.sh/polygon-clipping@0.15.7')
    .then(mod => { PC = mod.default; recompute(); })
    .catch(() => {});

  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  if (!canvas) return;

  let ctx, W, H;
  let vertices = DEFAULT_LOT.map(p => [...p]);
  let volume = null, profiles = [];
  let dragIdx = -1, hovIdx = -1;

  // Top-view camera
  let vpZoom = 6, vpCx = 10, vpCy = 15;
  let panning = false, panLX = 0, panLY = 0;

  // Iso camera — mutable angles for drag rotation
  let isoAx = Math.PI / 6;   // tilt (elevation)
  let isoAy = -Math.PI / 4;  // rotation (azimuth)
  let isoZoom = 4, isoCx = 0, isoCy = 0;
  let isoRotating = false, isoLX = 0, isoLY = 0;

  /* ── Coordinate transforms ─────────────────────────────────── */
  function w2sTop(wx, wy) {
    return [W / 4 + (wx - vpCx) * vpZoom, H / 2 - (wy - vpCy) * vpZoom];
  }
  function s2wTop(sx, sy) {
    return [(sx - W / 4) / vpZoom + vpCx, -(sy - H / 2) / vpZoom + vpCy];
  }
  function w2sIso(x3, y3, z3) {
    const cosAx = Math.cos(isoAx), sinAx = Math.sin(isoAx);
    const cosAy = Math.cos(isoAy), sinAy = Math.sin(isoAy);
    const rx = x3 * cosAy + z3 * sinAy;
    const rz = -x3 * sinAy + z3 * cosAy;
    const ry = y3 * cosAx - rz * sinAx;
    return [W * 3 / 4 + (rx - isoCx) * isoZoom, H / 2 - (ry - isoCy) * isoZoom];
  }

  function recompute() {
    const ccw = ensureCCW(vertices);
    profiles = computeEdgeProfiles(ccw, DEFAULT_PARAMS);
    volume = generateVolume(vertices, DEFAULT_PARAMS, PC);
  }

  function centerViewports() {
    const cent = polygonCentroid(vertices);
    vpCx = cent[0]; vpCy = cent[1];
    vpZoom = Math.min(W / 2, H) / 50;
    isoZoom = Math.min(W / 2, H) / 60;
    isoCx = 0;
    isoCy = (volume?.metadata?.maxHeight || 15) / 3;
  }

  function resize() {
    const s = setupCanvas(canvas); W = s.w; H = s.h; ctx = s.ctx;
    centerViewports();
  }

  /* ── Hit test ──────────────────────────────────────────────── */
  function hitVertex(sx, sy) {
    if (sx > W / 2) return -1;
    for (let i = 0; i < vertices.length; i++) {
      const [px, py] = w2sTop(vertices[i][0], vertices[i][1]);
      if (Math.hypot(sx - px, sy - py) < HIT_R) return i;
    }
    return -1;
  }
  function hitEdge(sx, sy) {
    if (sx > W / 2) return -1;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const [ax, ay] = w2sTop(vertices[i][0], vertices[i][1]);
      const [bx, by] = w2sTop(vertices[j][0], vertices[j][1]);
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / (len * len)));
      const px = ax + t * dx, py = ay + t * dy;
      if (Math.hypot(sx - px, sy - py) < 8 && t > 0.05 && t < 0.95) return i;
    }
    return -1;
  }

  /* ── Drawing helpers ───────────────────────────────────────── */
  function drawPolyTop(pts, close) {
    if (pts.length < 2) return;
    const [x0, y0] = w2sTop(pts[0][0], pts[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) { const [x, y] = w2sTop(pts[i][0], pts[i][1]); ctx.lineTo(x, y); }
    if (close) ctx.closePath();
  }
  function drawPolyIso(pts3) {
    if (pts3.length < 6) return;
    const [x0, y0] = w2sIso(pts3[0], pts3[1], pts3[2]);
    ctx.moveTo(x0, y0);
    for (let i = 3; i < pts3.length; i += 3) {
      const [x, y] = w2sIso(pts3[i], pts3[i + 1], pts3[i + 2]);
      ctx.lineTo(x, y);
    }
  }

  /* ── Draw: Top view ────────────────────────────────────────── */
  function drawTopView() {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W / 2, H); ctx.clip();
    ctx.fillStyle = BG_LEFT; ctx.fillRect(0, 0, W / 2, H);

    // Grid
    const step = vpZoom < 3 ? 10 : vpZoom < 8 ? 5 : 1;
    const [wl] = s2wTop(0, 0), [wr] = s2wTop(W / 2, 0);
    const wt = s2wTop(0, 0)[1], wb = s2wTop(0, H)[1];
    ctx.strokeStyle = GRID_MINOR; ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = Math.floor(wl / step) * step; x <= wr + step; x += step) { const [sx] = w2sTop(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(Math.min(wt, wb) / step) * step; y <= Math.max(wt, wb) + step; y += step) { const [, sy] = w2sTop(0, y); ctx.moveTo(0, sy); ctx.lineTo(W / 2, sy); }
    ctx.stroke();
    const major = step * 5;
    ctx.strokeStyle = GRID_MAJOR;
    ctx.beginPath();
    for (let x = Math.floor(wl / major) * major; x <= wr + major; x += major) { const [sx] = w2sTop(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(Math.min(wt, wb) / major) * major; y <= Math.max(wt, wb) + major; y += major) { const [, sy] = w2sTop(0, y); ctx.moveTo(0, sy); ctx.lineTo(W / 2, sy); }
    ctx.stroke();

    // Lot fill + white stroke
    ctx.fillStyle = 'rgba(70,130,180,0.15)';
    ctx.beginPath(); drawPolyTop(vertices, true); ctx.fill();
    ctx.strokeStyle = SITE_COLOR; ctx.lineWidth = 1.5;
    ctx.beginPath(); drawPolyTop(vertices, true); ctx.stroke();

    // North-facing edges (red dashed)
    if (profiles.length) {
      ctx.save(); ctx.strokeStyle = NORTH_EDGE; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      for (let i = 0; i < profiles.length; i++) {
        if (!profiles[i].isNorthFacing) continue;
        const j = (i + 1) % vertices.length;
        const [x1, y1] = w2sTop(vertices[i][0], vertices[i][1]);
        const [x2, y2] = w2sTop(vertices[j][0], vertices[j][1]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.restore();
    }

    // Floor slices
    if (volume?.floorSlices) {
      for (const slice of volume.floorSlices) {
        if (slice.polygon.length < 3) continue;
        const color = slice.isStep ? STEP_COLOR : FLOOR_COLORS[slice.floor % FLOOR_COLORS.length];
        ctx.strokeStyle = color; ctx.lineWidth = slice.isStep ? 1.5 : 1;
        ctx.setLineDash(slice.isStep ? [4, 3] : []);
        ctx.beginPath(); drawPolyTop(slice.polygon, true); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Setback line (red dashed)
    if (profiles.some(p => p.isNorthFacing)) {
      const translated = vertices.map(([x, y]) => [x, y - DEFAULT_PARAMS.belowBaseSetback]);
      ctx.save(); ctx.strokeStyle = 'rgba(255,80,80,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); drawPolyTop(translated, true); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }

    // Dimension labels
    const cent = polygonCentroid(vertices);
    ctx.save();
    ctx.font = "500 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const len = Math.hypot(vertices[j][0] - vertices[i][0], vertices[j][1] - vertices[i][1]);
      if (len < 0.5) continue;
      const [mx, my] = w2sTop((vertices[i][0] + vertices[j][0]) / 2, (vertices[i][1] + vertices[j][1]) / 2);
      const [sx1, sy1] = w2sTop(vertices[i][0], vertices[i][1]);
      const [sx2, sy2] = w2sTop(vertices[j][0], vertices[j][1]);
      let nx = -(sy2 - sy1), ny = sx2 - sx1, nl = Math.hypot(nx, ny);
      if (nl > 0) { nx /= nl; ny /= nl; }
      const cmx = (vertices[i][0] + vertices[j][0]) / 2 - cent[0];
      const cmy = (vertices[i][1] + vertices[j][1]) / 2 - cent[1];
      if (nx * cmx + ny * (-cmy) < 0) { nx = -nx; ny = -ny; }
      const lx = mx + nx * 14, ly = my + ny * 14;
      const txt = `E${i + 1}: ${len.toFixed(1)}m`;
      const tm = ctx.measureText(txt);
      ctx.fillStyle = LABEL_BG; ctx.fillRect(lx - tm.width / 2 - 3, ly - 6, tm.width + 6, 12);
      ctx.fillStyle = TEXT_COLOR; ctx.fillText(txt, lx, ly);
    }
    ctx.restore();

    // Area label
    const area = polygonArea(vertices);
    const [acx, acy] = w2sTop(cent[0], cent[1]);
    ctx.save(); ctx.font = "bold 11px -apple-system, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const atxt = `${area.toFixed(1)} m²`;
    const atm = ctx.measureText(atxt);
    ctx.fillStyle = LABEL_BG; ctx.fillRect(acx - atm.width / 2 - 4, acy - 8, atm.width + 8, 16);
    ctx.fillStyle = '#fff'; ctx.fillText(atxt, acx, acy);
    ctx.restore();

    // Vertices (white)
    for (let i = 0; i < vertices.length; i++) {
      const [vx, vy] = w2sTop(vertices[i][0], vertices[i][1]);
      const isDrag = dragIdx === i, isHov = hovIdx === i;
      ctx.beginPath(); ctx.arc(vx, vy, isDrag ? 7 : isHov ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isDrag ? NORTH_COLOR : isHov ? '#E8944A' : VERTEX_COLOR; ctx.fill();
      if (isDrag || isHov) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke(); }
    }

    // North indicator
    const nCx = W / 2 - 25, nCy = 30, nLen = 16;
    ctx.save(); ctx.strokeStyle = NORTH_COLOR; ctx.fillStyle = NORTH_COLOR; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(nCx, nCy + nLen); ctx.lineTo(nCx, nCy - nLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nCx, nCy - nLen); ctx.lineTo(nCx - 4, nCy - nLen + 7); ctx.lineTo(nCx + 4, nCy - nLen + 7); ctx.closePath(); ctx.fill();
    ctx.font = "bold 9px -apple-system, sans-serif"; ctx.textAlign = 'center';
    ctx.fillText('N', nCx, nCy - nLen - 6);
    ctx.restore();

    ctx.restore();
  }

  /* ── Draw: Isometric view ──────────────────────────────────── */
  function drawIsoView() {
    ctx.save();
    ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip();
    ctx.fillStyle = BG_RIGHT; ctx.fillRect(W / 2, 0, W / 2, H);

    if (!volume || !volume.horizontalRings.length) {
      ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = TEXT_DIM; ctx.textAlign = 'center';
      ctx.fillText('Loading...', W * 3 / 4, H / 2);
      ctx.restore(); return;
    }

    // Site boundary (white)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); drawPolyIso(volume.siteBoundary); ctx.stroke();

    // Vertical lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.6;
    for (const line of volume.verticalLines) {
      const [x1, y1] = w2sIso(line[0], line[1], line[2]);
      const [x2, y2] = w2sIso(line[3], line[4], line[5]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // Horizontal rings (colored)
    for (const ring of volume.horizontalRings) {
      const color = ring.isStep ? STEP_COLOR : FLOOR_COLORS[ring.floor % FLOOR_COLORS.length];
      ctx.strokeStyle = color; ctx.lineWidth = ring.isStep ? 2 : 1.5;
      ctx.setLineDash(ring.isStep ? [4, 3] : []);
      ctx.beginPath(); drawPolyIso(ring.points); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Height ruler
    if (volume.floorSlices.length > 0) {
      const rulerX = Math.max(...vertices.map(v => v[0])) + 3;
      const rulerY = Math.min(...vertices.map(v => v[1]));
      ctx.font = "500 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'left';
      for (const slice of volume.floorSlices) {
        const [sx, sy] = w2sIso(rulerX, slice.height, -rulerY);
        const color = slice.isStep ? STEP_COLOR : FLOOR_COLORS[slice.floor % FLOOR_COLORS.length];
        ctx.fillStyle = color;
        const label = slice.isStep ? '꺾임' : (slice.floor === 0 ? 'GL' : `${slice.floor}F`);
        ctx.fillText(`${label} ${slice.height}m`, sx + 4, sy + 3);
        ctx.strokeStyle = color; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(sx - 2, sy); ctx.lineTo(sx + 3, sy); ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawDivider() {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    drawTopView(); drawIsoView(); drawDivider();
    if (volume?.metadata) {
      const m = volume.metadata;
      metricsEl.textContent = `Floors: ${m.buildableFloors}  |  H: ${m.maxHeight}m  |  Vol: ${m.volume.toFixed(0)} m³  |  Area: ${m.floorArea.toFixed(0)} m²`;
    } else metricsEl.textContent = 'Loading...';
  }

  /* ── Interaction ───────────────────────────────────────────── */
  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { sx: t.clientX - r.left, sy: t.clientY - r.top };
  }

  canvas.addEventListener('mousedown', e => {
    const { sx, sy } = getXY(e);
    // Right half → iso rotation
    if (sx > W / 2) { isoRotating = true; isoLX = e.clientX; isoLY = e.clientY; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    // Left half → vertex drag or pan
    const hit = hitVertex(sx, sy);
    if (hit >= 0) { dragIdx = hit; canvas.style.cursor = 'grabbing'; e.preventDefault(); return; }
    panning = true; panLX = e.clientX; panLY = e.clientY; canvas.style.cursor = 'move'; e.preventDefault();
  });

  canvas.addEventListener('mousemove', e => {
    const { sx, sy } = getXY(e);
    if (isoRotating) {
      isoAy -= (e.clientX - isoLX) * 0.008;
      isoAx = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, isoAx + (e.clientY - isoLY) * 0.008));
      isoLX = e.clientX; isoLY = e.clientY; return;
    }
    if (dragIdx >= 0) { const [wx, wy] = s2wTop(sx, sy); vertices[dragIdx] = [wx, wy]; recompute(); return; }
    if (panning) { vpCx -= (e.clientX - panLX) / vpZoom; vpCy += (e.clientY - panLY) / vpZoom; panLX = e.clientX; panLY = e.clientY; return; }
    const hit = hitVertex(sx, sy);
    if (hit >= 0) { hovIdx = hit; canvas.style.cursor = 'pointer'; }
    else { hovIdx = -1; canvas.style.cursor = sx > W / 2 ? 'grab' : 'default'; }
  });

  canvas.addEventListener('mouseup', () => { dragIdx = -1; panning = false; isoRotating = false; canvas.style.cursor = 'default'; });
  canvas.addEventListener('mouseleave', () => { dragIdx = -1; panning = false; isoRotating = false; hovIdx = -1; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    vpZoom = Math.max(1, Math.min(30, vpZoom * f));
    isoZoom = Math.max(1, Math.min(20, isoZoom * f));
  }, { passive: false });

  // Double-click: add/remove vertex
  canvas.addEventListener('dblclick', e => {
    const { sx, sy } = getXY(e);
    const hitV = hitVertex(sx, sy);
    if (hitV >= 0 && vertices.length > 3) { vertices.splice(hitV, 1); recompute(); initDrift(); return; }
    const hitE = hitEdge(sx, sy);
    if (hitE >= 0) { const [wx, wy] = s2wTop(sx, sy); vertices.splice(hitE + 1, 0, [wx, wy]); recompute(); initDrift(); }
  });

  // Touch
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const hit = hitVertex(t.clientX - r.left, t.clientY - r.top);
    if (hit >= 0) { dragIdx = hit; e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (dragIdx < 0) return;
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const [wx, wy] = s2wTop(t.clientX - r.left, t.clientY - r.top);
    vertices[dragIdx] = [wx, wy]; recompute(); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { dragIdx = -1; });

  /* ── Drift animation with auto vertex add/remove ───────────── */
  let origPts = [], driftTargets = [];
  let driftState = 'moving', pauseTimer = 0, driftFrames = 0;
  let driftCycle = 0; // track cycles for add/remove

  function initDrift() {
    origPts = vertices.map(p => [...p]);
    driftTargets = vertices.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]);
    driftState = 'moving'; driftFrames = 0;
  }

  function autoAddVertex() {
    // Pick a random edge and insert a midpoint with small random offset
    const i = Math.floor(Math.random() * vertices.length);
    const j = (i + 1) % vertices.length;
    const mx = (vertices[i][0] + vertices[j][0]) / 2 + (Math.random() - 0.5) * 2;
    const my = (vertices[i][1] + vertices[j][1]) / 2 + (Math.random() - 0.5) * 2;
    vertices.splice(i + 1, 0, [mx, my]);
  }

  function autoRemoveVertex() {
    if (vertices.length <= 4) return; // keep minimum shape
    // Remove the most recently added (last vertex that isn't original)
    const removeIdx = Math.floor(Math.random() * vertices.length);
    vertices.splice(removeIdx, 1);
  }

  function tickDrift() {
    if (dragIdx >= 0 || panning || isoRotating) return;
    if (driftState === 'paused') {
      pauseTimer += 0.016;
      if (pauseTimer >= PAUSE_SECS) {
        driftState = 'moving'; driftFrames = 0;
        driftCycle++;
        // Every 3rd cycle: add a vertex; every 4th: remove one
        if (driftCycle % 4 === 1) { autoAddVertex(); }
        else if (driftCycle % 4 === 3 && vertices.length > 5) { autoRemoveVertex(); }
        origPts = vertices.map(p => [...p]);
        driftTargets = vertices.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]);
        recompute();
      }
      return;
    }
    let allDone = true;
    for (let i = 0; i < vertices.length && i < origPts.length; i++) {
      if (!driftTargets[i]) continue;
      const tx = origPts[i][0] + driftTargets[i][0], ty = origPts[i][1] + driftTargets[i][1];
      vertices[i][0] += (tx - vertices[i][0]) * DRIFT_SPEED;
      vertices[i][1] += (ty - vertices[i][1]) * DRIFT_SPEED;
      if (Math.abs(vertices[i][0] - tx) > 0.15 || Math.abs(vertices[i][1] - ty) > 0.15) allDone = false;
    }
    driftFrames++;
    if (driftFrames % RECOMP_EVERY === 0) recompute();
    if (allDone) { driftState = 'paused'; pauseTimer = 0; recompute(); }
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  resize(); recompute(); initDrift();
  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  const cleanup = registerDemo(cell, () => { tickDrift(); draw(); });
  return () => { cleanup(); window.removeEventListener('resize', onResize); };
}
