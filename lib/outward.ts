// What a held outward act is, in a person's words: who it goes to, by which channel, when, and what it says (as Markdown). One reading of the held call, used by the Gate to write the hold's card and by the
// card to read a hold parked before that (apps/app chats conversation held-card). Pure: no node imports, nothing here reads a secret or a field the person should not see ("timing", "online", ids).
// Capabilities: chat.message_person (a message to a person), mail.send (email), telephony.send_sms and twilio.sms.send (text), chat.post (a post in a thread or channel).

export type Channel = "message" | "email" | "text" | "post" | "event";
export interface Recipient { kind: "person" | "address" | "phone" | "thread"; /** a person's id or a thread id */ id?: string; /** an email address or a phone number */ address?: string; name?: string }
export interface Schedule { kind: "at" | "online"; at?: number }
/** What a calendar entry says: the card reads these, never the raw fields. Times are moments (milliseconds); `tz` is the zone the event was written in, when it said so. */
export interface EventFacts { title: string; startMs?: number; endMs?: number; allDay?: boolean; tz?: string; where?: string; link?: string; join?: string; /** invitees get an email */ notify: boolean }
export interface Outward {
  channel: Channel;
  /** A calendar entry: when, where, whether the invitees are emailed. The invitees are `to`, the agenda is `body`. */
  event?: EventFacts;
  /** The input field the event's title lives in. */
  titleField?: "title" | "summary" | "subject";
  to: Recipient[];
  subject?: string;
  /** What it says, as Markdown. */
  body: string;
  /** The input field the body lives in, so an edit goes back to the right place. */
  bodyField: "body" | "text" | "description" | "agenda";
  /** Only when it does not go now. */
  schedule?: Schedule;
  urgent?: boolean;
  /** Set by the Gate when the person edited the words before sending. */
  edited?: { by: string; at: number };
}

const OBJ = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const STR = (v: unknown): string => (typeof v === "string" ? v : "");
const NUM = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The capabilities whose held calls are a message going out. */
export const OUTWARD_CAPS: readonly string[] = ["chat.message_person", "mail.send", "telephony.send_sms", "twilio.sms.send", "chat.post", "calendar.create_event", "google.calendar.create_event", "ms.calendar.create_event"];

/** The held call as an outward act, or null when it is not one (or carries nothing to say). */
export function outwardOf(cap: string, input: unknown): Outward | null {
  const i = OBJ(input);
  switch (cap) {
    case "chat.message_person": {
      const to = STR(i["to"]);
      const at = NUM(i["at"]);
      const timing = i["timing"];
      return {
        channel: "message", to: to ? [{ kind: "person", id: to }] : [], body: STR(i["body"]), bodyField: "body",
        ...(timing === "at" && at !== undefined ? { schedule: { kind: "at" as const, at } } : timing === "online" ? { schedule: { kind: "online" as const } } : {}),
        ...(i["urgent"] === true ? { urgent: true } : {}),
      };
    }
    case "mail.send": {
      const list = Array.isArray(i["to"]) ? (i["to"] as unknown[]) : [];
      const to: Recipient[] = list.map((r) => { const o = OBJ(r); return { kind: "address" as const, address: STR(o["address"]), ...(STR(o["name"]) ? { name: STR(o["name"]) } : {}) }; }).filter((r) => r.address !== "");
      const at = NUM(i["sendAt"]);
      return { channel: "email", to, subject: STR(i["subject"]), body: STR(i["text"]), bodyField: "text", ...(at !== undefined ? { schedule: { kind: "at" as const, at } } : {}) };
    }
    case "telephony.send_sms": case "twilio.sms.send": {
      const to = STR(i["to"]);
      const at = NUM(i["sendAt"]);
      return { channel: "text", to: to ? [{ kind: "phone", address: to }] : [], body: STR(i["body"]), bodyField: "body", ...(at !== undefined ? { schedule: { kind: "at" as const, at } } : {}) };
    }
    case "chat.post": {
      const thread = STR(i["threadId"]);
      return { channel: "post", to: thread ? [{ kind: "thread", id: thread }] : [], body: STR(i["body"]), bodyField: "body" };
    }
    case "calendar.create_event": case "google.calendar.create_event": case "ms.calendar.create_event": return eventOutward(cap, i);
    default: return null;
  }
}

const ZOOM = /https?:\/\/[\w.-]*(?:zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\/[^\s)>\]"']+/i;
const URL_ANY = /https?:\/\/[^\s)>\]"']+/i;

const validZone = (z: string): boolean => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
/** The zone's offset from UTC at a moment, in ms, read from Intl: no table of zones here. */
function offsetMs(zone: string, atUtc: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(atUtc));
  const g = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - atUtc;
}
/** A moment as Google or Microsoft write it: { dateTime, timeZone } or { date }. A zone name that is not an IANA one (a Windows name) is kept out, and the time is read as written. */
function momentOf(v: unknown): { ms?: number; allDay?: boolean } {
  const o = OBJ(v);
  const tz = STR(o["timeZone"]);
  const dt = STR(o["dateTime"]);
  if (dt) {
    const trimmed = dt.replace(/\.(\d{3})\d+/, ".$1");
    if (/(?:Z|[+-]\d\d:?\d\d)$/i.test(trimmed)) { const t = Date.parse(trimmed); return Number.isNaN(t) ? {} : { ms: t }; }
    const asUtc = Date.parse(`${trimmed}Z`);
    if (Number.isNaN(asUtc)) return {};
    return { ms: tz !== "" && !/^utc$/i.test(tz) && validZone(tz) ? asUtc - offsetMs(tz, asUtc) : asUtc };
  }
  const day = STR(o["date"]);
  if (day) { const t = Date.parse(`${day}T00:00:00Z`); return { ...(Number.isNaN(t) ? {} : { ms: t }), allDay: true }; }
  return {};
}

function eventOutward(cap: string, i: Record<string, unknown>): Outward {
  const vyre = cap === "calendar.create_event";
  const ms = cap.startsWith("ms.");
  const titleField = vyre ? "title" : ms ? "subject" : "summary";
  const bodyField = vyre ? (STR(i["agenda"]) !== "" || STR(i["description"]) === "" ? "agenda" : "description") : ms ? "body" : "description";
  const list = Array.isArray(i["attendees"]) ? (i["attendees"] as unknown[]) : [];
  const to: Recipient[] = list.map((r) => { const o = OBJ(r); return { kind: "address" as const, address: STR(o["email"]), ...(STR(o["name"]) ? { name: STR(o["name"]) } : {}) }; }).filter((r) => r.address !== "");
  const body = STR(i[bodyField]);
  const where = STR(i["location"]);
  const link = ZOOM.exec(where)?.[0] ?? ZOOM.exec(body)?.[0] ?? URL_ANY.exec(where)?.[0];
  const start: { ms?: number | undefined; allDay?: boolean | undefined } = vyre ? { ms: NUM(i["startsAt"]), allDay: i["allDay"] === true } : momentOf(i["start"]);
  const end: { ms?: number | undefined } = vyre ? { ms: NUM(i["endsAt"]) } : momentOf(i["end"]);
  const tz = vyre ? "" : STR(OBJ(i["start"])["timeZone"]);
  const join = vyre ? (STR(i["joinProvider"]) !== "" && i["joinProvider"] !== "none" ? STR(i["joinProvider"]) : i["video"] === true ? "video" : "") : ms ? (i["teamsMeeting"] === true ? "teams" : "") : (i["conference"] === true ? "meet" : "");
  const notify = to.length > 0 && (vyre || ms ? true : STR(i["sendUpdates"]) !== "none");
  const place = where !== "" && !(link !== undefined && where === link) ? where : "";
  const event: EventFacts = { title: STR(i[titleField]), ...(start.ms !== undefined ? { startMs: start.ms } : {}), ...(end.ms !== undefined ? { endMs: end.ms } : {}), ...(start.allDay ? { allDay: true } : {}), ...(tz && validZone(tz) ? { tz } : {}), ...(place ? { where: place } : {}), ...(link ? { link } : {}), ...(join ? { join } : {}), notify };
  return { channel: "event", to, subject: event.title, body, bodyField: bodyField as Outward["bodyField"], titleField, event };
}

/** "Wed 4 Nov, 2:00 to 3:00 pm PST · Thu 5 Nov, 3:00 am yours": the event in its own zone, and in the viewer's when that is another. Just the viewer's when the event named no zone. */
export function whenWords(e: EventFacts, viewerTz?: string): string | null {
  if (e.startMs === undefined) return null;
  const zoneOf = (z: string | undefined): string | undefined => (z && validZone(z) ? z : undefined);
  const day = (ms: number, z?: string): string => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", ...(z ? { timeZone: z } : {}) }).format(new Date(ms)).replace(",", "");
  const half = (ms: number, z?: string): string => new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, ...(z ? { timeZone: z } : {}) }).format(new Date(ms)).slice(-2).toLowerCase();
  const clock = (ms: number, z?: string, meridiem = true): string => {
    const t = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(z ? { timeZone: z } : {}) }).format(new Date(ms));
    return meridiem ? t.replace(/\s?(AM|PM)$/i, (_m, h: string) => ` ${h.toLowerCase()}`) : t.replace(/\s?(AM|PM)$/i, "");
  };
  const span = (z?: string, label = ""): string => {
    const s = e.startMs!; const en = e.endMs;
    if (e.allDay) return `${day(s, "UTC")} all day`;
    if (en === undefined) return `${day(s, z)}, ${clock(s, z)}${label}`;
    const sameDay = day(s, z) === day(en, z);
    const sameHalf = half(s, z) === half(en, z);
    return `${day(s, z)}, ${clock(s, z, !(sameDay && sameHalf))} to ${sameDay ? "" : `${day(en, z)}, `}${clock(en, z)}${label}`;
  };
  const own = zoneOf(e.tz);
  const mine = zoneOf(viewerTz);
  if (e.allDay || !own) return span(mine);
  const short = new Intl.DateTimeFormat("en-US", { timeZone: own, timeZoneName: "short" }).formatToParts(new Date(e.startMs)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const theirs = span(own, short ? ` ${short}` : "");
  if (mine === own || mine === undefined) return theirs;
  return `${theirs} · ${day(e.startMs, mine)}, ${clock(e.startMs, mine)} yours`;
}

/** The input with the event's title replaced, for an edit. Null when it is not an event. */
export function withTitle(cap: string, input: unknown, title: string): Record<string, unknown> | null {
  const o = outwardOf(cap, input);
  if (!o?.titleField) return null;
  return { ...OBJ(input), [o.titleField]: title };
}

/** The verb the header uses: "message Aliza Rizvi", "email aliza@example.com", "text +14155550123", "post in Lab 7 no-shows". */
export function verbOfChannel(o: Outward, names: (r: Recipient) => string): string {
  const who = o.to.map(names).filter(Boolean);
  const list = who.length === 0 ? "" : who.length <= 2 ? who.join(" and ") : `${who.slice(0, 2).join(", ")} and ${who.length - 2} more`;
  switch (o.channel) {
    case "message": return list ? `message ${list}` : "send a message";
    case "email": return list ? `email ${list}` : "send an email";
    case "text": return list ? `text ${list}` : "send a text";
    case "event": return "add a calendar event";
    default: return list ? `post in ${list}` : "post a message";
  }
}

/** "Sends at 9:00 her time" is the card's to write (it knows the zone); this is the part the data decides: when it is not now, and how. */
export function scheduleWords(s: Schedule | undefined, when: (at: number) => string): string | null {
  if (!s) return null;
  return s.kind === "online" ? "Sends when they are next online" : s.at !== undefined ? `Sends ${when(s.at)}` : null;
}

/** The same, in the recipient's time when it is known: "Sends at 9:00 their time (14:00 yours)"; in the viewer's alone when the recipient has not set a zone. `theirs` is null then. */
export function scheduleLine(s: Schedule | undefined, fmt: { yours(at: number): string; theirs: ((at: number) => string) | null }): string | null {
  if (!s) return null;
  if (s.kind === "online") return "Sends when they are next online";
  if (s.at === undefined) return null;
  return fmt.theirs ? `Sends at ${fmt.theirs(s.at)} their time (${fmt.yours(s.at)} yours)` : `Sends at ${fmt.yours(s.at)}`;
}

/** The input with its body replaced, for an edit: only the body field changes (an email's HTML is dropped, since the text is what was edited). Null when the call is not one that can be edited. */
export function withBody(cap: string, input: unknown, markdown: string): Record<string, unknown> | null {
  const o = outwardOf(cap, input);
  if (!o) return null;
  const next: Record<string, unknown> = { ...OBJ(input), [o.bodyField]: markdown };
  if (cap === "mail.send") delete next["html"];
  return next;
}
