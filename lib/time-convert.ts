// Time between zones, so a model never does the arithmetic (owner, 4 Nov: "Thursday 5 Nov 2pm PST is Friday 6 Nov 03:00 PKT" was worked out in the model's head, with epoch numbers, and the day came out
// wrong). Pure functions over Intl: a zone by name or common abbreviation, a time in words ("Thursday 5 Nov 2pm", "tomorrow 2pm", "in 3 hours", an ISO time), the instant it names, and how that reads in
// other zones. "Tomorrow" and the other day words are the person's days (their now, in their zone); the clock time is in the zone the time was given in.

const ALIASES: Readonly<Record<string, string>> = {
  utc: "UTC", gmt: "UTC", z: "UTC",
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles", la: "America/Los_Angeles",
  mt: "America/Denver", mst: "America/Denver", mdt: "America/Denver", mountain: "America/Denver",
  ct: "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", central: "America/Chicago",
  et: "America/New_York", est: "America/New_York", edt: "America/New_York", eastern: "America/New_York", ny: "America/New_York",
  uk: "Europe/London", london: "Europe/London", bst: "Europe/London",
  cet: "Europe/Paris", cest: "Europe/Paris", paris: "Europe/Paris", berlin: "Europe/Berlin",
  eet: "Europe/Athens", eest: "Europe/Athens", msk: "Europe/Moscow",
  gst: "Asia/Dubai", dubai: "Asia/Dubai", pkt: "Asia/Karachi", karachi: "Asia/Karachi", ist: "Asia/Kolkata", india: "Asia/Kolkata",
  sgt: "Asia/Singapore", singapore: "Asia/Singapore", myt: "Asia/Kuala_Lumpur", kl: "Asia/Kuala_Lumpur",
  jst: "Asia/Tokyo", tokyo: "Asia/Tokyo", kst: "Asia/Seoul", hkt: "Asia/Hong_Kong",
  aest: "Australia/Sydney", aedt: "Australia/Sydney", sydney: "Australia/Sydney", nzst: "Pacific/Auckland", nzdt: "Pacific/Auckland",
};

const valid = (tz: string): boolean => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

/** An IANA zone from a name, an abbreviation or a city the person might say; null when it is none. */
export function resolveZone(name: string | undefined): string | null {
  const raw = (name ?? "").trim();
  if (raw === "") return null;
  const key = raw.toLowerCase().replace(/\s+(time|standard time|daylight time)$/, "").replace(/[\s.]/g, "");
  if (ALIASES[key]) return ALIASES[key]!;
  if (valid(raw)) return raw;
  const city = raw.replace(/\s+/g, "_");
  for (const prefix of ["America", "Europe", "Asia", "Africa", "Australia", "Pacific"]) if (valid(`${prefix}/${city}`)) return `${prefix}/${city}`;
  return null;
}

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number }

function partsOf(at: number, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  return { y: Number(p["year"]), mo: Number(p["month"]), d: Number(p["day"]), h: Number(p["hour"]) % 24, mi: Number(p["minute"]), s: Number(p["second"]), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p["weekday"] ?? "") };
}

/** The zone's offset from UTC at an instant, in minutes east. */
export function offsetMinutes(at: number, tz: string): number {
  const p = partsOf(at, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(at / 1000) * 1000) / 60_000);
}

const offsetLabel = (min: number): string => `UTC${min < 0 ? "-" : "+"}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, "0")}` : ""}`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number): string => String(n).padStart(2, "0");

/** "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)". */
export function describe(at: number, tz: string): string {
  const p = partsOf(at, tz);
  return `${DAYS[p.wd]} ${p.d} ${MONTHS[p.mo - 1]} ${p.y}, ${pad(p.h)}:${pad(p.mi)} (${tz}, ${offsetLabel(offsetMinutes(at, tz))})`;
}

/** The instant a wall-clock time names in a zone. A time the clocks skip (spring forward) moves on to the first real one; a time they repeat (fall back) is the first of the two. */
export function zonedToInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): { at: number; note?: string } {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offs = new Set([offsetMinutes(guess - 86_400_000, tz), offsetMinutes(guess + 86_400_000, tz), offsetMinutes(guess, tz)]);
  const hits: number[] = [];
  for (const off of offs) {
    const at = guess - off * 60_000;
    const p = partsOf(at, tz);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) hits.push(at);
  }
  if (hits.length > 0) {
    hits.sort((a, b) => a - b);
    return hits.length > 1 ? { at: hits[0]!, note: `${pad(h)}:${pad(mi)} happens twice that day in ${tz} (the clocks go back); this is the first.` } : { at: hits[0]! };
  }
  // in the gap: the clocks jump over it, so the time means the same minute after the jump
  const before = guess - offsetMinutes(guess - 86_400_000, tz) * 60_000;
  const after = guess - offsetMinutes(guess + 86_400_000, tz) * 60_000;
  return { at: Math.max(before, after), note: `${pad(h)}:${pad(mi)} does not exist that day in ${tz} (the clocks go forward); this is the first real time after it.` };
}

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface When { at: number; zone: string; note?: string }

/**
 * The instant a time in words names. `zone` is where the clock time was given (default: the person's); `person` is the person's zone and `now` the present, which the day words are counted from.
 * Throws an Error with a plain sentence the model can act on.
 */
export function parseWhen(text: string, o: { zone?: string | undefined; person: string; now: number }): When {
  const raw = text.trim();
  const zone = o.zone ? (resolveZone(o.zone) ?? (() => { throw new Error(`I do not know the time zone "${o.zone}". Use a name like America/Los_Angeles, or PT, ET, PKT, UTC.`); })()) : o.person;
  const lower = raw.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (lower === "now") return { at: o.now, zone };
  // an instant that already says its offset needs no zone
  if (/^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const at = Date.parse(raw.replace(" ", "T").replace(/\s/g, ""));
    if (Number.isFinite(at)) return { at, zone };
  }
  const rel = /^in (\d+(?:\.\d+)?) (minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)$/.exec(lower);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.startsWith("m") ? 60_000 : rel[2]!.startsWith("h") ? 3_600_000 : rel[2]!.startsWith("d") ? 86_400_000 : 604_800_000;
    return { at: o.now + n * unit, zone };
  }
  // the clock time: 2pm, 2:30 pm, 14:00, noon, midnight
  let hour: number | null = null, minute = 0, rest = lower;
  // the first number that is a clock time: it has am or pm, or minutes (a bare "5" in "5 Nov" is a day)
  const clock = [...lower.matchAll(/(?:^|\s|t)(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/g)].find((m) => m[3] !== undefined || m[2] !== undefined) ?? null;
  const named = /\b(noon|midnight)\b/.exec(lower);
  if (named) { hour = named[1] === "noon" ? 12 : 0; rest = lower.replace(named[0], " "); }
  else if (clock) {
    hour = Number(clock[1]); minute = clock[2] ? Number(clock[2]) : 0;
    const ap = clock[3]?.replace(/\./g, "");
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) throw new Error(`"${text}" is not a time of day.`);
    rest = lower.replace(clock[0], " ");
  }
  rest = rest.replace(/\b(at|on|the|of)\b/g, " ").replace(/\s+/g, " ").trim();
  // the day: the person's days for the words, the date as written otherwise
  const today = partsOf(o.now, o.person);
  const base = Date.UTC(today.y, today.mo - 1, today.d);
  let day: { y: number; mo: number; d: number } | null = null;
  const addDays = (n: number): { y: number; mo: number; d: number } => { const t = new Date(base + n * 86_400_000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(rest);
  if (iso) { day = { y: Number(iso[1]), mo: Number(iso[2]), d: Number(iso[3]) }; rest = rest.replace(iso[0], " ").replace(/\bt\b/, " "); }
  else if (/\btoday\b/.test(rest)) { day = addDays(0); rest = rest.replace("today", " "); }
  else if (/\btomorrow\b/.test(rest)) { day = addDays(1); rest = rest.replace("tomorrow", " "); }
  else if (/\byesterday\b/.test(rest)) { day = addDays(-1); rest = rest.replace("yesterday", " "); }
  else {
    const dm = /\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})(?: (\d{4}))?\b/.exec(rest) ?? null;
    const md = /\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?\b/.exec(rest) ?? null;
    const mon = (s: string): number => MON.indexOf(s.slice(0, 3));
    if (dm && mon(dm[2]!) >= 0) { day = { y: dm[3] ? Number(dm[3]) : today.y, mo: mon(dm[2]!) + 1, d: Number(dm[1]) }; rest = rest.replace(dm[0], " "); }
    else if (md && mon(md[1]!) >= 0) { day = { y: md[3] ? Number(md[3]) : today.y, mo: mon(md[1]!) + 1, d: Number(md[2]) }; rest = rest.replace(md[0], " "); }
    else {
      const wd = WEEKDAY.findIndex((w) => new RegExp(`\\b(next )?(${w}|${w.slice(0, 3)})\\b`).test(rest));
      if (wd >= 0) {
        const re = new RegExp(`\\b(next )?(${WEEKDAY[wd]}|${WEEKDAY[wd]!.slice(0, 3)})\\b`);
        const nextWord = re.exec(rest)?.[1] !== undefined;
        let ahead = (wd - today.wd + 7) % 7;
        if (nextWord && ahead === 0) ahead = 7;   // "next Thursday" said on a Thursday is a week on; a bare "Thursday" said on one is today
        day = addDays(ahead);
        rest = rest.replace(re, " ");
      }
    }
  }
  const leftover = rest.replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, " ").replace(/\s+/g, " ").trim();
  if (hour === null && day === null) throw new Error(`I could not read "${text}" as a time. Say it like "Thursday 5 Nov 2pm", "tomorrow 14:00", "2026-11-05 14:00", or "in 3 hours".`);
  if (leftover !== "") throw new Error(`I could not read "${leftover}" in "${text}". Say it like "Thursday 5 Nov 2pm" or "tomorrow 14:00".`);
  const d = day ?? addDays(0);
  const made = zonedToInstant(d.y, d.mo, d.d, hour ?? 0, minute, zone);
  // a weekday said together with a date must agree with it
  const said = day !== null && (iso !== null || /[a-z]{3,9} \d|\d [a-z]{3,}/.test(lower)) ? DAYS.find((w) => new RegExp(`\\b${w.toLowerCase()}\\b`).test(lower)) : undefined;
  const got = partsOf(made.at, zone);
  const note = said && DAYS[got.wd] !== said ? `${said} is not the day of that date: ${d.d} ${MONTHS[d.mo - 1]} ${d.y} is a ${DAYS[got.wd]}.` : made.note;
  return { at: made.at, zone, ...(note ? { note } : {}) };
}

export interface Converted { instantIso: string; epochMs: number; given: string; zones: Array<{ zone: string; text: string }>; person: string; note?: string }

/** A time in words, said in `from` (default the person's zone), as it reads in each of `to` and in the person's own zone. */
export function convert(o: { when: string; from?: string | undefined; to?: readonly string[]; person: string; now: number }): Converted {
  const w = parseWhen(o.when, { zone: o.from, person: o.person, now: o.now });
  const zones: Array<{ zone: string; text: string }> = [];
  for (const name of o.to ?? []) {
    const z = resolveZone(name);
    if (!z) throw new Error(`I do not know the time zone "${name}". Use a name like America/Los_Angeles, or PT, ET, PKT, UTC.`);
    if (!zones.some((x) => x.zone === z)) zones.push({ zone: z, text: describe(w.at, z) });
  }
  return { instantIso: new Date(w.at).toISOString(), epochMs: w.at, given: describe(w.at, w.zone), zones, person: describe(w.at, o.person), ...(w.note ? { note: w.note } : {}) };
}

/** The words of a moment in a zone, with its offset: "Wednesday 4 November 2026, 05:41 (Asia/Karachi, UTC+5)". An unknown zone reads as UTC. */
export const nowLine = (at: number, zone: string): string => describe(at, valid(zone) ? zone : "UTC");

const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const TIME_KEY = /(?:At|Time|Start|End|Due|Date|Until|From|To|Seen|Sent|Received)$|^(?:start|end|due|date|time|when)$/;
const SANE_MS = (n: number): boolean => Number.isFinite(n) && n >= 946_684_800_000 && n < 4_102_444_800_000;

/**
 * A tool's result with the times in it said in the person's zone as well: next to each ISO time (or epoch milliseconds under a key that names a time) a `<key>Local` string, so the model reads
 * "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)" and never works it out from the ISO or the epoch number. Returns a copy; at most `max` times are annotated.
 */
export function withLocalTimes<T>(value: T, zone: string, max = 400): T {
  let left = max;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 8 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(x, depth + 1);
      const at = typeof x === "string" && ISO_AT.test(x) ? Date.parse(x) : typeof x === "number" && TIME_KEY.test(k) && SANE_MS(x) ? x : NaN;
      if (Number.isFinite(at) && left > 0 && !(`${k}Local` in (v as Record<string, unknown>))) { left--; out[`${k}Local`] = describe(at, zone); }
    }
    return out;
  };
  return walk(value, 0) as T;
}
