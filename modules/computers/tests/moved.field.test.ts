// The result of an old desktop's move is on the computers list and get, so Console can say it in one line.
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigration, migrateComputers } from "../migrate.ts";
import { get, list, provision, sleep, wake } from "../handlers/lifecycle.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

const ports = { async ensureWorkspace() { return { workspaceId: "w" }; }, async ensureBrowserProfile() { return { profileId: "p" }; }, async importChromeData() { return { bytes: 1 }; }, async profileInUse() { return false; } };

test("a desktop that has not moved has no `moved` field; one that has says how it ended, on list and on get", async () => {
  const h = harness();
  h.fake.host.chromeData = async () => ({ tar: new Uint8Array([1]) });
  bindMigration(ports);
  try {
    const id = (await provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k" })).computer.computerId;
    assert.equal((await list(h.ctx, {})).computers[0]!["moved"], undefined);
    await migrateComputers(h.ctx);
    const row = (await list(h.ctx, {})).computers[0] as Record<string, unknown>;
    assert.deepEqual((row["moved"] as { state: string }).state, "done");
    assert.equal(typeof (row["moved"] as { at: number }).at, "number");
    assert.equal(((await get(h.ctx, { computerId: id })).computer as Record<string, unknown>)["moved"] !== undefined, true);
    assert.deepEqual(contractErrors("computers.list", "out", await list(h.ctx, {})), []);
  } finally { bindMigration(null); }
});

test("partial carries its reason", async () => {
  const h = harness();
  bindMigration(ports);
  try {
    await provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k" });
    await migrateComputers(h.ctx);   // the fake host cannot hand over Chrome's folder
    const m = (await list(h.ctx, {})).computers[0]!["moved"] as { state: string; error?: string };
    assert.equal(m.state, "partial");
    assert.match(m.error ?? "", /signs in again once/);
  } finally { bindMigration(null); }
});
