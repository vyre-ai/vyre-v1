// The terminal screen as lines and the change between two screens (27 Nov 2026, rc.44; terminal.stream). A screen is tmux's capture split on newlines. A change is described as: drop `top` lines from the top (the
// screen scrolled), then in what is left replace `drop` lines at `at` by `ins`. Output that scrolls the history up by a few lines is a small change this way, where a plain prefix and suffix compare would call
// every line changed (the capture is the last 2,000 lines, so a new line at the bottom moves all of them).

export interface LineDiff {
  /** Lines dropped from the top of the old screen first. */
  top: number;
  /** Where, in what is left, the replacement starts. */
  at: number;
  /** How many lines it replaces. */
  drop: number;
  /** The lines that go there. */
  ins: string[];
}

/** The most lines the screen may have scrolled between two looks that are still searched for. */
const MAX_SCROLL = 400;

function plain(a: readonly string[], b: readonly string[]): { at: number; drop: number; ins: string[] } {
  let pre = 0;
  const m = Math.min(a.length, b.length);
  while (pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < m - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { at: pre, drop: a.length - pre - suf, ins: b.slice(pre, b.length - suf) };
}

/** The change from `a` to `b`, or null when it is not smaller than sending `b` whole. Identical screens give a diff that does nothing. */
export function diffLines(a: readonly string[], b: readonly string[]): LineDiff | null {
  let best: LineDiff | null = null;
  const cost = (d: LineDiff): number => d.ins.length + d.drop * 0.1 + d.top * 0.05;
  const limit = b.length * 0.6;
  for (let top = 0; top <= Math.min(MAX_SCROLL, a.length); top++) {
    // a scrolled screen starts, after the dropped lines, with what the new one starts with: cheap to rule out
    if (top > 0 && (a[top] === undefined || a[top] !== b[0])) continue;
    const d = plain(a.slice(top), b);
    const c = { top, ...d };
    if (best === null || cost(c) < cost(best)) best = c;
    // nothing changed, or only a few lines: no need to look for a better scroll
    if (top === 0 && cost(c) <= 8) break;
  }
  return best !== null && best.ins.length <= limit ? best : null;
}

/** Apply a change to a screen. A diff that does not fit (a gap in the numbering the caller missed) throws. */
export function applyDiff(lines: readonly string[], d: LineDiff): string[] {
  if (d.top < 0 || d.top > lines.length) throw new Error("the screen scrolled by more than it has");
  const rest = lines.slice(d.top);
  if (d.at < 0 || d.at + d.drop > rest.length) throw new Error("the change does not fit the screen");
  return [...rest.slice(0, d.at), ...d.ins, ...rest.slice(d.at + d.drop)];
}
