// A polling trigger, as pure steps: what to ask for, which items are new, where the cursor moves, and how long to wait after a failure.
// The poller keeps the ids it has seen, so an app that repeats the item at the cursor edge fires once.
import { pointerGet } from "./connector-def.ts";
import type { Cursor, PollTrigger } from "./connector-def.ts";

export interface PollState {
  cursor: string | null;
  /** Item ids already handled, oldest first. */
  seen: string[];
  /** False until the first successful read. That read records what exists and fires nothing. */
  primed: boolean;
  fails: number;
  nextAt: number;
}

export const SEEN_LIMIT = 1_000;
export const FIRE_LIMIT = 100;
const MAX_BACKOFF_MS = 3_600_000;
const MAX_RETRY_AFTER_MS = 6 * 3_600_000;

export function freshState(): PollState {
  return { cursor: null, seen: [], primed: false, fails: 0, nextAt: 0 };
}

/** The query value that carries the cursor, if the trigger has one and the poller has a position. */
export function cursorQuery(trigger: PollTrigger, state: Pick<PollState, "cursor">): Record<string, unknown> {
  const c = trigger.cursor;
  if (c.mode === "none" || state.cursor === null) return {};
  if (c.mode === "updated_since") {
    const ms = Number(state.cursor);
    if (!Number.isFinite(ms)) return {};
    if (c.format === "iso") return { [c.param]: new Date(ms).toISOString() };
    if (c.format === "epoch_s") return { [c.param]: Math.floor(ms / 1000) };
    return { [c.param]: ms };
  }
  return { [c.param]: state.cursor };
}

export function itemsOf(reply: unknown, trigger: PollTrigger): unknown[] | undefined {
  const list = pointerGet(reply, trigger.items);
  return Array.isArray(list) ? list : undefined;
}

export function idOf(item: unknown, trigger: PollTrigger): string | undefined {
  const raw = trigger.idField.startsWith("/") ? pointerGet(item, trigger.idField) : typeof item === "object" && item !== null ? (item as Record<string, unknown>)[trigger.idField] : undefined;
  if (typeof raw === "string" && raw !== "") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function stamp(item: unknown, c: Extract<Cursor, { mode: "updated_since" }>): number | undefined {
  const raw = c.field.startsWith("/") ? pointerGet(item, c.field) : typeof item === "object" && item !== null ? (item as Record<string, unknown>)[c.field] : undefined;
  if (c.format === "iso") { const t = typeof raw === "string" ? Date.parse(raw) : NaN; return Number.isFinite(t) ? t : undefined; }
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return c.format === "epoch_s" ? n * 1000 : n;
}

function greater(a: string, b: string): boolean {
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== "" && b.trim() !== "" ? na > nb : a > b;
}

export interface Advance {
  /** New items, oldest first. */
  fresh: { id: string; item: unknown }[];
  state: PollState;
  /** More new items than one pass fires. The rest come on the next pass. */
  more: boolean;
}

/** Fold one successful read into the state. The first read primes the state and fires nothing. */
export function advance(trigger: PollTrigger, before: PollState, reply: unknown, now: number): Advance | { error: string } {
  const items = itemsOf(reply, trigger);
  if (items === undefined) return { error: "The reply has no list at the items pointer." };
  const seen = new Set(before.seen);
  const ordered = trigger.order === "newest_first" ? [...items].reverse() : [...items];
  const entries: { id: string; item: unknown }[] = [];
  for (const item of ordered) {
    const id = idOf(item, trigger);
    if (id !== undefined) entries.push({ id, item });
  }
  const fresh = before.primed ? entries.filter((e) => !seen.has(e.id)) : [];
  const taken = fresh.slice(0, FIRE_LIMIT);
  const more = fresh.length > taken.length;
  const handled = before.primed ? taken : entries;
  const nextSeen = [...before.seen, ...handled.map((e) => e.id).filter((id) => !seen.has(id))].slice(-SEEN_LIMIT);

  let cursor = before.cursor;
  const c = trigger.cursor;
  if (c.mode === "updated_since") {
    let best = cursor === null ? undefined : Number(cursor);
    for (const e of handled) { const s = stamp(e.item, c); if (s !== undefined && (best === undefined || s > best)) best = s; }
    cursor = best === undefined || !Number.isFinite(best) ? cursor : String(best);
  } else if (c.mode === "after_id") {
    for (const e of handled) if (cursor === null || greater(e.id, cursor)) cursor = e.id;
  } else if (c.mode === "next_token") {
    const t = pointerGet(reply, c.from);
    if ((typeof t === "string" && t !== "") || typeof t === "number") cursor = String(t);
  }
  return { fresh: taken, more, state: { cursor, seen: nextSeen, primed: true, fails: 0, nextAt: now + trigger.intervalSec * 1000 } };
}

/** How long to wait after a failed read. A Retry-After from the app is honoured when it is longer than the interval. */
export function backoff(trigger: Pick<PollTrigger, "intervalSec">, fails: number, retryAfterMs?: number): number {
  const base = Math.max(trigger.intervalSec * 1000, 60_000);
  const grown = Math.min(base * 2 ** Math.min(fails, 10), MAX_BACKOFF_MS);
  if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.min(Math.max(retryAfterMs, base), MAX_RETRY_AFTER_MS);
  return grown;
}

/** Retry-After is a number of seconds or a date. */
export function retryAfterMs(header: string | undefined, now: number): number | undefined {
  if (header === undefined) return undefined;
  const t = header.trim();
  if (/^\d{1,7}$/.test(t)) return Number(t) * 1000;
  const at = Date.parse(t);
  return Number.isFinite(at) && at > now ? at - now : undefined;
}
