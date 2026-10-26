// Scroll frame-time probe (ruling 29, budget scroll): p95 frame interval while scrolling a 10,000-row list top to bottom.
// Any packet with a long list adds `"scroll": { "selector": "<css>" }` to its target in scripts/shots/targets/<packet>.json;
// shots.mjs then calls measureScroll on the mounted route and fails the run when p95 is over the ceiling.
//   frame interval = time between consecutive requestAnimationFrame callbacks while the list scrolls one frame at a time.
export const SCROLL_P95_MS = 16.7;
/** Headless Chrome paints on a 60 Hz clock, so intervals quantise around 16.7 ms; this much jitter is not a dropped frame. */
export const VSYNC_JITTER_MS = 1.0;

/** p95 and worst of a list of frame intervals. */
export function summarize(intervals) {
  if (!intervals.length) return { frames: 0, p95: Infinity, max: Infinity };
  const s = [...intervals].sort((a, b) => a - b);
  return { frames: s.length, p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)], max: s[s.length - 1] };
}

export function withinBudget(summary, ceiling = SCROLL_P95_MS) {
  return summary.frames >= 30 && summary.p95 <= ceiling + VSYNC_JITTER_MS;
}

/**
 * Lets the page finish what it started when it loaded (ruling 79): the sample Space seeds 100,000 rows after the load event, and the garbage collections that move those rows out of the young
 * generation landed inside the measured scroll as 25 to 50 ms pauses. Wait for idle (or 2 s), collect where the browser allows it (--js-flags=--expose-gc), then measure the scroll only.
 */
export async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const done = () => setTimeout(resolve, 300);
    if (typeof requestIdleCallback === "function") requestIdleCallback(done, { timeout: 2000 }); else setTimeout(done, 2000);
  }));
  await page.evaluate(() => { if (typeof globalThis.gc === "function") globalThis.gc(); });
  await page.waitForTimeout(500);
}

/** Scrolls the element matching `selector` `pxPerFrame` per animation frame for `frames` frames (120 px is about 7,200 px/s, a hard fling), then jumps to the end. Returns the frame intervals and layout shift. */
export async function measureScroll(page, { selector, frames = 600, pxPerFrame = 120 }) {
  await page.waitForSelector(selector, { timeout: 30000 });
  await settle(page);
  const out = await page.evaluate(async ({ selector, frames, pxPerFrame }) => {
    const el = document.querySelector(selector);
    const max = el.scrollHeight - el.clientHeight;
    const step = pxPerFrame;
    let n = 0;
    let shift = 0;
    const po = typeof PerformanceObserver === "function" ? new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) shift += e.value; }) : null;
    try { po?.observe({ type: "layout-shift", buffered: true }); } catch { /* unsupported */ }
    const heightBefore = el.scrollHeight;
    const intervals = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        intervals.push(now - last); last = now;
        el.scrollTop = Math.min(max, el.scrollTop + step);
        if (++n >= frames || el.scrollTop >= max - 1) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Then jump to the very end: the last rows must render and the reserved height must not change.
    el.scrollTop = max;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    po?.disconnect();
    return { intervals: intervals.slice(1), layoutShift: shift, heightBefore, heightAfter: el.scrollHeight };
  }, { selector, frames, pxPerFrame });
  return { ...summarize(out.intervals), layoutShift: out.layoutShift, heightStable: out.heightBefore === out.heightAfter };
}
