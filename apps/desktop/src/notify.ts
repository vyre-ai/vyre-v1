// Desktop notifications (spec 2.24, 3.13): what the shell shows when the window is not in front, and where a click on it goes.
// Pure functions: the page decides when to call them; the shell's Rust side (src-tauri/src/native.rs) shows the banner and checks its link.
// Rules from 2.24 that live here: only Interrupt level reaches the operating system; a push carries no content ("Northwind needs you");
// the same key collapses to one banner; at most 3 banners at a time. A banner's link is a vyre://open link, but the desktop notification plugin reports
// no press, and a window coming forward is not one, so nothing opens it on its own (review 12 Nov 2026: reading a focus as a press pulled people away).

export const SCHEME = "vyre";
export const MAX_BANNERS = 3;
export const MAX_TITLE = 120;
export const MAX_BODY = 240;
export const MAX_LINK = 2048;

export type Level = "interrupt" | "badge" | "digest";

export type NotificationInput = {
  /** Same key = same thing; repeats collapse to one banner. */
  key: string;
  level: Level;
  /** Who or what needs you ("Northwind"), and the line under it. */
  title: string;
  body?: string;
  /** The Space (its address or id) and the thread, record or task the click opens. */
  space: string;
  thread?: string;
  record?: string;
  task?: string;
  /** Milliseconds since the epoch. */
  at: number;
};

export type OsNotification = { title: string; body: string; link: string; tag: string };
export type Banner = { key: string; title: string; body: string; link: string; count: number; at: number };

const clean = (s: string, max: number): string =>
  Array.from(s.replace(/[\u0000-\u001f\u007f]/g, " ").trim())
    .slice(0, max)
    .join("");

/** vyre://open?space=...&thread=... The page's router reads it; the shell only checks that it is ours and well formed. */
export function openLink(target: { space: string; thread?: string; record?: string; task?: string }): string {
  const q: string[] = [`space=${encodeURIComponent(target.space)}`];
  for (const k of ["thread", "record", "task"] as const) {
    const v = target[k];
    if (v) q.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `${SCHEME}://open?${q.join("&")}`;
}

export type OpenTarget = { space: string; thread?: string; record?: string; task?: string };

/** The target inside a vyre://open link, or null when the text is not one of ours, is too long, or names no Space. */
export function parseOpenLink(url: string): OpenTarget | null {
  if (typeof url !== "string" || url.length > MAX_LINK || /[\u0000-\u001f\u007f]/.test(url)) return null;
  const m = /^vyre:\/\/open\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(url);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const pair of (m[1] ?? "").split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    let v = "";
    try {
      v = decodeURIComponent((i < 0 ? "" : pair.slice(i + 1)).replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (!k || Object.keys(out).length >= 16) return null;
    out[k] = v;
  }
  if (!out["space"]) return null;
  const t: OpenTarget = { space: out["space"] };
  if (out["thread"]) t.thread = out["thread"];
  if (out["record"]) t.record = out["record"];
  if (out["task"]) t.task = out["task"];
  return t;
}

/**
 * What goes to the operating system for one notification, or null when it must not interrupt: only Interrupt level does, and never while the
 * window is in front (the page shows its own banner then). `showContent` is off by default: the banner says who needs you and nothing else.
 */
export function osNotification(
  n: NotificationInput,
  opts: { windowFocused: boolean; showContent?: boolean },
): OsNotification | null {
  if (n.level !== "interrupt" || opts.windowFocused) return null;
  if (!n.key || !n.space) return null;
  const who = clean(n.title, MAX_TITLE) || "Vyre";
  const title = opts.showContent ? who : `${who} needs you`;
  const body = opts.showContent ? clean(n.body ?? "", MAX_BODY) : "";
  const link = openLink({ space: n.space, thread: n.thread, record: n.record, task: n.task });
  return { title, body, link, tag: n.key };
}

/** The in-app banner list after one more notification: the same key collapses (count goes up, newest text wins), newest first, at most MAX_BANNERS. */
export function pushBanner(list: readonly Banner[], n: NotificationInput, max = MAX_BANNERS): Banner[] {
  if (n.level !== "interrupt" || !n.key || !n.space) return [...list];
  const link = openLink({ space: n.space, thread: n.thread, record: n.record, task: n.task });
  const prev = list.find((b) => b.key === n.key);
  const next: Banner = {
    key: n.key,
    title: clean(n.title, MAX_TITLE),
    body: clean(n.body ?? "", MAX_BODY),
    link,
    count: (prev?.count ?? 0) + 1,
    at: n.at,
  };
  return [next, ...list.filter((b) => b.key !== n.key)].slice(0, max);
}

/** "9+" past nine, "" for none: the dock and tray badge text. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 9 ? "9+" : String(Math.floor(count));
}
