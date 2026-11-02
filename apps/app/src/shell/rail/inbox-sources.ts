// Inbox is on the rail only for a person who has something flowing in: a mailbox they can see that is still connected, a calendar, or a phone number assigned to them.
// The answer comes from three live reads the Inbox already makes (mail.mailbox.list, calendar.list_calendars, telephony.number.list): they are read once when the Space opens
// and again on the change events the live link carries, never on a timer or per render. Until they answer, the shell keeps the last answer this device saw for this person
// and Space, so the rail does not jump on every launch.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";

export interface MailboxLite { state: string }
export interface NumberLite { assigneeKind: string; assigneeId?: string; state: string }

/** The three reads behind the answer: the screen queries the Inbox sidebar, Settings and the softphone already declare, so they share one read with them. */
export const INBOX_SOURCE_QUERIES = [
  ["mail.connections", "mailboxes"],
  ["inbox.sidebar", "calendars"],
  ["telephony.softphone", "numbers"],
] as const;

/** The one-time words on the Inbox rail button the first time a source connects. */
export const INBOX_TIP = "Your mail and calendar are here";

/** A read that failed (a module this Space does not run, a refusal) counts as answered with nothing in it. */
const answered = (s: QueryState<unknown>): boolean => s.status === "ready" || s.error !== undefined;

function list<T>(s: QueryState<unknown>, key: string): readonly T[] {
  if (s.status !== "ready") return [];
  const v = (s.data as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Does this person have something flowing into Inbox? True as soon as one read shows a source; false only when all three have answered with none; null while that is unknown. */
export function inboxAnswer(snaps: readonly [QueryState<unknown>, QueryState<unknown>, QueryState<unknown>], me: string): boolean | null {
  const [mail, cal, nums] = snaps;
  if (list<MailboxLite>(mail, "mailboxes").some((m) => m.state !== "disconnected")) return true;
  if (list<unknown>(cal, "calendars").length > 0) return true;
  if (list<NumberLite>(nums, "numbers").some((n) => n.state !== "released" && n.assigneeKind === "person" && n.assigneeId === me)) return true;
  return answered(mail) && answered(cal) && answered(nums) ? false : null;
}

const NEVER: LiveQuery<unknown> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading", error: { message: "not in this Space" } }) };

/** The three live queries. A screen this build does not know reads as answered and empty, so a missing module never holds the answer back. */
export function inboxSourceQueries(screens: ScreenHooks): readonly [LiveQuery<unknown>, LiveQuery<unknown>, LiveQuery<unknown>] {
  const one = ([screen, name]: readonly [string, string]): LiveQuery<unknown> => { try { return screens.query(screen, name, {}); } catch { return NEVER; } };
  return [one(INBOX_SOURCE_QUERIES[0]), one(INBOX_SOURCE_QUERIES[1]), one(INBOX_SOURCE_QUERIES[2])];
}

/** Follow the answer: `on` hears it once the reads answer and again only when it changes. Returns how to stop. */
export function followInboxSources(screens: ScreenHooks, me: string, on: (has: boolean) => void): () => void {
  const qs = inboxSourceQueries(screens);
  let last: boolean | null = null;
  const read = (): void => {
    const now = inboxAnswer([qs[0].getSnapshot(), qs[1].getSnapshot(), qs[2].getSnapshot()], me);
    if (now === null || now === last) return;
    last = now;
    on(now);
  };
  const offs = qs.map((q) => q.subscribe(read));
  read();
  return () => { for (const off of offs) off(); };
}

/** The answer for a screen that draws from it (the Inbox place, Settings, the Chats checklist): null until it is known. */
export function useInboxSources(screens: ScreenHooks | null, me: string): boolean | null {
  const qs = useMemo(() => (screens ? inboxSourceQueries(screens) : null), [screens]);
  const subscribe = useCallback((l: () => void): (() => void) => {
    if (!qs) return () => undefined;
    const offs = qs.map((q) => q.subscribe(l));
    return () => { for (const off of offs) off(); };
  }, [qs]);
  const read = (): boolean | null => (qs ? inboxAnswer([qs[0].getSnapshot(), qs[1].getSnapshot(), qs[2].getSnapshot()], me) : null);
  return useSyncExternalStore(subscribe, read, read);
}

// ---- the last answer this device saw, per person and Space

export interface KnownStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

const knownKey = (personId: string, spaceId: string): string => `vyre.inbox.has.${personId}.${spaceId}`;
const tipKey = (personId: string, spaceId: string): string => `vyre.inbox.tip.${personId}.${spaceId}`;

/** The last answer for this person and Space, or null when this device never saw one. */
export function knownInbox(storage: KnownStorage | null, personId: string, spaceId: string): boolean | null {
  const v = storage?.getItem(knownKey(personId, spaceId)) ?? null;
  return v === "1" ? true : v === "0" ? false : null;
}

/** A Space's card as the shell opens it: Inbox where this device last saw it for this person, until the reads answer. A card with no answer anywhere is left as it is. */
export function seedInbox<D extends { spaceId: string; inbox?: boolean }>(def: D, storage: KnownStorage | null, personId: string): D {
  const k = knownInbox(storage, personId, def.spaceId);
  return k === null ? def : { ...def, inbox: k };
}

export function rememberInbox(storage: KnownStorage | null, personId: string, spaceId: string, has: boolean): void {
  storage?.setItem(knownKey(personId, spaceId), has ? "1" : "0");
}

/** The tooltip shows once per person and Space: true the first time it is asked, false after. */
export function takeInboxTip(storage: KnownStorage | null, personId: string, spaceId: string): boolean {
  if (!storage) return true;
  if (storage.getItem(tipKey(personId, spaceId)) === "1") return false;
  storage.setItem(tipKey(personId, spaceId), "1");
  return true;
}
