import { setupCanvas, registerDemo } from '../shared.js';

export function init(cell) {
  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  const colSlider = cell.querySelector('#wfcColSlider');
  const rowSlider = cell.querySelector('#wfcRowSlider');
  if (!canvas) return;
  let ctx, W, H;

  let COLS = 6, ROWS = 6;
  let modules = [];
  let adjacencyTable = null;
  let grid = null;
  let meshCache = [];

  let rotY = 0.6, rotX = -0.5, zoom3D = 1.8;
  let orbiting = false, orbLastX = 0, orbLastY = 0;

  // Wall size animation (move -> pause -> move)
  let curCols = 6, curRows = 6, tgtCols = 6, tgtRows = 6;
  let wallDriftState = 'moving', wallPauseTimer = 0;
  const WALL_PAUSE_DUR = 3, WALL_LERP = 0.02;
  const COL_MIN = 2, COL_MAX = 8, ROW_MIN = 2, ROW_MAX = 8;
  function pickWallSize() {
    tgtCols = COL_MIN + Math.random() * (COL_MAX - COL_MIN);
    tgtRows = ROW_MIN + Math.random() * (ROW_MAX - ROW_MIN);
  }

  // PRNG (Mulberry32)
  function createPRNG(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Edge Rules
  const OPPOSITE = { 0: 2, 1: 3, 2: 0, 3: 1 };
  const DIR_OFFSETS = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };
  function neighborEdgeType(x) { return (x * 2) % 3; }
  function isCompatible(a, dirA, b) {
    const dirB = OPPOSITE[dirA];
    return a.type[dirA] === b.type[dirB] && neighborEdgeType(a.edge_types[dirA]) === b.edge_types[dirB];
  }
  function buildAdjacencyTable(mods) {
    const table = {};
    for (let dir = 0; dir < 4; dir++) {
      const dm = {};
      for (const a of mods) {
        const s = new Set();
        for (const b of mods) { if (isCompatible(a, dir, b)) s.add(b.id); }
        dm[a.id] = s;
      }
      table[dir] = dm;
    }
    return table;
  }

  // WFC Solver
  function createGrid(w, h, modCount) {
    const cells = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const possible = new Set();
        for (let i = 0; i < modCount; i++) possible.add(i);
        row.push({ x, y, possibleModules: possible, collapsed: null });
      }
      cells.push(row);
    }
    return { width: w, height: h, cells };
  }
  function cloneGrid(g) {
    const cells = [];
    for (let y = 0; y < g.height; y++) {
      const row = [];
      for (let x = 0; x < g.width; x++) {
        const c = g.cells[y][x];
        row.push({ x: c.x, y: c.y, possibleModules: new Set(c.possibleModules), collapsed: c.collapsed });
      }
      cells.push(row);
    }
    return { width: g.width, height: g.height, cells };
  }
  function getCell(g, x, y) {
    if (x < 0 || x >= g.width || y < 0 || y >= g.height) return null;
    return g.cells[y][x];
  }
  function isFullyCollapsed(g) {
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++)
        if (g.cells[y][x].collapsed === null) return false;
    return true;
  }
  function solveWFC(w, h, mods, adjTable, seed) {
    const MAX_RESTARTS = 20, MAX_ITER = 5000, BT_DEPTH = 50;
    for (let restart = 0; restart <= MAX_RESTARTS; restart++) {
      const random = createPRNG(seed + restart * 997);
      let g = createGrid(w, h, mods.length);
      const history = [];
      let iterations = 0, failed = false;
      while (!isFullyCollapsed(g) && iterations < MAX_ITER) {
        iterations++;
        let minE = Infinity; const cands = [];
        for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
          const c = g.cells[y][x];
          if (c.collapsed !== null) continue;
          const e = c.possibleModules.size;
          if (e === 0) continue;
          if (e < minE) { minE = e; cands.length = 0; cands.push(c); }
          else if (e === minE) cands.push(c);
        }
        if (cands.length === 0) {
          if (isFullyCollapsed(g)) return g;
          if (history.length > 0) { const en = history.pop(); g = en.grid; const r = getCell(g, en.cx, en.cy); if (r) r.possibleModules.delete(en.tried); continue; }
          failed = true; break;
        }
        const target = cands[Math.floor(random() * cands.length)];
        const snapshot = cloneGrid(g);
        const possible = Array.from(target.possibleModules);
        const weights = possible.map(id => mods[id].weight || 1);
        const tw = weights.reduce((a, b) => a + b, 0);
        let r = random() * tw, modId = possible[possible.length - 1];
        for (let i = 0; i < possible.length; i++) { r -= weights[i]; if (r <= 0) { modId = possible[i]; break; } }
        if (history.length >= BT_DEPTH) history.shift();
        history.push({ grid: snapshot, cx: target.x, cy: target.y, tried: modId });
        target.collapsed = modId;
        target.possibleModules = new Set([modId]);
        // Propagate AC-3
        const queue = [[target.x, target.y]];
        const visited = new Set();
        let contradiction = false;
        while (queue.length > 0) {
          const [cx, cy] = queue.shift();
          const key = cx + ',' + cy;
          if (visited.has(key)) continue;
          visited.add(key);
          const cell = getCell(g, cx, cy);
          if (!cell) continue;
          for (let dir = 0; dir < 4; dir++) {
            const [dx, dy] = DIR_OFFSETS[dir];
            const nb = getCell(g, cx + dx, cy + dy);
            if (!nb || nb.collapsed !== null) continue;
            const allowed = new Set();
            for (const mid of cell.possibleModules) {
              const compat = adjTable[dir][mid];
              if (compat) for (const nid of compat) allowed.add(nid);
            }
            const before = nb.possibleModules.size;
            const newP = new Set();
            for (const nid of nb.possibleModules) { if (allowed.has(nid)) newP.add(nid); }
            if (newP.size === 0) { contradiction = true; break; }
            if (newP.size < before) { nb.possibleModules = newP; if (!visited.has((cx+dx)+','+(cy+dy))) queue.push([cx+dx, cy+dy]); }
          }
          if (contradiction) break;
        }
        if (contradiction) {
          if (history.length > 0) { const en = history.pop(); g = en.grid; const rs = getCell(g, en.cx, en.cy); if (rs) rs.possibleModules.delete(en.tried); continue; }
          failed = true; break;
        }
      }
      if (!failed && isFullyCollapsed(g)) return g;
    }
    return null;
  }

  // Build 3D mesh cache per module
  function buildMeshCache(mods) {
    return mods.map(m => {
      const geo = m.geometry;
      if (!geo) return { tris: [] };
      const bx = geo.bounds.min[0], by = geo.bounds.min[1], bz = geo.bounds.min[2];
      const sx = (geo.bounds.max[0] - bx) || 1;
      const verts = [];
      for (let i = 0; i < geo.vertex_count; i++) {
        verts.push({
          x: (geo.vertices[i * 3]     - bx) / sx,
          y: (geo.vertices[i * 3 + 2] - bz) / sx,
          z: (geo.vertices[i * 3 + 1] - by) / sx
        });
      }
      const tris = [];
      for (let i = 0; i < geo.faces.length; i += 3) {
        const p0 = verts[geo.faces[i]], p1 = verts[geo.faces[i+1]], p2 = verts[geo.faces[i+2]];
        if (!p0 || !p1 || !p2) continue;
        const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
        const bxx = p2.x - p0.x, byy = p2.y - p0.y, bzz = p2.z - p0.z;
        const nx = ay * bzz - az * byy, ny = az * bxx - ax * bzz, nz = ax * byy - ay * bxx;
        const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        const dot = Math.abs((nx/nl)*0.4 + (ny/nl)*0.8 + (nz/nl)*0.3);
        const shade = 0.35 + dot * 0.65;
        tris.push({ p0, p1, p2, shade, cy: (p0.y + p1.y + p2.y) / 3 });
      }
      return { tris };
    });
  }

  // 3D Projection
  function project(wx, wy, wz) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const x1 = wx * cy + wy * sy, y1 = -wx * sy + wy * cy, z1 = wz;
    const x2 = x1, y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx;
    const extent = Math.max(COLS, ROWS);
    const sc = zoom3D * Math.min(W, H) / (extent * 1.6);
    return { x: W / 2 + x2 * sc, y: H / 2 - z2 * sc, z: y2 };
  }

  function resize() {
    const s = setupCanvas(canvas);
    W = s.w; H = s.h; ctx = s.ctx;
    if (colSlider) COLS = parseInt(colSlider.value);
    if (rowSlider) ROWS = parseInt(rowSlider.value);
    curCols = COLS; curRows = ROWS;
    pickWallSize();
    regenerate();
  }

  let wfcSeed = Math.floor(Math.random() * 100000);
  function regenerate() {
    if (!modules.length || !adjacencyTable) return;
    wfcSeed = Math.floor(Math.random() * 100000);
    grid = solveWFC(COLS, ROWS, modules, adjacencyTable, wfcSeed);
  }

  function draw() {
    if (!W || !modules.length) return;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('WFC PAVILION', 8, 14);

    // Wall size drift: move -> pause -> move
    if (wallDriftState === 'paused') {
      wallPauseTimer += 0.016;
      if (wallPauseTimer >= WALL_PAUSE_DUR) { wallDriftState = 'moving'; wallPauseTimer = 0; pickWallSize(); }
    } else {
      curCols += (tgtCols - curCols) * WALL_LERP;
      curRows += (tgtRows - curRows) * WALL_LERP;
      const newC = Math.round(curCols), newR = Math.round(curRows);
      if (newC !== COLS || newR !== ROWS) { COLS = newC; ROWS = newR; regenerate(); }
      if (Math.abs(curCols - tgtCols) < 0.5 && Math.abs(curRows - tgtRows) < 0.5) { wallDriftState = 'paused'; wallPauseTimer = 0; }
    }

    if (!grid) {
      metricsEl.textContent = 'Generating...';
      return;
    }

    const allTris = [];
    const hw = grid.width / 2, hh = grid.height / 2;
    for (let gy = 0; gy < grid.height; gy++) {
      for (let gx = 0; gx < grid.width; gx++) {
        const cell = grid.cells[gy][gx];
        if (cell.collapsed === null) continue;
        const mc = meshCache[cell.collapsed];
        if (!mc) continue;
        const ox = gx - hw + 0.5, oz = gy - hh + 0.5;
        for (const tri of mc.tris) {
          const wp0 = project(ox + tri.p0.x, oz + tri.p0.z, tri.p0.y);
          const wp1 = project(ox + tri.p1.x, oz + tri.p1.z, tri.p1.y);
          const wp2 = project(ox + tri.p2.x, oz + tri.p2.z, tri.p2.y);
          const avgZ = (wp0.z + wp1.z + wp2.z) / 3;
          allTris.push({ wp0, wp1, wp2, shade: tri.shade, z: avgZ });
        }
      }
    }

    allTris.sort((a, b) => a.z - b.z);

    for (const { wp0, wp1, wp2, shade } of allTris) {
      const r = Math.round(204 * shade), g = Math.round(198 * shade), b = Math.round(190 * shade);
      ctx.beginPath();
      ctx.moveTo(wp0.x, wp0.y);
      ctx.lineTo(wp1.x, wp1.y);
      ctx.lineTo(wp2.x, wp2.y);
      ctx.closePath();
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
    }

    const totalCells = grid.width * grid.height;
    const collapsed = grid.cells.flat().filter(c => c.collapsed !== null).length;
    metricsEl.textContent = `Grid: ${COLS}\u00D7${ROWS}  |  Modules: ${collapsed}/${totalCells}  |  Seed: ${wfcSeed}`;
  }

  // Orbit controls
  canvas.addEventListener('mousedown', e => { orbiting = true; orbLastX = e.clientX; orbLastY = e.clientY; canvas.style.cursor = 'grabbing'; e.preventDefault(); });
  canvas.addEventListener('mousemove', e => {
    if (!orbiting) return;
    rotY += (e.clientX - orbLastX) * 0.005;
    rotX -= (e.clientY - orbLastY) * 0.005;
    rotX = Math.max(-1.2, Math.min(0.4, rotX));
    orbLastX = e.clientX; orbLastY = e.clientY;
  });
  canvas.addEventListener('mouseup', () => { orbiting = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('mouseleave', () => { orbiting = false; canvas.style.cursor = 'grab'; });
  canvas.style.cursor = 'grab';
  canvas.addEventListener('touchstart', e => { if (e.touches.length === 1) { orbiting = true; orbLastX = e.touches[0].clientX; orbLastY = e.touches[0].clientY; e.preventDefault(); } }, { passive: false });
  canvas.addEventListener('touchmove', e => { if (!orbiting || e.touches.length !== 1) return; rotY += (e.touches[0].clientX - orbLastX) * 0.005; rotX -= (e.touches[0].clientY - orbLastY) * 0.005; rotX = Math.max(-1.2, Math.min(0.4, rotX)); orbLastX = e.touches[0].clientX; orbLastY = e.touches[0].clientY; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', () => { orbiting = false; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom3D *= e.deltaY > 0 ? 0.92 : 1.08; zoom3D = Math.max(0.3, Math.min(5, zoom3D)); }, { passive: false });

  if (colSlider) colSlider.addEventListener('input', () => { COLS = parseInt(colSlider.value); curCols = COLS; tgtCols = COLS; regenerate(); });
  if (rowSlider) rowSlider.addEventListener('input', () => { ROWS = parseInt(rowSlider.value); curRows = ROWS; tgtRows = ROWS; regenerate(); });

  // Load module data & init
  fetch('/playground/sonsbeek-modules.json')
    .then(r => r.json())
    .then(data => {
      modules = data.modules;
      adjacencyTable = buildAdjacencyTable(modules);
      meshCache = buildMeshCache(modules);
      resize();
      window.addEventListener('resize', resize);
      registerDemo(cell, draw);
    })
    .catch(err => {
      console.error('WFC module load failed:', err);
      if (metricsEl) metricsEl.textContent = 'Failed to load modules';
    });
}
