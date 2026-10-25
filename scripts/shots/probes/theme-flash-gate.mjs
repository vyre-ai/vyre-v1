// Pure gate for the theme_flash probe (ruling 37). The browser part is scripts/shots/theme-flash.mjs, which imports this.
//   wrong frames: binding, every frame of every load must show the skin's --win color (budget wrong_frames_max, 0).
//   apply time: a budget on the MEDIAN of three probes per skin and mode; one slow sample on a loaded runner never fails a run.
export const APPLY_SAMPLES = 3;

/** Median of a list of numbers (middle value; mean of the two middle values when even). NaN for an empty list. */
export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One combo from its samples: [{ wrong, apply_ms }]. A missing apply mark (negative) counts as a failure of the mark, not a time. */
export function summarizeCombo(samples) {
  const wrong = samples.reduce((a, s) => a + s.wrong, 0);
  const times = samples.map((s) => s.apply_ms);
  const missing = times.some((t) => !(t >= 0));
  return { wrong, apply_ms_median: missing ? -1 : Math.round(median(times) * 10) / 10, apply_ms_samples: times, missing };
}

/** A combo passes with 0 wrong frames (budget), a present apply mark, and a median apply time at or under the ceiling. */
export function comboOk(c, budget) {
  return c.wrong <= budget.wrong_frames_max && !c.missing && c.apply_ms_median <= budget.apply_ms_max;
}
