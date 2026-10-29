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

/** "1 holder", "2 holders": the count with its noun in the right number. */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** A section label as a person reads it: "space" is "Space". */
export const capital = (text: string): string => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
/** A day as a person reads it in a title: "29 Oct" (the year only when it is not this one). */
export function dayLabel(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const same = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(same ? {} : { year: "numeric" }) });
}
