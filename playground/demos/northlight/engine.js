/**
 * Northlight regulation engine — pure algorithm module.
 * No DOM, no rendering. All geometry in plan-view [x, y] metres.
 * Coordinate convention:  +x = east,  +y = north.
 * 3-D output uses (x, h, -y) so that Three.js +Z faces the viewer.
 *
 * Requires polygon-clipping (PC) to be injected by the caller.
 * Usage:
 *   import { generateVolume, DEFAULT_PARAMS } from './engine.js';
 *   const result = generateVolume(vertices, params, PC);
 */

/* ── Default parameters ──────────────────────────────────────────── */
export const DEFAULT_PARAMS = {
  northEnabled:        true,
  baseHeight:          9,      // metres — top of base zone
  belowBaseSetback:    1.5,    // metres — flat setback below base height
  aboveBaseRatio:      0.5,    // ratio of height → setback above base
  northAngleTolerance: 45,     // degrees either side of north
  interpretationMode:  'discontinuous', // 'continuous' | 'discontinuous'
  maxHeight:           25,     // metres
  floorHeight:         3,      // metres per storey
};

/* ── Vec2 helpers ────────────────────────────────────────────────── */
const len2  = v  => Math.hypot(v[0], v[1]);
const norm2 = v  => { const l = len2(v); return l < 1e-9 ? [0, 0] : [v[0] / l, v[1] / l]; };
const dot2  = (a, b) => a[0] * b[0] + a[1] * b[1];

/* ── Polygon helpers ─────────────────────────────────────────────── */

/**
 * Unsigned polygon area via the shoelace formula.
 * @param {number[][]} pts  Array of [x, y] vertices (open ring).
 * @returns {number} Area in square metres.
 */
export function polygonArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

/**
 * Centroid of a polygon.
 * @param {number[][]} pts  Open ring vertices.
 * @returns {number[]}  [cx, cy]
 */
export function polygonCentroid(pts) {
  let cx = 0, cy = 0, area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    cx += (pts[i][0] + pts[j][0]) * cross;
    cy += (pts[i][1] + pts[j][1]) * cross;
    area += cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Fallback: simple average
    const sx = pts.reduce((s, p) => s + p[0], 0) / n;
    const sy = pts.reduce((s, p) => s + p[1], 0) / n;
    return [sx, sy];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Ensure polygon vertices are in counter-clockwise order.
 * @param {number[][]} vertices  Open ring.
 * @returns {number[][]}  CCW open ring.
 */
export function ensureCCW(vertices) {
  let a = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += vertices[i][0] * vertices[j][1] - vertices[j][0] * vertices[i][1];
  }
  // Signed area > 0 → already CCW; < 0 → CW, reverse
  return a >= 0 ? vertices.slice() : vertices.slice().reverse();
}

/* ── Edge analysis ───────────────────────────────────────────────── */

/**
 * @typedef {Object} EdgeProfile
 * @property {number}  edgeIndex       Index of first vertex of this edge.
 * @property {number}  azimuth         Outward-normal azimuth in degrees [0, 360).
 * @property {boolean} isNorthFacing   True when azimuth is within tolerance of north.
 * @property {number}  setbackDistance Setback that this edge contributes (base-height value).
 */

/**
 * Compute edge profiles for every edge of the site polygon.
 * @param {number[][]} vertices  CCW open ring.
 * @param {object}     params    Merged parameters.
 * @returns {EdgeProfile[]}
 */
export function computeEdgeProfiles(vertices, params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const centroid = polygonCentroid(vertices);
  const n = vertices.length;
  const profiles = [];

  for (let i = 0; i < n; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];

    // Outward normal (rotated 90° to the right of the edge direction for CCW rings)
    let nx = -dy, ny = dx;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) { profiles.push({ edgeIndex: i, azimuth: 0, isNorthFacing: false, setbackDistance: 0 }); continue; }
    nx /= nl; ny /= nl;

    // Flip normal if it points toward the centroid
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    const toCentX = centroid[0] - midX;
    const toCentY = centroid[1] - midY;
    if (nx * toCentX + ny * toCentY > 0) { nx = -nx; ny = -ny; }

    // Azimuth: angle from north (+y), measured clockwise → atan2(nx, ny)
    let azimuth = Math.atan2(nx, ny) * (180 / Math.PI);
    if (azimuth < 0) azimuth += 360;

    // North-facing: within tolerance of 0°/360°
    const distFromNorth = Math.min(azimuth, 360 - azimuth);
    const isNorthFacing = p.northEnabled && distFromNorth <= p.northAngleTolerance;

    // Setback at base height (representative single value stored on profile)
    const setbackDistance = isNorthFacing ? p.belowBaseSetback : 0;

    profiles.push({ edgeIndex: i, azimuth, isNorthFacing, setbackDistance });
  }
  return profiles;
}

/* ── Setback calculation ─────────────────────────────────────────── */

/**
 * Compute the required setback at a given height for a north-facing edge.
 * Non-north-facing edges always return 0.
 */
function setbackAtHeight(h, p) {
  const { baseHeight, belowBaseSetback, aboveBaseRatio, interpretationMode } = p;
  if (h <= baseHeight) return belowBaseSetback;
  if (interpretationMode === 'discontinuous') return h * aboveBaseRatio;
  // continuous: linear ramp from belowBaseSetback at baseHeight
  return belowBaseSetback + (h - baseHeight) * aboveBaseRatio;
}

/* ── Polygon clipping helpers ────────────────────────────────────── */

/**
 * Close a ring (append first point if not already closed).
 */
function closeRing(ring) {
  if (ring.length < 2) return ring;
  const first = ring[0], last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-10 && Math.abs(first[1] - last[1]) < 1e-10) return ring;
  return [...ring, [first[0], first[1]]];
}

/**
 * Intersect two polygons using the polygon-clipping library.
 * Returns the vertices (open ring) of the largest resulting polygon,
 * or null if the intersection is empty.
 * @param {number[][]} a   Open ring.
 * @param {number[][]} b   Open ring.
 * @param {object}     PC  polygon-clipping library instance.
 * @returns {number[][]|null}
 */
function intersectPolygons(a, b, PC) {
  const ringA = closeRing(a);
  const ringB = closeRing(b);
  let result;
  try {
    result = PC.intersection([ringA], [ringB]);
  } catch (_) {
    return null;
  }
  if (!result || result.length === 0) return null;

  // Pick the largest polygon (outer ring only)
  let best = null, bestArea = 0;
  for (const polygon of result) {
    if (!polygon || !polygon[0] || polygon[0].length < 3) continue;
    const outer = polygon[0].map(pt => [pt[0], pt[1]]);
    const area = polygonArea(outer);
    if (area > bestArea) { bestArea = area; best = outer; }
  }
  return best;
}

/* ── Buildable polygon at height h ──────────────────────────────── */

/**
 * Compute the buildable polygon at a given height by applying northward
 * setbacks and intersecting with the original site boundary.
 *
 * Strategy: translate the entire polygon southward by the setback amount
 * (only the north-facing edges drive the offset in this simplified model),
 * then intersect with the original boundary.
 *
 * @param {number[][]}  vertices  CCW open ring of site boundary.
 * @param {number}      h         Height in metres.
 * @param {EdgeProfile[]} profiles Pre-computed edge profiles.
 * @param {object}      p         Merged parameters.
 * @param {object}      PC        polygon-clipping instance.
 * @returns {number[][]|null}  Open ring or null.
 */
function buildablePolygonAtHeight(vertices, h, profiles, p, PC) {
  const hasNorth = profiles.some(e => e.isNorthFacing);
  if (!hasNorth || !p.northEnabled) return vertices;

  const setback = setbackAtHeight(h, p);
  // Translate entire polygon southward (−y) by setback
  const translated = vertices.map(v => [v[0], v[1] - setback]);
  return intersectPolygons(translated, vertices, PC);
}

/* ── Nearest-neighbour vertex connections ────────────────────────── */

/**
 * Connect each vertex of polyA to the nearest vertex of polyB.
 * Returns array of line segments [ [ax, hA, -ay], [bx, hB, -by] ].
 */
function connectFloors(polyA, hA, polyB, hB) {
  const lines = [];
  const usedB = new Set();

  for (const a of polyA) {
    let bestIdx = 0, bestDist = Infinity;
    for (let j = 0; j < polyB.length; j++) {
      const d = Math.hypot(a[0] - polyB[j][0], a[1] - polyB[j][1]);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    usedB.add(bestIdx);
    const b = polyB[bestIdx];
    lines.push([[a[0], hA, -a[1]], [b[0], hB, -b[1]]]);
  }

  // Connect unused polyB vertices back to their nearest polyA vertex
  for (let j = 0; j < polyB.length; j++) {
    if (usedB.has(j)) continue;
    const b = polyB[j];
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < polyA.length; i++) {
      const d = Math.hypot(b[0] - polyA[i][0], b[1] - polyA[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const a = polyA[bestIdx];
    lines.push([[a[0], hA, -a[1]], [b[0], hB, -b[1]]]);
  }
  return lines;
}

/* ── Main entry point ────────────────────────────────────────────── */

/**
 * Generate the northlight regulation volume geometry.
 *
 * @param {number[][]} vertices  Site boundary as [x, y] vertices (any winding).
 * @param {object}     params    Partial params (merged with DEFAULT_PARAMS).
 * @param {object}     PC        polygon-clipping library instance (from CDN).
 * @returns {{
 *   floorSlices:    Array<{height:number, polygon:number[][], area:number}>,
 *   horizontalRings: Array<number[][][]>,
 *   verticalLines:   Array<number[][][]>,
 *   siteBoundary:    number[][][],
 *   metadata:        {maxHeight:number, volume:number, floorArea:number, buildableFloors:number},
 *   edgeProfiles:    EdgeProfile[]
 * }}
 */
export function generateVolume(vertices, params, PC) {
  const EMPTY = { floorSlices: [], horizontalRings: [], verticalLines: [], siteBoundary: [], metadata: { maxHeight: 0, volume: 0, floorArea: 0, buildableFloors: 0 }, edgeProfiles: [] };
  if (!PC) return EMPTY;

  const p = { ...DEFAULT_PARAMS, ...params };
  const ccwVerts = ensureCCW(vertices);
  const profiles = computeEdgeProfiles(ccwVerts, p);

  const floorSlices = [];
  const { maxHeight, floorHeight, baseHeight, aboveBaseRatio, interpretationMode } = p;
  const numFloors = Math.floor(maxHeight / floorHeight);
  const baseFloor = Math.round(baseHeight / floorHeight); // floor index at base height

  for (let f = 0; f <= numFloors; f++) {
    const h = f * floorHeight;

    // In discontinuous mode, insert a step slice just above base height
    if (f === baseFloor && interpretationMode === 'discontinuous' && f > 0) {
      const stepSetback = baseHeight * aboveBaseRatio;
      const translated = ccwVerts.map(v => [v[0], v[1] - stepSetback]);
      const stepPoly = intersectPolygons(translated, ccwVerts, PC);
      if (stepPoly) {
        const area = polygonArea(stepPoly);
        if (area >= 0.5) floorSlices.push({ height: baseHeight + 0.001, polygon: stepPoly, area });
      }
    }

    const poly = buildablePolygonAtHeight(ccwVerts, h, profiles, p, PC);
    if (!poly) break;
    const area = polygonArea(poly);
    if (area < 0.5) break;
    floorSlices.push({ height: h, polygon: poly, area });
  }

  // Sort by height ascending
  floorSlices.sort((a, b) => a.height - b.height);

  // ── Horizontal rings ─────────────────────────────────────────────
  const horizontalRings = floorSlices.map(({ height, polygon }) => {
    const ring = polygon.map(v => [v[0], height, -v[1]]);
    // Close the ring
    if (ring.length > 0) ring.push([...ring[0]]);
    return ring;
  });

  // ── Vertical lines between adjacent floors ───────────────────────
  const verticalLines = [];
  for (let i = 0; i < floorSlices.length - 1; i++) {
    const s0 = floorSlices[i], s1 = floorSlices[i + 1];
    const connections = connectFloors(s0.polygon, s0.height, s1.polygon, s1.height);
    verticalLines.push(...connections);
  }

  // ── Site boundary at ground level ────────────────────────────────
  const groundH = 0.02; // slight offset above ground to avoid z-fighting
  const siteBoundary = ccwVerts.map(v => [v[0], groundH, -v[1]]);
  if (siteBoundary.length > 0) siteBoundary.push([...siteBoundary[0]]);

  // ── Metadata ─────────────────────────────────────────────────────
  const buildableFloors = floorSlices.length;
  const floorArea = floorSlices.length > 0 ? floorSlices[0].area : 0;

  // Volume via trapezoidal rule over floor slices
  let volume = 0;
  for (let i = 0; i < floorSlices.length - 1; i++) {
    const dh = floorSlices[i + 1].height - floorSlices[i].height;
    volume += 0.5 * (floorSlices[i].area + floorSlices[i + 1].area) * dh;
  }

  const peakHeight = floorSlices.length > 0 ? floorSlices[floorSlices.length - 1].height : 0;

  return {
    floorSlices,
    horizontalRings,
    verticalLines,
    siteBoundary: [siteBoundary],
    metadata: { maxHeight: peakHeight, volume, floorArea, buildableFloors },
    edgeProfiles: profiles,
  };
}
