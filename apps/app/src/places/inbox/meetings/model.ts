// Inbox > Meetings, the pure part: the words for a close-out's state, a row's note, the order the package reads in, and what an approved item links to. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";

export type ListOut = CapMap["meetings.closeout.list"]["out"];
export type MeetingRow = ListOut["meetings"][number];
export type Package = CapMap["meetings.closeout.get"]["out"];
export type Item = Package["items"][number];
export type CloseState = MeetingRow["state"];
export type Made = NonNullable<Item["made"]>[number];

export const SCREEN = "meetings.closeout";

export const STATE_LABEL: Readonly<Record<CloseState, string>> = { ready: "Ready to close", closed: "Closed", nothing: "Nothing to do", preparing: "Preparing" };

/** The sections of a package, in the order a person reads it, and what each is called. */
export const SECTIONS: ReadonlyArray<{ kind: Item["kind"]; title: string }> = [
  { kind: "task", title: "Tasks" },
  { kind: "record", title: "Record updates" },
  { kind: "email", title: "Follow-up email" },
  { kind: "hold", title: "Next meeting" },
];

const DAY = 86_400_000;

/** "Today 10:00", "Yesterday 15:30", "Tue 4 Nov, 10:00": the meeting's start in the person's time. */
export function meetingTime(at: number, now: number, offsetMin: number): string {
  const local = (ms: number): Date => new Date(ms + offsetMin * 60_000);
  const d = local(at);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const dayOf = (ms: number): number => Math.floor((ms + offsetMin * 60_000) / DAY);
  const diff = dayOf(now) - dayOf(at);
  if (diff === 0) return `Today ${hm}`;
  if (diff === 1) return `Yesterday ${hm}`;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mo}, ${hm}`;
}

/** A due date or a hold as a day: "Fri 7 Nov", with the time for a hold. */
export function dayLabel(at: number, offsetMin: number, withTime = false): string {
  const d = new Date(at + offsetMin * 60_000);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${wd} ${d.getUTCDate()} ${mo}${withTime ? `, ${hm}` : ""}`;
}

/** Up to three names, then how many more. */
export function names(list: readonly string[], max = 3): string {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

/** The second line of a row: when, and who was there. */
export function rowNote(m: MeetingRow, now: number, offsetMin: number): string {
  const who = names(m.attendees);
  return who ? `${meetingTime(m.startsAt, now, offsetMin)} · ${who}` : meetingTime(m.startsAt, now, offsetMin);
}

/** The header's count: how many meetings wait for a look. */
export function readyMeta(ready: number): string {
  return ready === 0 ? "" : ready === 1 ? "1 ready to close" : `${ready} ready to close`;
}

/** The items of one section, in the package's order. */
export function itemsOf(p: Package, kind: Item["kind"]): Item[] {
  return p.items.filter((i) => i.kind === kind);
}

/** How many items still wait for a yes. */
export function waiting(p: Package): number {
  return p.items.filter((i) => i.status === "proposed" || i.status === "failed").length;
}

/** The line under an item once it is handled: what approving it made, or that it was skipped. */
export function handledLine(i: Item): string {
  if (i.status === "skipped") return "Skipped";
  if (i.status === "failed") return i.error ?? "That did not go through.";
  const m = i.made ?? [];
  if (m.some((x) => x.type === "approval")) return "Waiting for approval before it sends";
  if (i.kind === "task") return "Task created";
  if (i.kind === "record") return m.some((x) => x.type === "record") ? (m.some((x) => x.type === "comment") ? "Updated, note added" : "Updated") : "Note added";
  if (i.kind === "email") return m.some((x) => x.type === "draft") ? "Saved as a draft" : "Sent";
  return "Added to your calendar";
}

/** Where a made thing opens: a task, a record, the conversation with whoever the email went to, a calendar event (the Inbox's Calendar). */
export function openTarget(m: Made, i: Item, attendees: Package["attendees"]): { subject: { type: string; id: string } } | { contactId: string } | { calendar: true } | null {
  if (m.type === "task" || m.type === "approval") return { subject: { type: "task", id: m.id } };
  if (m.type === "record" || m.type === "comment") return i.recordId ? { subject: { type: "record", id: i.recordId } } : null;
  if (m.type === "email" || m.type === "draft") {
    const who = attendees.find((a) => a.recordId && a.email && (i.to ?? []).some((t) => t.address === a.email));
    return who?.recordId ? { contactId: who.recordId } : null;
  }
  if (m.type === "event") return { calendar: true };
  return null;
}

/** The words of the link to what an item made. */
export function openLabel(m: Made): string {
  if (m.type === "task") return "Open task";
  if (m.type === "approval") return "Open approval";
  if (m.type === "record") return "Open record";
  if (m.type === "comment") return "Open note";
  if (m.type === "email") return "Open conversation";
  if (m.type === "draft") return "Open draft";
  return "Open calendar";
}

/** The task line under a task item: who, and when it is due. */
export function taskMeta(i: Item, nameOf: (id: string) => string, offsetMin: number): string {
  const parts: string[] = [];
  if (i.assignee) parts.push(nameOf(i.assignee));
  else if (i.ownerName) parts.push(i.ownerName);
  if (i.due !== undefined) parts.push(`Due ${dayLabel(i.due, offsetMin)}`);
  return parts.join(" · ");
}

/** "Sam said: …" when the person who said it is not who it is assigned to. */
export function saidBy(i: Item, nameOf: (id: string) => string): string {
  if (!i.ownerName || !i.assignee) return "";
  const n = nameOf(i.assignee);
  return n.toLowerCase().startsWith(i.ownerName.toLowerCase().split(" ")[0] ?? "") ? "" : `${i.ownerName} said they would`;
}
