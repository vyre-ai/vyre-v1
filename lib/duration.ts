// One duration formatter for the app (owner, 6 Nov 2026): how long something has run or been going, as a person says it. Under a minute is "now", then "12 min", "2 h 14 min", and from a day on "3 d".
// A negative or missing span reads "now"; nothing here ever prints a clock like 9073:44:02.
export function durationWords(ms: number): string {
  const min = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return m === 0 ? `${h} h` : `${h} h ${m} min`; }
  return `${Math.floor(min / (24 * 60))} d`;
}
