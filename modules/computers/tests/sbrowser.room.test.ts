// The Space browser on the host's budget and in the migration of an old agent computer (capacity.ts, migrate.ts of l-capacity): a browser that would start asks for room, says the plain line when there is
// none, gives its claim back when the browser stopped by itself and lets a waiting one in; Chrome's data of an old computer goes into the agent's profile, safely twice.
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigrationPort, migrateComputers, migrationRows } from "../migrate.ts";
import { provision } from "../handlers/lifecycle.ts";
import { heldOn } from "../capacity.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom } from "../sbrowser/room.ts";
import "../sbrowser/migrate.ts";
import { codeOf, DANA, harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

let sessionsNow: () => Array<{ site: string; since: number; lastSeen: number }> = () => [];
const signedOut: string[] = [];
function sbrowser(o: { running?: () => string[] } = {}) {
  const calls: string[] = [];
  const imports: Array<{ profileId: string; bytes: number }> = [];
  const sb: SpaceBrowser = {
    async available() { return true; },
    async tool(a) { calls.push(`${a.profileId} ${a.tool}`); return { ok: true, url: "https://x.test/", title: "X", loading: false, connected: false, paused: false, held: [] }; },
    async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover() {}, async giveBack() {}, async screenshot() { return { bytes: new Uint8Array(), width: 1, height: 1 }; },
    async stream() { return { transport: "mjpeg", url: "http://x" }; },
    async sessions() { return sessionsNow(); }, async signOut(_p, site) { signedOut.push(site); return true; }, async importChrome(profileId, tar) { imports.push({ profileId, bytes: tar.length }); return { bytes: tar.length }; },
    async stop() {}, async forget() {},
    async profiles() { const rows: ProfileRow[] = (o.running?.() ?? []).map((id) => ({ profileId: id, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: 1, held: 0, paused: false })); return { profiles: rows, maxRunning: 6 }; },
    async health() { return { ok: true }; },
  };
  bindSpaceBrowser(sb);
  return { calls, imports };
}
const agent = (id: string, h = harness({ principal: { kind: "agent", id }, actingFor: DANA })) => h;

test("a browser that would start waits with the plain line when the host has no memory for it, and starts when room appears", async () => {
  sbrowser();
  resetRoom();
  const full = agent("agt_dex");
  // a host with 2 GB in all, 1.5 GB of it held back for the OS and Vyre
  full.fake.host.capacity = async () => ({ totalMb: 1600, freeMb: 100, cpus: 2, os: "linux" });
  try {
    await assert.rejects(() => tool["computers.chrome.state"]!(full.ctx, {}), (e) => codeOf(e) === "provider.unavailable" && /Waiting for room/.test(JSON.stringify(e)));
    assert.equal(full.rows("SELECT state FROM computers_claim WHERE claim_key = 'agt_dex'")[0]?.["state"], "waiting");
    full.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
    await tool["computers.chrome.state"]!(full.ctx, {});
    assert.equal(full.rows("SELECT state FROM computers_claim WHERE claim_key = 'agt_dex'")[0]?.["state"], "running");
    assert.equal(heldOn(full.db, "space").reserveMb, 256, "a browser holds back 256 MB of the host while it runs");
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

test("a claim ends when browserd says the browser stopped, so the next one has room; a look at status asks for none", async () => {
  let running = ["agt_dex"];
  sbrowser({ running: () => running });
  resetRoom();
  const h = agent("agt_dex");
  h.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
  try {
    await tool["computers.chrome.status"]!(h.ctx, {});
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_claim")[0]?.["n"], 0, "status starts nothing and claims nothing");
    await tool["computers.chrome.state"]!(h.ctx, {});
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_claim")[0]?.["n"], 1);
    running = [];
    h.advance(30_000);
    await tool["computers.chrome.state"]!(h.ctx, {});
    assert.equal(h.rows("SELECT state FROM computers_claim WHERE claim_key = 'agt_dex'")[0]?.["state"], "running", "released when it was gone, claimed again for the new start");
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

test("Dex keeps his logins: the old computer's Chrome data goes into his profile, and a second pass does it no more", async () => {
  const sb = sbrowser();
  const h = harness();
  const TAR = new Uint8Array([9, 8, 7, 6]);
  h.fake.host.chromeData = async () => ({ tar: TAR });
  bindMigrationPort("ensureWorkspace", async (_c, a) => ({ workspaceId: `wks_${a.agentId}` }));
  try {
    await provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k-dex" });
    assert.deepEqual(await migrateComputers(h.ctx), { done: 1, partial: 0, failed: 0, waiting: 0 });
    assert.deepEqual(sb.imports, [{ profileId: "agt_dex", bytes: 4 }], "into the agent's own profile");
    assert.equal(migrationRows(h.ctx)[0]?.profileId, "agt_dex");
    assert.deepEqual(await migrateComputers(h.ctx), { done: 0, partial: 0, failed: 0, waiting: 0 });
    assert.equal(sb.imports.length, 1);
  } finally { bindSpaceBrowser(null); bindMigrationPort("ensureWorkspace", null); }
});

test("with no Space browser the move of the profile fails and is tried again, and a profile that is not the agent's is refused", async () => {
  const h = harness();
  h.fake.host.chromeData = async () => ({ tar: new Uint8Array([1]) });
  bindMigrationPort("ensureWorkspace", async (_c, a) => ({ workspaceId: `wks_${a.agentId}` }));
  bindSpaceBrowser(null);
  try {
    await provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k-dex" });
    await migrateComputers(h.ctx);
    assert.equal(migrationRows(h.ctx)[0]?.state, "failed");
    assert.match(String(migrationRows(h.ctx)[0]?.error), /Space browser is not running/);
    const sb = sbrowser();
    assert.deepEqual(await migrateComputers(h.ctx), { done: 1, partial: 0, failed: 0, waiting: 0 }, "the next pass moves it");
    assert.equal(sb.imports.length, 1);
  } finally { bindSpaceBrowser(null); bindMigrationPort("ensureWorkspace", null); }
});
