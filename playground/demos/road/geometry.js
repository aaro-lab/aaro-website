/**
 * Road demo — geometry primitives and fillet algorithms.
 * Pure functions, no side effects, no DOM.
 */

/* ── Vec2 helpers ─────────────────────────────────────────────── */
export const dist  = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add   = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (v, s) => [v[0] * s, v[1] * s];
export const len   = v => Math.hypot(v[0], v[1]);
export const norm  = v => { const l = len(v); return l < 1e-9 ? [0, 0] : [v[0] / l, v[1] / l]; };
export const perp  = v => [-v[1], v[0]];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1];

/* ── Thresholds ───────────────────────────────────────────────── */
const COLLINEAR_TOL  = 0.02;   // rad — skip nearly-straight corners
const FILLET_EDGE_MAX = 0.45;  // max fraction of adjacent edge for tangent
const DEDUP_DIST     = 0.01;   // ring vertex dedup threshold (m)
const SHORT_EDGE_MULT = 1.5;   // skip reflex corners between edges shorter than R * this

/* ── Segment intersection ─────────────────────────────────────── */
export function segIntersect(a1, a2, b1, b2) {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const d = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(d) < 1e-10) return null;
  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / d;
  const u = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

export function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ls = dx * dx + dy * dy;
  if (ls < 1e-12) return { pt: [...a], t: 0 };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ls));
  return { pt: [a[0] + t * dx, a[1] + t * dy], t };
}

/* ── Chaikin smoothing ────────────────────────────────────────── */
export function chaikin(pts, iter) {
  let r = pts.map(p => [...p]);
  for (let it = 0; it < iter; it++) {
    const n = [r[0]];
    for (let i = 0; i < r.length - 1; i++) {
      n.push([.75 * r[i][0] + .25 * r[i + 1][0], .75 * r[i][1] + .25 * r[i + 1][1]]);
      n.push([.25 * r[i][0] + .75 * r[i + 1][0], .25 * r[i][1] + .75 * r[i + 1][1]]);
    }
    n.push(r[r.length - 1]); r = n;
  }
  return r;
}

/* ── Shared arc generator for all fillet functions ─────────────── */
function generateArc(center, radius, startAngle, endAngle, minSteps) {
  let sweep = endAngle - startAngle;
  while (sweep > Math.PI)  sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const steps = Math.max(minSteps, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  const pts = [];
  for (let s = 1; s < steps; s++) {
    const a = startAngle + sweep * (s / steps);
    pts.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return pts;
}

/* ── Remove closing duplicate from a ring ─────────────────────── */
export function openRing(ring) {
  let pts = [...ring];
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  return pts;
}

/* ── Signed area (shoelace) ───────────────────────────────────── */
export function ringArea(ring) {
  let a = 0; const n = ring.length;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
  return a / 2;
}

/* ── Fillet interior vertices of an open polyline ─────────────── */
export function filletPolyline(pts, radius) {
  if (radius <= 0 || pts.length < 3) return pts.map(p => [...p]);
  const n = pts.length, out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < n - 1; i++) {
    const prev = pts[i - 1], curr = pts[i], next = pts[i + 1];
    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) { out.push([curr[0], curr[1]]); continue; }
    const d1x = v1x / l1, d1y = v1y / l1, d2x = v2x / l2, d2y = v2y / l2;
    const c = d1x * d2y - d1y * d2x, dt = d1x * d2x + d1y * d2y;
    const turn = Math.atan2(Math.abs(c), dt);
    if (turn < COLLINEAR_TOL || turn > Math.PI - COLLINEAR_TOL) { out.push([curr[0], curr[1]]); continue; }
    const half = turn / 2;
    const tanLen = Math.min(radius * Math.tan(half), Math.min(l1, l2) * 0.5);
    const R = tanLen / Math.tan(half);
    const tA = [curr[0] - d1x * tanLen, curr[1] - d1y * tanLen];
    const tB = [curr[0] + d2x * tanLen, curr[1] + d2y * tanLen];
    const bx = -d1x + d2x, by = -d1y + d2y, bl = Math.hypot(bx, by);
    if (bl < 1e-9) { out.push([curr[0], curr[1]]); continue; }
    const bisLen = R / Math.cos(half);
    const center = [curr[0] + (bx / bl) * bisLen, curr[1] + (by / bl) * bisLen];
    const sa = Math.atan2(tA[1] - center[1], tA[0] - center[0]);
    const ea = Math.atan2(tB[1] - center[1], tB[0] - center[0]);
    out.push(tA);
    out.push(...generateArc(center, R, sa, ea, 4));
    out.push(tB);
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/* ── Fillet convex corners of a closed polygon ring ───────────── */
export function filletConvex(ring, radius) {
  if (radius <= 0 || ring.length < 3) return ring;
  const pts = openRing(ring);
  const n = pts.length; if (n < 3) return ring;
  const ccw = ringArea(pts) > 0;
  const result = [];

  const edgeLen = new Array(n), turnA = new Array(n), cvx = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    edgeLen[i] = dist(curr, next);
    const d1 = norm(sub(curr, prev)), d2 = norm(sub(next, curr));
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    turnA[i] = Math.atan2(Math.abs(cr), dot(d1, d2));
    cvx[i] = ccw ? cr > 1e-9 : cr < -1e-9;
  }
  const is90 = i => cvx[i] && Math.abs(turnA[i] - Math.PI / 2) < 0.25;
  const isCap = i => { if (!is90(i)) return false; return is90((i + 1) % n) || is90((i - 1 + n) % n); };

  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    // Skip: non-convex, nearly-straight (turn < 0.54 rad), or dead-end cap corners
    if (!cvx[i] || turnA[i] < 0.54 || turnA[i] < 0.01 || isCap(i)) { result.push(curr); continue; }
    const d1 = norm(sub(curr, pts[(i - 1 + n) % n])), d2 = norm(sub(pts[(i + 1) % n], curr));
    const half = turnA[i] / 2;
    let tanLen = radius * Math.tan(half);
    tanLen = Math.min(tanLen, Math.min(edgeLen[(i - 1 + n) % n], edgeLen[i]) * FILLET_EDGE_MAX);
    const R = tanLen / Math.tan(half);
    const tA = [curr[0] - d1[0] * tanLen, curr[1] - d1[1] * tanLen];
    const tB = [curr[0] + d2[0] * tanLen, curr[1] + d2[1] * tanLen];
    const bis = norm(add(scale(d1, -1), d2)), bisL = R / Math.cos(half);
    const cDir = ccw ? scale(bis, -1) : bis;
    const center = [curr[0] + cDir[0] * bisL, curr[1] + cDir[1] * bisL];
    const sa = Math.atan2(tA[1] - center[1], tA[0] - center[0]);
    const ea = Math.atan2(tB[1] - center[1], tB[0] - center[0]);
    result.push(tA);
    result.push(...generateArc(center, R, sa, ea, 4));
    result.push(tB);
  }
  if (result.length > 0) result.push([...result[0]]);
  return result;
}

/* ── Fillet reflex (concave) corners — curb return at junctions ── */
export function filletReflex(ring, radius) {
  if (radius <= 0 || ring.length < 3) return ring;
  const pts = openRing(ring);
  const n = pts.length; if (n < 3) return ring;
  const ccw = ringArea(pts) > 0;

  const reflexIdx = [], cornerTurn = new Array(n), isReflex = new Array(n);
  for (let i = 0; i < n; i++) {
    const d1 = norm(sub(pts[i], pts[(i - 1 + n) % n])), d2 = norm(sub(pts[(i + 1) % n], pts[i]));
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    cornerTurn[i] = Math.atan2(Math.abs(cr), dot(d1, d2));
    isReflex[i] = ccw ? cr < -1e-9 : cr > 1e-9;
    if (isReflex[i] && cornerTurn[i] >= 0.05) reflexIdx.push(i);
  }
  const nearDist = new Map();
  for (const i of reflexIdx) { let best = Infinity; for (const j of reflexIdx) if (i !== j) best = Math.min(best, dist(pts[i], pts[j])); nearDist.set(i, best); }

  const result = [];
  for (let i = 0; i < n; i++) {
    if (!isReflex[i] || cornerTurn[i] < 0.05) { result.push(pts[i]); continue; }
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    const d1 = norm(sub(curr, prev)), d2 = norm(sub(next, curr));
    const half = cornerTurn[i] / 2;
    let tanLen = radius * Math.tan(half);
    const lP = dist(prev, curr), lN = dist(curr, next);
    if (lP < radius * SHORT_EDGE_MULT && lN < radius * SHORT_EDGE_MULT) { result.push(curr); continue; }
    tanLen = Math.min(tanLen, Math.min(lP, lN) * FILLET_EDGE_MAX);
    const nb = nearDist.get(i) ?? Infinity;
    if (isFinite(nb)) tanLen = Math.min(tanLen, nb * FILLET_EDGE_MAX * Math.sin(half));
    if (tanLen < 1e-6) { result.push(curr); continue; }
    const R = tanLen / Math.tan(half);
    const tA = [curr[0] - d1[0] * tanLen, curr[1] - d1[1] * tanLen];
    const tB = [curr[0] + d2[0] * tanLen, curr[1] + d2[1] * tanLen];
    const bis = norm(add(scale(d1, -1), d2)), bisL = R / Math.cos(half);
    const center = [curr[0] + bis[0] * bisL, curr[1] + bis[1] * bisL];
    const sa = Math.atan2(tA[1] - center[1], tA[0] - center[0]);
    const ea = Math.atan2(tB[1] - center[1], tB[0] - center[0]);
    result.push(tA);
    result.push(...generateArc(center, R, sa, ea, 8));
    result.push(tB);
  }
  if (result.length > 0) result.push([...result[0]]);
  return result;
}

/* ── Offset polyline (left/right edges) ───────────────────────── */
export function offsetPolyline(pts, d) {
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    let n;
    if (i === 0) {
      const e = sub(pts[1], pts[0]);
      n = len(e) > 1e-9 ? perp(norm(e)) : [0, 1];
    } else if (i === pts.length - 1) {
      const e = sub(pts[i], pts[i - 1]);
      n = len(e) > 1e-9 ? perp(norm(e)) : [0, 1];
    } else {
      const e1 = sub(pts[i], pts[i - 1]), e2 = sub(pts[i + 1], pts[i]);
      const l1 = len(e1), l2 = len(e2);
      if (l1 < 1e-9 || l2 < 1e-9) {
        // Degenerate edge — use whichever neighbour edge is valid
        const e = l1 >= 1e-9 ? e1 : l2 >= 1e-9 ? e2 : [1, 0];
        n = perp(norm(e));
      } else {
        const n1 = perp(norm(e1)), n2 = perp(norm(e2));
        const avg = add(n1, n2);
        const avgL = len(avg);
        if (avgL < 1e-6) {
          // Near-hairpin: normals cancel out → use incoming edge normal (bevel)
          n = n1;
        } else {
          n = scale(avg, 1 / avgL);          // normalised bisector
          const c = dot(n, n1);              // cos(half-angle)
          if (c > 0.15) {
            n = scale(n, Math.min(1 / c, 2.5));  // miter, capped
          } else {
            // Very sharp turn: bisector is valid but miter would explode →
            // fall back to incoming edge normal for a clean bevel-like join
            n = n1;
          }
        }
      }
    }
    left.push(add(pts[i], scale(n, d)));
    right.push(add(pts[i], scale(n, -d)));
  }
  return { left, right };
}

/* ── Polygon ring utilities ───────────────────────────────────── */
export function toRing(strip) {
  const r = strip.map(p => [p[0], p[1]]);
  if (r.length > 0 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]))
    r.push([r[0][0], r[0][1]]);
  return r;
}

export function simplifyRing(ring) {
  if (ring.length < 4) return ring;
  const pts = openRing(ring);
  const dd = [];
  for (const p of pts) { if (!dd.length || Math.hypot(p[0] - dd[dd.length - 1][0], p[1] - dd[dd.length - 1][1]) > DEDUP_DIST) dd.push(p); }
  if (dd.length < 3) return ring;
  const out = [], n = dd.length;
  for (let i = 0; i < n; i++) {
    const prev = dd[(i - 1 + n) % n], curr = dd[i], next = dd[(i + 1) % n];
    const d1x = curr[0] - prev[0], d1y = curr[1] - prev[1], d2x = next[0] - curr[0], d2y = next[1] - curr[1];
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cr = (d1x * d2y - d1y * d2x) / (l1 * l2), dt2 = (d1x * d2x + d1y * d2y) / (l1 * l2);
    if (Math.atan2(Math.abs(cr), dt2) < COLLINEAR_TOL) continue;
    out.push(curr);
  }
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}

export function multiPolyToRings(mp) {
  const rings = [];
  for (const polygon of mp) {
    if (!polygon.length || polygon[0].length < 3) continue;
    rings.push(simplifyRing(polygon[0].map(p => [p[0], p[1]])));
    for (let h = 1; h < polygon.length; h++) {
      const hole = polygon[h]; if (hole.length < 3) continue;
      const ha = Math.abs(ringArea(hole)); if (ha < 0.5) continue;
      const oa = Math.abs(ringArea(polygon[0]));
      if (oa > 0 && ha / oa < 0.02) continue;
      let perim = 0;
      for (let i = 0; i < hole.length - 1; i++) perim += Math.hypot(hole[i + 1][0] - hole[i][0], hole[i + 1][1] - hole[i][1]);
      if (perim * perim / ha >= 40) continue;
      rings.push(simplifyRing(hole.map(p => [p[0], p[1]])));
    }
  }
  return rings;
}

export function disc(center, radius, sides = 24) {
  const r = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; r.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]); }
  r.push([r[0][0], r[0][1]]);
  return r;
}

/* ── Point-in-ring (ray casting, array-based [x,y]) ───────────── */
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ── Direction arrows (7-point polygon per arrow) ─────────────── */
const ARROW_SPACING = 15; // metres between arrows

export function genArrows(centerline, roadWidth, spacing = ARROW_SPACING) {
  if (centerline.length < 2) return [];
  const s0 = Math.max(0.4, roadWidth / 6);
  const arrowLen = 2.5 * s0, shaftW = 0.25 * s0, headLen = 0.9 * s0, headHW = 0.6 * s0, laneOff = roadWidth / 4;
  let totalLen = 0;
  for (let i = 1; i < centerline.length; i++) totalLen += dist(centerline[i - 1], centerline[i]);
  if (totalLen < 2 * arrowLen) return [];
  const placements = totalLen < spacing ? [totalLen / 2] : [];
  if (!placements.length) for (let s = spacing / 2; s < totalLen - arrowLen / 2; s += spacing) placements.push(s);
  const sample = s => {
    let acc = 0;
    for (let i = 0; i < centerline.length - 1; i++) {
      const sl = dist(centerline[i], centerline[i + 1]);
      if (acc + sl >= s) {
        const t = sl > 1e-9 ? (s - acc) / sl : 0;
        return { pos: [centerline[i][0] + t * (centerline[i + 1][0] - centerline[i][0]), centerline[i][1] + t * (centerline[i + 1][1] - centerline[i][1])], tan: norm(sub(centerline[i + 1], centerline[i])) };
      }
      acc += sl;
    }
    const last = centerline.length - 1;
    return { pos: centerline[last], tan: norm(sub(centerline[last], centerline[last - 1])) };
  };
  const arrows = [];
  for (const s of placements) {
    const { pos, tan } = sample(s);
    const pr = [-tan[1], tan[0]];
    for (const lane of [1, -1]) {
      const dir = lane === 1 ? tan : [-tan[0], -tan[1]];
      const c = [pos[0] + pr[0] * lane * laneOff, pos[1] + pr[1] * lane * laneOff];
      const shLen = arrowLen - headLen;
      const tail = [c[0] - dir[0] * arrowLen / 2, c[1] - dir[1] * arrowLen / 2];
      const shoulder = [tail[0] + dir[0] * shLen, tail[1] + dir[1] * shLen];
      const tip = [c[0] + dir[0] * arrowLen / 2, c[1] + dir[1] * arrowLen / 2];
      const pd = [-dir[1], dir[0]];
      arrows.push([
        [tail[0] + pd[0] * shaftW / 2, tail[1] + pd[1] * shaftW / 2],
        [tail[0] - pd[0] * shaftW / 2, tail[1] - pd[1] * shaftW / 2],
        [shoulder[0] - pd[0] * shaftW / 2, shoulder[1] - pd[1] * shaftW / 2],
        [shoulder[0] - pd[0] * headHW, shoulder[1] - pd[1] * headHW],
        tip,
        [shoulder[0] + pd[0] * headHW, shoulder[1] + pd[1] * headHW],
        [shoulder[0] + pd[0] * shaftW / 2, shoulder[1] + pd[1] * shaftW / 2],
      ]);
    }
  }
  return arrows;
}
