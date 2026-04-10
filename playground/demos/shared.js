/**
 * Shared utilities for playground demos.
 * Each demo imports what it needs via ES module imports.
 */

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

/** Array-based [x,y] variant of pointInPolygon (ray casting). */
export function pointInRingArray(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

/**
 * Demo lifecycle manager.
 * Registers draw callbacks and uses IntersectionObserver to only
 * run animations for demos visible in the viewport.
 *
 * Returns a cleanup function that disconnects the observer and
 * removes the draw callback from the active set.
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

  // Return cleanup function for lifecycle management
  return () => {
    observer.disconnect();
    activeDemos.delete(drawFn);
  };
}
