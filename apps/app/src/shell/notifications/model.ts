// Notification UI model (spec 2.24, 3.0 title bar, 4.11): which banners show, how repeats collapse, the dots and counts on places,
// and the title-bar line for the offline queue. Pure functions; the banner stack is a small store.
import type { CapMap } from "../../../../../generated/types.ts";

export type Notification = CapMap["notifications.list"]["out"]["notifications"][number];
export type NotificationAction = Notification["actions"][number];
export type PlaceId = Notification["place"];

/** At most this many banners are on screen; the rest wait behind them (spec 2.24). */
export const MAX_BANNERS = 3;
/** A banner leaves after this long unless it is hovered; Interrupt notifications also stay in Needs you. */
export const BANNER_TTL_MS = 12000;

/** Same key collapses to one banner: the kind plus what it is about (a thread, a task), else the kind plus the title. */
export function collapseKey(n: Pick<Notification, "kind" | "subject" | "title">): string {
  return n.subject ? `${n.kind}|${n.subject.type}:${n.subject.id}` : `${n.kind}|${n.title}`;
}

export interface Banner {
  key: string;
  /** The newest notification under this key. */
  item: Notification;
  /** How many arrived under the key and are still on screen (a repeat in a thread collapses into one banner with a count). */
  count: number;
  shownAt: number;
}

/** Only an Interrupt notification gets a banner. Badge and digest levels show as dots and in While you were away. */
export function wantsBanner(n: Notification): boolean {
  return n.level === "interrupt" && n.seenAt === undefined;
}

export class BannerStack {
  private all: Banner[] = [];
  private listeners = new Set<() => void>();
  private snap: { visible: readonly Banner[]; waiting: number } = { visible: [], waiting: 0 };

  constructor(private readonly now: () => number = Date.now) {}

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = (): { visible: readonly Banner[]; waiting: number } => this.snap;

  private publish(): void {
    this.snap = { visible: this.all.slice(0, MAX_BANNERS), waiting: Math.max(0, this.all.length - MAX_BANNERS) };
    for (const l of this.listeners) l();
  }

  /** A notification arrived. A repeat under the same key replaces the banner's text and moves it to the top with the count raised. */
  push(n: Notification): void {
    if (!wantsBanner(n)) return;
    const key = collapseKey(n);
    const at = this.all.findIndex((b) => b.key === key);
    const prev = at >= 0 ? this.all[at] : undefined;
    if (at >= 0) this.all.splice(at, 1);
    this.all.unshift({ key, item: n, count: (prev?.count ?? 0) + Math.max(1, n.count), shownAt: this.now() });
    this.publish();
  }

  dismiss(key: string): void {
    const next = this.all.filter((b) => b.key !== key);
    if (next.length === this.all.length) return;
    this.all = next;
    this.publish();
  }

  /** Drops banners older than the TTL (a hovered one is held by the caller passing its key). */
  expire(hold?: string): void {
    const t = this.now();
    const next = this.all.filter((b) => b.key === hold || t - b.shownAt < BANNER_TTL_MS);
    if (next.length === this.all.length) return;
    this.all = next;
    this.publish();
  }

  /** A notification was seen elsewhere (marked seen): its banner goes. */
  seen(ids: readonly string[]): void {
    const next = this.all.filter((b) => !ids.includes(b.item.id));
    if (next.length === this.all.length) return;
    this.all = next;
    this.publish();
  }
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
