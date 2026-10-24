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

/** Scrolls the element matching `selector` to the end, one step per animation frame, and returns the frame intervals and layout shift. */
export async function measureScroll(page, { selector, steps = 300 }) {
  await page.waitForSelector(selector, { timeout: 30000 });
  const out = await page.evaluate(async ({ selector, steps }) => {
    const el = document.querySelector(selector);
    const max = el.scrollHeight - el.clientHeight;
    const step = Math.max(1, max / steps);
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
        if (el.scrollTop >= max - 1) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    po?.disconnect();
    return { intervals: intervals.slice(1), layoutShift: shift, heightBefore, heightAfter: el.scrollHeight };
  }, { selector, steps });
  return { ...summarize(out.intervals), layoutShift: out.layoutShift, heightStable: out.heightBefore === out.heightAfter };
}
