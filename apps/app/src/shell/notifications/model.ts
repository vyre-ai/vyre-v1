// Notification UI model (spec 2.24, 3.0 title bar, 4.11): which notifications need the person now, how repeats collapse, the dots and counts on places, and the title-bar line for the offline queue.
// Pure functions. What needs the person now is shown in the top bar's notifications slot (shell/noticeslot/bridge.ts).
import type { CapMap } from "../../../../../generated/types.ts";

export type Notification = CapMap["notifications.list"]["out"]["notifications"][number];
export type NotificationAction = Notification["actions"][number];
export type PlaceId = Notification["place"];

/** Same key collapses to one banner: the kind plus what it is about (a thread, a task), else the kind plus the title. */
export function collapseKey(n: Pick<Notification, "kind" | "subject" | "title">): string {
  return n.subject ? `${n.kind}|${n.subject.type}:${n.subject.id}` : `${n.kind}|${n.title}`;
}

/** Only an Interrupt notification needs the person now (it goes to the top bar's notifications slot). Badge and digest levels show as dots and in While you were away. */
export function wantsBanner(n: Notification): boolean {
  return n.level === "interrupt" && n.seenAt === undefined;
}

/* ---------- places ---------- */

const RAIL_COUNT_KINDS: ReadonlySet<Notification["kind"]> = new Set(["approval.requested", "approval.backstop", "agent.blocked", "dm", "mention"]);

export interface PlaceMark {
  /** A quiet dot: something new that needs no count. */
  dot: boolean;
  /** A count on the rail: only Needs you and direct conversations carry one. */
  count: number;
  /** The count inside the place's own sidebar (every unseen badge item for the place). */
  sidebar: number;
}

/** Dots and counts per place from the unseen notifications (spec 2.24 Rules). */
export function placeMarks(items: readonly Notification[]): Partial<Record<PlaceId, PlaceMark>> {
  const out: Partial<Record<PlaceId, PlaceMark>> = {};
  for (const n of items) {
    if (n.seenAt !== undefined || n.level === "digest") continue;
    const m = out[n.place] ?? { dot: false, count: 0, sidebar: 0 };
    m.dot = true;
    m.sidebar += Math.max(1, n.count);
    if (RAIL_COUNT_KINDS.has(n.kind)) m.count += Math.max(1, n.count);
    out[n.place] = m;
  }
  return out;
}

/* ---------- title bar ---------- */

export interface QueueLine {
  text: string;
  /** What the click opens: Waiting and Conflicts (spec 4.11). */
  tone: "quiet" | "attention";
}

/** The title-bar text for the offline queue: "Offline, 3 changes waiting"; while sending after a reconnect, "Sending 3 changes". Nothing when all is saved. */
export function queueLine(online: boolean, waiting: number, conflicts = 0): QueueLine | null {
  const w = `${waiting} ${waiting === 1 ? "change" : "changes"}`;
  if (conflicts > 0) return { text: `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"} to look at`, tone: "attention" };
  if (!online) return { text: waiting > 0 ? `Offline, ${w} waiting` : "Offline", tone: "attention" };
  if (waiting > 0) return { text: `Sending ${w}`, tone: "quiet" };
  return null;
}

/* ---------- what needs the person ---------- */

/** The read the slot watches: my unseen Interrupt notifications, newest first. */
export const BANNER_QUERY = { level: "interrupt", unseenOnly: true, limit: 20 } as const;

/** What a notice's action opens: the thing it is about (a thread opens beside its message, a task on its page), else its place. */
export function bannerTarget(n: Pick<Notification, "subject" | "place">): { subject: { type: string; id: string } } | { place: PlaceId } {
  return n.subject ? { subject: n.subject } : { place: n.place };
}
