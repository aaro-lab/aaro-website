/**
 * Road demo — road generation pipeline.
 * Split → Graph → Chain → Smooth → Offset → Union → Fillet → Sidewalk.
 */
import {
  dist, sub, norm, segIntersect, closestOnSeg, chaikin,
  filletPolyline, filletConvex, filletReflex, offsetPolyline,
  toRing, multiPolyToRings, disc, genArrows
} from './geometry.js';

/* ── Vertex key for graph (round to 0.1m) ─────────────────────── */
const vk = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
const COINCIDENCE_THRESH = 0.5;

/* ── Split polylines at intersections → sub-segments ──────────── */
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
  // Segment–segment intersections
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].pi === segs[j].pi && Math.abs(segs[i].si - segs[j].si) <= 1) continue;
      const pt = segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (!pt) continue;
      const di = dist(segs[i].a, pt) / dist(segs[i].a, segs[i].b);
      const dj = dist(segs[j].a, pt) / dist(segs[j].a, segs[j].b);
      if (di > 0.001 && di < 0.999) splitPts[segs[i].pi].get(segs[i].si).push({ t: di, pt: [...pt] });
      if (dj > 0.001 && dj < 0.999) splitPts[segs[j].pi].get(segs[j].si).push({ t: dj, pt: [...pt] });
    }
  }
  // Endpoint-on-edge
  for (let pi = 0; pi < polylines.length; pi++) {
    const pts = polylines[pi];
    for (const ep of [pts[0], pts[pts.length - 1]]) {
      for (let pj = 0; pj < polylines.length; pj++) {
        if (pi === pj) continue;
        for (let si = 0; si < polylines[pj].length - 1; si++) {
          const { pt, t } = closestOnSeg(ep, polylines[pj][si], polylines[pj][si + 1]);
          if (dist(ep, pt) < COINCIDENCE_THRESH && t > 0.01 && t < 0.99)
            splitPts[pj].get(si).push({ t, pt: [...ep] });
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
      if (dist(all[i], all[i + 1]) > 0.1) result.push([all[i], all[i + 1]]);
  }
  return result;
}

/* ── Build vertex graph ───────────────────────────────────────── */
function buildGraph(subSegs) {
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
  for (const [key, nb] of adj) {
    if (nb.size >= 3) junctionKeys.add(key);
    else if (nb.size === 1) entryKeys.add(key);
  }
  const nodeKeys = new Set([...junctionKeys, ...entryKeys]);
  const nodes = [], nodeKeyList = [];
  for (const key of nodeKeys) {
    const pos = posMap.get(key); if (!pos) continue;
    nodes.push({ position: pos, type: junctionKeys.has(key) ? 'junction' : 'entry' });
    nodeKeyList.push(key);
  }
  return { adj, posMap, nodeKeys, nodes, nodeKeyList };
}

/* ── Trace chains (node → node through degree-2 vertices) ─────── */
function traceChains(adj, posMap, nodeKeys, nodeKeyList) {
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
        visited.add(prev < curr ? prev + '>' + curr : curr + '>' + prev);
        pts.push(posMap.get(curr));
        if (nodeKeys.has(curr)) break;
        const cn = adj.get(curr); if (!cn) break;
        let next = ''; for (const nb of cn) { if (nb !== prev) { next = nb; break; } }
        if (!next) break; prev = curr; curr = next;
      }
      if (pts.length >= 2) chains.push({ pts, startNode: ni, endNode: nodeKeyList.indexOf(curr) });
    }
  }
  return chains;
}

/* ── Smooth + offset chains into road segments ────────────────── */
function buildSegments(chains, nodes, halfW, turningRadius, chaikinIter) {
  const segments = [];
  for (const chain of chains) {
    let cl = chain.pts;
    if (turningRadius > 0 && cl.length >= 3) cl = filletPolyline(cl, turningRadius);
    else if (chaikinIter > 0 && cl.length >= 3) cl = chaikin(cl, chaikinIter);
    // Dedup
    const dd = [cl[0]];
    for (let i = 1; i < cl.length; i++) if (dist(cl[i], dd[dd.length - 1]) > 0.05) dd.push(cl[i]);
    cl = dd; if (cl.length < 2) continue;
    const { left, right } = offsetPolyline(cl, halfW);
    if (left.length < 2 || right.length < 2) continue;
    const strip = [...left, ...[...right].reverse()];
    const sni = chain.startNode >= 0 && chain.startNode < nodes.length ? nodes[chain.startNode] : null;
    const eni = chain.endNode >= 0 && chain.endNode < nodes.length ? nodes[chain.endNode] : null;
    segments.push({ centerline: cl, leftEdge: left, rightEdge: right, strip,
      startIsJunction: sni?.type === 'junction', endIsJunction: eni?.type === 'junction' });
  }
  return segments;
}

/* ── Compute union outline + fillet ───────────────────────────── */
function computeOutline(segments, junctionDiscs, cornerRadius, PC) {
  if (!PC) return { outline: null, filletOutline: null };
  try {
    const allStrips = [...segments.map(s => s.strip), ...junctionDiscs];
    if (!allStrips.length) return { outline: null, filletOutline: null };
    let result = [[toRing(allStrips[0])]];
    for (let i = 1; i < allStrips.length; i++) {
      try { result = PC.union(result, [[toRing(allStrips[i])]]); } catch { /* skip */ }
    }
    const outline = multiPolyToRings(result);
    const filletOutline = cornerRadius > 0
      ? outline.map(r => filletReflex(r, cornerRadius)).map(r => filletConvex(r, cornerRadius))
      : outline;
    return { outline, filletOutline };
  } catch { return { outline: null, filletOutline: null }; }
}

/* ── Compute sidewalk band (row − road) ───────────────────────── */
function computeSidewalk(segments, nodes, halfW, sidewalkWidth, filletOutline, PC) {
  if (!PC || sidewalkWidth <= 0 || !filletOutline) return null;
  try {
    const widerStrips = [
      ...segments.map(seg => {
        const { left, right } = offsetPolyline(seg.centerline, halfW + sidewalkWidth);
        return [...left, ...[...right].reverse()];
      }),
      ...nodes.filter(n => n.type === 'junction').map(n => disc(n.position, halfW + sidewalkWidth + 0.05))
    ];
    let rowResult = [[toRing(widerStrips[0])]];
    for (let i = 1; i < widerStrips.length; i++) {
      try { rowResult = PC.union(rowResult, [[toRing(widerStrips[i])]]); } catch { /* skip */ }
    }
    const roadGeom = filletOutline.map(r => [toRing(r)]);
    const diff = PC.difference(rowResult, roadGeom);
    return multiPolyToRings(diff);
  } catch { return null; }
}

/* ══ Main pipeline ═══════════════════════════════════════════════ */
export function generateRoads(polylines, cfg) {
  const { roadWidth, chaikinIter, turningRadius, cornerRadius, sidewalkWidth, PC } = cfg;
  const empty = { segments: [], nodes: [], outline: null, filletOutline: null, sidewalkOutline: null, arrows: [] };
  if (!polylines.length) return empty;
  const halfW = roadWidth / 2;

  const subSegs = splitAtIntersections(polylines);
  if (!subSegs.length) return empty;

  const { adj, posMap, nodeKeys, nodes, nodeKeyList } = buildGraph(subSegs);
  const chains = traceChains(adj, posMap, nodeKeys, nodeKeyList);
  const segments = buildSegments(chains, nodes, halfW, turningRadius, chaikinIter);

  // Junction disc patches (fill micro-gaps at meeting points)
  const junctionDiscs = nodes
    .filter(n => n.type === 'junction')
    .map(n => disc(n.position, halfW + 0.05));

  // Direction arrows
  let arrows = [];
  for (const seg of segments) arrows = arrows.concat(genArrows(seg.centerline, roadWidth));

  // Union + fillet
  const { outline, filletOutline } = computeOutline(segments, junctionDiscs, cornerRadius, PC);

  // Sidewalk
  const sidewalkOutline = computeSidewalk(segments, nodes, halfW, sidewalkWidth, filletOutline, PC);

  return { segments, nodes, outline, filletOutline, sidewalkOutline, arrows };
}
