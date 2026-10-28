// Small text helpers the Console pages share. Numbers are tabular wherever they show; times are relative to the shell's clock so a screen test is stable.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function ago(now: number, at: number): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "now";
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)} d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/** Micros of a dollar to "$1,234" (whole dollars; the Console is a dense table, not a bill). */
export function money(micros: number): string {
  return "$" + Math.round(micros / 1_000_000).toLocaleString("en-US");
}

/** "role.changed" to "role changed": the registry's action names read as a phrase. */
export function actionPhrase(action: string): string {
  return action.replace(/[._]/g, " ");
}
