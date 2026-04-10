import { setupCanvas, registerDemo } from '../shared.js';

export function init(cell) {
  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  const fileInput = cell.querySelector('#brickImgInput');
  const colSlider = cell.querySelector('#brickColSlider');
  const rowSlider = cell.querySelector('#brickRowSlider');

  if (!canvas) return;
  let ctx, W, H;

  let COLS = 30, ROWS = 70;
  const MORTAR = 0.3, MAX_ANGLE = 60;
  const BW = 2.4, BH = 1.0, BD = 0.8;
  let bricks = [], currentAngles = [], targetAngles = [];
  let gridIdx = {};
  let hasImage = false, storedImgData = null, storedImgW = 0, storedImgH = 0;

  // Wall size animation (move -> pause -> move)
  let curCols = 30, curRows = 70, tgtCols = 30, tgtRows = 70;
  let wallDriftState = 'moving', wallPauseTimer = 0;
  const WALL_PAUSE_DUR = 2.5, WALL_LERP = 0.025;
  const COL_MIN = 10, COL_MAX = 80, ROW_MIN = 10, ROW_MAX = 90;
  function pickWallSize() {
    tgtCols = COL_MIN + Math.random() * (COL_MAX - COL_MIN);
    tgtRows = ROW_MIN + Math.random() * (ROW_MAX - ROW_MIN);
  }

  let rotY = 0.25, rotX = -0.15, zoom3D = 1.6;
  let orbiting = false, orbLastX = 0, orbLastY = 0;

  function buildGrid() {
    bricks = []; gridIdx = {};
    const totalW = COLS * (BW + MORTAR), totalH = ROWS * (BH + MORTAR);
    for (let r = 0; r < ROWS; r++) {
      const off = (r % 2 === 1) ? BW / 2 : 0;
      for (let c = 0; c < COLS; c++) {
        gridIdx[r + ',' + c] = bricks.length;
        bricks.push({ wx: c * (BW + MORTAR) + off - totalW / 2, wz: r * (BH + MORTAR) - totalH / 2, r, c });
      }
    }
    currentAngles = bricks.map(() => 0);
    targetAngles = bricks.map(() => 0);
    if (hasImage && storedImgData) targetAngles = sampleImage(storedImgData, storedImgW, storedImgH);
  }

  function sampleImage(imgData, imgW, imgH) {
    const angles = new Float32Array(bricks.length);
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      const u = (b.c + 0.5) / COLS, v = 1 - (b.r + 0.5) / ROWS;
      const ix = Math.min(imgW - 1, Math.floor(u * imgW)), iy = Math.min(imgH - 1, Math.floor(v * imgH));
      const idx = (iy * imgW + ix) * 4;
      angles[i] = ((imgData[idx] + imgData[idx + 1] + imgData[idx + 2]) / (3 * 255) - 0.5) * 2 * MAX_ANGLE;
    }
    for (let pass = 0; pass < 2; pass++) {
      const sm = new Float32Array(angles);
      for (let i = 0; i < bricks.length; i++) {
        const br = bricks[i].r, bc = bricks[i].c;
        let s = angles[i], cnt = 1;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const ni = gridIdx[(br + dr) + ',' + (bc + dc)];
          if (ni !== undefined) { s += angles[ni]; cnt++; }
        }
        sm[i] = s / cnt;
      }
      angles.set(sm);
    }
    return Array.from(angles);
  }

  function project(wx, wy, wz) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const x1 = wx * cy + wy * sy, y1 = -wx * sy + wy * cy, z1 = wz;
    const x2 = x1, y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx;
    const sc = zoom3D * Math.min(W, H) / (Math.max(COLS * (BW + MORTAR), ROWS * (BH + MORTAR)) * 1.3);
    return { x: W / 2 + x2 * sc, y: H / 2 - z2 * sc, z: y2 };
  }

  function resize() { const s = setupCanvas(canvas); W = s.w; H = s.h; ctx = s.ctx; if (colSlider) COLS = parseInt(colSlider.value); if (rowSlider) ROWS = parseInt(rowSlider.value); curCols = COLS; curRows = ROWS; buildGrid(); pickWallSize(); }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "500 9px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('BRICK WALL', 8, 14);

    for (let i = 0; i < bricks.length; i++) currentAngles[i] += (targetAngles[i] - currentAngles[i]) * 0.06;

    // Wall size drift: move -> pause -> move
    if (wallDriftState === 'paused') {
      wallPauseTimer += 0.016;
      if (wallPauseTimer >= WALL_PAUSE_DUR) { wallDriftState = 'moving'; wallPauseTimer = 0; pickWallSize(); }
    } else {
      curCols += (tgtCols - curCols) * WALL_LERP;
      curRows += (tgtRows - curRows) * WALL_LERP;
      const newC = Math.round(curCols), newR = Math.round(curRows);
      if (newC !== COLS || newR !== ROWS) { COLS = newC; ROWS = newR; buildGrid(); }
      if (Math.abs(curCols - tgtCols) < 0.5 && Math.abs(curRows - tgtRows) < 0.5) { wallDriftState = 'paused'; wallPauseTimer = 0; }
    }

    const sorted = bricks.map((b, i) => ({ idx: i, z: project(b.wx, 0, b.wz).z }));
    sorted.sort((a, b) => a.z - b.z);

    for (const { idx } of sorted) {
      const b = bricks[idx], angle = currentAngles[idx] * Math.PI / 180;
      const brightness = 0.45 + Math.abs(currentAngles[idx] / MAX_ANGLE) * 0.55;
      const hw = BW / 2, hd = BD / 2, cosA = Math.cos(angle), sinA = Math.sin(angle);
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => ({ wx: b.wx + lx * cosA - ly * sinA, wy: ly * cosA + lx * sinA }));
      const topPts = corners.map(c => project(c.wx, c.wy, b.wz + BH / 2));
      const botPts = corners.map(c => project(c.wx, c.wy, b.wz - BH / 2));
      // Bottom face
      ctx.beginPath(); botPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(180*brightness)},${Math.round(170*brightness)},${Math.round(155*brightness)})`; ctx.fill();
      // Side faces
      for (let e = 0; e < 4; e++) {
        const e2 = (e + 1) % 4, nm = (topPts[e2].x - topPts[e].x) * (botPts[e].y - topPts[e].y) - (topPts[e2].y - topPts[e].y) * (botPts[e].x - topPts[e].x);
        if (nm > 0) { ctx.beginPath(); ctx.moveTo(topPts[e].x, topPts[e].y); ctx.lineTo(topPts[e2].x, topPts[e2].y); ctx.lineTo(botPts[e2].x, botPts[e2].y); ctx.lineTo(botPts[e].x, botPts[e].y); ctx.closePath(); ctx.fillStyle = `rgb(${Math.round(200*brightness*0.85)},${Math.round(190*brightness*0.85)},${Math.round(175*brightness*0.85)})`; ctx.fill(); }
      }
      // Top face
      ctx.beginPath(); topPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(220*brightness)},${Math.round(210*brightness)},${Math.round(195*brightness)})`; ctx.fill();
    }
    const maxCur = bricks.length > 0 ? Math.max(...currentAngles.map(Math.abs)).toFixed(1) : '0';
    metricsEl.textContent = `Bricks: ${bricks.length}  |  ${COLS}\u00D7${ROWS}  |  Max Angle: ${maxCur}\u00B0  |  ${hasImage ? 'Image' : 'Wave 20\u00B0\u201360\u00B0'}`;
  }

  // Orbit
  canvas.addEventListener('mousedown', e => { orbiting = true; orbLastX = e.clientX; orbLastY = e.clientY; canvas.style.cursor = 'grabbing'; e.preventDefault(); });
  canvas.addEventListener('mousemove', e => {
    if (!orbiting) return;
    rotY -= (e.clientX - orbLastX) * 0.005;
    rotX += (e.clientY - orbLastY) * 0.005;
    rotX = Math.max(-1.2, Math.min(0.4, rotX));
    orbLastX = e.clientX; orbLastY = e.clientY;
  });
  canvas.addEventListener('mouseup', () => { orbiting = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('mouseleave', () => { orbiting = false; canvas.style.cursor = 'grab'; });
  canvas.style.cursor = 'grab';
  canvas.addEventListener('touchstart', e => { if (e.touches.length === 1) { orbiting = true; orbLastX = e.touches[0].clientX; orbLastY = e.touches[0].clientY; e.preventDefault(); } }, { passive: false });
  canvas.addEventListener('touchmove', e => { if (!orbiting || e.touches.length !== 1) return; rotY -= (e.touches[0].clientX - orbLastX) * 0.005; rotX += (e.touches[0].clientY - orbLastY) * 0.005; rotX = Math.max(-1.2, Math.min(0.4, rotX)); orbLastX = e.touches[0].clientX; orbLastY = e.touches[0].clientY; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', () => { orbiting = false; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom3D *= e.deltaY > 0 ? 0.92 : 1.08; zoom3D = Math.max(0.3, Math.min(5, zoom3D)); }, { passive: false });

  if (fileInput) fileInput.addEventListener('change', e => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => { const oc = document.createElement('canvas'); oc.width = img.width; oc.height = img.height; oc.getContext('2d').drawImage(img, 0, 0); storedImgData = oc.getContext('2d').getImageData(0, 0, img.width, img.height).data; storedImgW = img.width; storedImgH = img.height; targetAngles = sampleImage(storedImgData, storedImgW, storedImgH); hasImage = true; }; img.src = reader.result; }; reader.readAsDataURL(file); });
  if (colSlider) colSlider.addEventListener('input', () => { COLS = parseInt(colSlider.value); curCols = COLS; tgtCols = COLS; buildGrid(); });
  if (rowSlider) rowSlider.addEventListener('input', () => { ROWS = parseInt(rowSlider.value); curRows = ROWS; tgtRows = ROWS; buildGrid(); });
  resize(); window.addEventListener('resize', resize);

  registerDemo(cell, draw);

  // Load default brick image
  const defImg = new Image();
  defImg.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = defImg.width; oc.height = defImg.height;
    oc.getContext('2d').drawImage(defImg, 0, 0);
    storedImgData = oc.getContext('2d').getImageData(0, 0, defImg.width, defImg.height).data;
    storedImgW = defImg.width; storedImgH = defImg.height;
    targetAngles = sampleImage(storedImgData, storedImgW, storedImgH);
    currentAngles = Float32Array.from(targetAngles);
    hasImage = true;
  };
  defImg.src = '/playground/default-brick.png';
}
