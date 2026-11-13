// The operating system's banner for a notification, in the desktop app (macOS, Windows, Linux), on spec 2.24's rules (apps/desktop/src/notify.ts osNotification). The same unseen Interrupt
// notifications the top bar's notices slot shows (noticeslot/bridge.ts), and only those, less the kinds the person keeps off the desktop ("Notify me on"): the server already applied every
// switch before a row is Interrupt (the per-kind level, Alerts, away, working hours, quiet hours, a muted chat or agent drops the row, and nobody is told about their own act). What this decides:
//   content   none: the banner says "<Space> needs you" and nothing else, so no name, chat, note or title anyone wrote is drawn on a shared or locked screen. Vyre has no setting that shows
//             content on a banner (notify.ts showContent is off by default and nothing turns it on), so none is read here.
//   when      never while the window is in front, whichever place it shows (the app shows its own notice); a notice that came then is not bannered later
//   new       a notice id new to this window: never what was there when the app opened, never a count rise (a burst collapsed into one row is one banner), never a notice that left the
//             list and came back; ids are remembered for the life of the window, the newest MEMORY_LIMIT of them
//   many      one banner per read; at most BANNERS_PER_MINUTE a minute, then one summary a minute, and nothing more until the minute rolls
//   where     its link is the newest notice's thing or place when there is one, the Inbox when there are several, through the same door a shared link uses (vyre://open, held, then reach).
//             The desktop shell cannot tell a press on a banner from the window coming forward, so it opens nothing by itself (native.rs); the link is kept for a shell that can.
import { noticeIdOf } from "../noticeslot/bridge.ts";
import type { Notification } from "./model.ts";

export interface OsBanner {
  title: string;
  body: string;
  link: string;
  tag: string;
}

/** The kinds of subject a link opens (reach/open-link.ts targetOfOpen); anything else opens the place the row is in. */
const OPENS = new Set([
  "file",
  "folder",
  "task",
  "project",
  "agent",
  "automation",
  "run",
  "goal",
  "channel",
  "thread",
  "record",
]);
export const BANNERS_PER_MINUTE = 3;
export const MEMORY_LIMIT = 500;
const MINUTE = 60_000;

/** The link a banner opens: the thing the row is about, else its place. `address` is the Space's address, the one the desktop link names (session/desktop.ts routeDesktopLink). */
export function bannerLink(n: Pick<Notification, "subject" | "place">, address: string): string {
  const at = `vyre://open?address=${encodeURIComponent(address)}`;
  if (n.subject && OPENS.has(n.subject.type))
    return `${at}&kind=${encodeURIComponent(n.subject.type)}&id=${encodeURIComponent(n.subject.id)}`;
  return `${at}&kind=place&id=${encodeURIComponent(n.place)}`;
}

export interface BannerView {
  /** the window is focused and visible */
  focused: boolean;
  address: string;
  /** the Space's name: the banner's only words */
  spaceName: string;
  now: number;
  /** the person's own choice for this kind allows the desktop (Settings, Notifications, "Notify me on": a kind they set to phone only gets no banner); absent: allowed */
  allows?(kind: string): boolean;
}

/** What this window remembers between reads: the notice ids it has seen (insertion order, oldest first), when its banners went, and when its last summary went. */
export interface BannerMemory {
  ids: Set<string>;
  sent: number[];
  summaryAt: number;
}

/**
 * What a fresh read of the shown notices asks of the operating system. `memory` null means the first read since the app opened, which raises nothing and only remembers. Answers at most
 * one banner and the memory for the next read.
 */
export function osBanners(
  shown: readonly Notification[],
  memory: BannerMemory | null,
  view: BannerView,
): { banners: OsBanner[]; memory: BannerMemory } {
  const first = memory === null;
  const m: BannerMemory = memory
    ? { ids: new Set(memory.ids), sent: memory.sent.filter((t) => view.now - t < MINUTE), summaryAt: memory.summaryAt }
    : { ids: new Set(), sent: [], summaryAt: -Infinity };
  const fresh: Notification[] = [];
  for (const n of shown) {
    const id = noticeIdOf(n);
    if (m.ids.has(id)) continue;
    m.ids.add(id);
    if (first || view.focused) continue;
    if (view.allows && !view.allows(n.kind)) continue;
    fresh.push(n);
  }
  while (m.ids.size > MEMORY_LIMIT) m.ids.delete(m.ids.values().next().value as string);
  if (fresh.length === 0) return { banners: [], memory: m };
  const title = `${view.spaceName || "Vyre"} needs you`;
  const newest = fresh.reduce((a, b) => (b.at > a.at ? b : a));
  const link = fresh.length === 1 ? bannerLink(newest, view.address) : bannerLink({ place: "inbox" }, view.address);
  if (m.sent.length < BANNERS_PER_MINUTE) {
    m.sent.push(view.now);
    return {
      banners: [{ title, body: "", link, tag: fresh.length === 1 ? noticeIdOf(newest) : "ntf:several" }],
      memory: m,
    };
  }
  if (view.now - m.summaryAt < MINUTE) return { banners: [], memory: m };
  m.summaryAt = view.now;
  return {
    banners: [{ title, body: "", link: bannerLink({ place: "inbox" }, view.address), tag: "ntf:summary" }],
    memory: m,
  };
}

/** The window is in front of the person: focused and visible (a minimised or hidden window is not). */
export function windowFocused(
  doc: { hasFocus?: () => boolean; visibilityState?: string } | undefined = (
    globalThis as { document?: { hasFocus?: () => boolean; visibilityState?: string } }
  ).document,
): boolean {
  if (!doc) return false;
  return (
    (doc.visibilityState === undefined || doc.visibilityState === "visible") &&
    (typeof doc.hasFocus !== "function" || doc.hasFocus())
  );
}
