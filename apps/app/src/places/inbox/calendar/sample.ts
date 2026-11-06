// The sample calendar behind the Calendar tests and screenshots, on top of the Inbox sample (../contactlist/sample.ts). Friday 24 October 2025 is today. Northwind has a week of events across
// its three calendars (Work Google, Microsoft, Personal) with overlapping ones, an all-day one, a booked-by-agent one and a joinable one; the team's busy patterns come from
// the same table the Find a time resolver reads, so a shaded stripe and a suggestion always agree. Writes change the rows, as the real replica would.
import type { Row } from "../../../../../../client/src/index.ts";
import type { InboxData } from "../sidebar/data.tsx";
import { SAMPLE_NOW, createSampleInbox, northwind } from "../contactlist/sample.ts";
import type { SampleInbox, SampleSpace } from "../contactlist/sample.ts";
import { DAY, HOUR, MIN, STEP } from "./model.ts";
import type { Busy, EventRow, Slot } from "./model.ts";

export const ME = "irfad@northwind.example";
export interface Person { email: string; name: string }
export const TEAM: readonly Person[] = [
  { email: ME, name: "Irfad Imtiaz" },
  { email: "maya@northwind.example", name: "Maya Chen" },
  { email: "omar@northwind.example", name: "Omar Haddad" },
  { email: "lena@northwind.example", name: "Lena Ortiz" },
];
/** Someone who has not shared a calendar. */
export const OUTSIDE: Person = { email: "elena@example.test", name: "Elena Rivera" };

/** Busy from Monday to Friday, as hours and minutes: [start hour, start min, end hour, end min]. */
const BASE_BUSY: Record<string, readonly (readonly [number, number, number, number])[]> = {
  "maya@northwind.example": [[10, 0, 11, 0], [14, 0, 15, 30]],
  "omar@northwind.example": [[13, 0, 15, 0]],
  "lena@northwind.example": [[11, 0, 12, 30], [16, 0, 17, 0]],
};

const DAY0 = Date.UTC(2025, 9, 24); // Friday 24 October, midnight UTC (the sample person's day is UTC)
// whole days the sample is moved by, so a screenshot has its today be the real today; 0 for the tests
let SHIFT = 0;
const at = (dayOffset: number, h: number, m = 0): number => DAY0 + SHIFT + dayOffset * DAY + h * HOUR + m * MIN;
/** The whole days from the sample's today to the day `now` falls in. */
export const daysTo = (now: number): number => Math.floor(now / DAY) - Math.floor(SAMPLE_NOW / DAY);
const att = (...emails: string[]): EventRow["attendees"] => emails.map((email) => ({ email, name: TEAM.find((t) => t.email === email)?.name ?? email, response: "accepted" as const }));
const ev = (id: string, calendarId: string, title: string, startsAt: number, endsAt: number, o: Partial<EventRow> = {}): EventRow =>
  ({ id, calendarId, title, startsAt, endsAt, allDay: false, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed", ...o });

function nwEvents(): EventRow[] {
  const out: EventRow[] = [];
  // the daily standup, Monday to Friday, three weeks around today
  for (let d = -18; d <= 17; d++) {
    const wd = new Date(DAY0 + SHIFT + d * DAY).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(ev(`standup_${d}`, "cal_work", "Team standup", at(d, 9, 30), at(d, 10, 0), { seriesId: "standup", organizer: "maya@northwind.example", attendees: att(ME, "maya@northwind.example", "omar@northwind.example", "lena@northwind.example") }));
  }
  out.push(
    ev("e_lease_review", "cal_work", "Lease review with Marcus", at(-4, 14), at(-4, 15), { attendees: att(ME, "omar@northwind.example") }),
    ev("e_intake", "cal_work", "Intake call: Elena Rivera", at(-3, 10), at(-3, 11), {
      meetingId: "rec_m_intake", organizer: ME, description: "Booked from the Consult page. Intake form: https://forms.northwind.example/intake/elena", joinProvider: "zoom", joinUrl: "https://zoom.example/j/4415", recordIds: ["rec_elena"], attendees: [...att(ME), { email: OUTSIDE.email, name: OUTSIDE.name, contactId: "ct_elena", response: "accepted" }] }),
    ev("e_dentist", "cal_pers", "Dentist", at(-3, 13), at(-3, 13, 30)),
    ev("e_spring", "cal_ms", "Spring check-in review", at(-2, 11), at(-2, 12, 30), { attendees: att(ME, "lena@northwind.example") }),
    ev("e_ooo", "cal_work", "Lena out of office", at(-1, 0), at(0, 0), { allDay: true }),
    ev("e_renewal", "cal_work", "Renewal quote with Whitfield", at(-1, 15), at(-1, 16), { recordIds: ["rec_whitfield"], attendees: att(ME) }),
    ev("e_lease_call", "cal_work", "Lease call with Elena", at(0, 11), at(0, 11, 45), {
      joinProvider: "zoom", joinUrl: "https://us02web.zoom.us/j/84512345678?pwd=Q2x", recordIds: ["rec_elena", "rec_lease"], bookedByAgentId: "agt_intake", fromBookingPage: "Book a lease call", organizer: "maya@northwind.example",
      conference: { provider: "zoom", url: "https://us02web.zoom.us/j/84512345678?pwd=Q2x", meetingId: "84512345678", passcode: "551203", dialIns: [{ number: "+1 669 444 9171", pin: "84512345678#", label: "US" }, { number: "+1 646 931 3860", pin: "84512345678#", label: "US" }] },
      description: "Draft 3 of the lease, clause by clause. The draft: https://files.northwind.example/elena/lease-draft-3.pdf",
      attendees: [...att(ME), { email: OUTSIDE.email, name: OUTSIDE.name, contactId: "ct_elena", response: "needs_action" }],
    }),
    ev("e_planning", "cal_work", "Quarterly planning", at(0, 14), at(0, 15), {
      organizer: ME, attendees: att(ME, "maya@northwind.example"), location: "Room 4, Northwind office, 410 Valencia St, San Francisco", joinProvider: "meet", joinUrl: "https://meet.google.com/abc-defg-hij",
      conference: { provider: "meet", url: "https://meet.google.com/abc-defg-hij", meetingId: "abc-defg-hij", dialIns: [{ number: "+1 415-555-0161", pin: "264326521#", label: "US" }] },
    }),
    ev("e_invoices", "cal_ms", "Invoice review", at(0, 14, 30), at(0, 15, 30), {
      attendees: att(ME, "omar@northwind.example"), organizer: "omar@northwind.example", joinProvider: "teams", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA4%40thread.v2/0",
      conference: { provider: "teams", url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA4%40thread.v2/0", meetingId: "482991733", dialIns: [{ number: "+1 323-555-0144", pin: "482991733#" }] },
    }),
    ev("e_vendor", "cal_work", "Supplier call: Harbor Freight", at(1, 11), at(1, 11, 30), { attendees: att(ME), organizer: "maya@northwind.example", location: "+1 415 555 0132", description: "Dial in and enter PIN 4471 when asked." }),
    ev("e_dinner", "cal_pers", "Dinner with Grace", at(0, 19), at(0, 20, 30), { location: "Tartine Manufactory, 595 Alabama St, San Francisco" }),
    ev("e_sat", "cal_pers", "Farmers market", at(1, 9), at(1, 10)),
    ev("e_mon1", "cal_work", "Client intake: Priya Nair", at(3, 10, 30), at(3, 11, 30), { joinProvider: "meet", joinUrl: "https://meet.example/abc-defg", attendees: att(ME) }),
  );
  // a crowded week like a real one (Monday to Thursday of today's week): overlaps, long Block and Focus events, repeated and multi-day all-day items
  const MON = -((new Date(DAY0 + SHIFT).getUTCDay() + 6) % 7);
  const day = (id: string, cal: string, title: string, d: number, o: Partial<EventRow> = {}): EventRow => ev(id, cal, title, at(d, 0), at(d + 1, 0), { allDay: true, ...o });
  out.push(
    ev("e_x_block", "cal_work", "Block", at(MON + 1, 9), at(MON + 1, 17)),
    ev("e_x_focus", "cal_work", "Focus", at(MON + 3, 8, 30), at(MON + 3, 16)),
    ev("e_x_prep", "cal_work", "Block 10:00 prep for Hartwell", at(MON + 2, 10), at(MON + 2, 12)),
    ev("e_x_nda", "cal_work", "NDA walk-through: Alvarez Design", at(MON + 2, 10), at(MON + 2, 10, 30), { attendees: att(ME) }),
    ev("e_x_priya", "cal_work", "Meeting with Priya", at(MON + 2, 10), at(MON + 2, 10, 30), { attendees: att(ME) }),
    ev("e_x_hart", "cal_ms", "The Hartwell intake call", at(MON + 2, 10, 15), at(MON + 2, 11), { attendees: att(ME, "lena@northwind.example"), joinProvider: "teams", joinUrl: "https://teams.microsoft.com/l/meetup-join/hartwell" }),
    ev("e_x_pipe", "cal_work", "Pipeline review", at(MON + 3, 10), at(MON + 3, 10, 45), { attendees: att(ME, "maya@northwind.example", "omar@northwind.example"), joinProvider: "meet", joinUrl: "https://meet.google.com/pip-eline-rev" }),
    ev("e_x_omar", "cal_ms", "Quick sync: Omar", at(MON + 3, 10, 30), at(MON + 3, 11), { attendees: att(ME, "omar@northwind.example") }),
    day("e_x_up1", "cal_work", "MLA Updates", MON + 0), day("e_x_up2", "cal_work", "MLA Updates", MON + 1), day("e_x_up2b", "cal_work", "MLA Updates", MON + 1),
    day("e_x_up3", "cal_work", "MLA Updates", MON + 2), day("e_x_up3b", "cal_work", "MLA Updates", MON + 2), day("e_x_up4", "cal_work", "MLA Updates", MON + 3),
    day("e_x_off", "cal_ms", "Offsite prep", MON + 1), day("e_x_bd", "cal_work", "Birthday: Maya", MON + 2), day("e_x_car", "cal_pers", "Car service", MON + 2),
    ev("e_x_summit", "cal_pers", "LegalTech Summit", at(MON + 2, 0), at(MON + 4, 0), { allDay: true }),
  );
  return out;
}

function harborEvents(): EventRow[] {
  return [
    ev("h_review", "cal_h", "Logo review with Kai", at(-1, 10), at(-1, 11), { joinProvider: "meet", joinUrl: "https://meet.example/kai-logo", attendees: att(ME) }),
    ev("h_studio", "cal_h", "Studio day", at(0, 9), at(0, 17)),
    ev("h_signage", "cal_h", "Signage proofs", at(0, 13), at(0, 14)),
  ];
}

function sampleOffset(): number {
  try { const v = Number(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("tzoff")); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}

export interface CalendarSample extends SampleInbox {
  /** Every calendar write, in order. */
  writes: { cap: string; input: unknown }[];
  events(): EventRow[];
}

/** Busy periods of a person over [from, to): their weekday pattern plus the events they attend. */
export function busyOf(people: readonly string[], from: number, to: number, events: readonly EventRow[]): Busy[] {
  const out: Busy[] = [];
  for (const who of people) {
    for (let d = Math.floor(from / DAY) * DAY; d < to; d += DAY) {
      const wd = new Date(d).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (const [sh, sm, eh, em] of BASE_BUSY[who] ?? []) out.push({ who, startsAt: d + sh * HOUR + sm * MIN, endsAt: d + eh * HOUR + em * MIN });
    }
    for (const e of events) if (!e.allDay && e.status !== "canceled" && e.startsAt < to && e.endsAt > from && e.attendees.some((a) => a.email === who)) out.push({ who, startsAt: e.startsAt, endsAt: e.endsAt });
  }
  return out;
}

/** Slots inside working hours (9:00 to 17:30) on weekdays when everyone, and the person, is free; at most two a day. */
export function slotsFor(people: readonly string[], minutes: number, from: number, to: number, events: readonly EventRow[], limit: number): Slot[] {
  const everyone = [...new Set([...people, ME])];
  const busy = busyOf(everyone, from, to, events);
  const out: Slot[] = [];
  for (let d = Math.floor(from / DAY) * DAY; d < to && out.length < limit; d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    let perDay = 0;
    for (let t = d + 9 * HOUR; t + minutes * MIN <= d + 17.5 * HOUR && perDay < 2 && out.length < limit; t += STEP) {
      if (t < from) continue;
      if (!busy.some((b) => b.startsAt < t + minutes * MIN && b.endsAt > t)) {
        out.push({ startsAt: t, endsAt: t + minutes * MIN });
        perDay++;
        t += 45 * MIN;
      }
    }
  }
  return out;
}

export function createCalendarSample(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number; shiftDays?: number } = {}): CalendarSample {
  SHIFT = (o.shiftDays ?? 0) * DAY;
  const base = createSampleInbox(space, { online: o.online, bulk: o.bulk } as Parameters<typeof createSampleInbox>[1]);
  const { replica } = base;
  const writes: CalendarSample["writes"] = [];
  const rows = (): EventRow[] => replica.rows("events") as unknown as EventRow[];
  replica.put("events", (space.id === "northwind" ? nwEvents() : harborEvents()) as unknown as Row[]);

  replica.resolve("calendar.list_events", (_t, i) => {
    const events = rows().filter((e) => e.status !== "canceled" && e.startsAt < i.to && e.endsAt > i.from && (!i.calendarIds || i.calendarIds.includes(e.calendarId)));
    return { events: events.sort((a, b) => a.startsAt - b.startsAt), total: events.length };
  });
  replica.resolve("calendar.availability", (_t, i) => {
    const known = i.people.filter((p) => p === ME || p in BASE_BUSY);
    return { busy: busyOf(known, i.from, i.to, rows()), unknown: i.people.filter((p) => !known.includes(p)) };
  });

  let n = 0;
  const w: Record<string, (i: never) => unknown> = {
    "calendar.create_event": (i: { calendarId: string; title: string; startsAt: number; endsAt: number; attendees?: EventRow["attendees"]; joinProvider?: EventRow["joinProvider"]; video?: "meet" | "zoom" | "teams" }) => {
      // the server makes the call through the connection; here it answers with a link of that kind
      const link = i.video === "meet" ? "https://meet.google.com/new-ewnt-abc" : i.video === "teams" ? "https://teams.microsoft.com/l/meetup-join/new" : i.video === "zoom" ? `https://us02web.zoom.us/j/8${1000 + n}` : undefined;
      const e = ev(`evt_new_${++n}`, i.calendarId, i.title, i.startsAt, i.endsAt, { attendees: i.attendees ?? [], joinProvider: i.video ?? i.joinProvider ?? "none", ...(link ? { joinUrl: link, conference: { provider: i.video!, url: link, dialIns: [] } } : {}) });
      replica.put("events", [e as unknown as Row]);
      return { event: e };
    },
    "calendar.update_event": (i: { eventId: string; startsAt?: number; endsAt?: number; title?: string; attendees?: EventRow["attendees"]; scope?: "this" | "all" }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      // All events of a series: every instance not yet ended takes the title and moves by the same amount (the server does the same, modules/calendar updateSeries)
      const shift = i.startsAt !== undefined ? i.startsAt - cur.startsAt : 0;
      const len = i.startsAt !== undefined && i.endsAt !== undefined ? i.endsAt - i.startsAt : cur.endsAt - cur.startsAt;
      const series = i.scope === "all" && cur.seriesId ? rows().filter((e) => e.seriesId === cur.seriesId && (e.id === cur.id || e.endsAt > SAMPLE_NOW + SHIFT)) : [cur];
      const out = series.map((e) => {
        const startsAt = e.id === cur.id ? (i.startsAt ?? e.startsAt) : e.startsAt + shift;
        return { ...e, ...(i.startsAt !== undefined || i.endsAt !== undefined ? { startsAt, endsAt: e.id === cur.id ? (i.endsAt ?? startsAt + len) : startsAt + len } : {}), ...(i.title !== undefined ? { title: i.title } : {}), ...(i.attendees !== undefined ? { attendees: i.attendees } : {}) };
      });
      replica.put("events", out as unknown as Row[]);
      return { event: out.find((e) => e.id === cur.id), ...(i.scope === "all" ? { changed: out.length } : {}) };
    },
    "calendar.delete_event": (i: { eventId: string }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      replica.put("events", [{ ...cur, status: "canceled" } as unknown as Row]);
      return { deleted: true };
    },
    "calendar.restore_event": (i: { eventId: string }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      replica.put("events", [{ ...cur, status: "confirmed" } as unknown as Row]);
      return { event: { ...cur, status: "confirmed" } };
    },
    "calendar.find_time": (i: { people: string[]; durationMinutes: number; from: number; to: number; limit?: number }) => ({ slots: slotsFor(i.people, i.durationMinutes, i.from, i.to, rows(), i.limit ?? 3) }),
    "calendar.move_to_calendar": (i: { eventId: string; calendarId: string }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      const next = { ...cur, calendarId: i.calendarId };
      replica.put("events", [next as unknown as Row]);
      return { event: next };
    },
    // the event pane's reads and writes (lane l-calevents)
    "calendar.respond": (i: { eventId: string; response: "accepted" | "declined" | "tentative" }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      const next = { ...cur, attendees: cur.attendees.map((a) => (a.email === ME ? { ...a, response: i.response } : a)) };
      replica.put("events", [next as unknown as Row]);
      return { event: next };
    },
    "meetings.prep.start": (i: { eventId: string }) => { prep.set(i.eventId, { state: "working", notes: [] }); return { state: "working" }; },
  };
  const prep = new Map<string, { state: "working" | "ready"; notes: string[] }>([["e_planning", { state: "ready", notes: ["Maya wants the Q1 numbers before the call.", "Open from last time: the hiring plan for spring.", "Decide the budget split today."] }]]);
  const reads: Record<string, (i: never) => unknown> = {
    "connections.list": () => ({ connections: [{ connector: "zoom", state: "active" }, { connector: "google", state: "active" }] }),
    "calendar.get_event": (i: { eventId: string }) => {
      const e = rows().find((x) => x.id === i.eventId);
      if (!e) throw Object.assign(new Error("There is no such event."), { code: "validation.not_found" });
      const me = e.attendees.find((a) => a.email === ME);
      return { event: e, ...(me ? { mine: { email: ME, response: me.response ?? "needs_action" } } : {}), ...(e.seriesId ? { repeats: "weekday" } : {}) };
    },
    "meetings.prep.get": (i: { eventId: string }) => prep.get(i.eventId) ?? { state: "none", notes: [] },
    "meetings.closeout.get": (i: { meetingId: string }) => {
      if (i.meetingId !== "rec_m_intake") throw new Error("no close-out");
      return {
        meetingId: i.meetingId, title: "Intake call: Elena Rivera", startsAt: at(-3, 10), endsAt: at(-3, 11), attendees: [{ name: "Elena Rivera", email: OUTSIDE.email }], state: "ready",
        summary: "Elena wants the lease reviewed before Friday and may add a second property in spring. Maya owns the first pass; Lena reviews.", decisions: [], questions: [], shared: [],
        items: [
          { itemId: "mci_a", kind: "task", status: "approved", title: "Review draft 3 of the lease", assignee: "usr_lena", made: [{ type: "task", id: "tsk_l3" }] },
          { itemId: "mci_b", kind: "task", status: "proposed", title: "Send Elena the fee quote", assignee: "usr_maya" },
        ],
      };
    },
    "meetings.get": (i: { meetingId: string }) => ({ meeting: { id: i.meetingId, title: "Intake call", startsAt: at(-3, 10), provider: "zoom", status: "ended", attendeeIds: [], recordingState: "attached", hasTranscript: true, hasSummary: true }, recordingFileId: "fil_intake_rec" }),
    "meetings.transcript.get": () => ({ segments: [{ startMs: 0, endMs: 4000, speaker: "Maya", text: "Thanks for booking, Elena." }, { startMs: 4000, endMs: 9000, speaker: "Elena", text: "The lease is the urgent part." }], total: 2 }),
  };
  const data: InboxData = {
    ...base.data,
    // `?tzoff=<minutes east of UTC>` shows the sample to a viewer in another zone (the all-day dates are kept as midnight UTC, as the server keeps them)
    clock: () => ({ now: SAMPLE_NOW + SHIFT, offsetMin: sampleOffset() }),
    async call(cap, input) {
      const r = reads[cap];
      if (r) return r(input as never);
      const h = w[cap];
      if (!h) return base.data.call(cap, input);
      base.calls.push({ cap, input });
      writes.push({ cap, input });
      return h(input as never);
    },
  };
  return { ...base, data, writes, events: rows };
}

export { SAMPLE_NOW };
