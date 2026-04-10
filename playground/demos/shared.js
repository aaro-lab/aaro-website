/**
 * Shared utilities for playground demos.
 * Each demo imports what it needs via ES module imports.
 */

export const DPR = window.devicePixelRatio || 1;

export function setupCanvas(canvas) {
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  canvas.width = w * DPR; canvas.height = h * DPR;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  return { w, h, ctx };
}

export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

export function rectInPolygon(cx, cy, hw, hh, angle, poly) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  for (const [lx, ly] of corners) {
    const wx = cx + lx * cos - ly * sin;
    const wy = cy + lx * sin + ly * cos;
    if (!pointInPolygon(wx, wy, poly)) return false;
  }
  return true;
}

/**
 * Demo lifecycle manager.
 * Registers draw callbacks and uses IntersectionObserver to only
 * run animations for demos visible in the viewport.
 */
const activeDemos = new Set();
let loopRunning = false;

function masterLoop() {
  for (const fn of activeDemos) fn();
  if (activeDemos.size > 0) {
    requestAnimationFrame(masterLoop);
  } else {
    loopRunning = false;
  }
}

function ensureLoop() {
  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(masterLoop);
  }
}

export function registerDemo(cellElement, drawFn) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        activeDemos.add(drawFn);
        ensureLoop();
      } else {
        activeDemos.delete(drawFn);
      }
    }
  }, { threshold: 0.1 });

  observer.observe(cellElement);
  // Start immediately if visible
  activeDemos.add(drawFn);
  ensureLoop();
}
