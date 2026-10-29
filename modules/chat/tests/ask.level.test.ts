// chat.ask_level: the level the person holds on the object an Ask pane is about. The pane's tools never go past it (agent/src/tools/access.ts), so a view-only person's Ask can read and propose but not change.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { INTAKE, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const RANK = ["view", "use", "edit", "manage"];
const rig = (max: string | null) => harness({
  calls: {
    "access.check": (i) => {
      const level = (i as { action: { level: string } }).action.level;
      const ok = max !== null && RANK.indexOf(level) <= RANK.indexOf(max);
      return { decision: { effect: ok ? "allow" : "deny", reason: "test", steps: [], decisionId: "dec_1" } };
    },
    "records.get": () => ({ record: { id: "rec_a1", type: "contact", fields: {} } }),
  },
});
const ask = async (hn: Harness, scopeType = "record", scopeId = "rec_a1"): Promise<string> =>
  (await h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType, scopeId, idempotencyKey: `a${Math.random()}` })).thread.threadId as string;

for (const max of ["manage", "edit", "use", "view"]) {
  test(`a person who holds ${max} on the object gets ${max}`, async () => {
    const hn = rig(max);
    assert.deepEqual(await h["chat.ask_level"]!(hn.ctx, { threadId: await ask(hn) }), { level: max });
  });
}

test("an object with no resource of its own (an event) reads as view", async () => {
  const hn = harness({ calls: { "calendar.get_event": () => ({ event: { recordIds: [] } }), "access.check": () => ({ decision: { effect: "allow", reason: "t", steps: [], decisionId: "d" } }) } });
  const t = (await h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "event", scopeId: "evt_1", idempotencyKey: "e1" })).thread.threadId as string;
  assert.deepEqual(await h["chat.ask_level"]!(hn.ctx, { threadId: t }), { level: "view" });
});

test("an ordinary chat is at manage, and a pane that is not yours is not found", async () => {
  const hn = rig("view");
  const chat = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "c1" })).thread.threadId as string;
  assert.deepEqual(await h["chat.ask_level"]!(hn.ctx, { threadId: chat }), { level: "manage" });
  const pane = await ask(hn);
  assert.equal(await failure(() => h["chat.ask_level"]!(hn.person("usr_maya"), { threadId: pane })), "validation.not_found");
});
