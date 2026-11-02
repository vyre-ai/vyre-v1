// The Calendars rows of the Inbox sidebar, the pure part: what a row is called, what its menu offers, what its status line says and what a key does. No React.
// A row is one calendar: click shows or hides it in the view, right-click and the "..." open its menu, Up and Down move, Space toggles, Enter shows only it.
import type { MenuEntry } from "../../../../../../ui/src/Menu/props.ts";
import type { CalendarRow, Mailbox } from "./model.ts";

/** The words a provider calendar was given before it had a real name. A row never shows these when it can say whose calendar it is. */
const GENERIC = new Set(["google calendar", "outlook calendar", "microsoft calendar", "calendar"]);

export const isGenericTitle = (title: string): boolean => GENERIC.has(title.trim().toLowerCase());

/**
 * The calendar's real name: its own title, or for a provider calendar still called "Google Calendar", the address of the owner's own mailbox on the same provider (the account the
 * calendar is read as). With no single such mailbox the title stays as it is.
 */
export function calendarName(c: CalendarRow, mailboxes: readonly Mailbox[] = []): string {
  if (c.provider === "local" || !isGenericTitle(c.title)) return c.title;
  const own = mailboxes.filter((m) => m.kind === "personal" && m.provider === c.provider && m.ownerId === c.ownerId && m.address.includes("@"));
  return own.length === 1 ? own[0]!.address : c.title;
}

/** The provider's own app for a calendar, as the menu and the mark say it; null for a calendar kept in Vyre. */
export function providerApp(c: Pick<CalendarRow, "provider">): { brand: "gcal" | "microsoft"; name: string } | null {
  if (c.provider === "google") return { brand: "gcal", name: "Google Calendar" };
  if (c.provider === "microsoft") return { brand: "microsoft", name: "Outlook" };
  return null;
}

/** Where "Open in Google Calendar" goes: the provider's web calendar, signed in as the calendar's account when the name is an address. */
export function providerUrl(c: Pick<CalendarRow, "provider">, name: string): string | null {
  const who = name.includes("@") ? name : "";
  if (c.provider === "google") return `https://calendar.google.com/calendar/r${who ? `?authuser=${encodeURIComponent(who)}` : ""}`;
  if (c.provider === "microsoft") return `https://outlook.office.com/calendar/view/week${who ? `?login_hint=${encodeURIComponent(who)}` : ""}`;
  return null;
}

/** The colours a calendar can take: the server's palette, named. */
export const CALENDAR_COLOURS: readonly { name: string; hex: string }[] = [
  { name: "Blue", hex: "#4f6bed" }, { name: "Green", hex: "#16a085" }, { name: "Orange", hex: "#d35400" },
  { name: "Purple", hex: "#8e44ad" }, { name: "Red", hex: "#c0392b" }, { name: "Slate", hex: "#2c3e50" },
];

/** The quiet line under a row: a pull the person started is running, or the last pull failed. Null when there is nothing to say. */
export type CalendarStatus = { kind: "syncing"; text: string } | { kind: "failed"; text: string; action: string } | null;

export function calendarStatus(c: Pick<CalendarRow, "provider" | "state">, running: boolean, failed: boolean): CalendarStatus {
  if (c.provider === "local") return null;
  if (running) return { kind: "syncing", text: "Syncing…" };
  if (failed || c.state === "error") return { kind: "failed", text: "Couldn't sync", action: "Retry" };
  return null;
}

/** May this person ask for a pull now? Their own provider calendar: yes. Someone else's, or a local one: no, and the reason says why. */
export function canSyncNow(c: Pick<CalendarRow, "provider" | "ownerId">, me: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (c.provider === "local") return { ok: false, reason: "This calendar is kept in Vyre, so there is nothing to pull" };
  if (me !== undefined && c.ownerId !== me) return { ok: false, reason: "Only the person whose calendar it is can sync it" };
  return { ok: true };
}

export interface CalendarMenuActions {
  only(): void;
  colour(): void;
  syncNow(): void;
  openIn(url: string): void;
  settings(): void;
}

/** The row's menu: Show only this calendar, Colour, Sync now, Open in the provider's app, Calendar settings. */
export function calendarRowMenu(c: CalendarRow, name: string, me: string | undefined, a: CalendarMenuActions, canOpenIn = true): MenuEntry[] {
  const out: MenuEntry[] = [
    { label: "Show only this calendar", onSelect: a.only },
    { label: "Colour…", onSelect: a.colour },
  ];
  const app = providerApp(c);
  if (app !== null) {
    out.push({ separator: true });
    const sync = canSyncNow(c, me);
    out.push(sync.ok ? { label: "Sync now", onSelect: a.syncNow } : { label: "Sync now", disabled: true, reason: sync.reason });
    const url = providerUrl(c, name);
    if (url !== null && canOpenIn) out.push({ label: `Open in ${app.name}`, onSelect: () => a.openIn(url) });
  }
  out.push({ separator: true });
  out.push({ label: "Calendar settings", onSelect: a.settings });
  return out;
}

/** The colour menu: each colour with its name, the current one checked. */
export function calendarColourMenu(current: string, pick: (hex: string) => void): MenuEntry[] {
  return CALENDAR_COLOURS.map((c) => ({ label: c.name, checked: c.hex.toLowerCase() === current.toLowerCase(), onSelect: () => pick(c.hex) }));
}

/** What a key does on a focused calendar row: Up and Down move between rows, Space toggles, Enter shows only this one. Null: the key is not the row's. */
export type CalendarRowKey = { type: "move"; to: number } | { type: "toggle" } | { type: "only" } | null;

export function calendarRowKey(key: string, index: number, count: number): CalendarRowKey {
  if (key === "ArrowDown") return index + 1 < count ? { type: "move", to: index + 1 } : null;
  if (key === "ArrowUp") return index > 0 ? { type: "move", to: index - 1 } : null;
  if (key === " " || key === "Spacebar") return { type: "toggle" };
  if (key === "Enter") return { type: "only" };
  return null;
}
