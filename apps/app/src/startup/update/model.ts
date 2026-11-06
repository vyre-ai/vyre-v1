// Vyre updates itself (owner, 3 Nov). The pure half: what a startup check means for the person, what the progress bar says, what the toggle is, and when What's new shows.
//
//   on start the desktop shell checks its channel (src-tauri/src/updater.rs) with a short timeout; the page waits a moment for the answer, before the lock screen
//   a newer signed version and the toggle on: the Updating screen, then the shell installs and restarts       (decide: "update")
//   the toggle off, or the answer came too late: a quiet "Update available" row in Settings and a dot on Settings (decide: "offer")
//   offline, a failed check, nothing newer: nothing at all, and the start is never held up                   (decide: "none")
//   after an update the first open shows "What's new in Vyre" once, from the copy the new build carries (apps/app/public/whats-new.json)

/** What the shell knows about updates for this app. `phase` "checking" means the startup check has not answered yet. */
export interface UpdateCheck {
  phase: "checking" | "none" | "available" | "failed";
  current: string;
  channel: string;
  /** The newer version, when there is one. */
  version: string | null;
  notes: string | null;
  /** When the last check answered (ms since 1970), null before any. */
  checkedAt: number | null;
}

/** The release's What's new, as the build carries it. */
export interface WhatsNew { version: string; lines: string[] }

/** A small key-value store: localStorage in the app, a Map in tests. */
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const AUTO_KEY = "vyre.update.auto";
export const SEEN_KEY = "vyre.whatsNew.seen";
/** The version the app updated from, set just before an install, so the first open after it knows it was an update. */
export const FROM_KEY = "vyre.update.from";

/** How long the page waits for the startup check before it shows the lock screen anyway. The shell started checking when the app launched, so this is the tail of it. */
export const STARTUP_WAIT_MS = 2500;

/** On by default: only an explicit "off" turns it off. */
export function autoUpdateOn(store: Store | null): boolean {
  try { return store?.getItem(AUTO_KEY) !== "0"; } catch { return true; }
}
export function setAutoUpdate(store: Store | null, on: boolean): void {
  try { if (on) store?.removeItem(AUTO_KEY); else store?.setItem(AUTO_KEY, "0"); } catch { /* a store that refuses keeps the default */ }
}

/** What the start does with a check. Only a newer version updates; an equal or older one is nothing, whatever the shell said. */
export function decide(check: UpdateCheck | null, auto: boolean): "update" | "offer" | "none" {
  if (!check || check.phase !== "available" || !check.version || !isNewer(check.current, check.version)) return "none";
  return auto ? "update" : "offer";
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

/** semver order: is `remote` newer than `current`? A prerelease sorts below its release, and its parts compare numerically when both are numbers. Anything unreadable is not newer. */
export function isNewer(current: string, remote: string): boolean {
  const a = SEMVER.exec(current.trim()), b = SEMVER.exec(remote.trim());
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) { const d = Number(b[i]) - Number(a[i]); if (d !== 0) return d > 0; }
  const pa = a[4], pb = b[4];
  if (pa === undefined || pb === undefined) return pa !== undefined && pb === undefined;
  const xa = pa.split("."), xb = pb.split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const p = xa[i], q = xb[i];
    if (p === undefined) return true;
    if (q === undefined) return false;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    if (np && nq) { const d = Number(q) - Number(p); if (d !== 0) return d > 0; continue; }
    if (np !== nq) return np;   // a number sorts below a word
    if (p !== q) return q > p;
  }
  return false;
}

/** Where an install is, as the shell reports it (vyre://update-progress). */
export interface Progress {
  phase: "download" | "verify" | "waiting" | "stopping" | "installing" | "restarting";
  downloaded: number;
  total: number | null;
  /** Chat turns still running on this computer, while the shell waits for them. */
  turns?: number;
  /** The titles of the chats those replies are in, while the shell waits for them. */
  chats?: string[];
  /** Seconds left before the wait ends and the update goes ahead on its own (the wait has a cap), while the shell waits. */
  left?: number;
  /** The whole wait, in seconds (the cap): the bar drains from full to empty over it. */
  of?: number;
}

/** "8:42": minutes and seconds, for the countdown. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The chats a wait names: one title, two, or the first and a count. Quotes around each. */
export function chatsWords(chats: readonly string[] | undefined, turns: number | undefined): string {
  const names = (chats ?? []).filter((c) => c.trim() !== "");
  if (names.length === 0) return turns && turns > 1 ? `${turns} replies` : "a reply";
  if (names.length === 1) return `the reply in \u201c${names[0]}\u201d`;
  if (names.length === 2) return `the replies in \u201c${names[0]}\u201d and \u201c${names[1]}\u201d`;
  return `the replies in \u201c${names[0]}\u201d and ${names.length - 1} other chats`;
}

export function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** 0 to 1 for the bar, or null while the size is not known. Past the download the bar is full. */
export function fraction(p: Progress | null): number | null {
  if (!p) return 0;
  // while it waits for a reply the bar is the time that is left, draining; it is never full (full reads as done), and without the cap it is the quiet indeterminate bar
  if (p.phase === "waiting") return p.left !== undefined && p.of !== undefined && p.of > 0 ? Math.max(0, Math.min(1, p.left / p.of)) : null;
  if (p.phase !== "download") return 1;
  if (!p.total || p.total <= 0) return null;
  return Math.max(0, Math.min(1, p.downloaded / p.total));
}

/** The line under the bar: real bytes and percent while it downloads, then what it is doing. */
export function progressLine(p: Progress | null): string {
  if (!p) return "Starting the download";
  switch (p.phase) {
    case "download": {
      const f = fraction(p);
      return f === null ? `${bytes(p.downloaded)} downloaded` : `${bytes(p.downloaded)} of ${bytes(p.total ?? 0)}, ${Math.floor(f * 100)}%`;
    }
    case "verify": return "Checking the release signature";
    case "waiting": return p.chats && p.chats.length > 0 ? `Waiting for ${chatsWords(p.chats, p.turns)} to finish` : p.turns && p.turns > 1 ? `Waiting for ${p.turns} replies on this computer to finish` : "Waiting for a reply on this computer to finish";
    case "stopping": return p.turns && p.turns > 0 ? `Stopped ${p.turns === 1 ? "the reply" : "the replies"} cleanly. Getting ready to install` : "Getting ready to install";
    case "installing": return "Installing";
    case "restarting": return "Opening the new Vyre";
  }
}

/** The feed's notes as lines for the Settings row: one per line, without list marks, and nothing when they only name the version. */
export function noteLines(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const lines = notes.split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter((l) => l !== "");
  if (lines.length === 1 && /^Vyre \S+$/.test(lines[0]!)) return [];
  return lines.slice(0, 6);
}

/** Read a build's whats-new.json; anything else is nothing. */
export function parseWhatsNew(v: unknown): WhatsNew | null {
  const o = v as { version?: unknown; lines?: unknown } | null;
  if (!o || typeof o.version !== "string" || o.version === "" || !Array.isArray(o.lines)) return null;
  return { version: o.version, lines: o.lines.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim()).slice(0, 6) };
}

/**
 * Whether to show What's new now. Once per version: a version already seen never shows again. The very first open of a fresh install is not an update, so it shows nothing and only remembers
 * the version; an open after an update (a version seen before, or the shell's note of the version it came from) shows the lines, when there are any.
 */
export function whatsNewToShow(store: Store | null, notes: WhatsNew | null): WhatsNew | null {
  if (!store || !notes) return null;
  let seen: string | null = null, from: string | null = null;
  try { seen = store.getItem(SEEN_KEY); from = store.getItem(FROM_KEY); } catch { return null; }
  if (seen === notes.version) return null;
  if (seen === null && (from === null || from === notes.version)) { markSeen(store, notes.version); return null; }
  if (notes.lines.length === 0) { markSeen(store, notes.version); return null; }
  return notes;
}

export function markSeen(store: Store | null, version: string): void {
  try { store?.setItem(SEEN_KEY, version); store?.removeItem(FROM_KEY); } catch { /* nothing to remember with */ }
}

/** Just before the shell installs: remember where the app came from, and that the version it runs now was seen, so the next open knows it was an update. */
export function noteUpdateFrom(store: Store | null, current: string): void {
  try { store?.setItem(FROM_KEY, current); if (store?.getItem(SEEN_KEY) === null) store.setItem(SEEN_KEY, current); } catch { /* the sheet just will not show */ }
}

/** The words for when the last check answered. */
export function checkedLabel(at: number | null, now: number): string {
  if (at === null) return "Not checked yet";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Checked just now";
  if (min < 60) return `Checked ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Checked ${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `Checked ${d} ${d === 1 ? "day" : "days"} ago`;
}

/** The channel as a person reads it. */
export const channelLabel = (channel: string): string => (channel === "beta" ? "Beta" : channel === "stable" ? "Stable" : channel);

/** What a Mac needs free to update: the bundle is about 180 MB packed and about four times that unpacked. */
export const NEEDS_SPACE = "Your Mac needs about 1 GB free to update. Free some space and press Update now.";

/** An error text that means the disk is full: the unpack stops with "No space left on device (os error 28)" or the shell's own pre-check message. */
export function isNoSpace(text: string): boolean {
  return /no space left|os error 28|enospc|not enough (disk )?space|disk (is )?full|needs about 1 GB free/i.test(text);
}

/** The line a failed install shows: the space message when the disk is full, else the shell's own words, else `fallback`. */
export function installFailureWords(e: unknown, fallback: string): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (isNoSpace(text)) return NEEDS_SPACE;
  return text || fallback;
}
