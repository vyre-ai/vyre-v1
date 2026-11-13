// Per-person state on a thing (contract P2): what one person has done with one thing, kept apart from the thing. Pure: no database, no clock, so the server and a device replica
// apply exactly the same rules and always agree. Every function takes a row and returns a new one; nothing here mutates.
//
// A row exists only once there is something to say. No row means: read, open, not starred, not followed, not muted.
// Read is a position in the thing's entries, not a flag. Unread is the number of entries after that position that the person did not write themselves; it is stored so a list or a badge never counts.
// Done and Archive are one state (a time); each kind of thing says what brings it back (`Reopen`).

/** A mute with no end. A far-future time, so one column holds "until" and "for good". */
export const MUTE_FOREVER = 8_640_000_000_000_000;

export type Follow = "following" | "left";
/** What brings a done thing back: a new entry (the Inbox), only a mention (Chats), or nothing. */
export type Reopen = "new_entry" | "mention" | "never";

/** One person's state on one thing. */
export interface PersonState {
  /** the newest entry the person has read */
  readUpto: number;
  /** entries after `readUpto` that someone else wrote */
  unread: number;
  doneAt: number | null;
  starredAt: number | null;
  follow: Follow | null;
  /** "Alert me on replies" */
  alert: boolean;
  mutedUntil: number | null;
  /** the person lost access: the row keeps its flags but leaves every list and count until access comes back */
  hidden: boolean;
}

/** One entry of a thing (a message, a mail, a call): its position, and who wrote it (null when it came from outside). */
export interface Entry {
  pos: number;
  by: string | null;
}

/** What a thing adds to a badge: how many things have something unread, and how many entries that is. */
export interface Count {
  things: number;
  entries: number;
}

export const NO_COUNT: Count = { things: 0, entries: 0 };

/** The state of a thing nobody has touched: read up to `head`, nothing set. */
export const blank = (head: number): PersonState => ({
  readUpto: head,
  unread: 0,
  doneAt: null,
  starredAt: null,
  follow: null,
  alert: false,
  mutedUntil: null,
  hidden: false,
});

/** Is the mute still on at this moment? A person's view of a row uses this; a badge does not (see `counted`). */
export const isMuted = (s: PersonState, now: number): boolean => s.mutedUntil !== null && s.mutedUntil > now;

/** Has a mute run out? Such a row is cleared by a sweep (`unmuted`), so a badge never depends on the clock. */
export const muteEnded = (s: PersonState, now: number): boolean => s.mutedUntil !== null && s.mutedUntil <= now;

/** The row with an ended mute cleared. */
export const unmuted = (s: PersonState): PersonState => ({ ...s, mutedUntil: null });

/**
 * Does this thing show in a badge? Something unread, not done, not muted, and the person still has access. A mute counts as on until a sweep clears it once its time has passed:
 * a badge is a function of the rows alone, never of the clock, so a stored count can always be recomputed and compared.
 */
export const counted = (s: PersonState): boolean =>
  !s.hidden && s.unread > 0 && s.doneAt === null && s.mutedUntil === null;

export const weigh = (s: PersonState | null): Count =>
  s !== null && counted(s) ? { things: 1, entries: s.unread } : NO_COUNT;

/** What a change from `before` to `after` does to the person's badge for the thing's scope. */
export function delta(before: PersonState | null, after: PersonState | null): Count {
  const b = weigh(before);
  const a = weigh(after);
  return { things: a.things - b.things, entries: a.entries - b.entries };
}

export const isZero = (c: Count): boolean => c.things === 0 && c.entries === 0;

/** Entries after `readUpto` that `person` did not write. */
export function unreadOf(entries: readonly Entry[], readUpto: number, person: string): number {
  let n = 0;
  for (const e of entries) if (e.pos > readUpto && e.by !== person) n++;
  return n;
}

/** Does a new entry bring a done thing back for this person? */
export function reopens(rule: Reopen, mentioned: boolean): boolean {
  return rule === "new_entry" || (rule === "mention" && mentioned);
}

export interface Arrival {
  /** the thing's newest position before this entry */
  headBefore: number;
  pos: number;
  person: string;
  /** who wrote the entry; null when it came from outside */
  by: string | null;
  mentioned: boolean;
  reopen: Reopen;
}

/**
 * A new entry reaches a person. Someone else's entry is one more unread (a row made now starts at the thing's old head: what came before you could see it counts as read) and brings a done
 * thing back when the kind says so. The author's own entry moves their cursor to it, clears what they had not read (answering is reading) and never reopens their own Done.
 */
export function arrive(row: PersonState | null, a: Arrival): PersonState {
  const s = { ...(row ?? blank(a.headBefore)) };
  if (a.by === a.person) return { ...s, readUpto: Math.max(s.readUpto, a.pos), unread: 0 };
  s.unread += 1;
  if (s.doneAt !== null && reopens(a.reopen, a.mentioned)) s.doneAt = null;
  return s;
}

/** What a person asked of their read position. Exactly one. `upto` only moves forward; `unread` and `fromPos` move back. */
export type ReadRequest = { upto: number } | { unread: true } | { fromPos: number };

/** The row after a read request, or null when the request cannot apply (marking unread something with no entry from anyone else). */
export function read(
  row: PersonState | null,
  head: number,
  entries: readonly Entry[],
  person: string,
  req: ReadRequest,
): PersonState | null {
  const s = { ...(row ?? blank(head)) };
  let upto: number;
  if ("upto" in req) upto = Math.max(s.readUpto, Math.min(req.upto, head));
  else if ("fromPos" in req) upto = Math.max(0, Math.min(req.fromPos - 1, head));
  else {
    const newest = Math.max(-1, ...entries.filter((e) => e.by !== person).map((e) => e.pos));
    if (newest < 0) return null;
    upto = Math.min(s.readUpto, newest - 1);
  }
  return { ...s, readUpto: upto, unread: unreadOf(entries, upto, person) };
}

/** A change to a person's flags on a thing. A field left out is left alone. */
export interface Change {
  done?: boolean;
  star?: boolean;
  follow?: Follow | null;
  alert?: boolean;
  mute?: { until: number } | null;
}

/** Which of the flags a change moved: the words of the `state.changed` event. */
export type Flag = "read" | "done" | "star" | "follow" | "mute";

export function set(row: PersonState | null, head: number, c: Change, now: number): PersonState {
  const s = { ...(row ?? blank(head)) };
  if (c.done !== undefined) s.doneAt = c.done ? (s.doneAt ?? now) : null;
  if (c.star !== undefined) s.starredAt = c.star ? (s.starredAt ?? now) : null;
  if (c.follow !== undefined) s.follow = c.follow;
  if (c.alert !== undefined) s.alert = c.alert;
  if (c.mute !== undefined) s.mutedUntil = c.mute === null ? null : c.mute.until;
  return s;
}

/** The flags that differ between two states of one person on one thing. */
export function changedFlags(before: PersonState | null, after: PersonState, head: number): Flag[] {
  const b = before ?? blank(head);
  const out: Flag[] = [];
  if (b.readUpto !== after.readUpto || b.unread !== after.unread) out.push("read");
  if ((b.doneAt === null) !== (after.doneAt === null)) out.push("done");
  if ((b.starredAt === null) !== (after.starredAt === null)) out.push("star");
  if (b.follow !== after.follow || b.alert !== after.alert) out.push("follow");
  if (b.mutedUntil !== after.mutedUntil) out.push("mute");
  return out;
}

/** Two things become one (an Inbox merge): one person's state on each, merged. Flags are kept; a Done survives only when both were done; the cursor is the higher one only where both were fully read. */
export function merge(a: PersonState, b: PersonState): PersonState {
  const bothRead = a.unread === 0 && b.unread === 0;
  const earliest = (x: number | null, y: number | null): number | null =>
    x === null ? y : y === null ? x : Math.min(x, y);
  return {
    readUpto: bothRead ? Math.max(a.readUpto, b.readUpto) : Math.min(a.readUpto, b.readUpto),
    unread: a.unread + b.unread,
    doneAt: a.doneAt !== null && b.doneAt !== null ? Math.max(a.doneAt, b.doneAt) : null,
    starredAt: earliest(a.starredAt, b.starredAt),
    follow: a.follow === "following" || b.follow === "following" ? "following" : (a.follow ?? b.follow),
    alert: a.alert || b.alert,
    mutedUntil: a.mutedUntil !== null && b.mutedUntil !== null ? Math.min(a.mutedUntil, b.mutedUntil) : null,
    hidden: a.hidden && b.hidden,
  };
}

/** The row recounted from the thing's entries (after an entry was removed or two things merged): the cursor stays, the number follows the entries. */
export function recount(row: PersonState, entries: readonly Entry[], person: string): PersonState {
  return { ...row, unread: unreadOf(entries, row.readUpto, person) };
}

/** A scope is one string: `mailbox:mbx_a`, `number:num_b`, `chats`, `notices:inbox`. The part before the first colon is its type, the rest its id (empty for `chats`). */
export function splitScope(scope: string): { type: string; id: string } {
  const i = scope.indexOf(":");
  return i < 0 ? { type: scope, id: "" } : { type: scope.slice(0, i), id: scope.slice(i + 1) };
}
export const joinScope = (type: string, id: string): string => (id === "" ? type : `${type}:${id}`);
