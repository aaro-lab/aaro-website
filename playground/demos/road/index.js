import { setupCanvas, registerDemo } from '../shared.js';

/* ═══ Vec2 helpers ═══════════════════════════════════════════════ */
const D   = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sc  = (v, s) => [v[0] * s, v[1] * s];
const vlen = v => Math.hypot(v[0], v[1]);
const norm = v => { const l = vlen(v); return l < 1e-9 ? [0, 0] : [v[0] / l, v[1] / l]; };
const perp = v => [-v[1], v[0]];
const dot  = (a, b) => a[0] * b[0] + a[1] * b[1];

/* ═══ Segment intersection ═══════════════════════════════════════ */
function segX(a1, a2, b1, b2) {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const d = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(d) < 1e-10) return null;
  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / d;
  const u = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ls = dx * dx + dy * dy;
  if (ls < 1e-12) return { pt: [...a], t: 0 };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ls));
  return { pt: [a[0] + t * dx, a[1] + t * dy], t };
}

/* ═══ Chaikin smoothing ═══════════════════════════════════════════ */
function chaikin(pts, iter) {
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

/* ═══ Fillet interior vertices of an open polyline ═══════════════ */
function filletPolyline(pts, radius) {
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
    if (turn < 0.02 || turn > Math.PI - 0.02) { out.push([curr[0], curr[1]]); continue; }
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
    let sweep = ea - sa;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    out.push(tA);
    for (let s = 1; s < steps; s++) { const a = sa + sweep * (s / steps); out.push([center[0] + R * Math.cos(a), center[1] + R * Math.sin(a)]); }
    out.push(tB);
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/* ═══ Fillet convex corners of a closed polygon ring ═════════════ */
function filletConvex(ring, radius) {
  if (radius <= 0 || ring.length < 3) return ring;
  let pts = [...ring];
  if (pts.length > 1 && D(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  const n = pts.length; if (n < 3) return ring;
  let sa2 = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; sa2 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  const ccw = sa2 > 0;
  const result = [];
  // Pre-compute edge lengths, turn angles, convexity
  const edgeLen = new Array(n), turnA = new Array(n), cvx = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    edgeLen[i] = D(curr, next);
    const d1 = norm(sub(curr, prev)), d2 = norm(sub(next, curr));
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    turnA[i] = Math.atan2(Math.abs(cr), dot(d1, d2));
    cvx[i] = ccw ? cr > 1e-9 : cr < -1e-9;
  }
  const is90 = i => cvx[i] && Math.abs(turnA[i] - Math.PI / 2) < 0.25;
  const isCap = i => { if (!is90(i)) return false; return (is90((i + 1) % n)) || (is90((i - 1 + n) % n)); };
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    const d1 = norm(sub(curr, prev)), d2 = norm(sub(next, curr));
    const inter = Math.PI - turnA[i];
    if (!cvx[i] || inter > 2.6 || turnA[i] < 0.01 || isCap(i)) { result.push(curr); continue; }
    const half = turnA[i] / 2;
    let tanLen = radius * Math.tan(half);
    tanLen = Math.min(tanLen, Math.min(edgeLen[(i - 1 + n) % n], edgeLen[i]) * 0.45);
    const R = tanLen / Math.tan(half);
    const tA = [curr[0] - d1[0] * tanLen, curr[1] - d1[1] * tanLen];
    const tB = [curr[0] + d2[0] * tanLen, curr[1] + d2[1] * tanLen];
    const bis = norm(add(sc(d1, -1), d2)), bisL = R / Math.cos(half);
    const cDir = ccw ? sc(bis, -1) : bis;
    const center = [curr[0] + cDir[0] * bisL, curr[1] + cDir[1] * bisL];
    const sa = Math.atan2(tA[1] - center[1], tA[0] - center[0]);
    const ea = Math.atan2(tB[1] - center[1], tB[0] - center[0]);
    let sweep = ea - sa; while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(4, Math.round(Math.abs(sweep) / (Math.PI / 12)));
    result.push(tA);
    for (let s = 1; s < steps; s++) { const a = sa + sweep * (s / steps); result.push([center[0] + R * Math.cos(a), center[1] + R * Math.sin(a)]); }
    result.push(tB);
  }
  if (result.length > 0) result.push([...result[0]]);
  return result;
}

/* ═══ Fillet reflex (concave) corners — curb return at junctions ═ */
function filletReflex(ring, radius) {
  if (radius <= 0 || ring.length < 3) return ring;
  let pts = [...ring];
  if (pts.length > 1 && D(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  const n = pts.length; if (n < 3) return ring;
  let sa2 = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; sa2 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  const ccw = sa2 > 0;
  const reflexIdx = [], cornerTurn = new Array(n), isReflex = new Array(n);
  for (let i = 0; i < n; i++) {
    const d1 = norm(sub(pts[i], pts[(i - 1 + n) % n])), d2 = norm(sub(pts[(i + 1) % n], pts[i]));
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    cornerTurn[i] = Math.atan2(Math.abs(cr), dot(d1, d2));
    const ref = ccw ? cr < -1e-9 : cr > 1e-9;
    isReflex[i] = ref;
    if (ref && cornerTurn[i] >= 0.05) reflexIdx.push(i);
  }
  const nearDist = new Map();
  for (const i of reflexIdx) { let best = Infinity; for (const j of reflexIdx) if (i !== j) best = Math.min(best, D(pts[i], pts[j])); nearDist.set(i, best); }
  const result = [];
  for (let i = 0; i < n; i++) {
    if (!isReflex[i] || cornerTurn[i] < 0.05) { result.push(pts[i]); continue; }
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    const d1 = norm(sub(curr, prev)), d2 = norm(sub(next, curr));
    const half = cornerTurn[i] / 2;
    let tanLen = radius * Math.tan(half);
    const lP = D(prev, curr), lN = D(curr, next);
    if (lP < radius * 1.5 && lN < radius * 1.5) { result.push(curr); continue; }
    tanLen = Math.min(tanLen, Math.min(lP, lN) * 0.45);
    const nb = nearDist.get(i) ?? Infinity;
    if (isFinite(nb)) tanLen = Math.min(tanLen, nb * 0.45 * Math.sin(half));
    if (tanLen < 1e-6) { result.push(curr); continue; }
    const R = tanLen / Math.tan(half);
    const tA = [curr[0] - d1[0] * tanLen, curr[1] - d1[1] * tanLen];
    const tB = [curr[0] + d2[0] * tanLen, curr[1] + d2[1] * tanLen];
    const bis = norm(add(sc(d1, -1), d2)), bisL = R / Math.cos(half);
    const center = [curr[0] + bis[0] * bisL, curr[1] + bis[1] * bisL];
    const sa = Math.atan2(tA[1] - center[1], tA[0] - center[0]);
    const ea = Math.atan2(tB[1] - center[1], tB[0] - center[0]);
    let sweep = ea - sa; while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    result.push(tA);
    for (let s = 1; s < steps; s++) { const a = sa + sweep * (s / steps); result.push([center[0] + R * Math.cos(a), center[1] + R * Math.sin(a)]); }
    result.push(tB);
  }
  if (result.length > 0) result.push([...result[0]]);
  return result;
}

/* ═══ Offset polyline ════════════════════════════════════════════ */
function offsetPoly(pts, d) {
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    let n;
    if (i === 0) n = perp(norm(sub(pts[1], pts[0])));
    else if (i === pts.length - 1) n = perp(norm(sub(pts[i], pts[i - 1])));
    else {
      const n1 = perp(norm(sub(pts[i], pts[i - 1]))), n2 = perp(norm(sub(pts[i + 1], pts[i])));
      n = norm(add(n1, n2));
      const c = dot(n, n1);
      if (Math.abs(c) > 0.15) n = sc(norm(n), Math.min(1 / c, 2.5));
    }
    left.push(add(pts[i], sc(n, d)));
    right.push(add(pts[i], sc(n, -d)));
  }
  return { left, right };
}

/* ═══ Insert intersection vertices into polylines ════════════════ */
function insertIntersectionVertices(polylines) {
  for (let pi = 0; pi < polylines.length; pi++) {
    for (let pj = pi + 1; pj < polylines.length; pj++) {
      const splitsI = [], splitsJ = [];
      for (let si = 0; si < polylines[pi].length - 1; si++) {
        for (let sj = 0; sj < polylines[pj].length - 1; sj++) {
          const pt = segX(polylines[pi][si], polylines[pi][si + 1], polylines[pj][sj], polylines[pj][sj + 1]);
          if (!pt) continue;
          const diA = D(polylines[pi][si], pt), diB = D(polylines[pi][si + 1], pt);
          const djA = D(polylines[pj][sj], pt), djB = D(polylines[pj][sj + 1], pt);
          if (diA > 0.3 && diB > 0.3) {
            const t = diA / D(polylines[pi][si], polylines[pi][si + 1]);
            splitsI.push({ segIdx: si, t, pt: [...pt] });
          }
          if (djA > 0.3 && djB > 0.3) {
            const t = djA / D(polylines[pj][sj], polylines[pj][sj + 1]);
            splitsJ.push({ segIdx: sj, t, pt: [...pt] });
          }
        }
      }
      // Also check endpoint-on-edge
      for (const ep of [polylines[pi][0], polylines[pi][polylines[pi].length - 1]]) {
        for (let sj = 0; sj < polylines[pj].length - 1; sj++) {
          const { pt, t } = closestOnSeg(ep, polylines[pj][sj], polylines[pj][sj + 1]);
          if (D(ep, pt) < 0.5 && t > 0.01 && t < 0.99)
            splitsJ.push({ segIdx: sj, t, pt: [...ep] });
        }
      }
      for (const ep of [polylines[pj][0], polylines[pj][polylines[pj].length - 1]]) {
        for (let si = 0; si < polylines[pi].length - 1; si++) {
          const { pt, t } = closestOnSeg(ep, polylines[pi][si], polylines[pi][si + 1]);
          if (D(ep, pt) < 0.5 && t > 0.01 && t < 0.99)
            splitsI.push({ segIdx: si, t, pt: [...ep] });
        }
      }
      const doInsert = (pl, splits) => {
        const byS = new Map();
        for (const s of splits) {
          if (!byS.has(s.segIdx)) byS.set(s.segIdx, []);
          byS.get(s.segIdx).push(s);
        }
        const segIdxs = [...byS.keys()].sort((a, b) => b - a);
        for (const si of segIdxs) {
          const ss = byS.get(si).sort((a, b) => b.t - a.t);
          const deduped = [];
          for (const s of ss) { if (!deduped.some(d => D(d.pt, s.pt) < 0.5)) deduped.push(s); }
          for (const s of deduped) pl.splice(si + 1, 0, s.pt);
        }
      };
      doInsert(polylines[pi], splitsI);
      doInsert(polylines[pj], splitsJ);
    }
  }
}

/* ═══ Split polylines at intersections for road generation ═══════ */
function splitAtIntersections(polylines) {
  const segs = [];
  for (let pi = 0; pi < polylines.length; pi++) {
    const pts = polylines[pi];
    for (let si = 0; si < pts.length - 1; si++)
      segs.push({ pi, si, a: pts[si], b: pts[si + 1] });
  }
  const splitPts = polylines.map(pl => {
    const m = new Map();
    for (let si = 0; si < pl.length - 1; si++) m.set(si, []);
    return m;
  });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].pi === segs[j].pi && Math.abs(segs[i].si - segs[j].si) <= 1) continue;
      const pt = segX(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (!pt) continue;
      const di = D(segs[i].a, pt) / D(segs[i].a, segs[i].b);
      const dj = D(segs[j].a, pt) / D(segs[j].a, segs[j].b);
      if (di > 0.001 && di < 0.999) splitPts[segs[i].pi].get(segs[i].si).push({ t: di, pt: [...pt] });
      if (dj > 0.001 && dj < 0.999) splitPts[segs[j].pi].get(segs[j].si).push({ t: dj, pt: [...pt] });
    }
  }
  for (let pi = 0; pi < polylines.length; pi++) {
    const pts = polylines[pi];
    for (const ep of [pts[0], pts[pts.length - 1]]) {
      for (let pj = 0; pj < polylines.length; pj++) {
        if (pi === pj) continue;
        for (let si = 0; si < polylines[pj].length - 1; si++) {
          const { pt, t } = closestOnSeg(ep, polylines[pj][si], polylines[pj][si + 1]);
          if (D(ep, pt) < 0.5 && t > 0.01 && t < 0.99) splitPts[pj].get(si).push({ t, pt: [...ep] });
        }
      }
    }
  }
  const result = [];
  for (let pi = 0; pi < polylines.length; pi++) {
    const pts = polylines[pi], all = [];
    for (let si = 0; si < pts.length - 1; si++) {
      all.push(pts[si]);
      const sp = splitPts[pi].get(si);
      if (sp.length) { sp.sort((a, b) => a.t - b.t); for (const s of sp) all.push(s.pt); }
    }
    all.push(pts[pts.length - 1]);
    for (let i = 0; i < all.length - 1; i++)
      if (D(all[i], all[i + 1]) > 0.1) result.push([all[i], all[i + 1]]);
  }
  return result;
}

/* ═══ Polygon helpers for union + fillet ═════════════════════════ */
function toRing(strip) {
  const r = strip.map(p => [p[0], p[1]]);
  if (r.length > 0 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]))
    r.push([r[0][0], r[0][1]]);
  return r;
}
function ringArea(ring) {
  let a = 0; const n = ring.length;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
  return a / 2;
}
function simplifyRing(ring) {
  if (ring.length < 4) return ring;
  let pts = [...ring];
  if (pts.length >= 2 && D(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  const dd = [];
  for (const p of pts) { if (!dd.length || Math.hypot(p[0] - dd[dd.length - 1][0], p[1] - dd[dd.length - 1][1]) > 0.01) dd.push(p); }
  if (dd.length < 3) return ring;
  const out = [], n = dd.length;
  for (let i = 0; i < n; i++) {
    const prev = dd[(i - 1 + n) % n], curr = dd[i], next = dd[(i + 1) % n];
    const d1x = curr[0] - prev[0], d1y = curr[1] - prev[1], d2x = next[0] - curr[0], d2y = next[1] - curr[1];
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cr = (d1x * d2y - d1y * d2x) / (l1 * l2), dt2 = (d1x * d2x + d1y * d2y) / (l1 * l2);
    if (Math.atan2(Math.abs(cr), dt2) < 0.02) continue;
    out.push(curr);
  }
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}
function multiPolyToRings(mp) {
  const rings = [];
  for (const polygon of mp) {
    if (!polygon.length || polygon[0].length < 3) continue;
    rings.push(simplifyRing(polygon[0].map(p => [p[0], p[1]])));
    for (let h = 1; h < polygon.length; h++) {
      const hole = polygon[h]; if (hole.length < 3) continue;
      const ha = Math.abs(ringArea(hole)); if (ha < 1) continue;
      const oa = Math.abs(ringArea(polygon[0]));
      if (oa > 0 && ha / oa < 0.04) continue;
      let perim = 0;
      for (let i = 0; i < hole.length - 1; i++) perim += Math.hypot(hole[i + 1][0] - hole[i][0], hole[i + 1][1] - hole[i][1]);
      if (perim * perim / ha >= 30) continue;
      rings.push(simplifyRing(hole.map(p => [p[0], p[1]])));
    }
  }
  return rings;
}
function disc(center, radius, sides = 48) {
  const r = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; r.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]); }
  r.push([r[0][0], r[0][1]]);
  return r;
}

/* ═══ Direction arrows ═══════════════════════════════════════════ */
function genArrows(centerline, roadWidth, spacing = 15) {
  if (centerline.length < 2) return [];
  const s0 = Math.max(0.4, roadWidth / 6);
  const arrowLen = 2.5 * s0, shaftW = 0.25 * s0, headLen = 0.9 * s0, headHW = 0.6 * s0, laneOff = roadWidth / 4;
  let totalLen = 0;
  for (let i = 1; i < centerline.length; i++) totalLen += D(centerline[i - 1], centerline[i]);
  if (totalLen < 2 * arrowLen) return [];
  const placements = totalLen < spacing ? [totalLen / 2] : [];
  if (!placements.length) for (let s = spacing / 2; s < totalLen - arrowLen / 2; s += spacing) placements.push(s);
  const sample = s => {
    let acc = 0;
    for (let i = 0; i < centerline.length - 1; i++) {
      const sl = D(centerline[i], centerline[i + 1]);
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

/* ═══ Find straight runs on a centerline (skip curves/fillets) ═══ */
function findStraightRuns(centerline, minLength, perVtxTol = 0.05, cumTol = 0.15) {
  const runs = [], n = centerline.length;
  if (n < 2) return runs;
  if (n === 2) { if (D(centerline[0], centerline[1]) >= minLength) runs.push({ s: 0, e: 1 }); return runs; }
  const headings = [], edgeFrom = [];
  for (let i = 0; i < n - 1; i++) {
    const d = sub(centerline[i + 1], centerline[i]);
    if (d[0] * d[0] + d[1] * d[1] < 1e-12) continue;
    headings.push(Math.atan2(d[1], d[0])); edgeFrom.push(i);
  }
  if (!headings.length) return runs;
  let runStart = 0, startH = headings[0];
  const runLen = (s, e) => { let L = 0; for (let i = s; i < e; i++) L += D(centerline[i], centerline[i + 1]); return L; };
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

/* ═══ Parking generation (straight runs only, perfect rectangles) ═ */
function genParking(segments, spotW, spotD, fillPct, setback) {
  const spots = [];
  const minRunLen = Math.max(spotW * 2, 10); // minimum straight run to host parking
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si], cl = seg.centerline;
    if (cl.length < 2 || cl.length !== seg.leftEdge.length) continue;
    const sbS = seg.startIsJunction ? setback : 0;
    const sbE = seg.endIsJunction ? setback : 0;
    // Find straight runs on centerline
    const runs = findStraightRuns(cl, minRunLen);
    for (const run of runs) {
      for (const side of ['left', 'right']) {
        const edge = side === 'left' ? seg.leftEdge : seg.rightEdge;
        // Use start/end of the straight run on the EDGE polyline
        const start = edge[run.s], end = edge[run.e];
        const runLen = D(start, end);
        // Compute single tangent and outward normal (exact perpendicular → 90° corners)
        const t = norm(sub(end, start));
        const outNorm = side === 'left' ? perp(t) : sc(perp(t), -1);
        // Apply setback: only if run touches segment endpoints
        const runSbS = (run.s === 0) ? sbS : 0;
        const runSbE = (run.e === cl.length - 1) ? sbE : 0;
        const usable = runLen - runSbS - runSbE;
        if (usable < spotW) continue;
        const maxN = Math.floor(usable / spotW);
        const n = Math.max(0, Math.min(maxN, Math.round(maxN * fillPct / 100)));
        if (n <= 0) continue;
        const slack = usable - n * spotW;
        const lead = slack / 2;
        for (let i = 0; i < n; i++) {
          const s0 = runSbS + lead + i * spotW;
          const p0 = [start[0] + t[0] * s0, start[1] + t[1] * s0];
          // Perfect rectangle using single tangent + normal
          const innerA = p0;
          const innerB = [p0[0] + t[0] * spotW, p0[1] + t[1] * spotW];
          const outerB = [innerB[0] + outNorm[0] * spotD, innerB[1] + outNorm[1] * spotD];
          const outerA = [p0[0] + outNorm[0] * spotD, p0[1] + outNorm[1] * spotD];
          const center = [p0[0] + t[0] * spotW / 2 + outNorm[0] * spotD / 2, p0[1] + t[1] * spotW / 2 + outNorm[1] * spotD / 2];
          // CCW winding: left side (t,n) is right-handed → CCW; right side reverse
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

/* ═══ Parking collision resolution (SAT) ═════════════════════════ */
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
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function resolveParkingCollisions(spots, roadRings) {
  if (!spots.length) return spots;
  // Pass 1: remove spots whose center or inset corners lie inside the road outline
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
  // Pass 2: spot-spot overlap (cross-group AND same-segment cross-side)
  // Slightly shrink spots for overlap test to avoid false positives at touching edges
  const shrink = (corners, center, amt = 0.98) => corners.map(c => [
    center[0] + (c[0] - center[0]) * amt, center[1] + (c[1] - center[1]) * amt
  ]);
  const gOf = s => `${s.segmentIndex}:${s.side}`;
  const pairs = new Map();
  for (let i = 0; i < after.length; i++) {
    const ci = shrink(after[i].corners, after[i].center);
    for (let j = i + 1; j < after.length; j++) {
      const gi = gOf(after[i]), gj = gOf(after[j]);
      if (gi === gj) continue; // same group: placed correctly by construction
      const cj = shrink(after[j].corners, after[j].center);
      if (!rectsOverlap(ci, cj)) continue;
      const [gA, gB] = gi < gj ? [gi, gj] : [gj, gi];
      const key = gA + '|' + gB;
      if (!pairs.has(key)) pairs.set(key, { gA, gB, aIds: new Set(), bIds: new Set() });
      const e = pairs.get(key);
      if (gi === gA) { e.aIds.add(i); e.bIds.add(j); } else { e.bIds.add(i); e.aIds.add(j); }
    }
  }
  const rm = new Set();
  for (const e of pairs.values()) {
    // Group with more collisions loses; ties go to lexicographically later group
    const victim = e.aIds.size > e.bIds.size ? e.aIds : e.bIds;
    for (const idx of victim) rm.add(idx);
  }
  return after.filter((_, i) => !rm.has(i));
}

/* ═══ Road generation pipeline ═══════════════════════════════════ */
function generateRoads(polylines, roadWidth, chaikinIter, turningRadius, cornerRadius, sidewalkWidth, PC) {
  const empty = { segments: [], nodes: [], outline: null, filletOutline: null, sidewalkOutline: null, arrows: [] };
  if (!polylines.length) return empty;
  const halfW = roadWidth / 2;
  const subSegs = splitAtIntersections(polylines);
  if (!subSegs.length) return empty;

  // Vertex graph
  const vk = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const adj = new Map(), posMap = new Map();
  for (const seg of subSegs) {
    const ka = vk(seg[0]), kb = vk(seg[seg.length - 1]);
    if (!posMap.has(ka)) posMap.set(ka, seg[0]);
    if (!posMap.has(kb)) posMap.set(kb, seg[seg.length - 1]);
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka).add(kb); adj.get(kb).add(ka);
  }
  const junctionKeys = new Set(), entryKeys = new Set();
  for (const [key, nb] of adj) { if (nb.size >= 3) junctionKeys.add(key); else if (nb.size === 1) entryKeys.add(key); }
  const nodeKeys = new Set([...junctionKeys, ...entryKeys]);
  const nodes = [], nodeKeyList = [];
  for (const key of nodeKeys) {
    const pos = posMap.get(key); if (!pos) continue;
    nodes.push({ position: pos, type: junctionKeys.has(key) ? 'junction' : 'entry' });
    nodeKeyList.push(key);
  }

  // Trace chains
  const visited = new Set(), chains = [];
  for (let ni = 0; ni < nodeKeyList.length; ni++) {
    const startKey = nodeKeyList[ni], neighbors = adj.get(startKey);
    if (!neighbors) continue;
    for (const first of neighbors) {
      const eId = startKey < first ? startKey + '>' + first : first + '>' + startKey;
      if (visited.has(eId)) continue;
      const pts = [posMap.get(startKey)];
      let prev = startKey, curr = first;
      for (let s = 0; s < 1000; s++) {
        const id2 = prev < curr ? prev + '>' + curr : curr + '>' + prev;
        visited.add(id2);
        pts.push(posMap.get(curr));
        if (nodeKeys.has(curr)) break;
        const cn = adj.get(curr); if (!cn) break;
        let next = ''; for (const nb of cn) { if (nb !== prev) { next = nb; break; } }
        if (!next) break; prev = curr; curr = next;
      }
      if (pts.length >= 2) chains.push({ pts, startNode: ni, endNode: nodeKeyList.indexOf(curr) });
    }
  }

  // Smooth + offset each chain
  const segments = [];
  for (const chain of chains) {
    let cl = chain.pts;
    if (turningRadius > 0 && cl.length >= 3) cl = filletPolyline(cl, turningRadius);
    else if (chaikinIter > 0 && cl.length >= 3) cl = chaikin(cl, chaikinIter);
    const dd = [cl[0]];
    for (let i = 1; i < cl.length; i++) if (D(cl[i], dd[dd.length - 1]) > 0.05) dd.push(cl[i]);
    cl = dd; if (cl.length < 2) continue;
    const { left, right } = offsetPoly(cl, halfW);
    if (left.length < 2 || right.length < 2) continue;
    const strip = [...left, ...[...right].reverse()];
    const sni = chain.startNode >= 0 && chain.startNode < nodes.length ? nodes[chain.startNode] : null;
    const eni = chain.endNode >= 0 && chain.endNode < nodes.length ? nodes[chain.endNode] : null;
    segments.push({ centerline: cl, leftEdge: left, rightEdge: right, strip,
      startIsJunction: sni?.type === 'junction', endIsJunction: eni?.type === 'junction' });
  }

  // Junction disc patches
  const junctionDiscs = [];
  for (const node of nodes) {
    if (node.type === 'junction') junctionDiscs.push(disc(node.position, halfW + 0.05));
  }

  // Direction arrows
  let arrows = [];
  for (const seg of segments) arrows = arrows.concat(genArrows(seg.centerline, roadWidth));

  // Union + fillet with polygon-clipping (if available)
  let outline = null, filletOutline = null, sidewalkOutline = null;
  if (PC) {
    try {
      // Union all strips + junction discs
      const allStrips = [...segments.map(s => s.strip), ...junctionDiscs];
      if (allStrips.length) {
        let result = [[toRing(allStrips[0])]];
        for (let i = 1; i < allStrips.length; i++) {
          try { result = PC.union(result, [[toRing(allStrips[i])]]); } catch { /* skip */ }
        }
        outline = multiPolyToRings(result);
        // Apply fillet: reflex first (curb returns), then convex
        filletOutline = cornerRadius > 0
          ? outline.map(r => filletReflex(r, cornerRadius)).map(r => filletConvex(r, cornerRadius))
          : outline;
      }
    } catch { /* fallback to no outline */ }

    // Sidewalk: wider strips - road
    if (sidewalkWidth > 0 && filletOutline) {
      try {
        const widerStrips = [...segments.map(seg => {
          const { left, right } = offsetPoly(seg.centerline, halfW + sidewalkWidth);
          return [...left, ...[...right].reverse()];
        }), ...nodes.filter(n => n.type === 'junction').map(n => disc(n.position, halfW + sidewalkWidth + 0.05))];
        let rowResult = [[toRing(widerStrips[0])]];
        for (let i = 1; i < widerStrips.length; i++) {
          try { rowResult = PC.union(rowResult, [[toRing(widerStrips[i])]]); } catch { /* skip */ }
        }
        const roadGeom = filletOutline.map(r => [toRing(r)]);
        const diff = PC.difference(rowResult, roadGeom);
        sidewalkOutline = multiPolyToRings(diff);
      } catch { /* no sidewalk */ }
    }
  }

  return { segments, nodes, outline, filletOutline, sidewalkOutline, arrows, junctionDiscs };
}

/* ═══════════════════════════════════════════════════════════════════
   DEMO INIT
   ═══════════════════════════════════════════════════════════════════ */
export function init(cell) {
  let PC = null;
  // Load polygon-clipping from CDN in background
  import('https://esm.sh/polygon-clipping@0.15.7')
    .then(mod => { PC = mod.default; recompute(); })
    .catch(() => { /* fallback to simple rendering */ });

  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  if (!canvas) return;

  let ctx, W, H;

  // Camera
  let camX = 0, camY = 0, camZoom = 8;
  let panning = false, panLX = 0, panLY = 0;

  // Config
  const ROAD_W = 6, SIDEWALK_W = 1.5, TURNING_R = 5, CORNER_R = 3;
  const SPOT_W = 2.5, SPOT_D = 5.0, FILL_PCT = 80, JUNCTION_SB = 5;
  let parkingOn = false;

  // State
  let polylines = []; // Array of Vec2[] (with intersection vertices inserted)
  let roadResult = { segments: [], nodes: [], outline: null, filletOutline: null, sidewalkOutline: null, arrows: [], junctionDiscs: [] };
  let parkingSpots = [];

  // Drawing state
  let drawing = false, drawPts = [];

  // Drag state: group of coincident vertices
  let dragGroup = []; // [{pi, vi}]
  let hovPl = -1, hovVi = -1;

  // Default: 3 intersecting lines
  function initDefaults() {
    polylines = [
      [[-35, -8], [35, -8]],
      [[-20, 22], [20, -22]],
      [[-5, -28], [5, 28]],
    ];
    insertIntersectionVertices(polylines);
  }

  // World <-> Screen (Y-up)
  function w2s(x, y) { return { x: W / 2 + (x - camX) * camZoom, y: H / 2 - (y - camY) * camZoom }; }
  function s2w(sx, sy) { return [(sx - W / 2) / camZoom + camX, -(sy - H / 2) / camZoom + camY]; }

  function recompute() {
    const showSidewalk = !parkingOn && SIDEWALK_W > 0;
    roadResult = generateRoads(polylines, ROAD_W, 2, TURNING_R, CORNER_R, showSidewalk ? SIDEWALK_W : 0, PC);
    parkingSpots = parkingOn
      ? resolveParkingCollisions(genParking(roadResult.segments, SPOT_W, SPOT_D, FILL_PCT, JUNCTION_SB), roadResult.filletOutline || roadResult.outline)
      : [];
  }

  function resize() {
    const s = setupCanvas(canvas); W = s.w; H = s.h; ctx = s.ctx;
    camZoom = Math.min(W, H) / 80;
  }

  /* ── Hit test ──────────────────────────────────────────────── */
  function hitVertex(sx, sy) {
    const thresh = 12;
    for (let pi = 0; pi < polylines.length; pi++)
      for (let vi = 0; vi < polylines[pi].length; vi++) {
        const p = w2s(polylines[pi][vi][0], polylines[pi][vi][1]);
        if (Math.hypot(sx - p.x, sy - p.y) < thresh) return { pi, vi };
      }
    return null;
  }

  function findCoincident(pi, vi) {
    const pos = polylines[pi][vi];
    const group = [{ pi, vi }];
    for (let p = 0; p < polylines.length; p++)
      for (let v = 0; v < polylines[p].length; v++) {
        if (p === pi && v === vi) continue;
        if (D(polylines[p][v], pos) < 0.5) group.push({ pi: p, vi: v });
      }
    return group;
  }

  /* ── Draw ──────────────────────────────────────────────────── */
  function drawRingSet(rings, fill, stroke, lw, alpha = 1) {
    if (!rings || !rings.length) return;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const ring of rings) {
      if (ring.length < 3) continue;
      const s0 = w2s(ring[0][0], ring[0][1]);
      ctx.moveTo(s0.x, s0.y);
      for (let k = 1; k < ring.length; k++) { const sk = w2s(ring[k][0], ring[k][1]); ctx.lineTo(sk.x, sk.y); }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.restore();
    if (stroke) {
      ctx.save();
      ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.lineJoin = 'round';
      for (const ring of rings) {
        if (ring.length < 3) continue;
        ctx.beginPath();
        const s0 = w2s(ring[0][0], ring[0][1]);
        ctx.moveTo(s0.x, s0.y);
        for (let k = 1; k < ring.length; k++) { const sk = w2s(ring[k][0], ring[k][1]); ctx.lineTo(sk.x, sk.y); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    const step = camZoom < 3 ? 20 : camZoom < 6 ? 10 : 5;
    const [wl] = s2w(0, 0), [wr] = s2w(W, 0), wb = s2w(0, H)[1], wt = s2w(0, 0)[1];
    for (let x = Math.floor(wl / step) * step; x <= wr + step; x += step) {
      const p1 = w2s(x, wt + step), p2 = w2s(x, wb - step);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    for (let y = Math.floor(Math.min(wt, wb) / step) * step; y <= Math.max(wt, wb) + step; y += step) {
      const p1 = w2s(wl - step, y), p2 = w2s(wr + step, y);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    // Sidewalk (under road, only when parking off)
    if (!parkingOn) {
      if (roadResult.sidewalkOutline) {
        drawRingSet(roadResult.sidewalkOutline, 'rgb(225,222,210)', 'rgba(110,100,80,0.55)', 1, 0.85);
      } else if (roadResult.segments.length) {
        // Fallback: draw wider strips as sidewalk
        ctx.save(); ctx.globalAlpha = 0.5;
        for (const seg of roadResult.segments) {
          const { left, right } = offsetPoly(seg.centerline, ROAD_W / 2 + SIDEWALK_W);
          const strip = [...left, ...[...right].reverse()];
          ctx.beginPath();
          const s0 = w2s(strip[0][0], strip[0][1]); ctx.moveTo(s0.x, s0.y);
          for (let i = 1; i < strip.length; i++) { const si = w2s(strip[i][0], strip[i][1]); ctx.lineTo(si.x, si.y); }
          ctx.closePath();
          ctx.fillStyle = 'rgb(225,222,210)'; ctx.fill();
          ctx.strokeStyle = 'rgba(110,100,80,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        }
        // Junction discs for sidewalk
        for (const node of roadResult.nodes) {
          if (node.type !== 'junction') continue;
          const r = (ROAD_W / 2 + SIDEWALK_W) * camZoom;
          const c = w2s(node.position[0], node.position[1]);
          ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgb(225,222,210)'; ctx.fill();
        }
        ctx.restore();
      }
    }

    // Road surface
    const roadOutline = roadResult.filletOutline || roadResult.outline;
    if (roadOutline) {
      drawRingSet(roadOutline, 'rgb(180,180,180)', 'rgba(100,100,100,0.35)', 1.5, 0.45);
    } else {
      // Fallback: draw strips
      for (const seg of roadResult.segments) {
        const strip = seg.strip; if (strip.length < 3) continue;
        ctx.beginPath();
        const s0 = w2s(strip[0][0], strip[0][1]); ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < strip.length; i++) { const si = w2s(strip[i][0], strip[i][1]); ctx.lineTo(si.x, si.y); }
        ctx.closePath(); ctx.fillStyle = 'rgba(180,180,180,0.35)'; ctx.fill();
        ctx.strokeStyle = 'rgba(100,100,100,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // Junction discs (fill gaps)
      for (const node of roadResult.nodes) {
        if (node.type !== 'junction') continue;
        const r = ROAD_W / 2 * camZoom;
        const c = w2s(node.position[0], node.position[1]);
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,180,180,0.35)'; ctx.fill();
      }
    }

    // Parking spots
    if (parkingOn && parkingSpots.length) {
      ctx.save(); ctx.fillStyle = 'rgba(70,130,180,0.35)'; ctx.strokeStyle = 'rgba(70,130,180,0.6)'; ctx.lineWidth = 1;
      for (const spot of parkingSpots) {
        const c = spot.corners;
        ctx.beginPath();
        const p0 = w2s(c[0][0], c[0][1]); ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < 4; i++) { const pi = w2s(c[i][0], c[i][1]); ctx.lineTo(pi.x, pi.y); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    // Direction arrows
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = 'rgba(255,255,255,1.0)'; ctx.lineWidth = 0.3; ctx.lineJoin = 'round';
    for (const arrow of roadResult.arrows) {
      ctx.beginPath();
      const a0 = w2s(arrow[0][0], arrow[0][1]); ctx.moveTo(a0.x, a0.y);
      for (let k = 1; k < arrow.length; k++) { const ak = w2s(arrow[k][0], arrow[k][1]); ctx.lineTo(ak.x, ak.y); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    // Centerlines (dashed orange)
    ctx.save(); ctx.setLineDash([8, 5]); ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 1.5;
    for (const seg of roadResult.segments) {
      if (seg.centerline.length < 2) continue;
      ctx.beginPath();
      const c0 = w2s(seg.centerline[0][0], seg.centerline[0][1]); ctx.moveTo(c0.x, c0.y);
      for (let i = 1; i < seg.centerline.length; i++) { const ci = w2s(seg.centerline[i][0], seg.centerline[i][1]); ctx.lineTo(ci.x, ci.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();

    // User polylines (gray dashed)
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.lineWidth = 1;
    for (const pl of polylines) {
      if (pl.length < 2) continue;
      ctx.beginPath();
      const p0 = w2s(pl[0][0], pl[0][1]); ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < pl.length; i++) { const pi = w2s(pl[i][0], pl[i][1]); ctx.lineTo(pi.x, pi.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();

    // Drawing preview
    if (drawing && drawPts.length >= 1) {
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(196,119,60,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const dp0 = w2s(drawPts[0][0], drawPts[0][1]); ctx.moveTo(dp0.x, dp0.y);
      for (let i = 1; i < drawPts.length; i++) { const dpi = w2s(drawPts[i][0], drawPts[i][1]); ctx.lineTo(dpi.x, dpi.y); }
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      for (const pt of drawPts) { const pp = w2s(pt[0], pt[1]); ctx.beginPath(); ctx.arc(pp.x, pp.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#C4773C'; ctx.fill(); }
    }

    // Nodes
    for (const node of roadResult.nodes) {
      const np = w2s(node.position[0], node.position[1]);
      const isJ = node.type === 'junction';
      ctx.beginPath(); ctx.arc(np.x, np.y, isJ ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isJ ? '#ef4444' : '#3b82f6'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Polyline vertices (draggable)
    for (let pi = 0; pi < polylines.length; pi++) {
      for (let vi = 0; vi < polylines[pi].length; vi++) {
        const vp = w2s(polylines[pi][vi][0], polylines[pi][vi][1]);
        const isDrag = dragGroup.some(g => g.pi === pi && g.vi === vi);
        const isHov = hovPl === pi && hovVi === vi;
        ctx.beginPath(); ctx.arc(vp.x, vp.y, isDrag ? 6 : isHov ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isDrag ? '#C4773C' : isHov ? '#E8944A' : '#1a1a1a'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // Metrics
    const nSeg = roadResult.segments.length;
    const nJ = roadResult.nodes.filter(n => n.type === 'junction').length;
    const nE = roadResult.nodes.filter(n => n.type === 'entry').length;
    const nP = parkingSpots.length;
    metricsEl.textContent = `Seg: ${nSeg}  |  J: ${nJ}  E: ${nE}  |  Lines: ${polylines.length}  |  P: ${parkingOn ? nP : 'off'}`;
  }

  /* ── Interaction ───────────────────────────────────────────── */
  function getXY(e) { const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { sx: t.clientX - r.left, sy: t.clientY - r.top }; }

  canvas.addEventListener('mousedown', e => {
    const { sx, sy } = getXY(e);
    const hit = hitVertex(sx, sy);
    if (hit && !drawing) {
      dragGroup = findCoincident(hit.pi, hit.vi);
      canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
    }
    if (drawing) return;
    panning = true; panLX = e.clientX; panLY = e.clientY; canvas.style.cursor = 'move'; e.preventDefault();
  });

  canvas.addEventListener('mousemove', e => {
    const { sx, sy } = getXY(e);
    if (dragGroup.length) {
      const [wx, wy] = s2w(sx, sy);
      for (const g of dragGroup) polylines[g.pi][g.vi] = [wx, wy];
      recompute(); return;
    }
    if (panning) { camX -= (e.clientX - panLX) / camZoom; camY += (e.clientY - panLY) / camZoom; panLX = e.clientX; panLY = e.clientY; return; }
    const hit = hitVertex(sx, sy);
    if (hit) { hovPl = hit.pi; hovVi = hit.vi; canvas.style.cursor = 'pointer'; }
    else { hovPl = -1; hovVi = -1; canvas.style.cursor = drawing ? 'crosshair' : 'default'; }
  });

  canvas.addEventListener('mouseup', () => { if (dragGroup.length) dragGroup = []; panning = false; canvas.style.cursor = drawing ? 'crosshair' : 'default'; });
  canvas.addEventListener('mouseleave', () => { dragGroup = []; panning = false; hovPl = -1; hovVi = -1; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); camZoom = Math.max(1, Math.min(30, camZoom * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });

  canvas.addEventListener('click', e => { if (dragGroup.length || panning || !drawing) return; const { sx, sy } = getXY(e); drawPts.push(s2w(sx, sy)); });
  canvas.addEventListener('dblclick', e => {
    if (!drawing) return; e.preventDefault();
    if (drawPts.length >= 2) {
      polylines.push([...drawPts]);
      insertIntersectionVertices(polylines);
      recompute(); initDrift();
    }
    drawPts = []; drawing = false; canvas.style.cursor = 'default';
  });

  // Touch support
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

  // Keyboard
  function onKey(e) {
    if (e.key === 'd' || e.key === 'D') { if (!drawing) { drawing = true; drawPts = []; canvas.style.cursor = 'crosshair'; } }
    if (e.key === 'Escape') { if (drawing) { drawing = false; drawPts = []; canvas.style.cursor = 'default'; } }
    if (e.key === 'Enter') {
      if (drawing && drawPts.length >= 2) {
        polylines.push([...drawPts]);
        insertIntersectionVertices(polylines);
        recompute(); initDrift();
        drawPts = []; drawing = false; canvas.style.cursor = 'default';
      }
    }
    if (e.key === 'p' || e.key === 'P') { parkingOn = !parkingOn; if (parkingToggle) parkingToggle.checked = parkingOn; recompute(); }
    if (e.key === 'Backspace' && !drawing && polylines.length > 0) { polylines.pop(); recompute(); initDrift(); }
  }
  window.addEventListener('keydown', onKey);

  // Parking toggle control
  const hintEl = cell.querySelector('.pg-cell__hint');
  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'pg-ctrl';
  toggleSpan.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px';
  const parkingToggle = document.createElement('input');
  parkingToggle.type = 'checkbox'; parkingToggle.id = 'roadParkingToggle_' + Math.random().toString(36).slice(2, 6);
  parkingToggle.checked = parkingOn;
  parkingToggle.style.cssText = 'accent-color:#C4773C;cursor:pointer';
  parkingToggle.addEventListener('change', () => { parkingOn = parkingToggle.checked; recompute(); });
  const toggleLbl = document.createElement('label');
  toggleLbl.textContent = 'Parking'; toggleLbl.htmlFor = parkingToggle.id;
  toggleLbl.style.cssText = 'cursor:pointer;font-size:10px;opacity:0.7';
  toggleSpan.appendChild(parkingToggle); toggleSpan.appendChild(toggleLbl);
  if (hintEl) hintEl.appendChild(toggleSpan);

  /* ── Animation ─────────────────────────────────────────────── */
  let origPts = [], driftTargets = [];
  let driftState = 'moving', pauseTimer = 0, driftFrames = 0;
  const RECOMPUTE_EVERY = 6;

  function initDrift() {
    origPts = polylines.map(pl => pl.map(p => [...p]));
    driftTargets = polylines.map(pl => pl.map(() => [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18]));
    driftState = 'moving'; driftFrames = 0;
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  initDefaults();
  resize();
  recompute();
  initDrift();
  window.addEventListener('resize', resize);

  registerDemo(cell, () => {
    if (!dragGroup.length && !panning && !drawing) {
      if (driftState === 'paused') {
        pauseTimer += 0.016;
        if (pauseTimer >= 2.5) {
          driftState = 'moving'; driftFrames = 0;
          driftTargets = polylines.map(pl => pl.map(() => [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18]));
        }
      } else {
        let allDone = true;
        for (let pi = 0; pi < polylines.length && pi < origPts.length; pi++) {
          for (let vi = 0; vi < polylines[pi].length && vi < origPts[pi].length; vi++) {
            if (!driftTargets[pi] || !driftTargets[pi][vi]) continue;
            const tx = origPts[pi][vi][0] + driftTargets[pi][vi][0];
            const ty = origPts[pi][vi][1] + driftTargets[pi][vi][1];
            polylines[pi][vi][0] += (tx - polylines[pi][vi][0]) * 0.03;
            polylines[pi][vi][1] += (ty - polylines[pi][vi][1]) * 0.03;
            if (Math.abs(polylines[pi][vi][0] - tx) > 0.3 || Math.abs(polylines[pi][vi][1] - ty) > 0.3) allDone = false;
          }
        }
        driftFrames++;
        if (driftFrames % RECOMPUTE_EVERY === 0) recompute();
        if (allDone) { driftState = 'paused'; pauseTimer = 0; recompute(); }
      }
    }
    draw();
  });
}
