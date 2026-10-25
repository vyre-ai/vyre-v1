// The Calendar's menus, as data: the event's right-click menu, the length and calendar pickers of the new event card, the people menu of the header. Pure, so a test can read them without a click.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { LENGTHS, lengthText } from "./model.ts";
import type { CalendarRow, MenuFacts } from "./model.ts";

export interface EventMenuHandlers {
  open(): void;
  join(): void;
  openRecord(): void;
  openConversation(): void;
  moveTo(calendarId: string): void;
  duplicate(): void;
  remove(): void;
}

/** Open, Join, Open Record, Open Conversation, Move to a calendar, Duplicate, Delete (spec 3.3 flow 4). Join, Open Record and Open Conversation appear only when the event has them. */
export function eventMenuEntries(f: MenuFacts, h: EventMenuHandlers): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "Open", onSelect: h.open }];
  if (f.joinUrl) out.push({ label: "Join", onSelect: h.join });
  if (f.record) out.push({ label: "Open Record", onSelect: h.openRecord });
  if (f.conversation) out.push({ label: "Open Conversation", onSelect: h.openConversation });
  out.push({ separator: true }, { head: "Move to a calendar" });
  for (const c of f.calendars) out.push({ label: c.title, checked: c.current, onSelect: () => { if (!c.current) h.moveTo(c.id); } });
  out.push({ separator: true }, { label: "Duplicate", onSelect: h.duplicate }, { label: "Delete", danger: true, onSelect: h.remove });
  return out;
}

export function lengthMenuEntries(current: number, pick: (minutes: number) => void): MenuEntry[] {
  return [{ head: "Length" }, ...LENGTHS.map((m) => ({ label: lengthText(m), checked: m === current, onSelect: () => pick(m) }))];
}

export function calendarMenuEntries(calendars: readonly CalendarRow[], current: string, pick: (id: string) => void): MenuEntry[] {
  return [{ head: "Calendar" }, ...calendars.map((c) => ({ label: c.title, checked: c.id === current, onSelect: () => pick(c.id) }))];
}

export function peopleMenuEntries(team: readonly { email: string; name: string }[], chosen: readonly string[], me: string, on: { toggle(email: string): void; clear(): void }): MenuEntry[] {
  const out: MenuEntry[] = [{ head: "Show when people are free" }];
  for (const p of team) if (p.email !== me) out.push({ label: p.name, checked: chosen.includes(p.email), onSelect: () => on.toggle(p.email) });
  if (chosen.length > 0) out.push({ separator: true }, { label: "Clear", onSelect: on.clear });
  return out;
}

export function dayMenuEntries(on: { newHere(): void; goDay(): void }): MenuEntry[] {
  return [{ label: "New Event Here", onSelect: on.newHere }, { label: "Open Day", onSelect: on.goDay }];
}
