// Calendar > event pane, the pure part (lane l-calevents, owner 3 Nov): the words for when an event is and how it repeats, each guest's answer, the description's links, the event's
// link, and what an edit sends. No React, no clock of its own.
import type { CapMap } from "../../../../../../../generated/types.ts";
import { DAY, MIN, clock, dayText, range, startOfDay } from "../model.ts";

export type EventFull = CapMap["calendar.get_event"]["out"];
export type EventRow = EventFull["event"];
export type Repeats = NonNullable<EventFull["repeats"]>;
export type Response = NonNullable<EventRow["attendees"][number]["response"]>;
export type Closeout = CapMap["meetings.closeout.get"]["out"];
export type Prep = CapMap["meetings.prep.get"]["out"];

export const RESPONSE_LABEL: Readonly<Record<Response, string>> = { accepted: "Going", declined: "Declined", tentative: "Maybe", needs_action: "Not answered" };
/** The Going? buttons, in the order a person reads them. */
export const RSVP: ReadonlyArray<{ response: Exclude<Response, "needs_action">; label: string }> = [
  { response: "accepted", label: "Yes" }, { response: "declined", label: "No" }, { response: "tentative", label: "Maybe" },
];

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The viewer's own time zone, as their clock names it (GMT+5, PKT, UTC); empty when the platform cannot say. */
export function zoneName(at: number): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "Thursday, Oct 9 · 2:00 to 2:45 PM", or "· All day", in the viewer's time (an all-day event is a date, so it reads in UTC like the server keeps it). */
export function whenLine(e: Pick<EventRow, "startsAt" | "endsAt" | "allDay">, offsetMin: number): string {
  return e.allDay ? `${dayText(e.startsAt, 0)} · All day` : `${dayText(e.startsAt, offsetMin)} · ${range(e.startsAt, e.endsAt, offsetMin)}`;
}

/** "Every Monday", "Every other Thursday", "Every weekday": what the instances of the series say. */
export function repeatsLine(r: Repeats | undefined, startsAt: number, offsetMin: number): string {
  if (!r) return "";
  const wd = WEEKDAY[new Date(startsAt + offsetMin * MIN).getUTCDay()] ?? "";
  if (r === "week") return `Every ${wd}`;
  if (r === "two_weeks") return `Every other ${wd}`;
  if (r === "day") return "Every day";
  if (r === "weekday") return "Every weekday";
  if (r === "month") return "Every month";
  return "Repeats";
}

/** "3 going, 1 maybe, 2 not answered": the guest list in one line. */
export function rsvpSummary(attendees: readonly { response?: Response }[]): string {
  const n = (k: Response): number => attendees.filter((a) => (a.response ?? "needs_action") === k).length;
  return ([["accepted", "going"], ["tentative", "maybe"], ["declined", "declined"], ["needs_action", "not answered"]] as const).filter(([k]) => n(k) > 0).map(([k, w]) => `${n(k)} ${w}`).join(", ");
}

/** A description cut into text and links, so the links can be pressed. */
export function linkParts(text: string): Array<{ text: string; url?: string }> {
  const out: Array<{ text: string; url?: string }> = [];
  const re = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], url: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The event's own link: Cmd-K, chat and Copy Link all speak vyre:// links; the shell opens it in Inbox, Calendar. */
export const eventLink = (id: string): string => `vyre://event/${id}`;

/** The name of a guest: the one the invitation carries, else a person of the Space, else the address. */
export const guestName = (a: { email: string; name?: string }, names: ReadonlyMap<string, string>): string => a.name || names.get(a.email.toLowerCase()) || a.email;

export interface EditDraft { title: string; day: string; time: string; minutes: number; people: string[] }

const pad = (n: number): string => String(n).padStart(2, "0");
/** The edit fields of an event, in the viewer's time: the day as 2026-11-07 and the start as 14:30. */
export function editDraft(e: EventRow, offsetMin: number): EditDraft {
  const d = new Date(e.startsAt + offsetMin * MIN);
  return {
    title: e.title, day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    minutes: Math.max(15, Math.round((e.endsAt - e.startsAt) / MIN)), people: e.attendees.map((a) => a.email),
  };
}

/** What Save sends: only what changed. A day or time that does not read is an error to show, never a guess. */
export function editInput(e: EventRow, d: EditDraft, offsetMin: number): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.day.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(d.time.trim());
  if (!dm) return { ok: false, error: "Write the day as 2026-11-07." };
  if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) return { ok: false, error: "Write the time as 14:30." };
  const startsAt = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2])) - offsetMin * MIN;
  if (!Number.isFinite(startsAt)) return { ok: false, error: "That day does not exist." };
  const endsAt = startsAt + d.minutes * MIN;
  const patch: Record<string, unknown> = {};
  const title = d.title.trim();
  if (title && title !== e.title) patch["title"] = title;
  if (startsAt !== e.startsAt || endsAt !== e.endsAt) { patch["startsAt"] = startsAt; patch["endsAt"] = endsAt; }
  const was = e.attendees.map((a) => a.email.toLowerCase()).sort().join();
  if ([...d.people].map((p) => p.toLowerCase()).sort().join() !== was) {
    patch["attendees"] = d.people.map((email) => e.attendees.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? { email });
  }
  return { ok: true, patch };
}

/** The same fields as they were, for Undo. */
export function undoInput(e: EventRow, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("title" in patch) out["title"] = e.title;
  if ("startsAt" in patch) { out["startsAt"] = e.startsAt; out["endsAt"] = e.endsAt; }
  if ("attendees" in patch) out["attendees"] = e.attendees;
  return out;
}

/** An ended meeting shows its close-out; one still to come offers Prepare. */
export const ended = (e: Pick<EventRow, "endsAt">, now: number): boolean => e.endsAt < now;

/** "Today", "Tomorrow" or the day, for the prep notes' line. */
export function relDay(at: number, now: number, offsetMin: number): string {
  const d = Math.round((startOfDay(at, offsetMin) - startOfDay(now, offsetMin)) / DAY);
  return d === 0 ? `Today ${clock(at, offsetMin)}` : d === -1 ? `Yesterday ${clock(at, offsetMin)}` : dayText(at, offsetMin);
}

/** True when a failed read says the event does not exist (validation.not_found), as opposed to a read that did not get through. */
export function goneError(x: unknown): boolean {
  const e = x as { code?: unknown; error?: { code?: unknown } } | null;
  return e?.code === "validation.not_found" || e?.error?.code === "validation.not_found";
}
