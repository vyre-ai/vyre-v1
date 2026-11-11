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

// Audit bugs 9 and 10 (12 Nov): claims were kept in memory, so after a restart of the daemon a claim marked running was never released; a waiting profile started only when some later browser call happened
// to look; and the live view and sign out started a browser without asking for room.
test("the periodic pass releases a claim left from before a restart and starts a waiting browser by itself", async () => {
  const sb = sbrowser({ running: () => [] });
  resetRoom();
  const h = harness();
  // room for one browser: 1536 MB kept back for the OS and Vyre, 256 MB per browser
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 256 + 10, freeMb: 1000, cpus: 2, os: "linux" });
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_old', 'browser', 'space', 'running', ?, NULL)", h.clock.t - 3_600_000);
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_next', 'browser', 'space', 'waiting', ?, 'Waiting for room on the Space server.')", h.clock.t - 60_000);
  try {
    const { periodic } = await import("../impl.ts") as { periodic?: Record<string, { everyMs: number; run: (ctx: unknown) => Promise<void> }> };
    const pass = periodic?.["computers.browser_room"];
    assert.ok(pass && pass.everyMs <= 60_000, "a pass runs at least every minute");
    await pass.run(h.ctx);
    assert.deepEqual(h.rows("SELECT claim_key, state FROM computers_claim ORDER BY claim_key").map((r) => [r["claim_key"], r["state"]]), [["agt_next", "running"]], "the stale claim is gone and the waiting one has its room");
    assert.deepEqual(sb.calls, ["agt_next chrome_tabs"], "and its browser was started");
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

test("the live view and sign out start a browser only with room on the host, with the plain line when there is none", async () => {
  const sb = sbrowser();
  resetRoom();
  const respond = { "agents.share_class": () => ({ class: "space", ownerId: DANA, people: [] }) };
  const h = harness({ principal: { kind: "person", id: DANA }, respond });
  h.fake.host.capacity = async () => ({ totalMb: 1600, freeMb: 100, cpus: 2, os: "linux" });
  let streamed = 0;
  (sb as unknown as { calls: string[] }).calls.length = 0;
  try {
    const { spaceBrowser } = await import("../sbrowser/port.ts");
    const bound = spaceBrowser()!;
    const orig = bound.stream.bind(bound);
    bound.stream = async (a) => { streamed += 1; return orig(a); };
    for (const [cap, input] of [["computers.browser.stream", { agentId: "agt_dex" }], ["computers.browser.sign_out", { agentId: "agt_dex", site: "app.example.com" }]] as const) {
      await assert.rejects(() => tool[cap]!(h.ctx, input), (e) => codeOf(e) === "provider.unavailable" && /Waiting for room/.test(JSON.stringify(e)), cap);
    }
    assert.equal(streamed, 0, "no browser was started for the view");
    assert.deepEqual(signedOut.filter((s) => s === "app.example.com"), [], "nor for the sign out");
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

// Audit bug 7 (12 Nov): SpaceBrowser.forget had no caller, so a deleted agent's cookies and sign-ins stayed in its profile.
test("a deleted agent's browser profile is removed with its hold and its room; a person's Assistant that goes when they leave is the same event", async () => {
  const forgot: string[] = [];
  const { calls } = sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  spaceBrowser()!.forget = async (id) => { forgot.push(id); };
  const h = harness();
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_gone', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
  h.db.run("INSERT INTO computers_browser_hold (profile_id, person_id, since, seen) VALUES ('agt_gone', ?, ?, ?)", DANA, h.clock.t, h.clock.t);
  try {
    const { consumers } = await import("../impl.ts") as { consumers?: Record<string, { on: string[]; run: (ctx: unknown, e: unknown) => Promise<unknown> }> };
    const c = Object.values(consumers ?? {}).find((x) => x.on.includes("agent.deleted"));
    assert.ok(c, "something hears agent.deleted");
    await c.run(h.ctx, { name: "agent.deleted", payload: { agentId: "agt_gone", by: DANA } });
    assert.deepEqual(forgot, ["agt_gone"], "the profile's folder is removed");
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_claim")[0]?.["n"], 0);
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_browser_hold")[0]?.["n"], 0);
    await c.run(h.ctx, { name: "agent.deleted", payload: { agentId: "../etc" } });
    assert.deepEqual(forgot, ["agt_gone"], "an id that is not a profile names nothing");
    assert.deepEqual(calls, []);
  } finally { bindSpaceBrowser(null); }
});

test("the periodic pass clears a takeover browserd kept after the module let go, and tells a restarted one about a hold it lost", async () => {
  const held = new Map<string, string>([["agt_stale", DANA]]);
  const told: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: [...new Set([...held.keys(), "agt_lost"])].map((id) => ({ profileId: id, running: true, tabs: 1, busy: false, takeover: held.has(id), ...(held.has(id) ? { takeoverBy: held.get(id)! } : {}), viewers: 0, lastActiveAt: 1, held: 0, paused: false })), maxRunning: 6 });
  sb.giveBack = async (id) => { told.push(`give_back ${id}`); held.delete(id); };
  sb.takeover = async (a) => { told.push(`takeover ${a.profileId} ${a.personId}`); held.set(a.profileId, a.personId); };
  const h = harness();
  h.db.run("INSERT INTO computers_browser_hold (profile_id, person_id, since, seen) VALUES ('agt_lost', ?, ?, ?)", DANA, h.clock.t, h.clock.t);
  try {
    const { periodic } = await import("../impl.ts") as { periodic: Record<string, { run: (ctx: unknown) => Promise<void> }> };
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(told.sort(), ["give_back agt_stale", `takeover agt_lost ${DANA}`]);
  } finally { bindSpaceBrowser(null); resetRoom(); }
});
