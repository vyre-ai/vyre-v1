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
const at = (dayOffset: number, h: number, m = 0): number => DAY0 + dayOffset * DAY + h * HOUR + m * MIN;
const att = (...emails: string[]): EventRow["attendees"] => emails.map((email) => ({ email, name: TEAM.find((t) => t.email === email)?.name ?? email, response: "accepted" as const }));
const ev = (id: string, calendarId: string, title: string, startsAt: number, endsAt: number, o: Partial<EventRow> = {}): EventRow =>
  ({ id, calendarId, title, startsAt, endsAt, allDay: false, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed", ...o });

function nwEvents(): EventRow[] {
  const out: EventRow[] = [];
  // the daily standup, Monday to Friday, three weeks around today
  for (let d = -18; d <= 17; d++) {
    const wd = new Date(DAY0 + d * DAY).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(ev(`standup_${d}`, "cal_work", "Team standup", at(d, 9, 30), at(d, 10, 0), { attendees: att(ME, "maya@northwind.example", "omar@northwind.example", "lena@northwind.example") }));
  }
  out.push(
    ev("e_lease_review", "cal_work", "Lease review with Marcus", at(-4, 14), at(-4, 15), { attendees: att(ME, "omar@northwind.example") }),
    ev("e_intake", "cal_work", "Intake call: Elena Rivera", at(-3, 10), at(-3, 11), { joinProvider: "zoom", joinUrl: "https://zoom.example/j/4415", recordIds: ["rec_elena"], attendees: [...att(ME), { email: OUTSIDE.email, name: OUTSIDE.name, contactId: "ct_elena", response: "accepted" }] }),
    ev("e_dentist", "cal_pers", "Dentist", at(-3, 13), at(-3, 13, 30)),
    ev("e_spring", "cal_ms", "Spring check-in review", at(-2, 11), at(-2, 12, 30), { attendees: att(ME, "lena@northwind.example") }),
    ev("e_ooo", "cal_work", "Lena out of office", at(-1, 0), at(0, 0), { allDay: true }),
    ev("e_renewal", "cal_work", "Renewal quote with Whitfield", at(-1, 15), at(-1, 16), { recordIds: ["rec_whitfield"], attendees: att(ME) }),
    ev("e_lease_call", "cal_work", "Lease call with Elena", at(0, 11), at(0, 11, 45), {
      joinProvider: "zoom", joinUrl: "https://zoom.example/j/9902", recordIds: ["rec_elena", "rec_lease"], bookedByAgentId: "agt_intake", fromBookingPage: "Book a lease call",
      attendees: [...att(ME), { email: OUTSIDE.email, name: OUTSIDE.name, contactId: "ct_elena", response: "needs_action" }],
    }),
    ev("e_planning", "cal_work", "Quarterly planning", at(0, 14), at(0, 15), { attendees: att(ME, "maya@northwind.example") }),
    ev("e_invoices", "cal_ms", "Invoice review", at(0, 14, 30), at(0, 15, 30), { attendees: att(ME, "omar@northwind.example") }),
    ev("e_dinner", "cal_pers", "Dinner with Grace", at(0, 19), at(0, 20, 30)),
    ev("e_sat", "cal_pers", "Farmers market", at(1, 9), at(1, 10)),
    ev("e_mon1", "cal_work", "Client intake: Priya Nair", at(3, 10, 30), at(3, 11, 30), { joinProvider: "meet", joinUrl: "https://meet.example/abc-defg", attendees: att(ME) }),
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

export function createCalendarSample(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): CalendarSample {
  const base = createSampleInbox(space, o);
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
    "calendar.create_event": (i: { calendarId: string; title: string; startsAt: number; endsAt: number; attendees?: EventRow["attendees"]; joinProvider?: EventRow["joinProvider"] }) => {
      const e = ev(`evt_new_${++n}`, i.calendarId, i.title, i.startsAt, i.endsAt, { attendees: i.attendees ?? [], joinProvider: i.joinProvider ?? "none", ...(i.joinProvider && i.joinProvider !== "none" ? { joinUrl: `https://zoom.example/j/${1000 + n}` } : {}) });
      replica.put("events", [e as unknown as Row]);
      return { event: e };
    },
    "calendar.update_event": (i: { eventId: string; startsAt?: number; endsAt?: number; title?: string; calendarId?: string }) => {
      const cur = rows().find((e) => e.id === i.eventId);
      if (!cur) throw new Error(`no such event ${i.eventId}`);
      const next = { ...cur, ...(i.startsAt !== undefined ? { startsAt: i.startsAt } : {}), ...(i.endsAt !== undefined ? { endsAt: i.endsAt } : {}), ...(i.title !== undefined ? { title: i.title } : {}), ...(i.calendarId !== undefined ? { calendarId: i.calendarId } : {}) };
      replica.put("events", [next as unknown as Row]);
      return { event: next };
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
  };
  const data: InboxData = {
    ...base.data,
    async call(cap, input) {
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
