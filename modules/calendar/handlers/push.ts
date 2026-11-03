// The provider push (lane l-calevents, owner 3 Nov: "nobody gets the meeting otherwise"): an event made, changed or deleted in Vyre goes to the real Google or Microsoft calendar it is on,
// through that calendar's connection and as its person, and the provider sends the invitations. A Meet link is asked of Google with the event (conferenceData createRequest), a Teams
// meeting of Graph (isOnlineMeeting); a Zoom meeting is made through the zoom connection and its link and dial-in are written into the event before it goes out.
// DECISION: every push carries an idempotency key built from the Vyre call (the create's own key, the event id and version for a change or a delete), so a retry never makes a second event.
// DECISION: the provider's answer is the truth: what it says comes back into Vyre's copy through the same ingest a pull uses. A change the provider refuses because its copy moved on
// (409/412, validation.precondition_failed) is not forced: the provider's version is read back and kept, and the caller is told in one quiet line.
import { conferenceOfUrl, first, list, num, obj, readAttendees, str, strOrNull, text } from "../projections.ts";

const GRAPH_DEFAULT = "default";   // events.ts: a member's default Outlook calendar has no id of its own
import type { Attendee, CalCtx, Conference, Json, Row } from "../projections.ts";

export interface Remote { provider: "google" | "microsoft"; connectionId: string; remoteId: string; account?: string }
export type Video = "meet" | "zoom" | "teams" | "none";

/** The provider calendar an event lives on, when it is one Vyre can push to: Google or Microsoft with a connection. A local calendar is Vyre's alone. */
export function remoteOf(ctx: CalCtx, calendarId: string): Remote | null {
  const cal = first(ctx.db.all(`SELECT * FROM calendar_list WHERE id = ? AND deleted_at IS NULL`, calendarId));
  const provider = str(cal, "provider");
  const connectionId = strOrNull(cal, "connectionId");
  const remoteId = strOrNull(cal, "remoteId");
  if ((provider !== "google" && provider !== "microsoft") || !connectionId || !remoteId) return null;
  const account = strOrNull(first(ctx.db.all(`SELECT account FROM calendar_account WHERE "calendarId" = ?`, calendarId)), "account") ?? undefined;
  return { provider, connectionId, remoteId, ...(account ? { account } : {}) };
}

const iso = (ts: number): string => new Date(ts).toISOString();
const day = (ts: number): string => iso(ts).slice(0, 10);
const as = (r: Remote): Json => ({ connectionId: r.connectionId, ...(r.account ? { as: r.account } : {}) });
const graphCal = (r: Remote): Json => (r.remoteId === GRAPH_DEFAULT ? {} : { calendarId: r.remoteId });

/** What Vyre pushes of an event. */
export interface PushFields { title?: string; startsAt?: number; endsAt?: number; allDay?: boolean; location?: string | null; description?: string | null; attendees?: Attendee[] }

function googleBody(f: PushFields): Json {
  const b: Json = {};
  if (f.title !== undefined) b["summary"] = f.title;
  if (f.description !== undefined) b["description"] = f.description ?? "";
  if (f.location !== undefined) b["location"] = f.location ?? "";
  if (f.startsAt !== undefined && f.endsAt !== undefined) {
    b["start"] = f.allDay ? { date: day(f.startsAt) } : { dateTime: iso(f.startsAt), timeZone: "UTC" };
    b["end"] = f.allDay ? { date: day(f.endsAt) } : { dateTime: iso(f.endsAt), timeZone: "UTC" };
  }
  if (f.attendees !== undefined) b["attendees"] = f.attendees.map((a) => ({ email: a.email, ...(a.optional ? { optional: true } : {}) }));
  return b;
}

function graphBody(f: PushFields): Json {
  const b: Json = {};
  if (f.title !== undefined) b["subject"] = f.title;
  if (f.description !== undefined) b["body"] = (f.description ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  if (f.location !== undefined) b["location"] = f.location ?? "";
  if (f.startsAt !== undefined && f.endsAt !== undefined) {
    b["start"] = { dateTime: iso(f.startsAt).slice(0, 19), timeZone: "UTC" };
    b["end"] = { dateTime: iso(f.endsAt).slice(0, 19), timeZone: "UTC" };
  }
  if (f.attendees !== undefined) b["attendees"] = f.attendees.map((a) => ({ email: a.email, ...(a.optional ? { optional: true } : {}) }));
  return b;
}

/** Make the event on its provider calendar. Answers the provider's event as the provider returned it. */
export async function pushCreate(ctx: CalCtx, r: Remote, f: PushFields, video: Video, key: string): Promise<Json> {
  if (r.provider === "google") {
    return obj(obj(await ctx.call("google.calendar.create_event", { ...as(r), calendarId: r.remoteId, ...googleBody(f), ...(video === "meet" ? { conference: true } : {}), sendUpdates: "all", idempotencyKey: `${key}:google` })).event);
  }
  return obj(obj(await ctx.call("ms.calendar.create_event", { ...as(r), ...graphCal(r), ...graphBody(f), ...(video === "teams" ? { teamsMeeting: true } : {}), idempotencyKey: `${key}:graph` })).event);
}

/** Change the event on its provider calendar (only the fields given; a video call to add). */
export async function pushUpdate(ctx: CalCtx, r: Remote, providerId: string, f: PushFields, video: Video, key: string): Promise<Json> {
  if (r.provider === "google") {
    return obj(obj(await ctx.call("google.calendar.update_event", { ...as(r), calendarId: r.remoteId, eventId: providerId, ...googleBody(f), ...(video === "meet" ? { conference: true } : {}), sendUpdates: "all", idempotencyKey: `${key}:google` })).event);
  }
  return obj(obj(await ctx.call("ms.calendar.update_event", { ...as(r), ...graphCal(r), eventId: providerId, ...graphBody(f), ...(video === "teams" ? { teamsMeeting: true } : {}), idempotencyKey: `${key}:graph` })).event);
}

/** Read the provider's own copy (to keep it when it won a conflict, or to move a whole series by its master). */
export async function pushRead(ctx: CalCtx, r: Remote, providerId: string): Promise<Json> {
  if (r.provider === "google") return obj(obj(await ctx.call("google.calendar.get_event", { ...as(r), calendarId: r.remoteId, eventId: providerId })).event);
  return obj(obj(await ctx.call("ms.calendar.get_event", { ...as(r), eventId: providerId })).event);
}

/** Delete it there; the provider tells the guests. One that is already gone is fine. */
export async function pushDelete(ctx: CalCtx, r: Remote, providerId: string, key: string): Promise<void> {
  try {
    if (r.provider === "google") await ctx.call("google.calendar.delete_event", { ...as(r), calendarId: r.remoteId, eventId: providerId, sendUpdates: "all", idempotencyKey: `${key}:google` });
    else await ctx.call("ms.calendar.delete_event", { ...as(r), eventId: providerId, idempotencyKey: `${key}:graph` });
  } catch (e) {
    if (((e as { error?: { code?: string } } | null)?.error?.code ?? "") !== "validation.not_found") throw e;
  }
}

/** A Zoom meeting for the event through the zoom connection: its link, id, passcode and dial-in. */
export async function zoomFor(ctx: CalCtx, title: string, startsAt: number, endsAt: number, key: string): Promise<Conference> {
  const m = obj(obj(await ctx.call("zoom.meetings.create", { topic: title.slice(0, 200) || "Meeting", startTime: startsAt, durationMinutes: Math.max(1, Math.round((endsAt - startsAt) / 60_000)), idempotencyKey: `${key}:zoom` })).meeting);
  const id = text(m["id"]);
  const passcode = text(m["password"]);
  return {
    provider: "zoom", url: text(m["joinUrl"]), ...(id ? { meetingId: id } : {}), ...(passcode ? { passcode } : {}),
    dialIns: list(m["dialIns"]).map(obj).filter((d) => text(d["number"])).map((d) => ({ number: text(d["number"]), ...(id ? { pin: `${id}#` } : {}), ...(text(d["country"]) ? { label: text(d["country"]) } : {}) })),
  };
}

/** The lines a Zoom meeting adds to the event's description, so every guest's calendar carries how to join. */
export function conferenceLines(c: Conference): string {
  const id = c.meetingId ? c.meetingId.replace(/(\d{3})(\d{3,4})(\d{4})$/, "$1 $2 $3") : "";
  const lines = [`Join Zoom: ${c.url ?? ""}`, [id ? `Meeting ID: ${id}` : "", c.passcode ? `Passcode: ${c.passcode}` : ""].filter(Boolean).join(" · ")];
  if (c.dialIns.length) lines.push(`Dial in: ${c.dialIns.slice(0, 2).map((d) => d.number).join(", ")}${c.meetingId ? `, then ${c.meetingId}#` : ""}`);
  return lines.filter(Boolean).join("\n");
}

/** Google's conferenceData as Vyre's conference: the video entry, the phone entries with their PIN, the meeting code. */
export function fromConferenceData(cd: Json, hangoutLink?: string): Conference | undefined {
  const eps = list(cd["entryPoints"]).map(obj);
  const video = eps.find((e) => text(e["entryPointType"]) === "video");
  const url = text(video?.["uri"]) || hangoutLink || "";
  if (!eps.length) return undefined;   // a bare hangoutLink is the event's join link; the conference is what conferenceData adds to it
  const sol = text(obj(obj(cd["conferenceSolution"])["key"])["type"]);
  const provider = conferenceOfUrl(url) ?? (sol === "hangoutsMeet" ? "meet" : "other");
  const passcode = text(video?.["passcode"]) || text(video?.["password"]) || text(video?.["accessCode"]);
  return {
    provider, ...(url ? { url } : {}), ...(text(cd["conferenceId"]) ? { meetingId: text(cd["conferenceId"]) } : {}), ...(passcode ? { passcode } : {}),
    dialIns: eps.filter((e) => text(e["entryPointType"]) === "phone").map((e) => ({
      number: text(e["label"]) || text(e["uri"]).replace(/^tel:/, ""), ...(text(e["pin"]) ? { pin: `${text(e["pin"])}#` } : {}), ...(text(e["regionCode"]) ? { label: text(e["regionCode"]) } : {}),
    })).filter((d) => d.number),
  };
}

/** Graph's onlineMeeting as Vyre's conference: the Teams (or Skype) link, the toll numbers and the conference id as the PIN. */
export function fromOnlineMeeting(om: Json, providerName?: string): Conference | undefined {
  const url = text(om["joinUrl"]);
  const pin = text(om["conferenceId"]);
  const numbers = [text(om["tollNumber"]), ...list(om["tollFreeNumbers"]).filter((x): x is string => typeof x === "string")].filter(Boolean);
  if (!url || (!pin && !numbers.length)) return undefined;   // a bare link is the event's join link; the conference is what the dial-in adds
  return {
    provider: conferenceOfUrl(url) ?? (/teams/i.test(providerName ?? "") ? "teams" : "other"), url, ...(pin ? { meetingId: pin } : {}),
    dialIns: numbers.map((n) => ({ number: n, ...(pin ? { pin: `${pin}#` } : {}) })),
  };
}

/** The fields of a stored row as a push sends them. */
export const fieldsOf = (row: Row): PushFields => ({
  title: str(row, "title"), startsAt: num(row, "startsAt"), endsAt: num(row, "endsAt"), allDay: num(row, "allDay") === 1, location: strOrNull(row, "location"),
  description: strOrNull(row, "description"), attendees: readAttendees(row.attendees),
});
