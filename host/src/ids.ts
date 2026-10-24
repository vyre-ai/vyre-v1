// Event ids the contract accepts (packages/contracts: evt_ followed by lower case letters and digits, no dashes).
// lib/ids.ts mints a dashed, time-ordered uuid; this file is the one place the host turns that into the contract's form.
// The mapping is pure and keeps order and uniqueness (only the dashes go), so a reader holding a raw dashed id gets the same value the host stores.
import { mintUuid } from "../../lib/ids.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import type { CommitBatch } from "./invoke.ts";

export const EVENT_ID = /^evt_[a-z0-9]+$/;

/** A new event id: `evt_` plus the time-ordered uuid without dashes. */
export function mintEventId(now: number = Date.now(), rand?: (n: number) => Uint8Array): string {
  return `evt_${mintUuid(now, rand).replaceAll("-", "")}`;
}

/** The contract form of any event id: lower case, dashes and other marks dropped, one `evt_` prefix. */
export function eventIdOf(raw: string): string {
  return `evt_${raw.replace(/^evt_/i, "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** One envelope with its id (and the id it names as its cause) in contract form. */
export function normalizeEvent<E extends EventEnvelope>(e: E): E {
  const id = EVENT_ID.test(e.id) ? e.id : eventIdOf(e.id);
  const cause = e.cause === undefined ? undefined : EVENT_ID.test(e.cause) ? e.cause : eventIdOf(e.cause);
  if (id === e.id && cause === e.cause) return e;
  const { cause: _drop, ...rest } = e;
  return { ...rest, id, ...(cause !== undefined ? { cause } : {}) } as E;
}

/** Wrap InvokeDeps.commit so every event reaches the log with a contract id. */
export function withEventIds(commit: (batch: CommitBatch) => Promise<EventEnvelope[]>): (batch: CommitBatch) => Promise<EventEnvelope[]> {
  return (batch) => commit({ ...batch, events: batch.events.map((e) => normalizeEvent(e)) });
}
