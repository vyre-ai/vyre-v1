// One way to say a time to a person: short, in their own zone, once. "Wed 11 Nov, 4:16". `offsetMin` is the viewer's zone against UTC.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortTime(at: number, offsetMin = 0): string {
  const a = new Date(at + offsetMin * 60_000);
  return `${DAYS[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}, ${a.getUTCHours()}:${String(a.getUTCMinutes()).padStart(2, "0")}`;
}

/** The token a stored sentence carries for a moment; the reader's zone fills it in later. */
export const atToken = (at: number): string => `{at:${Math.round(at)}}`;
/** The token a stored sentence carries for a person or agent; the reader's directory names it. */
export const whoToken = (id: string): string => `{who:${id}}`;
