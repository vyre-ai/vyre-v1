// A calm line: what it says changes at most every few seconds, to the newest thing, never to a step that came and went. Pure (the hook that uses it is in ActivityLine), so the rule is tested without a clock.

/** A line's words stay at least this long once shown. So a step that does appear is on screen for 4 s, never a flash, and the several steps that came and went in that time collapse into the newest. */
export const DWELL_MS = 4000;

/** How long to wait before the shown label may become the newest one: 0 means now. */
export function waitFor(shownAt: number, now: number, dwell = DWELL_MS): number {
  return Math.max(0, shownAt + dwell - now);
}

/** How long the same label keeps its excerpt before the excerpt moves on. */
export const EXCERPT_BEAT_MS = 1500;

/** When the line may show the newest words: now for a finished turn, now for the first of the thinking (a line gaining words is not a flicker), the excerpt's own beat when only the excerpt moves, the label's dwell when the label changes. */
export function lineWait(shown: { label: string; detail: string }, target: { label: string; detail: string }, done: boolean, shownAt: number, now: number): number {
  if (done) return 0;
  if (shown.label === target.label) return shown.detail === "" ? 0 : Math.max(0, shownAt + EXCERPT_BEAT_MS - now);
  return waitFor(shownAt, now);
}
