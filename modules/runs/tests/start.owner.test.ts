// P-SEC_10: a person or an agent who starts a Run through the gateway starts it for themselves or for the person they act for, never for someone else. The host and the modules that start Runs for
// other people (routines, connectors, journeys) call from inside, which is a system call, and keep working.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, bob, bot, engine, newRun } from "../fixtures/seed.ts";

const direct = (c: { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }) => ({ ...c, depth: 0 });

test("a direct caller cannot start a Run owned by someone else", async () => {
  const h = harness();
  await assert.rejects(h.call("runs.start", newRun({ owner: bob.id }), direct(alice)), (e) => { assert.equal(codeOf(e), "permission.role_lacks_permission"); assert.equal(reasonOf(e), "owner_not_caller"); return true; });
  assert.equal((h.db.all("SELECT COUNT(*) AS n FROM runs_items") as { n: number }[])[0]!.n, 0);
  assert.deepEqual(h.events, []);
});

test("a direct caller starts a Run for themselves, and an agent for the person it acts for", async () => {
  const h = harness();
  assert.match((await h.call("runs.start", newRun({ owner: alice.id }), direct(alice))).runId, /^run_/);
  assert.match((await h.call("runs.start", newRun({ owner: alice.id }), direct(bot))).runId, /^run_/);
  await assert.rejects(h.call("runs.start", newRun({ owner: bob.id }), direct(bot)), (e) => codeOf(e) === "permission.role_lacks_permission");
});

test("a system call, and a trusted service, start a Run for anyone", async () => {
  const h = harness();
  assert.match((await h.call("runs.start", newRun({ owner: bob.id }), alice)).runId, /^run_/, "a nested call (depth above 0)");
  assert.match((await h.call("runs.start", newRun({ owner: bob.id }), direct(engine))).runId, /^run_/, "svc_engine");
});

test("a tenant-made service cannot start a Run for a person", async () => {
  const h = harness();
  const tenant = { id: `svc_${"a1".repeat(16)}`, kind: "service" as const, depth: 0 };
  await assert.rejects(h.call("runs.start", newRun({ owner: bob.id }), tenant), (e) => codeOf(e) === "permission.role_lacks_permission");
});
