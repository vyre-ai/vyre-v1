import { memoryDb } from "./memory-db.ts";
import type { TwilioCtx } from "../handlers/hooks.ts";

export interface HookEventRec { name: string; subject: string; payload: unknown }

export interface TestBag {
  ctx: TwilioCtx;
  events: HookEventRec[];
  clock: { now: number };
}

export function testBag(start = 1_767_625_200_000): TestBag {
  const events: HookEventRec[] = [];
  const clock = { now: start };
  const ctx: TwilioCtx = {
    space: "spc_test",
    principal: { kind: "person", id: "usr_owner" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock.now,
    db: memoryDb(),
    emit(name, subject, payload) {
      events.push({ name, subject, payload });
      return { name, subject, payload };
    },
    http: async () => { throw new Error("http not scripted"); },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  };
  return { ctx, events, clock };
}
