// The operating system's banner for a notification, in the desktop app (macOS, Windows, Linux). The same unseen Interrupt notifications the top bar's notices slot shows (noticeslot/bridge.ts), and
// only those, less the kinds the person keeps off the desktop ("Notify me on"): the server already applied every switch before a row is Interrupt (the per-kind level, Alerts, away, working hours, quiet hours, a muted chat or agent drops the row, and nobody is
// told about their own act). What this decides on top:
//   new           a banner for a row that is new to this window, or one whose count rose (a burst collapsed into it); never for what was already there when the app opened
//   here          none while the window is focused on the place the row is about (a row about the chat on screen is marked seen before it gets here)
//   words         the same words as the notice (noticeText): who, what, where; never the body (a private message, a Vault value), which the line does not show either
//   many          at most three banners from one read; the rest are one "N more notices" banner that opens the Inbox
//   where         pressing it brings the app forward at that place through the same door a shared link uses (vyre://open, held, then reach: never a place the person cannot open)
import { noticeIdOf, noticeText } from "../noticeslot/bridge.ts";
import type { Notification } from "./model.ts";

export interface OsBanner { title: string; body: string; link: string; tag: string }

/** The kinds of subject a link opens (reach/open-link.ts targetOfOpen); anything else opens the place the row is in. */
const OPENS = new Set(["file", "folder", "task", "project", "agent", "automation", "run", "goal", "channel", "thread", "record"]);
export const MAX_BANNERS = 3;

/** The link a banner opens: the thing the row is about, else its place. `address` is the Space's address, the one the desktop link names (session/desktop.ts routeDesktopLink). */
export function bannerLink(n: Pick<Notification, "subject" | "place">, address: string): string {
  const at = `vyre://open?address=${encodeURIComponent(address)}`;
  if (n.subject && OPENS.has(n.subject.type)) return `${at}&kind=${encodeURIComponent(n.subject.type)}&id=${encodeURIComponent(n.subject.id)}`;
  return `${at}&kind=place&id=${encodeURIComponent(n.place)}`;
}

export interface BannerView {
  /** the window is focused and visible */
  focused: boolean;
  /** the window shows the place this row is about */
  here(n: Notification): boolean;
  address: string;
  /** the person's own choice for this kind allows the desktop (Settings, Notifications, "Notify me on": a kind they set to phone only gets no banner); absent: allowed */
  allows?(kind: string): boolean;
}

/**
 * What a fresh read of the shown notices asks of the operating system. `seen` is this window's memory (id to count); null means the first read since the app opened, which raises nothing and
 * only remembers. Answers the banners and the memory for the next read.
 */
export function osBanners(shown: readonly Notification[], seen: ReadonlyMap<string, number> | null, view: BannerView): { banners: OsBanner[]; seen: Map<string, number> } {
  const next = new Map<string, number>();
  const fresh: Notification[] = [];
  for (const n of shown) {
    const id = noticeIdOf(n);
    next.set(id, n.count);
    if (seen === null) continue;
    const before = seen.get(id);
    if (before !== undefined && n.count <= before) continue;
    if (view.focused && view.here(n)) continue;
    if (view.allows && !view.allows(n.kind)) continue;
    fresh.push(n);
  }
  const banners: OsBanner[] = fresh.slice(0, MAX_BANNERS).map((n) => ({ title: noticeText(n), body: "", link: bannerLink(n, view.address), tag: noticeIdOf(n) }));
  const more = fresh.length - MAX_BANNERS;
  if (more > 0) banners.push({ title: `${more} more notice${more === 1 ? "" : "s"} in Vyre`, body: "", link: bannerLink({ place: "inbox" }, view.address), tag: "ntf:more" });
  return { banners, seen: next };
}

/** The window is in front of the person: focused and visible (a minimised or hidden window is not). */
export function windowFocused(doc: { hasFocus?: () => boolean; visibilityState?: string } | undefined = (globalThis as { document?: { hasFocus?: () => boolean; visibilityState?: string } }).document): boolean {
  if (!doc) return false;
  return (doc.visibilityState === undefined || doc.visibilityState === "visible") && (typeof doc.hasFocus !== "function" || doc.hasFocus());
}
