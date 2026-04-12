/**
 * Northlight Regulation (정북일조) playground demo.
 * Dual-view: top-view (left) + isometric wireframe (right) in one canvas.
 */
import { setupCanvas, registerDemo } from '../shared.js';
import {
  generateVolume, computeEdgeProfiles, polygonArea, polygonCentroid,
  ensureCCW, DEFAULT_PARAMS,
} from './engine.js';

/* ── Constants ────────────────────────────────────────────────── */
const FLOOR_COLORS = [
  '#2196F3','#1976D2','#1565C0','#0D47A1',
  '#0277BD','#01579B','#006064','#004D40',
  '#1B5E20','#33691E','#827717','#F57F17',
];
const STEP_COLOR  = '#e74c3c';
const SITE_COLOR  = 'rgba(60,60,60,0.8)';
const NORTH_COLOR = '#cc0000';
const GRID_MINOR  = 'rgba(0,0,0,0.04)';
const GRID_MAJOR  = 'rgba(0,0,0,0.08)';
const BG_COLOR    = '#FAFAFA';
const HIT_R       = 12;
const DRIFT_SPEED = 0.025;
const DRIFT_RANGE = 4;
const PAUSE_SECS  = 2.5;
const RECOMP_EVERY = 8;

/* ── Default lot polygon (roughly 20×30m L-shape facing north) ── */
const DEFAULT_LOT = [
  [0, 0], [20, 0], [20, 20], [12, 20], [12, 30], [0, 30],
];

/* ══════════════════════════════════════════════════════════════════
   DEMO INIT
   ══════════════════════════════════════════════════════════════════ */
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
  let volume = null;
  let profiles = [];
  let dragIdx = -1, hovIdx = -1;

  // Viewports: left half = top view, right half = iso view
  let vpZoom = 6, vpCx = 10, vpCy = 15;
  let panning = false, panLX = 0, panLY = 0;

  // Iso camera params
  const ISO_AX = Math.PI / 6;  // 30° tilt
  const ISO_AY = -Math.PI / 4; // 45° rotation
  const cosAx = Math.cos(ISO_AX), sinAx = Math.sin(ISO_AX);
  const cosAy = Math.cos(ISO_AY), sinAy = Math.sin(ISO_AY);
  let isoZoom = 4, isoCx = 0, isoCy = 0;

  /* ── Coordinate transforms ─────────────────────────────────── */
  // Top-view: world [x,y] → screen in left half
  function w2sTop(wx, wy) {
    const hw = W / 2; // left half width
    return [hw / 2 + (wx - vpCx) * vpZoom, H / 2 - (wy - vpCy) * vpZoom];
  }
  function s2wTop(sx, sy) {
    const hw = W / 2;
    return [(sx - hw / 2) / vpZoom + vpCx, -(sy - H / 2) / vpZoom + vpCy];
  }

  // Isometric: 3D [x, h, -y] → screen in right half
  function w2sIso(x3, y3, z3) {
    // Rotate around Y axis
    const rx = x3 * cosAy + z3 * sinAy;
    const rz = -x3 * sinAy + z3 * cosAy;
    // Tilt around X axis
    const ry = y3 * cosAx - rz * sinAx;
    const rz2 = y3 * sinAx + rz * cosAx;
    void rz2;
    // Project to screen (right half)
    const rhw = W / 2; // right half starts at W/2
    return [rhw + rhw / 2 + (rx - isoCx) * isoZoom, H / 2 - (ry - isoCy) * isoZoom];
  }

  /* ── Recompute ─────────────────────────────────────────────── */
  function recompute() {
    const ccw = ensureCCW(vertices);
    profiles = computeEdgeProfiles(ccw, DEFAULT_PARAMS);
    volume = generateVolume(vertices, DEFAULT_PARAMS, PC);
  }

  function resize() {
    const s = setupCanvas(canvas); W = s.w; H = s.h; ctx = s.ctx;
    vpZoom = Math.min(W / 2, H) / 45;
    isoZoom = Math.min(W / 2, H) / 55;
  }

  /* ── Hit test (top-view only, left half) ───────────────────── */
  function hitVertex(sx, sy) {
    if (sx > W / 2) return -1; // right half = iso view
    for (let i = 0; i < vertices.length; i++) {
      const [px, py] = w2sTop(vertices[i][0], vertices[i][1]);
      if (Math.hypot(sx - px, sy - py) < HIT_R) return i;
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
    // pts3 is flat array [x, h, -y, x, h, -y, ...]
    if (pts3.length < 6) return;
    const [x0, y0] = w2sIso(pts3[0], pts3[1], pts3[2]);
    ctx.moveTo(x0, y0);
    for (let i = 3; i < pts3.length; i += 3) {
      const [x, y] = w2sIso(pts3[i], pts3[i + 1], pts3[i + 2]);
      ctx.lineTo(x, y);
    }
  }

  /* ── Draw: Top view (left half) ────────────────────────────── */
  function drawTopView() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W / 2, H);
    ctx.clip();

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W / 2, H);

    // Grid
    const step = vpZoom < 3 ? 10 : vpZoom < 8 ? 5 : 1;
    const [wl] = s2wTop(0, 0); const [wr] = s2wTop(W / 2, 0);
    const wt = s2wTop(0, 0)[1]; const wb = s2wTop(0, H)[1];
    ctx.strokeStyle = GRID_MINOR; ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = Math.floor(wl / step) * step; x <= wr + step; x += step) {
      const [sx] = w2sTop(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let y = Math.floor(Math.min(wt, wb) / step) * step; y <= Math.max(wt, wb) + step; y += step) {
      const [, sy] = w2sTop(0, y); ctx.moveTo(0, sy); ctx.lineTo(W / 2, sy);
    }
    ctx.stroke();
    // Major
    const major = step * 5;
    ctx.strokeStyle = GRID_MAJOR;
    ctx.beginPath();
    for (let x = Math.floor(wl / major) * major; x <= wr + major; x += major) {
      const [sx] = w2sTop(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let y = Math.floor(Math.min(wt, wb) / major) * major; y <= Math.max(wt, wb) + major; y += major) {
      const [, sy] = w2sTop(0, y); ctx.moveTo(0, sy); ctx.lineTo(W / 2, sy);
    }
    ctx.stroke();

    // Lot polygon fill
    ctx.fillStyle = 'rgba(70,130,180,0.12)';
    ctx.beginPath(); drawPolyTop(vertices, true); ctx.fill();

    // Lot polygon stroke
    ctx.strokeStyle = SITE_COLOR; ctx.lineWidth = 1.5;
    ctx.beginPath(); drawPolyTop(vertices, true); ctx.stroke();

    // North-facing edges (red dashed)
    if (profiles.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(220,50,50,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      for (let i = 0; i < profiles.length; i++) {
        if (!profiles[i].isNorthFacing) continue;
        const j = (i + 1) % vertices.length;
        const [x1, y1] = w2sTop(vertices[i][0], vertices[i][1]);
        const [x2, y2] = w2sTop(vertices[j][0], vertices[j][1]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.restore();
    }

    // Floor slices (top view)
    if (volume && volume.floorSlices) {
      for (let i = 0; i < volume.floorSlices.length; i++) {
        const slice = volume.floorSlices[i];
        if (slice.polygon.length < 3) continue;
        const color = slice.isStep ? STEP_COLOR : FLOOR_COLORS[slice.floor % FLOOR_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = slice.isStep ? 1.5 : 1;
        ctx.setLineDash(slice.isStep ? [4, 3] : []);
        ctx.beginPath(); drawPolyTop(slice.polygon, true); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Setback line (ground-level translated polygon, red dashed)
    if (profiles.some(p => p.isNorthFacing)) {
      const sb = DEFAULT_PARAMS.belowBaseSetback;
      const translated = vertices.map(([x, y]) => [x, y - sb]);
      ctx.save();
      ctx.strokeStyle = 'rgba(220,50,50,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
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
      // Outward normal
      const [sx1, sy1] = w2sTop(vertices[i][0], vertices[i][1]);
      const [sx2, sy2] = w2sTop(vertices[j][0], vertices[j][1]);
      const dx = sx2 - sx1, dy = sy2 - sy1;
      let nx = -dy, ny = dx, nl = Math.hypot(nx, ny);
      if (nl > 0) { nx /= nl; ny /= nl; }
      const cmx = (vertices[i][0] + vertices[j][0]) / 2 - cent[0];
      const cmy = (vertices[i][1] + vertices[j][1]) / 2 - cent[1];
      if (nx * cmx + ny * (-cmy) < 0) { nx = -nx; ny = -ny; }
      const lx = mx + nx * 14, ly = my + ny * 14;
      const txt = `E${i + 1}: ${len.toFixed(1)}m`;
      const tm = ctx.measureText(txt);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(lx - tm.width / 2 - 3, ly - 6, tm.width + 6, 12);
      ctx.fillStyle = '#333';
      ctx.fillText(txt, lx, ly);
    }
    ctx.restore();

    // Area label
    const area = polygonArea(vertices);
    const [acx, acy] = w2sTop(cent[0], cent[1]);
    ctx.save();
    ctx.font = "bold 11px -apple-system, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const atxt = `${area.toFixed(1)} m²`;
    const atm = ctx.measureText(atxt);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(acx - atm.width / 2 - 4, acy - 8, atm.width + 8, 16);
    ctx.fillStyle = '#333';
    ctx.fillText(atxt, acx, acy);
    ctx.restore();

    // Vertices (draggable)
    for (let i = 0; i < vertices.length; i++) {
      const [vx, vy] = w2sTop(vertices[i][0], vertices[i][1]);
      const isDrag = dragIdx === i, isHov = hovIdx === i;
      ctx.beginPath(); ctx.arc(vx, vy, isDrag ? 6 : isHov ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isDrag ? NORTH_COLOR : isHov ? '#E8944A' : '#333';
      ctx.fill();
      if (isDrag || isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    // North indicator
    const nCx = W / 2 - 25, nCy = 30, nLen = 16;
    ctx.save();
    ctx.strokeStyle = NORTH_COLOR; ctx.fillStyle = NORTH_COLOR; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(nCx, nCy + nLen); ctx.lineTo(nCx, nCy - nLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nCx, nCy - nLen); ctx.lineTo(nCx - 4, nCy - nLen + 7); ctx.lineTo(nCx + 4, nCy - nLen + 7); ctx.closePath(); ctx.fill();
    ctx.font = "bold 9px -apple-system, sans-serif"; ctx.textAlign = 'center';
    ctx.fillText('N', nCx, nCy - nLen - 6);
    ctx.restore();

    ctx.restore(); // clip
  }

  /* ── Draw: Isometric view (right half) ─────────────────────── */
  function drawIsoView() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(W / 2, 0, W / 2, H);
    ctx.clip();

    // Background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(W / 2, 0, W / 2, H);

    if (!volume || !volume.horizontalRings.length) {
      ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = '#999'; ctx.textAlign = 'center';
      ctx.fillText('Loading polygon-clipping...', W * 3 / 4, H / 2);
      ctx.restore(); return;
    }

    // Site boundary (ground)
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.beginPath(); drawPolyIso(volume.siteBoundary); ctx.stroke();

    // Vertical lines (gray)
    ctx.strokeStyle = 'rgba(150,150,150,0.4)'; ctx.lineWidth = 0.6;
    for (const line of volume.verticalLines) {
      const [x1, y1] = w2sIso(line[0], line[1], line[2]);
      const [x2, y2] = w2sIso(line[3], line[4], line[5]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // Horizontal rings (floor slices)
    for (const ring of volume.horizontalRings) {
      const color = ring.isStep ? STEP_COLOR : FLOOR_COLORS[ring.floor % FLOOR_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = ring.isStep ? 2 : 1.5;
      ctx.setLineDash(ring.isStep ? [4, 3] : []);
      ctx.beginPath(); drawPolyIso(ring.points); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Height ruler (right edge)
    if (volume.floorSlices.length > 0) {
      const maxH = volume.metadata.maxHeight;
      const rulerX = Math.max(...vertices.map(v => v[0])) + 3;
      const rulerY = Math.min(...vertices.map(v => v[1]));
      ctx.font = "500 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'left';
      for (const slice of volume.floorSlices) {
        const [sx, sy] = w2sIso(rulerX, slice.height, -rulerY);
        const color = slice.isStep ? STEP_COLOR : FLOOR_COLORS[slice.floor % FLOOR_COLORS.length];
        ctx.fillStyle = color;
        const label = slice.isStep ? '꺾임' : (slice.floor === 0 ? 'GL' : `${slice.floor}F`);
        ctx.fillText(`${label} ${slice.height}m`, sx + 4, sy + 3);
        // Tick mark
        ctx.strokeStyle = color; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(sx - 2, sy); ctx.lineTo(sx + 3, sy); ctx.stroke();
      }
    }

    ctx.restore(); // clip
  }

  /* ── Draw: divider line ────────────────────────────────────── */
  function drawDivider() {
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  }

  /* ── Main draw ─────────────────────────────────────────────── */
  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    drawTopView();
    drawIsoView();
    drawDivider();

    // Metrics
    if (volume && volume.metadata) {
      const m = volume.metadata;
      metricsEl.textContent = `Floors: ${m.buildableFloors}  |  H: ${m.maxHeight}m  |  Vol: ${m.volume.toFixed(0)} m³  |  Area: ${m.floorArea.toFixed(0)} m²`;
    } else {
      metricsEl.textContent = 'Loading...';
    }
  }

  /* ── Interaction ───────────────────────────────────────────── */
  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { sx: t.clientX - r.left, sy: t.clientY - r.top };
  }

  canvas.addEventListener('mousedown', e => {
    const { sx, sy } = getXY(e);
    const hit = hitVertex(sx, sy);
    if (hit >= 0) { dragIdx = hit; canvas.style.cursor = 'grabbing'; e.preventDefault(); return; }
    panning = true; panLX = e.clientX; panLY = e.clientY; canvas.style.cursor = 'move'; e.preventDefault();
  });
  canvas.addEventListener('mousemove', e => {
    const { sx, sy } = getXY(e);
    if (dragIdx >= 0) {
      const [wx, wy] = s2wTop(sx, sy);
      vertices[dragIdx] = [wx, wy];
      recompute(); return;
    }
    if (panning) {
      vpCx -= (e.clientX - panLX) / vpZoom;
      vpCy += (e.clientY - panLY) / vpZoom;
      panLX = e.clientX; panLY = e.clientY; return;
    }
    const hit = hitVertex(sx, sy);
    if (hit >= 0) { hovIdx = hit; canvas.style.cursor = 'pointer'; }
    else { hovIdx = -1; canvas.style.cursor = 'default'; }
  });
  canvas.addEventListener('mouseup', () => { dragIdx = -1; panning = false; canvas.style.cursor = 'default'; });
  canvas.addEventListener('mouseleave', () => { dragIdx = -1; panning = false; hovIdx = -1; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    vpZoom = Math.max(1, Math.min(30, vpZoom * f));
    isoZoom = Math.max(1, Math.min(20, isoZoom * f));
  }, { passive: false });

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

  /* ── Drift animation ───────────────────────────────────────── */
  let origPts = [], driftTargets = [];
  let driftState = 'moving', pauseTimer = 0, driftFrames = 0;

  function initDrift() {
    origPts = vertices.map(p => [...p]);
    driftTargets = vertices.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]);
    driftState = 'moving'; driftFrames = 0;
  }

  function tickDrift() {
    if (dragIdx >= 0 || panning) return;
    if (driftState === 'paused') {
      pauseTimer += 0.016;
      if (pauseTimer >= PAUSE_SECS) {
        driftState = 'moving'; driftFrames = 0;
        driftTargets = vertices.map(() => [(Math.random() - 0.5) * DRIFT_RANGE, (Math.random() - 0.5) * DRIFT_RANGE]);
      }
      return;
    }
    let allDone = true;
    for (let i = 0; i < vertices.length && i < origPts.length; i++) {
      if (!driftTargets[i]) continue;
      const tx = origPts[i][0] + driftTargets[i][0];
      const ty = origPts[i][1] + driftTargets[i][1];
      vertices[i][0] += (tx - vertices[i][0]) * DRIFT_SPEED;
      vertices[i][1] += (ty - vertices[i][1]) * DRIFT_SPEED;
      if (Math.abs(vertices[i][0] - tx) > 0.15 || Math.abs(vertices[i][1] - ty) > 0.15) allDone = false;
    }
    driftFrames++;
    if (driftFrames % RECOMP_EVERY === 0) recompute();
    if (allDone) { driftState = 'paused'; pauseTimer = 0; recompute(); }
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  resize();
  recompute();
  initDrift();

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  const cleanup = registerDemo(cell, () => { tickDrift(); draw(); });

  return () => { cleanup(); window.removeEventListener('resize', onResize); };
}
