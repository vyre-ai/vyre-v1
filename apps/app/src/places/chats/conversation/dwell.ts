// A calm line: what it says changes at most every few seconds, to the newest thing, never to a step that came and went. Pure (the hook that uses it is in ActivityLine), so the rule is tested without a clock.

/** A line's words stay at least this long once shown. So a step that does appear is on screen for 4 s, never a flash, and the several steps that came and went in that time collapse into the newest. */
export const DWELL_MS = 4000;

/** How long to wait before the shown label may become the newest one: 0 means now. */
export function waitFor(shownAt: number, now: number, dwell = DWELL_MS): number {
  return Math.max(0, shownAt + dwell - now);
}
