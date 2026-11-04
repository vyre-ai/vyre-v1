// The one-time clean-up of holds an agent raised for a placeholder call: those drop (and their tasks are withdrawn); a real hold waits for its person as before; it runs once.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { as, bot, parkInput } from "../fixtures/seed.ts";
import { dropPlaceholderHolds } from "../handlers/placeholders.ts";
import { findHold } from "../projections.ts";

const svc = { id: "svc_host", kind: "service" as const };

test("holds with placeholder content are dropped and nothing else is", async () => {
  const h = harness();
  const agent = as(bot);
  const real = await h.call("gate.park", parkInput({ input: { to: ["maya@northwind.com"], subject: "Retainer", body: "Dear Lee, here is the retainer." } }), agent);
  const probe = await h.call("gate.park", parkInput({ input: { to: ["client@example.com"], subject: "test", body: "test" }, payloadHash: "ph_2", decisionId: "dec_2" }), agent);
  const probe2 = await h.call("gate.park", parkInput({ input: { url: "https://example.com" }, payloadHash: "ph_3", decisionId: "dec_3" }), agent);
  assert.deepEqual(await dropPlaceholderHolds(h.ctxFor(null, svc)), { dropped: 2, ran: true });
  assert.equal(findHold(h.db, real.holdId)!.state, "held");
  assert.equal(findHold(h.db, probe.holdId)!.state, "denied");
  assert.equal(findHold(h.db, probe2.holdId)!.state, "denied");
  assert.deepEqual(h.callsTo("tasks.withdraw").map((c) => c.input.taskId).sort(), [probe.taskId, probe2.taskId].sort(), "their tasks leave Needs you");
  assert.deepEqual(await dropPlaceholderHolds(h.ctxFor(null, svc)), { dropped: 0, ran: false }, "once");
});
