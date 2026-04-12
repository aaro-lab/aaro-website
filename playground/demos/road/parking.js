/**
 * Road demo — parking spot generation and collision resolution.
 * Pure functions, no side effects, no DOM.
 */
import { dist, sub, norm, perp, scale, dot, pointInRing } from './geometry.js';

/* ── Find straight runs on a centerline (skip curves/fillets) ─── */
const MIN_STRAIGHT_RUN = 10; // metres

export function findStraightRuns(centerline, minLength = MIN_STRAIGHT_RUN, perVtxTol = 0.05, cumTol = 0.15) {
  const runs = [], n = centerline.length;
  if (n < 2) return runs;
  if (n === 2) { if (dist(centerline[0], centerline[1]) >= minLength) runs.push({ s: 0, e: 1 }); return runs; }
  const headings = [], edgeFrom = [];
  for (let i = 0; i < n - 1; i++) {
    const d = sub(centerline[i + 1], centerline[i]);
    if (d[0] * d[0] + d[1] * d[1] < 1e-12) continue;
    headings.push(Math.atan2(d[1], d[0])); edgeFrom.push(i);
  }
  if (!headings.length) return runs;
  let runStart = 0, startH = headings[0];
  const runLen = (s, e) => { let L = 0; for (let i = s; i < e; i++) L += dist(centerline[i], centerline[i + 1]); return L; };
  for (let k = 1; k < headings.length; k++) {
    let dh = headings[k] - headings[k - 1]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    let dt = headings[k] - startH; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    if (Math.abs(dh) > perVtxTol || Math.abs(dt) > cumTol) {
      const ei = edgeFrom[k];
      if (runLen(runStart, ei) >= minLength) runs.push({ s: runStart, e: ei });
      runStart = ei; startH = headings[k];
    }
  }
  if (runLen(runStart, n - 1) >= minLength) runs.push({ s: runStart, e: n - 1 });
  return runs;
}

/* ── Place parking spots on straight runs (perfect rectangles) ─── */
export function generateParking(segments, spotW, spotD, fillPct, setback) {
  const spots = [];
  const minRunLen = Math.max(spotW * 2, MIN_STRAIGHT_RUN);
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si], cl = seg.centerline;
    if (cl.length < 2 || cl.length !== seg.leftEdge.length) continue;
    const sbS = seg.startIsJunction ? setback : 0;
    const sbE = seg.endIsJunction ? setback : 0;
    const runs = findStraightRuns(cl, minRunLen);
    for (const run of runs) {
      for (const side of ['left', 'right']) {
        const edge = side === 'left' ? seg.leftEdge : seg.rightEdge;
        const start = edge[run.s], end = edge[run.e];
        const runLen = dist(start, end);
        const t = norm(sub(end, start));
        const outNorm = side === 'left' ? perp(t) : scale(perp(t), -1);
        const runSbS = (run.s === 0) ? sbS : 0;
        const runSbE = (run.e === cl.length - 1) ? sbE : 0;
        const usable = runLen - runSbS - runSbE;
        if (usable < spotW) continue;
        const maxN = Math.floor(usable / spotW);
        const n = Math.max(0, Math.min(maxN, Math.round(maxN * fillPct / 100)));
        if (n <= 0) continue;
        const lead = (usable - n * spotW) / 2;
        for (let i = 0; i < n; i++) {
          const s0 = runSbS + lead + i * spotW;
          const p0 = [start[0] + t[0] * s0, start[1] + t[1] * s0];
          const innerA = p0;
          const innerB = [p0[0] + t[0] * spotW, p0[1] + t[1] * spotW];
          const outerB = [innerB[0] + outNorm[0] * spotD, innerB[1] + outNorm[1] * spotD];
          const outerA = [p0[0] + outNorm[0] * spotD, p0[1] + outNorm[1] * spotD];
          const center = [p0[0] + t[0] * spotW / 2 + outNorm[0] * spotD / 2, p0[1] + t[1] * spotW / 2 + outNorm[1] * spotD / 2];
          const corners = side === 'left'
            ? [innerA, innerB, outerB, outerA]
            : [innerA, outerA, outerB, innerB];
          spots.push({ corners, center, side, segmentIndex: si });
        }
      }
    }
  }
  return spots;
}

/* ── SAT overlap test for two convex quads ────────────────────── */
function rectsOverlap(a, b) {
  for (const rect of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p1 = rect[i], p2 = rect[(i + 1) % 4];
      const nx = -(p2[1] - p1[1]), ny = p2[0] - p1[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const q of a) { const d = q[0] * nx + q[1] * ny; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const q of b) { const d = q[0] * nx + q[1] * ny; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA < minB + 1e-4 || maxB < minA + 1e-4) return false;
    }
  }
  return true;
}

/* ── Resolve parking collisions (road penetration + spot overlap) ─ */
export function resolveParkingCollisions(spots, roadRings) {
  if (!spots.length) return spots;
  // Pass 1: remove spots that penetrate road interior
  let after = spots;
  if (roadRings && roadRings.length) {
    after = spots.filter(s => {
      if (roadRings.some(r => pointInRing(s.center, r))) return false;
      for (const c of s.corners) {
        const dx = s.center[0] - c[0], dy = s.center[1] - c[1], L = Math.hypot(dx, dy);
        if (L < 1e-9) continue;
        const p = [c[0] + dx / L * 0.05, c[1] + dy / L * 0.05];
        if (roadRings.some(r => pointInRing(p, r))) return false;
      }
      return true;
    });
  }
  if (after.length < 2) return after;
  // Pass 2: cross-group spot-spot overlap
  const SHRINK = 0.98;
  const shrink = (corners, center) => corners.map(c => [
    center[0] + (c[0] - center[0]) * SHRINK, center[1] + (c[1] - center[1]) * SHRINK
  ]);
  const gOf = s => `${s.segmentIndex}:${s.side}`;
  const pairs = new Map();
  for (let i = 0; i < after.length; i++) {
    const ci = shrink(after[i].corners, after[i].center);
    for (let j = i + 1; j < after.length; j++) {
      const gi = gOf(after[i]), gj = gOf(after[j]);
      if (gi === gj) continue;
      const cj = shrink(after[j].corners, after[j].center);
      if (!rectsOverlap(ci, cj)) continue;
      const [gA, gB] = gi < gj ? [gi, gj] : [gj, gi];
      const key = gA + '|' + gB;
      if (!pairs.has(key)) pairs.set(key, { aIds: new Set(), bIds: new Set() });
      const e = pairs.get(key);
      if (gi === gA) { e.aIds.add(i); e.bIds.add(j); } else { e.bIds.add(i); e.aIds.add(j); }
    }
  }
  const rm = new Set();
  for (const e of pairs.values()) {
    const victim = e.aIds.size > e.bIds.size ? e.aIds : e.bIds;
    for (const idx of victim) rm.add(idx);
  }
  return after.filter((_, i) => !rm.has(i));
}
