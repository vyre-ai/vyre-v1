// The one-time move of an agent computer to a workspace and a Space browser profile that keeps its Chrome logins. The ports l-ws and l-sbrowser bind are scripted here; the machine is the fake host
// with a Chrome folder to hand over.
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigration, MAX_ATTEMPTS, migrateComputers, migrationRows } from "../migrate.ts";
import type { MigrationPorts } from "../migrate.ts";
import { provision, sleepIdle, wake } from "../handlers/lifecycle.ts";
import { harness, MIN } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const TAR = new Uint8Array([1, 2, 3, 4, 5]);
async function made(h: Harness, agent: string): Promise<string> {
  return (await provision(h.ctx, { agentId: agent, idempotencyKey: `k-${agent}` })).computer.computerId;
}
function ports(log: string[], o: { failProfile?: () => boolean } = {}): MigrationPorts {
  return {
    async ensureWorkspace(_c, a) { log.push(`workspace ${a.agentId}`); return { workspaceId: `wks_${a.agentId}` }; },
    async ensureBrowserProfile(_c, a) { if (o.failProfile?.()) throw new Error("the browser is not ready"); log.push(`profile ${a.agentId}`); return { profileId: `brw_${a.agentId}` }; },
    async importChromeData(_c, a) { log.push(`import ${a.profileId} ${a.data.tar.length}`); return { bytes: a.data.tar.length }; },
  };
}
const withChrome = (h: Harness): void => { h.fake.host.chromeData = async () => ({ tar: TAR }); };

test("an asleep computer gets a workspace and a browser profile, and Chrome's folder goes into the profile", async () => {
  const h = harness();
  withChrome(h);
  const log: string[] = [];
  bindMigration(ports(log));
  try {
    const id = await made(h, "agt_dex");
    assert.deepEqual(await migrateComputers(h.ctx), { done: 1, partial: 0, failed: 0, waiting: 0 });
    assert.deepEqual(log, ["workspace agt_dex", "profile agt_dex", "import brw_agt_dex 5"], "the workspace, then the profile, then the logins into the profile");
    assert.deepEqual(migrationRows(h.ctx), [{ computerId: id, agentId: "agt_dex", state: "done", workspaceId: "wks_agt_dex", profileId: "brw_agt_dex", chromeBytes: 5 }]);
    // the old computer is left alone, asleep, with its profile
    assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "asleep");
    assert.equal(h.fake.named("remove").length, 0);
  } finally { bindMigration(null); }
});

test("it runs once: a second pass changes nothing and calls nothing", async () => {
  const h = harness();
  withChrome(h);
  const log: string[] = [];
  bindMigration(ports(log));
  try {
    await made(h, "agt_dex");
    await migrateComputers(h.ctx);
    const n = log.length;
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 0 });
    assert.equal(log.length, n);
  } finally { bindMigration(null); }
});

test("with the ports not bound nothing runs and nothing is marked, so the move waits for both lanes", async () => {
  const h = harness();
  withChrome(h);
  await made(h, "agt_dex");
  bindMigration(null);
  assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 0 });
  assert.deepEqual(migrationRows(h.ctx), []);
});

test("an awake computer waits: its Chrome databases are not copied while Chrome runs", async () => {
  const h = harness();
  withChrome(h);
  const log: string[] = [];
  bindMigration(ports(log));
  try {
    const id = await made(h, "agt_dex");
    await wake(h.ctx, { computerId: id });
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 1 });
    assert.deepEqual(log, []);
    // once it sleeps, the next idle pass moves it, in that same pass
    h.advance(11 * MIN);
    await sleepIdle(h.ctx);
    assert.deepEqual(log, ["workspace agt_dex", "profile agt_dex", "import brw_agt_dex 5"]);
  } finally { bindMigration(null); }
});

test("a computer that never had a Chrome folder still moves, with nothing to import", async () => {
  const h = harness();
  h.fake.host.chromeData = async () => null;
  const log: string[] = [];
  bindMigration(ports(log));
  try {
    await made(h, "agt_dex");
    assert.deepEqual(await migrateComputers(h.ctx), { done: 1, partial: 0, failed: 0, waiting: 0 });
    assert.deepEqual(log, ["workspace agt_dex", "profile agt_dex"]);
    assert.equal(migrationRows(h.ctx)[0]?.chromeBytes, 0);
  } finally { bindMigration(null); }
});

test("a host that cannot hand over Chrome's folder (a joined server) gets a workspace and a profile and is marked partial, with the reason", async () => {
  const h = harness();
  const log: string[] = [];
  bindMigration(ports(log));
  try {
    await made(h, "agt_dex");
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 1, failed: 0, waiting: 0 });
    assert.deepEqual(log, ["workspace agt_dex", "profile agt_dex"]);
    const row = migrationRows(h.ctx)[0];
    assert.equal(row?.state, "partial");
    assert.match(row?.error ?? "", /signs in again once/);
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 0 }, "partial is final");
  } finally { bindMigration(null); }
});

test("a failed step is tried again on the next pass from where it stopped, and given up on after three, with the reason kept", async () => {
  const h = harness();
  withChrome(h);
  const log: string[] = [];
  let broken = true;
  bindMigration(ports(log, { failProfile: () => broken }));
  try {
    await made(h, "agt_dex");
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 0 }, "first failure: tried again later, not yet final");
    assert.equal(migrationRows(h.ctx)[0]?.state, "failed");
    assert.match(migrationRows(h.ctx)[0]?.error ?? "", /browser is not ready/);
    broken = false;
    assert.deepEqual(await migrateComputers(h.ctx), { done: 1, partial: 0, failed: 0, waiting: 0 }, "the second pass finishes it");
    assert.equal(migrationRows(h.ctx)[0]?.state, "done");
    assert.equal(migrationRows(h.ctx)[0]?.error, undefined);
  } finally { bindMigration(null); }
  const g = harness();
  withChrome(g);
  bindMigration(ports([], { failProfile: () => true }));
  try {
    await made(g, "agt_dex");
    const seen: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) seen.push((await migrateComputers(g.ctx)).failed);
    assert.deepEqual(seen, [0, 0, 1, 0, 0], "the third failure is counted once and then the computer is left alone");
    assert.equal(g.rows("SELECT attempts FROM computers_migration")[0]?.["attempts"], MAX_ATTEMPTS);
  } finally { bindMigration(null); }
});

test("each computer is its own row: one that fails does not stop the others", async () => {
  const h = harness();
  withChrome(h);
  const log: string[] = [];
  bindMigration({
    ...ports(log),
    async ensureWorkspace(_c, a) { if (a.agentId === "agt_a") throw new Error("no room"); log.push(`workspace ${a.agentId}`); return { workspaceId: `wks_${a.agentId}` }; },
  });
  try {
    await made(h, "agt_a"); await made(h, "agt_b");
    await migrateComputers(h.ctx);
    assert.deepEqual(migrationRows(h.ctx).map((r) => `${r.agentId}:${r.state}`), ["agt_a:failed", "agt_b:done"]);
  } finally { bindMigration(null); }
});
