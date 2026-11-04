// Everything that needs the person reaches them in one place, the top bar's notifications slot (owner, 4 Nov): replies, mentions and direct messages (Open), held approvals (Review), alerts about the
// Space's machines and health (Open), and an update that is ready (Restart). Until now a few of these were interrupt banners with their own stack and expiry; they are persisting notices now: each stays until the
// thing is seen or settled, and every one has exactly one action.
import { useEffect, useRef } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import { BANNER_QUERY, bannerTarget, collapseKey } from "../notifications/model.ts";
import type { Notification } from "../notifications/model.ts";
import { notices as shared } from "./model.ts";
import type { NoticeKind, NoticeStore } from "./model.ts";

type ListOut = CapMap["notifications.list"]["out"];

/** Which kind of notice a notification is, and the one word on its action. */
export function noticeKindOf(n: Pick<Notification, "kind">): { kind: Exclude<NoticeKind, "passing" | "locked" | "offline" | "update">; label: string } {
  switch (n.kind) {
    case "approval.requested": case "approval.backstop": case "unblock.requested": case "answer.requested": case "access.requested": return { kind: "approval", label: "Review" };
    case "health.degraded": case "incident.owned": case "sync.attention": case "agent.blocked": case "run.failed": case "limit.hit": return { kind: "machine", label: "Open" };
    default: return { kind: "reply", label: "Open" };
  }
}

export const noticeIdOf = (n: Pick<Notification, "kind" | "subject" | "title">): string => `ntf:${collapseKey(n)}`;

/** The text of a notice: the title, with how many when a burst collapsed into it and the title does not say. */
export function noticeText(n: Pick<Notification, "title" | "count">): string {
  return n.count > 1 && !n.title.startsWith(`${n.count} `) ? `${n.title} · ${n.count} new` : n.title;
}

/**
 * Bring the slot in line with a fresh read of my unseen Interrupt notifications: each is a persisting notice with one action; one that is no longer in the read (seen elsewhere, settled) goes.
 * Answers the ids it raised, for the next read.
 */
export function syncNotifications(store: NoticeStore, before: ReadonlySet<string>, items: readonly Notification[], act: (n: Notification) => void): Set<string> {
  const now = new Set<string>();
  for (const n of items) {
    if (n.level !== "interrupt" || n.seenAt !== undefined) continue;
    const id = noticeIdOf(n);
    const k = noticeKindOf(n);
    store.raise({ id, kind: k.kind, text: noticeText(n), action: { label: k.label, run: () => act(n) } });
    now.add(id);
  }
  for (const id of before) if (!now.has(id)) store.resolve(id);
  return now;
}

export interface NotificationNoticesProps {
  query(cap: string, input: Record<string, unknown>): LiveQuery<ListOut>;
  call(cap: string, input: unknown): Promise<unknown>;
  open(target: { subject?: { type: string; id: string }; place?: string }): void;
}

/** Mounted once by the signed-in shell: the live read of what needs me, kept in the slot. */
export function useNotificationNotices(p: NotificationNoticesProps | null, store: NoticeStore = shared): void {
  const raised = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (p === null) return undefined;
    const q = p.query("notifications.list", BANNER_QUERY);
    const act = (n: Notification): void => {
      // the notice goes with the press; a seen mark that fails only leaves the row unseen, and the next read raises it again
      void Promise.resolve(p.call("notifications.mark_seen", { notificationIds: [n.id] })).catch(() => undefined);
      store.resolve(noticeIdOf(n));
      p.open(bannerTarget(n));
    };
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status !== "ready") return;
      raised.current = syncNotifications(store, raised.current, s.data.notifications, act);
    };
    const off = q.subscribe(read);
    read();
    return () => { off(); for (const id of raised.current) store.resolve(id); raised.current = new Set(); };
  }, [p, store]);
}

export interface UpdateSource {
  /** The update state as the shell keeps it (startup/update/store.ts). */
  state(): { check: { phase: string; version: string | null } | null; installing: boolean };
  subscribe(l: () => void): () => void;
  /** Install and restart; absent where there is no shell to do it (a browser). */
  install?(): void | Promise<void>;
}

/** The update notice for the state as it is now: ready (Restart), installing (no action), or gone. */
export function updateNoticeFrom(src: UpdateSource, store: NoticeStore): void {
  const s = src.state();
  const version = s.check?.phase === "available" ? s.check.version : null;
  if (s.installing) { store.raise({ id: "update", kind: "update", text: `Updating to ${version ?? "the new version"}` }); return; }
  if (version !== null && src.install) { store.raise({ id: "update", kind: "update", text: `Vyre ${version} is ready`, action: { label: "Restart", run: () => { void src.install!(); } } }); return; }
  store.resolve("update");
}

/** An update that is ready is a persisting notice with Restart; while it installs it says so and has no action. Gone once there is none waiting. */
export function useUpdateNotice(src: UpdateSource | null, store: NoticeStore = shared): void {
  useEffect(() => {
    if (src === null) return undefined;
    const read = (): void => updateNoticeFrom(src, store);
    const off = src.subscribe(read);
    read();
    return () => { off(); store.resolve("update"); };
  }, [src, store]);
}
