// The Space tile's Needs you count (P-L7_21): the host call tasks.attention answers the same number as tasks.count_needs_you, for the person it runs as.
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls } from "../impl.ts";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, cara, owner, newTask } from "../fixtures/seed.ts";

const mk = async (h: Harness, over: Record<string, unknown> = {}): Promise<string> => (await h.call("tasks.create", newTask(over), { id: owner.id })).task.id as string;

test("tasks.attention counts the Ready requests waiting on the person, the same as tasks.count_needs_you, and nothing for someone with none", async () => {
  const h = harness();
  await mk(h, { kind: "approve", title: "Approve the invoice" });
  await mk(h, { kind: "review", title: "Review the brief" });
  await mk(h, { title: "Plain work, not a request" });
  const asAlice = h.ctxFor("tasks.count_needs_you", { id: alice.id });
  const viaHostCall = await hostCalls["tasks.attention"](asAlice);
  assert.equal(viaHostCall, 2);
  assert.equal(viaHostCall, (await h.call("tasks.count_needs_you", {}, { id: alice.id })).count);
  assert.equal(await hostCalls["tasks.attention"](h.ctxFor("tasks.count_needs_you", { id: cara.id })), 0);
});
