/**
 * Road demo — road generation pipeline.
 * Split → Graph → Chain → Smooth → Offset → Union → Fillet → Sidewalk.
 * Ported from road-generator.ts (upstream TypeScript source).
 */
import {
  dist, sub, norm, segIntersect, closestOnSeg, chaikin,
  filletPolyline, filletPolygon, filletReflexCorners, offsetPolyline,
  toRing, simplifyRing, multiPolyToRings, ringsToGeom, ringSignedArea,
  disc, genArrows
} from './geometry.js';

import { generateEdgeParking, resolveParkingCollisions } from './parking.js';

/* ── Vertex key for graph (round to 0.1m) ─────────────────────── */
const vk = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
const COINCIDENCE_THRESH = 0.5;

/** Inflation radius (metres) applied to parking-pocket cutter rectangles
 *  before polygon-clipping difference. See inflatedSpotRing for rationale. */
const PARKING_CUTTER_INFLATE = 0.05;

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
      if (pts.length >= 2) chains.push({ pts, startNodeIdx: ni, endNodeIdx: nodeKeyList.indexOf(curr) });
    }
  }
  return chains;
}

/* ── Fix self-intersecting strips via union-with-self ──────────── */
function sanitizeStrip(strip, PC) {
  if (!PC || strip.length < 3) return strip;
  try {
    const ring = toRing(strip);
    const fixed = PC.union([[ring]]);
    if (fixed.length > 0 && fixed[0][0].length >= 4)
      return fixed[0][0].slice(0, -1).map(p => [p[0], p[1]]);
  } catch { /* use original */ }
  return strip;
}

/** Union all strips into a MultiPolygon with retry logic.
 *  When a strip fails, park it and retry once more after all other
 *  strips have been accumulated. If the retry also fails, append the
 *  strip as a separate polygon so the road is still visible. */
function unionStrips(strips, PC) {
  if (!strips.length) return null;
  let result = [[toRing(strips[0])]];
  const failed = [];
  for (let i = 1; i < strips.length; i++) {
    const poly = [toRing(strips[i])];
    try {
      result = PC.union(result, [poly]);
    } catch {
      failed.push(poly);
    }
  }
  // Retry failed strips against the (now larger) accumulated result.
  for (const poly of failed) {
    try {
      result = PC.union(result, [poly]);
    } catch {
      // Last resort: include as a separate polygon so the road is at least drawn.
      result.push(poly);
    }
  }
  return result;
}

/** Build a closed polygon ring for a parking spot inflated outward from
 *  its center by `inflate` metres along each corner's radial direction.
 *  Used to cut parking pockets into the road outline. Inflating the
 *  cutter rectangle closes the sliver between the drawn spot and the
 *  cut notch without changing the visible layout. */
function inflatedSpotRing(corners, center, inflate) {
  const expand = p => {
    const dx = p[0] - center[0], dy = p[1] - center[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) return [p[0], p[1]];
    const k = (L + inflate) / L;
    return [center[0] + dx * k, center[1] + dy * k];
  };
  const p0 = expand(corners[0]);
  const p1 = expand(corners[1]);
  const p2 = expand(corners[2]);
  const p3 = expand(corners[3]);
  return [p0, p1, p2, p3, p0];
}

/**
 * Outward Minkowski sum of a polygon (set of rings) with a disc of given
 * radius. Used to compute the road + sidewalk band by offsetting the road
 * outline outward by `sidewalkWidth`. Handles outers (grow) and holes
 * (small holes unchanged; large holes eroded via intersection-of-translates).
 */
function offsetPolygonOutward(rings, radius, PC, sides = 64) {
  if (radius <= 0 || rings.length === 0) return rings;

  const outers = [], holes = [];
  for (const r of rings) {
    if (ringSignedArea(r) >= 0) outers.push(r);
    else holes.push(r);
  }
  if (outers.length === 0) return rings;

  // --- Step 1: grow the outers (Minkowski SUM with disc) ---
  let grown = outers.map(r => [toRing(r)]);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const dx = Math.cos(a) * radius;
    const dy = Math.sin(a) * radius;
    const translated = outers.map(r => [
      r.map(p => [p[0] + dx, p[1] + dy]),
    ]);
    try {
      grown = PC.union(grown, translated);
    } catch {
      continue;
    }
  }

  // --- Step 2: process each hole ---
  // Small holes (min dimension ≤ 4×radius): keep unchanged — sidewalk does
  // not intrude into them. Large holes: erode via intersection-of-translates
  // (Minkowski erosion) so the sidewalk band wraps inside them too.
  const shrunkHoles = [];
  for (const hole of holes) {
    const ccwHole = [...hole];
    if (ringSignedArea(ccwHole) < 0) ccwHole.reverse();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of ccwHole) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    const minDim = Math.min(maxX - minX, maxY - minY);
    const shouldErode = minDim > radius * 4;
    if (!shouldErode) {
      shrunkHoles.push([[toRing(ccwHole)]]);
      continue;
    }
    // Minkowski erosion via intersection-of-translates.
    let accum = [[toRing(ccwHole)]];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const dx = Math.cos(a) * radius;
      const dy = Math.sin(a) * radius;
      const translated = [[
        toRing(ccwHole).map(p => [p[0] - dx, p[1] - dy]),
      ]];
      try {
        accum = PC.intersection(accum, translated);
      } catch {
        continue;
      }
      if (accum.length === 0) break;
    }
    if (accum.length > 0) {
      shrunkHoles.push(accum);
    }
  }

  // --- Step 3: subtract (possibly eroded) holes from grown outers ---
  let result = grown;
  for (const sh of shrunkHoles) {
    try {
      result = PC.difference(result, sh);
    } catch {
      continue;
    }
  }

  return multiPolyToRings(result);
}

/** Union all road segment strips into a single outline, then apply fillet */
function computeUnionAndFillet(segments, cornerRadius, junctionPatches, PC) {
  if (!PC || segments.length === 0) return { unionOutline: null, filletOutline: null };

  const allStrips = [
    ...segments.map(s => s.strip),
    ...(junctionPatches || []),
  ].filter(s => s.length >= 3);

  if (!allStrips.length) return { unionOutline: null, filletOutline: null };

  try {
    const result = unionStrips(allStrips, PC);
    if (!result) return { unionOutline: null, filletOutline: null };

    const unionOutline = multiPolyToRings(result);
    if (!unionOutline.length) return { unionOutline: null, filletOutline: null };

    // Two passes: first round reflex armpit corners (curb-return radius at
    // intersections), then round any remaining convex corners.
    const filletOutline = cornerRadius > 0
      ? unionOutline
          .map(ring => { try { return filletReflexCorners(ring, cornerRadius); } catch { return ring; } })
          .map(ring => { try { return filletPolygon(ring, cornerRadius); } catch { return ring; } })
      : unionOutline;

    return { unionOutline, filletOutline };
  } catch {
    return { unionOutline: null, filletOutline: null };
  }
}

/**
 * Compute combined right-of-way (road + sidewalks) outline and sidewalk-only
 * outline using Minkowski offsetting.
 *   row = offsetPolygonOutward(road, sidewalkWidth)
 *   sidewalk = row − road
 */
function computeSidewalkOutlines(segments, cornerRadius, sidewalkWidth, roadFilletOutline, capClips, PC) {
  if (!PC || segments.length === 0 || sidewalkWidth <= 0 || !roadFilletOutline) {
    return { rowOutline: null, rowFilletOutline: null, sidewalkOutline: null };
  }

  try {
    // The right-of-way is the road outline expanded outward by sidewalkWidth.
    let rowOutline = offsetPolygonOutward(roadFilletOutline, sidewalkWidth, PC);
    if (!rowOutline.length) {
      return { rowOutline: null, rowFilletOutline: null, sidewalkOutline: null };
    }

    // Cut the row band flush at every dead-end cap so the sidewalk does NOT
    // wrap around the entry as a half-circle.
    if (capClips && capClips.length > 0) {
      try {
        const rowGeom = ringsToGeom(rowOutline);
        const clipsGeom = capClips.map(r => [toRing(r)]);
        const diff = PC.difference(rowGeom, clipsGeom);
        rowOutline = multiPolyToRings(diff);
      } catch {
        // Keep un-clipped row on numerical failure
      }
    }

    // Apply fillet to hole rings in the row outline (eroded holes carry
    // polygonal corners that need rounding to match curb arcs).
    const rowFilletOutline = cornerRadius > 0
      ? rowOutline.map(ring => { try { return filletReflexCorners(ring, cornerRadius); } catch { return ring; } })
      : rowOutline;

    // Sidewalk = row − road
    let sidewalkOutline = null;
    try {
      const rowForDiff = ringsToGeom(rowOutline);
      const roadForDiff = ringsToGeom(roadFilletOutline);
      const diff = PC.difference(rowForDiff, roadForDiff);
      sidewalkOutline = multiPolyToRings(diff);
    } catch {
      sidewalkOutline = null;
    }

    return { rowOutline, rowFilletOutline, sidewalkOutline };
  } catch {
    return { rowOutline: null, rowFilletOutline: null, sidewalkOutline: null };
  }
}

/**
 * Explode a closed polyline (ABCDA) into per-edge sub-polylines with
 * extension on both ends. Non-closed polylines pass through unchanged.
 */
function explodeClosedLoops(polylines, extendLen = 10) {
  const out = [];
  for (const pts of polylines) {
    const n = pts.length;
    const isClosed = n >= 4 && dist(pts[0], pts[n - 1]) < 0.5;
    if (!isClosed) {
      out.push(pts);
      continue;
    }
    // Unique vertices (drop the duplicated closing point).
    const uniq = pts.slice(0, n - 1);
    const k = uniq.length;
    for (let i = 0; i < k; i++) {
      const a = uniq[i];
      const b = uniq[(i + 1) % k];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const ux = dx / L, uy = dy / L;
      const newA = [a[0] - ux * extendLen, a[1] - uy * extendLen];
      const newB = [b[0] + ux * extendLen, b[1] + uy * extendLen];
      out.push([newA, newB]);
    }
  }
  return out;
}

/* ── Compute polyline arc length ──────────────────────────────── */
function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/* ── Fallback: generate simple roads for the no-intersection case ─ */
function generateSimpleRoads(polylines, cfg) {
  const { roadWidth, chaikinIter, turningRadius, cornerRadius, sidewalkWidth,
    edgeParking, parkingFillPct, spotWidth, spotDepth, junctionSetback, PC } = cfg;
  const halfW = roadWidth / 2;
  const halfRow = halfW + sidewalkWidth;
  const nodes = [], segments = [];

  for (const pts of polylines) {
    if (pts.length < 2) continue;
    const smoothed = turningRadius > 0 && pts.length >= 3
      ? filletPolyline(pts, turningRadius)
      : chaikinIter > 0 && pts.length >= 3
        ? chaikin(pts, chaikinIter)
        : pts.map(p => [...p]);

    const { left, right } = offsetPolyline(smoothed, halfW);
    const strip = [...left, ...[...right].reverse()];

    let rowLeft = left, rowRight = right;
    if (sidewalkWidth > 0) {
      const row = offsetPolyline(smoothed, halfRow);
      if (row.left.length >= 2 && row.right.length >= 2) {
        rowLeft = row.left;
        rowRight = row.right;
      }
    }

    segments.push({
      centerline: smoothed, leftEdge: left, rightEdge: right, strip,
      startIsJunction: false, endIsJunction: false,
    });

    const startPt = pts[0];
    const endPt = pts[pts.length - 1];
    if (!nodes.some(n => dist(n.position, startPt) < 0.5))
      nodes.push({ position: startPt, type: 'entry' });
    if (!nodes.some(n => dist(n.position, endPt) < 0.5))
      nodes.push({ position: endPt, type: 'entry' });
  }

  const { unionOutline, filletOutline } = computeUnionAndFillet(segments, cornerRadius, [], PC);
  const { rowOutline, rowFilletOutline, sidewalkOutline } =
    computeSidewalkOutlines(segments, cornerRadius, sidewalkWidth, filletOutline, [], PC);

  let parkingSpots = [];
  let finalFilletOutline = filletOutline;
  let finalRowFilletOutline = rowFilletOutline;
  let finalSidewalkOutline = sidewalkOutline;

  if (edgeParking && segments.length > 0 && PC) {
    const startFlags = segments.map(() => false);
    const endFlags = segments.map(() => false);
    const effectiveSetback = Math.max(junctionSetback || 5, cornerRadius + 0.5);
    parkingSpots = generateEdgeParking(segments, startFlags, endFlags, {
      spotWidth: spotWidth || 2.5,
      spotDepth: spotDepth || 5.0,
      fillPercent: parkingFillPct != null ? parkingFillPct : 100,
      junctionSetback: effectiveSetback,
    });
    parkingSpots = resolveParkingCollisions(parkingSpots, filletOutline);

    if (parkingSpots.length > 0 && filletOutline) {
      const spotRings = parkingSpots.map(s => inflatedSpotRing(s.corners, s.center, PARKING_CUTTER_INFLATE));
      const spotsGeom = spotRings.map(r => [toRing(r)]);
      try {
        const roadGeom = ringsToGeom(filletOutline);
        finalFilletOutline = multiPolyToRings(PC.difference(roadGeom, spotsGeom));
      } catch (e) {
        console.warn('[parking] road difference failed, keeping original outline', e);
      }
      if (rowFilletOutline) {
        try {
          const rowGeom = ringsToGeom(rowFilletOutline);
          finalRowFilletOutline = multiPolyToRings(PC.union(rowGeom, spotsGeom));
        } catch (e) {
          console.warn('[parking] row union failed, keeping original outline', e);
        }
      }
      if (finalRowFilletOutline && finalFilletOutline) {
        try {
          const rowG = ringsToGeom(finalRowFilletOutline);
          const roadG = ringsToGeom(finalFilletOutline);
          finalSidewalkOutline = multiPolyToRings(PC.difference(rowG, roadG));
        } catch (e) {
          console.warn('[parking] sidewalk recompute failed', e);
        }
      }
    }
  }

  return {
    segments, nodes,
    outline: unionOutline, filletOutline: finalFilletOutline,
    sidewalkOutline: finalSidewalkOutline,
    arrows: segments.flatMap(s => genArrows(s.centerline, roadWidth)),
    parkingSpots,
  };
}

/* ══ Main pipeline ═══════════════════════════════════════════════ */
export function generateRoads(polylines, cfg) {
  const {
    roadWidth, chaikinIter, turningRadius, cornerRadius, sidewalkWidth, PC,
    edgeParking, parkingFillPct, spotWidth, spotDepth, junctionSetback,
  } = cfg;

  const empty = {
    segments: [], nodes: [], outline: null, filletOutline: null,
    sidewalkOutline: null, arrows: [], parkingSpots: [],
  };
  if (!polylines.length) return empty;
  const halfW = roadWidth / 2;
  const halfRow = halfW + (sidewalkWidth || 0);

  // Explode closed loops into per-edge sub-polylines with extension stubs.
  const exploded = explodeClosedLoops(polylines, 10);

  const subSegs = splitAtIntersections(exploded);
  if (!subSegs.length) {
    return generateSimpleRoads(exploded, cfg);
  }

  const { adj, posMap, nodeKeys, nodes, nodeKeyList } = buildGraph(subSegs);
  const chains = traceChains(adj, posMap, nodeKeys, nodeKeyList);

  // Build segments from chains (threshold 0.05 m — only filter degenerate chains)
  const segments = [];
  for (const chain of chains) {
    let chainLen = 0;
    for (let i = 0; i < chain.pts.length - 1; i++)
      chainLen += dist(chain.pts[i], chain.pts[i + 1]);
    if (chainLen < 0.05) continue;

    let cl;
    if (turningRadius > 0 && chain.pts.length >= 3) {
      cl = filletPolyline(chain.pts, turningRadius);
    } else if (chaikinIter > 0 && chain.pts.length >= 3) {
      cl = chaikin(chain.pts, chaikinIter);
    } else {
      cl = chain.pts.map(p => [...p]);
    }

    // Dedup
    const deduped = [cl[0]];
    for (let i = 1; i < cl.length; i++)
      if (dist(cl[i], deduped[deduped.length - 1]) > 0.05) deduped.push(cl[i]);
    cl = deduped;
    if (cl.length < 2) continue;

    const { left, right } = offsetPolyline(cl, halfW);
    if (left.length < 2 || right.length < 2) continue;
    const strip = [...left, ...[...right].reverse()];

    const sni = chain.startNodeIdx >= 0 && chain.startNodeIdx < nodes.length ? nodes[chain.startNodeIdx] : null;
    const eni = chain.endNodeIdx >= 0 && chain.endNodeIdx < nodes.length ? nodes[chain.endNodeIdx] : null;

    segments.push({
      centerline: cl, leftEdge: left, rightEdge: right, strip,
      startIsJunction: sni?.type === 'junction',
      endIsJunction: eni?.type === 'junction',
    });
  }

  // Junction disc patches — safety net for precision gaps at meeting points
  const junctionRoadStrips = [];
  const junctionDiscFudge = 0.05;
  for (const node of nodes) {
    if (node.type !== 'junction') continue;
    junctionRoadStrips.push(disc(node.position, halfW + junctionDiscFudge));
  }

  // Direction arrows
  const arrows = segments.flatMap(s => genArrows(s.centerline, roadWidth));

  // 6. Union + fillet
  const { unionOutline, filletOutline } = computeUnionAndFillet(segments, cornerRadius, junctionRoadStrips, PC);

  // 7. Build cap clip rectangles at every ENTRY node so the sidewalk band
  //    gets cut flush with the road's perpendicular cap.
  const capClips = [];
  if (sidewalkWidth > 0) {
    const margin = Math.max(sidewalkWidth * 0.5, 0.2);
    const halfWidth = halfRow + margin;
    const outDepth = sidewalkWidth + margin;
    const inDepth = 0.05; // tiny inset toward the road
    for (const seg of segments) {
      const cl = seg.centerline;
      if (cl.length < 2) continue;
      const buildClip = (e, outX, outY) => {
        const px = -outY, py = outX;
        const inner = [e[0] - outX * inDepth, e[1] - outY * inDepth];
        const outer = [e[0] + outX * outDepth, e[1] + outY * outDepth];
        capClips.push([
          [inner[0] + px * halfWidth, inner[1] + py * halfWidth],
          [outer[0] + px * halfWidth, outer[1] + py * halfWidth],
          [outer[0] - px * halfWidth, outer[1] - py * halfWidth],
          [inner[0] - px * halfWidth, inner[1] - py * halfWidth],
          [inner[0] + px * halfWidth, inner[1] + py * halfWidth],
        ]);
      };
      // START endpoint
      const startIdx = nodes.findIndex(n => dist(n.position, cl[0]) < 0.5);
      const startIsEntry = startIdx >= 0 && nodes[startIdx].type === 'entry';
      if (startIsEntry) {
        const dx = cl[0][0] - cl[1][0], dy = cl[0][1] - cl[1][1];
        const L = Math.hypot(dx, dy);
        if (L > 1e-6) buildClip(cl[0], dx / L, dy / L);
      }
      // END endpoint
      const last = cl[cl.length - 1];
      const endIdx = nodes.findIndex(n => dist(n.position, last) < 0.5);
      const endIsEntry = endIdx >= 0 && nodes[endIdx].type === 'entry';
      if (endIsEntry) {
        const prev = cl[cl.length - 2];
        const dx = last[0] - prev[0], dy = last[1] - prev[1];
        const L = Math.hypot(dx, dy);
        if (L > 1e-6) buildClip(last, dx / L, dy / L);
      }
    }
  }

  // 8. Sidewalk = uniform-width band wrapping the (filleted) road outline
  const { rowOutline, rowFilletOutline, sidewalkOutline } =
    computeSidewalkOutlines(segments, cornerRadius, sidewalkWidth || 0, filletOutline, capClips, PC);

  // 9. Edge parking — pocket parking carved into the road's edge
  let parkingSpots = [];
  let finalFilletOutline = filletOutline;
  let finalRowFilletOutline = rowFilletOutline;
  let finalSidewalkOutline = sidewalkOutline;

  if (edgeParking && segments.length > 0 && PC) {
    const startFlags = chains.map(ch => nodes[ch.startNodeIdx]?.type === 'junction');
    const endFlags = chains.map(ch => nodes[ch.endNodeIdx]?.type === 'junction');
    const effectiveSetback = Math.max(junctionSetback || 5, cornerRadius + 0.5);
    parkingSpots = generateEdgeParking(segments, startFlags, endFlags, {
      spotWidth: spotWidth || 2.5,
      spotDepth: spotDepth || 5.0,
      fillPercent: parkingFillPct != null ? parkingFillPct : 100,
      junctionSetback: effectiveSetback,
    });
    parkingSpots = resolveParkingCollisions(parkingSpots, filletOutline);

    if (parkingSpots.length > 0 && filletOutline) {
      const spotRings = parkingSpots.map(s => inflatedSpotRing(s.corners, s.center, PARKING_CUTTER_INFLATE));
      const spotsGeom = spotRings.map(r => [toRing(r)]);
      // Subtract pockets from road outline
      try {
        const roadGeom = ringsToGeom(filletOutline);
        const cut = PC.difference(roadGeom, spotsGeom);
        finalFilletOutline = multiPolyToRings(cut);
      } catch (e) {
        console.warn('[parking] road difference failed, keeping original outline', e);
      }
      // Union pockets into the right-of-way outline
      if (rowFilletOutline) {
        try {
          const rowGeom = ringsToGeom(rowFilletOutline);
          const merged = PC.union(rowGeom, spotsGeom);
          finalRowFilletOutline = multiPolyToRings(merged);
        } catch (e) {
          console.warn('[parking] row union failed, keeping original outline', e);
        }
      }
      // Sidewalk-only = (row+pockets) − (road−pockets)
      if (finalRowFilletOutline && finalFilletOutline) {
        try {
          const rowG = ringsToGeom(finalRowFilletOutline);
          const roadG = ringsToGeom(finalFilletOutline);
          const sw = PC.difference(rowG, roadG);
          finalSidewalkOutline = multiPolyToRings(sw);
        } catch (e) {
          console.warn('[parking] sidewalk recompute failed', e);
        }
      }
    }
  }

  return {
    segments, nodes,
    outline: unionOutline,
    filletOutline: finalFilletOutline,
    sidewalkOutline: finalSidewalkOutline,
    arrows,
    parkingSpots,
  };
}
