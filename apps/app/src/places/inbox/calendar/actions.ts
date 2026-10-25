// What the Calendar asks of the capabilities: one function per action, so the screen and the tests call the same code.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { InboxData } from "../sidebar/data.tsx";
import { createInput } from "./model.ts";
import type { Draft, EventRow, Slot, Span } from "./model.ts";

export const newKey = (): string => globalThis.crypto.randomUUID();

export async function createEvent(data: InboxData, d: Draft, key: string = newKey()): Promise<EventRow> {
  const out = (await data.call("calendar.create_event", createInput(d, key))) as CapMap["calendar.create_event"]["out"];
  return out.event;
}

/** Drag, move and resize all end here: only the times change. */
export async function setTimes(data: InboxData, eventId: string, span: Span): Promise<EventRow> {
  const out = (await data.call("calendar.update_event", { eventId, startsAt: span.startsAt, endsAt: span.endsAt })) as CapMap["calendar.update_event"]["out"];
  return out.event;
}

export async function moveToCalendar(data: InboxData, eventId: string, calendarId: string): Promise<EventRow> {
  const out = (await data.call("calendar.update_event", { eventId, calendarId })) as CapMap["calendar.update_event"]["out"];
  return out.event;
}

/** A copy at the same time on the same calendar (no invitations go out until it is edited). */
export async function duplicateEvent(data: InboxData, e: EventRow, key: string = newKey()): Promise<EventRow> {
  const out = (await data.call("calendar.create_event", {
    calendarId: e.calendarId, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, ...(e.location ? { location: e.location } : {}), idempotencyKey: key,
  })) as CapMap["calendar.create_event"]["out"];
  return out.event;
}

export async function deleteEvent(data: InboxData, eventId: string): Promise<void> {
  await data.call("calendar.delete_event", { eventId });
}

export async function restoreEvent(data: InboxData, eventId: string): Promise<void> {
  await data.call("calendar.restore_event", { eventId });
}

export async function findTime(data: InboxData, people: readonly string[], durationMinutes: number, from: number, to: number, limit = 3): Promise<Slot[]> {
  const out = (await data.call("calendar.find_time", { people: [...people], durationMinutes, from, to, limit, workingHoursOnly: true })) as CapMap["calendar.find_time"]["out"];
  return out.slots;
}
