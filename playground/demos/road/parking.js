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

/* ── Does a spot penetrate any road ring? ─────────────────────── */
function spotPenetratesRoad(spot, roadRings) {
  const center = spot.center;
  if (roadRings.some(r => pointInRing(center, r))) return true;
  const eps = 0.05;
  for (const c of spot.corners) {
    const dx = center[0] - c[0];
    const dy = center[1] - c[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const p = [c[0] + (dx / L) * eps, c[1] + (dy / L) * eps];
    if (roadRings.some(r => pointInRing(p, r))) return true;
  }
  return false;
}

/* ── Resolve parking collisions (road penetration + spot overlap) ─ */
export function resolveParkingCollisions(spots, roadRings) {
  if (!spots.length) return spots;
  // Pass 1: remove spots that penetrate road interior
  const afterRoad = (roadRings && roadRings.length)
    ? spots.filter(s => !spotPenetratesRoad(s, roadRings))
    : spots.slice();
  if (afterRoad.length < 2) return afterRoad;

  // Pass 2: cross-group spot-spot overlap
  // Count TOTAL spots per edge group for priority comparison.
  const gOf = s => `${s.segmentIndex}:${s.side}`;
  const groupCount = new Map();
  for (const s of afterRoad) {
    const g = gOf(s);
    groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }

  const pairs = new Map();
  for (let i = 0; i < afterRoad.length; i++) {
    for (let j = i + 1; j < afterRoad.length; j++) {
      const gi = gOf(afterRoad[i]), gj = gOf(afterRoad[j]);
      if (gi === gj) continue;
      if (!rectsOverlap(afterRoad[i].corners, afterRoad[j].corners)) continue;
      const [gA, gB] = gi < gj ? [gi, gj] : [gj, gi];
      const key = gA + '|' + gB;
      if (!pairs.has(key)) pairs.set(key, { gA, gB, aIds: new Set(), bIds: new Set() });
      const e = pairs.get(key);
      if (gi === gA) e.aIds.add(i); else e.bIds.add(i);
      if (gj === gA) e.aIds.add(j); else e.bIds.add(j);
    }
  }

  const toRemove = new Set();
  for (const entry of pairs.values()) {
    // The group with FEWER total spots loses its colliding spots.
    // Ties remove from lexicographically later group (gB) for determinism.
    const countA = groupCount.get(entry.gA) ?? 0;
    const countB = groupCount.get(entry.gB) ?? 0;
    if (countA < countB) {
      for (const idx of entry.aIds) toRemove.add(idx);
    } else if (countB < countA) {
      for (const idx of entry.bIds) toRemove.add(idx);
    } else {
      for (const idx of entry.bIds) toRemove.add(idx);
    }
  }
  return afterRoad.filter((_, i) => !toRemove.has(i));
}

/* ── Place spots along an entire edge polyline (arc-length walk) ─ */
export function placeSpotsAlongEdge({ edge, side, segmentIndex, spotWidth, spotDepth,
  fillPercent, setbackStart, setbackEnd, outwardNormals }) {
  if (edge.length < 2) return [];

  // Cumulative arc length along the edge.
  const cum = [0];
  for (let i = 1; i < edge.length; i++) cum.push(cum[i - 1] + dist(edge[i - 1], edge[i]));
  const total = cum[cum.length - 1];
  const usable = total - setbackStart - setbackEnd;
  if (usable < spotWidth) return [];

  const maxN = Math.floor(usable / spotWidth);
  if (maxN <= 0) return [];
  const n = Math.max(0, Math.min(maxN, Math.round(maxN * fillPercent / 100)));
  if (n <= 0) return [];

  const slack = usable - n * spotWidth;
  const leadGap = slack / 2;

  // Sample position, tangent, and outward normal at arc-length s.
  const sampleAt = (s) => {
    if (s <= 0) {
      const a = edge[0], b = edge[1];
      return { pos: [a[0], a[1]], tan: norm(sub(b, a)), nrm: outwardNormals[0] };
    }
    if (s >= total) {
      const last = edge.length - 1;
      const a = edge[last - 1], b = edge[last];
      return { pos: [b[0], b[1]], tan: norm(sub(b, a)), nrm: outwardNormals[last] };
    }
    for (let i = 1; i < cum.length; i++) {
      if (cum[i] >= s) {
        const segLen = cum[i] - cum[i - 1];
        const t = segLen > 1e-12 ? (s - cum[i - 1]) / segLen : 0;
        const a = edge[i - 1], b = edge[i];
        const pos = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const tan = norm(sub(b, a));
        const nA = outwardNormals[i - 1], nB = outwardNormals[i];
        const nraw = [nA[0] * (1 - t) + nB[0] * t, nA[1] * (1 - t) + nB[1] * t];
        const nn = norm(nraw);
        return { pos, tan, nrm: (nn[0] === 0 && nn[1] === 0) ? nA : nn };
      }
    }
    const last = edge.length - 1;
    return { pos: edge[last], tan: norm(sub(edge[last], edge[last - 1])), nrm: outwardNormals[last] };
  };

  const spots = [];
  for (let i = 0; i < n; i++) {
    const sStart = setbackStart + leadGap + i * spotWidth;
    const sEnd = sStart + spotWidth;
    const A = sampleAt(sStart);
    const B = sampleAt(sEnd);

    // Reject spots where heading change over the spot width exceeds ~15°.
    const cross = A.tan[0] * B.tan[1] - A.tan[1] * B.tan[0];
    const d0 = A.tan[0] * B.tan[0] + A.tan[1] * B.tan[1];
    const turn = Math.abs(Math.atan2(cross, d0));
    if (turn > (15 * Math.PI) / 180) continue;

    // Use MIDPOINT reference frame for a perfect rectangle on curves.
    const M = sampleAt(sStart + spotWidth / 2);
    const halfW = spotWidth / 2;
    const innerA = [M.pos[0] - M.tan[0] * halfW, M.pos[1] - M.tan[1] * halfW];
    const innerB = [M.pos[0] + M.tan[0] * halfW, M.pos[1] + M.tan[1] * halfW];
    const outerA = [innerA[0] + M.nrm[0] * spotDepth, innerA[1] + M.nrm[1] * spotDepth];
    const outerB = [innerB[0] + M.nrm[0] * spotDepth, innerB[1] + M.nrm[1] * spotDepth];
    const center = [M.pos[0] + M.nrm[0] * (spotDepth / 2), M.pos[1] + M.nrm[1] * (spotDepth / 2)];
    // Force CCW winding: left side (tan, nrm) is right-handed → CCW as-is.
    // Right side nrm points opposite → reverse to keep CCW.
    const corners = side === 'left'
      ? [innerA, innerB, outerB, outerA]
      : [innerA, outerA, outerB, innerB];
    spots.push({ corners, center, side, segmentIndex });
  }
  return spots;
}

/* ── Generate parking for full curved edge polylines ─────────── */
export function generateEdgeParking(segments, startIsJunctionFlags, endIsJunctionFlags, opts) {
  // opts: { spotWidth, spotDepth, fillPercent, junctionSetback }
  const out = [];

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const cl = seg.centerline;
    if (cl.length < 2) continue;
    if (cl.length !== seg.leftEdge.length || cl.length !== seg.rightEdge.length) continue;

    const startIsJ = startIsJunctionFlags[si] ?? false;
    const endIsJ = endIsJunctionFlags[si] ?? false;
    const setbackStart = startIsJ ? opts.junctionSetback : 0;
    const setbackEnd = endIsJ ? opts.junctionSetback : 0;

    // Per-vertex outward normals: normalize(edge[i] - centerline[i]).
    const leftNormals = new Array(cl.length);
    const rightNormals = new Array(cl.length);
    for (let i = 0; i < cl.length; i++) {
      leftNormals[i] = norm(sub(seg.leftEdge[i], cl[i]));
      rightNormals[i] = norm(sub(seg.rightEdge[i], cl[i]));
    }

    // Patch zero-length normals with the nearest non-zero neighbor.
    const patch = (arr) => {
      let lastGood = null;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i][0] !== 0 || arr[i][1] !== 0) { lastGood = arr[i]; break; }
      }
      if (!lastGood) return;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i][0] === 0 && arr[i][1] === 0) arr[i] = lastGood;
        else lastGood = arr[i];
      }
    };
    patch(leftNormals);
    patch(rightNormals);

    const leftSpots = placeSpotsAlongEdge({
      edge: seg.leftEdge, side: 'left', segmentIndex: si,
      spotWidth: opts.spotWidth, spotDepth: opts.spotDepth,
      fillPercent: opts.fillPercent,
      setbackStart, setbackEnd, outwardNormals: leftNormals,
    });
    out.push(...leftSpots);

    const rightSpots = placeSpotsAlongEdge({
      edge: seg.rightEdge, side: 'right', segmentIndex: si,
      spotWidth: opts.spotWidth, spotDepth: opts.spotDepth,
      fillPercent: opts.fillPercent,
      setbackStart, setbackEnd, outwardNormals: rightNormals,
    });
    out.push(...rightSpots);
  }
  return out;
}
