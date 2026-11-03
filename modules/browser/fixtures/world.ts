// A small Space for the Browser connection tests: two people, two agents. The module needs no other module, so there are no scripted calls, only the events it emits.
import { MemoryDb } from "./db.ts";
import type { BrowserCtx } from "../projections.ts";

export const NOW = 1_700_000_000_000;
export interface Event { name: string; subject: string; payload: unknown }

export function world(space = "spc_test") {
  const db = new MemoryDb();
  const events: Event[] = [];
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let clock = NOW;
  const as = (id: string, kind: "person" | "agent" = "person", actingFor?: string): BrowserCtx => ({
    space, principal: { kind, id }, ...(actingFor ? { actingFor } : {}), trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => clock++, db,
    emit(name, subject, payload) { events.push({ name, subject, payload }); },
    async call(cap, input) { calls.push({ cap, input: input as Record<string, unknown> }); return { message: { id: "msg_1" } }; },
  });
  return { db, events, calls, as, called: (cap: string) => calls.filter((c) => c.cap === cap) };
}
export type World = ReturnType<typeof world>;
