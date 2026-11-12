// The Space browser on the host's budget and in the migration of an old agent computer (capacity.ts, migrate.ts of l-capacity): a browser that would start asks for room, says the plain line when there is
// none, gives its claim back when the browser stopped by itself and lets a waiting one in; Chrome's data of an old computer goes into the agent's profile, safely twice.
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigrationPort, migrateComputers, migrationRows } from "../migrate.ts";
import { provision } from "../handlers/lifecycle.ts";
import { heldOn } from "../capacity.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom, setRoomWaitMs, setSayWaitMs } from "../sbrowser/room.ts";
import "../sbrowser/migrate.ts";
import { asPerson, codeOf, DANA, harness } from "../fixtures/harness.ts";
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
  setRoomWaitMs(200);
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
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
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
  setRoomWaitMs(200);
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
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
});

// Audit bug 7 and review point 8 (12 Nov): SpaceBrowser.forget had no caller; then it removed the profile at once, though agent.deleted means "moved to Trash" and agents.restore exists.
test("an agent moved to Trash keeps its browser sign-ins while it can be restored; one restored keeps them; one left in Trash past its retention has its profile removed", async () => {
  const forgot: string[] = [];
  const stopped: string[] = [];
  const { calls } = sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  spaceBrowser()!.forget = async (id) => { forgot.push(id); };
  spaceBrowser()!.stop = async (id) => { stopped.push(id); };
  const h = harness();
  for (const id of ["agt_gone", "agt_back"]) {
    h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, 'browser', 'space', 'running', ?, NULL)", id, h.clock.t);
    h.db.run("INSERT INTO computers_browser_hold (profile_id, person_id, since, seen) VALUES (?, ?, ?, ?)", id, DANA, h.clock.t, h.clock.t);
  }
  try {
    const { consumers, periodic } = await import("../impl.ts") as { consumers: Record<string, { on: string[]; run: (ctx: unknown, e: unknown) => Promise<unknown> }>; periodic: Record<string, { run: (ctx: unknown) => Promise<void> }> };
    const c = Object.values(consumers).find((x) => x.on.includes("agent.deleted"))!;
    assert.ok(c.on.includes("agent.restored"), "it hears an agent coming back from Trash too");
    await c.run(h.ctx, { name: "agent.deleted", payload: { agentId: "agt_gone", by: DANA } });
    await c.run(h.ctx, { name: "agent.deleted", payload: { agentId: "agt_back", by: DANA } });
    assert.deepEqual(forgot, [], "nothing is removed while the agents can be restored");
    assert.deepEqual(stopped.sort(), ["agt_back", "agt_gone"], "their browsers stop");
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_claim")[0]?.["n"], 0, "and let go of their room");
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_browser_hold")[0]?.["n"], 0, "and of any hold");
    await c.run(h.ctx, { name: "agent.restored", payload: { agentId: "agt_back", by: DANA } });
    h.advance(29 * 86_400_000);
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, [], "29 days in Trash: kept");
    h.advance(2 * 86_400_000);
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, ["agt_gone"], "past Trash's 30 days: removed; the restored agent keeps its profile");
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, ["agt_gone"], "once");
    await c.run(h.ctx, { name: "agent.deleted", payload: { agentId: "../etc" } });
    assert.deepEqual(calls, []);
  } finally { bindSpaceBrowser(null); }
});

test("the periodic pass clears a takeover browserd kept after the module let go, and tells a restarted one about a hold it lost", async () => {
  const held = new Map<string, string>([["agt_stale", DANA]]);
  const told: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: [...new Set([...held.keys(), "agt_lost"])].map((id) => ({ profileId: id, spaceId: "spc_computerstest", running: true, tabs: 1, busy: false, takeover: held.has(id), ...(held.has(id) ? { takeoverBy: held.get(id)! } : {}), viewers: 0, lastActiveAt: 1, held: 0, paused: false })), maxRunning: 6 });
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

// Second look B (12 Nov): two Spaces on one computer (two daemons on one Docker engine) share the one `vyre-sbrowser` container. The periodic pass gave back every takeover its own table did not know,
// so each Space released the other's every 30 seconds.
test("the periodic pass touches only this Space's profiles on a Space browser two Spaces share", async () => {
  const told: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  const h = harness();
  sb.profiles = async () => ({ profiles: [
    { profileId: "agt_theirs", spaceId: "spc_other", running: true, tabs: 1, busy: false, takeover: true, takeoverBy: "usr_zed", viewers: 0, lastActiveAt: 1, held: 0, paused: false },
    { profileId: "agt_ours", spaceId: h.ctx.space, running: true, tabs: 1, busy: false, takeover: true, takeoverBy: DANA, viewers: 0, lastActiveAt: 1, held: 0, paused: false },
  ], maxRunning: 6 });
  sb.giveBack = async (id) => { told.push(`give_back ${id}`); };
  sb.takeover = async (a) => { told.push(`takeover ${a.profileId}`); };
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_ours', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
  try {
    const { periodic } = await import("../impl.ts") as { periodic: Record<string, { run: (ctx: unknown) => Promise<void> }> };
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(told, ["give_back agt_ours"], "this Space's stale takeover is released; the other Space's is left alone");
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

test("the Trash retention in force is read from governance: a Space that keeps Trash 45 days keeps the profile 45 days, one that keeps it forever never removes it", async () => {
  const forgot: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  spaceBrowser()!.forget = async (id) => { forgot.push(id); };
  let value = "45d";
  const h = harness({ respond: { "governance.retention.get": () => ({ kinds: [{ key: "logs", value: "1d" }, { key: "trash", value }] }) } });
  h.db.run("INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES ('agt_gone', ?)", h.clock.t);
  try {
    const { periodic } = await import("../impl.ts") as { periodic: Record<string, { run: (ctx: unknown) => Promise<void> }> };
    h.advance(44 * 86_400_000);
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, [], "44 days of 45");
    value = "forever";
    h.advance(400 * 86_400_000);
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, [], "Trash kept forever: never removed");
    value = "45d";
    await periodic["computers.browser_room"]!.run(h.ctx);
    assert.deepEqual(forgot, ["agt_gone"]);
  } finally { bindSpaceBrowser(null); }
});

// Owner, 12 Nov: "It needs to work on more than 30 ... smoothly without doing anything extra." When the host is full, the least recently used quiet browser makes room at once; only when every one is in use
// does a newcomer wait.
test("a full host closes the least recently used quiet browser for a newcomer and releases its room; one in use, watched or held is never closed; all in use, the newcomer waits", async () => {
  const stopped: string[] = [];
  let rows: ProfileRow[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: rows, maxRunning: 30 });
  sb.stop = async (id) => { stopped.push(id); rows = rows.filter((r) => r.profileId !== id); };
  resetRoom();
  const h = harness({ principal: { kind: "agent", id: "agt_new" }, actingFor: DANA });
  setRoomWaitMs(300);
  // room for exactly three browsers: 1536 MB kept back, 256 MB each
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 3 * 256, freeMb: 4000, cpus: 4, os: "linux" });
  const row = (id: string, over: Partial<ProfileRow> = {}): ProfileRow => ({ profileId: id, spaceId: h.ctx.space, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: 1, held: 0, paused: false, ...over });
  for (const id of ["agt_old", "agt_busy", "agt_watched"]) h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, 'browser', 'space', 'running', ?, NULL)", id, h.clock.t);
  rows = [row("agt_busy", { busy: true, lastActiveAt: 0 }), row("agt_watched", { viewers: 1, lastActiveAt: 0 }), row("agt_old", { lastActiveAt: 5 })];
  try {
    await tool["computers.chrome.state"]!(h.ctx, {});
    assert.deepEqual(stopped, ["agt_old"], "the quiet one went; the busy and the watched ones stayed");
    assert.deepEqual(h.rows("SELECT claim_key, state FROM computers_claim ORDER BY claim_key").map((r) => [r["claim_key"], r["state"]]), [["agt_busy", "running"], ["agt_new", "running"], ["agt_watched", "running"]], "its room went to the newcomer");
    // now all three are in use: a fourth waits with the plain line
    rows = [row("agt_busy", { busy: true }), row("agt_watched", { viewers: 1 }), row("agt_new", { busy: true })];
    const late = asPerson(h, { kind: "agent", id: "agt_late" }, { actingFor: DANA });
    await assert.rejects(() => tool["computers.chrome.state"]!(late.ctx, {}), (e) => /Every browser on this server is in use\. Yours opens as soon as one is free\./.test(JSON.stringify(e)) && /browser_full/.test(JSON.stringify(e)));
    assert.deepEqual(stopped, ["agt_old"]);
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
});

test("browsers that ask for room at the same moment never go past the budget", async () => {
  sbrowser({ running: () => [] });
  resetRoom();
  setRoomWaitMs(300);
  const h = harness();
  // the host's answer takes a moment, as a real one does: every claim reads what is held, waits, then writes
  h.fake.host.capacity = async () => { await new Promise((r) => setTimeout(r, 5)); return { totalMb: 1536 + 3 * 256, freeMb: 4000, cpus: 4, os: "linux" }; };
  try {
    const { needRoom } = await import("../sbrowser/room.ts");
    const { spaceBrowser } = await import("../sbrowser/port.ts");
    const results = await Promise.allSettled(["agt_c1", "agt_c2", "agt_c3", "agt_c4", "agt_c5", "agt_c6"].map((id) => needRoom(asPerson(h, { kind: "agent", id }).ctx, spaceBrowser()!, id)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3, "three fit");
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_claim WHERE state = 'running'")[0]?.["n"], 3);
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
});


// Fourth look, then the lead's rule of 12 Nov: a browser whose agent has a turn in progress is never closed; one known to have none may be closed 10 s after its last step; one whose turn state is not
// known keeps 90 s. Another Space's are never closed by this module; when the container is full of them browserd is asked, by the 90 s rule. The newcomer waits its turn and says so after 10 s.
test("make room: a turn keeps its browser; known idle goes after 10 s; unknown keeps 90 s; another Space's only through browserd; the newcomer waits in line and says how many are ahead", async () => {
  const stopped: string[] = [];
  const askedOther: number[] = [];
  let rows: ProfileRow[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: rows, maxRunning: 4 });
  sb.stop = async (id) => { stopped.push(id); rows = rows.filter((r) => r.profileId !== id); };
  sb.closeOther = async (_space, quietMs) => { askedOther.push(quietMs); return null; };
  resetRoom();
  setRoomWaitMs(1500);
  setSayWaitMs(200);
  const h = harness({ principal: { kind: "agent", id: "agt_new" }, actingFor: DANA });
  const { consumers } = await import("../impl.ts") as unknown as { consumers: Record<string, { run: (ctx: unknown, e: unknown) => Promise<unknown> }> };
  const turn = (name: string, agentId: string, turnId = `trn_${agentId}`): Promise<unknown> => consumers["computers.browser_turns"]!.run(h.ctx, { name, payload: { agentId, turnId, threadId: "thr_1" } });
  // agt_working is mid-turn (an Assistant: agents.status would not answer for it to another agent, the turn events do); agt_idle finished its turn 5 s ago; agt_unknown has no turn heard of
  await turn("turn.started", "agt_working");
  await turn("turn.started", "agt_idle"); await turn("turn.completed", "agt_idle");
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 10 * 256, freeMb: 4000, cpus: 4, os: "linux" });
  const old = Date.now() - 10 * 60_000;
  const row = (id: string, over: Partial<ProfileRow> = {}): ProfileRow => ({ profileId: id, spaceId: h.ctx.space, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: old, held: 0, paused: false, ...over });
  for (const id of ["agt_working", "agt_idle", "agt_unknown"]) h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, 'browser', 'space', 'running', ?, NULL)", id, h.clock.t);
  rows = [row("agt_working"), row("agt_idle", { lastActiveAt: Date.now() - 5_000 }), row("agt_unknown", { lastActiveAt: Date.now() - 30_000 }), row("agt_theirs", { spaceId: "spc_other" })];
  try {
    const t0 = Date.now();
    const waiting = assert.rejects(() => tool["computers.chrome.state"]!(h.ctx, {}), (e) => /Every browser on this server is in use/.test(JSON.stringify(e)), "nothing may be closed: it waits, then says so");
    await new Promise((r) => setTimeout(r, 600));
    const listed = (await (await import("../sbrowser/handlers.ts")).profiles(asPerson(h, { kind: "person", id: DANA }).ctx, {})) as { profiles: Array<{ agentId: string; line?: string }>; slots: { waiting: number } };
    assert.equal(listed.slots.waiting, 1);
    await waiting;
    assert.ok(Date.now() - t0 >= 1400, "it waited its turn for room before the line");
    assert.deepEqual(stopped, [], "the working agent's, the one 5 s after its turn, the unknown one 30 s after its step and the other Space's were all left alone");
    assert.ok(askedOther.length > 0 && askedOther.every((ms) => ms === 90_000), "browserd was asked for another Space's quiet browser by the 90 s rule");
    void listed;
    // agt_idle passes its 10 s: it goes first (the unknown one still has its 90 s)
    rows = rows.map((r) => (r.profileId === "agt_idle" ? { ...r, lastActiveAt: Date.now() - 11_000 } : r));
    await tool["computers.chrome.state"]!(h.ctx, {});
    assert.deepEqual(stopped, ["agt_idle"], "known idle and past the short grace");
    // the working agent's turn ends: its browser may go 10 s after its last step, not before
    await turn("turn.completed", "agt_working");
    const late = asPerson(h, { kind: "agent", id: "agt_late" }, { actingFor: DANA });
    rows = rows.concat([row("agt_new", { lastActiveAt: Date.now() })]);
    h.db.run("INSERT OR REPLACE INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_new', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
    await tool["computers.chrome.state"]!(late.ctx, {});
    assert.deepEqual(stopped, ["agt_idle", "agt_working"], "the least recently used of those that may now be closed");
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); setSayWaitMs(null); }
});

test("a waiting browser says so in its row after 10 s, with how many are ahead of it", async () => {
  let rows: ProfileRow[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: rows, maxRunning: 1 });
  resetRoom();
  setRoomWaitMs(1200);
  setSayWaitMs(150);
  const h = harness({ respond: { "agents.share_class": () => ({ class: "space", ownerId: DANA, people: [] }) } });
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 10 * 256, freeMb: 4000, cpus: 4, os: "linux" });
  rows = [{ profileId: "agt_busy", spaceId: h.ctx.space, running: true, tabs: 1, busy: true, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false }];
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_busy', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
  try {
    const { needRoom, roomWaitLine } = await import("../sbrowser/room.ts");
    const a = needRoom(asPerson(h, { kind: "agent", id: "agt_first" }).ctx, sb, "agt_first").catch(() => undefined);
    const b = needRoom(asPerson(h, { kind: "agent", id: "agt_second" }).ctx, sb, "agt_second").catch(() => undefined);
    assert.equal(roomWaitLine("agt_second"), null, "not before 10 s");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(roomWaitLine("agt_first"), "Waiting for a free browser on this server. Next in line.");
    assert.equal(roomWaitLine("agt_second"), "Waiting for a free browser on this server. 1 ahead.");
    await Promise.all([a, b]);
    assert.equal(roomWaitLine("agt_second"), null, "gone when it stops waiting");
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); setSayWaitMs(null); }
});

// Fifth look 3: a turn's protection is refreshed by its agent's browser calls and the engine's turn.block, so a long turn is never stale; turn.waiting ends it; and after a restart (nothing heard) every
// agent is unknown (the 90 s grace) until its next turn event; a call with no turn heard of makes it unknown again.
test("turn state: a long turn that keeps working is never stale; waiting ends it; nothing heard is unknown; a call with no known turn is unknown", async () => {
  const { turnStarted, turnEnded, turnActive, turnState, callStarted, callEnded, TURN_STALE_MS } = await import("../sbrowser/room.ts");
  resetRoom();
  const S = "spc_a";
  assert.equal(turnState(S, "agt_a", 0), "unknown", "nothing heard since this daemon started (a restart): unknown, so the 90 s grace");
  turnStarted(S, "agt_a", "trn_1", 0);
  assert.equal(turnState(S, "agt_a", 1000), "turn");
  // forty minutes of work: browser calls and the engine's blocks keep it alive
  for (let m = 5; m <= 40; m += 5) { if (m % 10 === 0) { callStarted("agt_a", S, m * 60_000); callEnded("agt_a"); } else turnActive("trn_1", m * 60_000); }
  assert.equal(turnState(S, "agt_a", 41 * 60_000), "turn", "still working after 40 minutes: still protected");
  assert.equal(turnState(S, "agt_a", 40 * 60_000 + TURN_STALE_MS + 1), "idle", "silent for 30 minutes: no longer");
  turnStarted(S, "agt_a", "trn_2", 0);
  // parked on a person (turn.waiting carries no agent id: the turn's own is used)
  turnEnded(S, "", "trn_2");
  assert.equal(turnState(S, "agt_a", 1000), "idle", "a parked turn does not hold its browser (a held send does)");
  callStarted("agt_a", S, 2000); callEnded("agt_a");
  assert.equal(turnState(S, "agt_a", 3000), "unknown", "a call with no turn heard of: the engine's events are behind, so unknown");
  turnStarted(S, "agt_a", "trn_3", 4000);
  assert.equal(turnState(S, "agt_a", 5000), "turn");
  resetRoom();
});

// Fifth look 2: every answer after a reopen says so once; an act on refs from a snapshot under an older start of the browser is refused every time until a new snapshot; the same after an idle stop.
test("after a reopen (make room or idle stop): the next answer carries the line once; an act on old refs is refused every time until a new snapshot", async () => {
  let start = "b1.1";
  const sent: Array<string | undefined> = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  const { ToolError } = await import("../handlers/tools/common.ts");
  const { REOPENED_LINE } = await import("../sbrowser/room.ts");
  sb.profiles = async () => ({ profiles: [{ profileId: "agt_dex", running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false }], maxRunning: 6 });
  sb.tool = async (a) => {
    if (a.tool === "chrome_tabs" && a.args["action"] === "list") return { tabs: [] };
    if (a.tool === "chrome_click" || a.tool === "chrome_act") sent.push(a.refsFrom);
    if (a.refsFrom && a.refsFrom !== start) throw new ToolError("bad_input", REOPENED_LINE, "browser_reopened");
    return { ok: true, url: "https://x.test/", title: "X", loading: false, tree: "- button e1", truncated: false, browserStart: start };
  };
  resetRoom();
  const h = agent("agt_dex");
  h.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
  const refused = (e: unknown): boolean => /Your browser was reopened and its pages reloaded\. Take a new snapshot before you click\./.test(JSON.stringify(e));
  try {
    await tool["computers.chrome.snapshot"]!(h.ctx, {});
    await tool["computers.chrome.click"]!(h.ctx, { ref: "e1" });
    assert.deepEqual(sent, ["b1.1"], "the act says which start its refs came from");
    for (const why of ["closed to make room", "stopped by browserd when idle"]) {
      start = start === "b1.1" ? "b1.2" : "b2.1";
      // a look: goes on, and its answer says so, once
      const look = await tool["computers.chrome.state"]!(h.ctx, {}) as Record<string, unknown>;
      assert.equal(look["reopened"], true, why);
      assert.equal(look["note"], REOPENED_LINE);
      assert.equal((await tool["computers.chrome.state"]!(h.ctx, {}) as Record<string, unknown>)["reopened"], undefined, "once");
      // a click on an old ref: refused, and again
      await assert.rejects(() => tool["computers.chrome.click"]!(h.ctx, { ref: "e1" }), refused, why);
      await assert.rejects(() => tool["computers.chrome.click"]!(h.ctx, { ref: "e1" }), refused, "every time until a new snapshot");
      await tool["computers.chrome.snapshot"]!(h.ctx, {});
      await tool["computers.chrome.click"]!(h.ctx, { ref: "e1" });
    }
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

test("calls waiting for room are served first come, first served", async () => {
  let rows: ProfileRow[] = [];
  const order: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: rows, maxRunning: 1 });
  sb.stop = async (id) => { rows = rows.filter((r) => r.profileId !== id); };
  resetRoom();
  setRoomWaitMs(5000);
  const h = harness();
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 10 * 256, freeMb: 4000, cpus: 4, os: "linux" });
  const row = (id: string): ProfileRow => ({ profileId: id, spaceId: h.ctx.space, running: true, tabs: 1, busy: true, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false });
  rows = [row("agt_busy")];
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_busy', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
  try {
    const { needRoom } = await import("../sbrowser/room.ts");
    const ask = (id: string) => needRoom(asPerson(h, { kind: "agent", id }).ctx, sb, id).then(() => { order.push(id); rows = [row(id)]; });
    const a = ask("agt_first");
    await new Promise((r) => setTimeout(r, 30));
    const b = ask("agt_second");
    await new Promise((r) => setTimeout(r, 200));
    // the busy one finishes: the first in line gets it, then the second when the first is done
    rows = [];
    await a;
    rows = [];
    await b;
    assert.deepEqual(order, ["agt_first", "agt_second"]);
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
});

// Sixth look 1: an act that names no ref (a click at x/y, a key, typed text into the focused field, a script, an API call) would run on the reloaded page the agent never saw. Every act carries the start
// of the browser the agent last saw; browserd refuses it when the browser started since, before any Vault value is asked for; once the agent was told (or has looked), it goes on. After a restart of
// this daemon (no start seen) acts are refused until a look.
test("after a reopen every kind of act is refused with the line before it touches the page (a #Handle never typed), and goes on after a look; after a daemon restart, refused until a look", async () => {
  let start = "b1.1";
  const reached: string[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  const { ToolError } = await import("../handlers/tools/common.ts");
  const { REOPENED_LINE } = await import("../sbrowser/room.ts");
  sb.profiles = async () => ({ profiles: [{ profileId: "agt_dex", running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false }], maxRunning: 6 });
  sb.tool = async (a) => {
    if (a.tool === "chrome_tabs" && a.args["action"] === "list") return { tabs: [], browserStart: start };
    // browserd: the act is refused before anything else (the Vault, the page) when the start it names is not the one running
    if (a.seenFrom !== undefined && a.seenFrom !== start) { const e = new ToolError("bad_input", REOPENED_LINE, "browser_reopened"); e.start = start; throw e; }
    if (a.seenFrom !== undefined) reached.push(`${a.tool}${typeof a.args["text"] === "string" ? ` ${a.args["text"]}` : ""}`);
    return { ok: true, url: "https://x.test/", title: "X", loading: false, result: 1, status: 200, headers: {}, body: null, browserStart: start };
  };
  resetRoom();
  const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA, respond: { "vault.fill_grant": () => ({ url: "http://fill", token: "t" }) } });
  h.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
  const told = (e: unknown): boolean => /Your browser was reopened and its pages reloaded\. Take a new snapshot before you click\./.test(JSON.stringify(e));
  const acts: Array<[string, Record<string, unknown>]> = [
    ["computers.chrome.click", { x: 10, y: 20 }],
    ["computers.chrome.act", { action: "press", value: "Enter" }],
    ["computers.chrome.act", { action: "scroll" }],
    ["computers.chrome.type", { text: "#Acme.password", submit: true }],
    ["computers.chrome.eval", { expression: "1" }],
    ["computers.chrome.api", { method: "GET", url: "https://x.test/api" }],
  ];
  try {
    await tool["computers.chrome.state"]!(h.ctx, {});
    let n = 1;
    for (const [cap, input] of acts) {
      start = `b1.${++n}`;   // closed to make room (or stopped when idle) and opened again: its pages reloaded
      reached.length = 0;
      await assert.rejects(() => tool[cap]!(h.ctx, input), told, `${cap} ${JSON.stringify(input)} is refused with the line`);
      assert.deepEqual(reached, [], "it never reached the page (a #Handle was never typed into whatever field the page focused)");
      await tool["computers.chrome.state"]!(h.ctx, {});
      await tool[cap]!(h.ctx, input);
      assert.equal(reached.length, 1, "after a look it goes on");
    }
    // the refusal is the notice: told once, the next act goes on
    start = "b1.99";
    await assert.rejects(() => tool["computers.chrome.click"]!(h.ctx, { x: 1, y: 1 }), told);
    await tool["computers.chrome.click"]!(h.ctx, { x: 1, y: 1 });
    // this daemon restarts: it has seen no start, so acts are refused until a look
    resetRoom();
    reached.length = 0;
    await assert.rejects(() => tool["computers.chrome.type"]!(h.ctx, { text: "#Acme.password", submit: true }), told);
    await assert.rejects(() => tool["computers.chrome.type"]!(h.ctx, { text: "#Acme.password", submit: true }), told, "still refused: nothing looked at yet");
    assert.deepEqual(reached, []);
    await tool["computers.chrome.tabs"]!(h.ctx, { action: "list" });
    await tool["computers.chrome.type"]!(h.ctx, { text: "#Acme.password", submit: true });
    assert.equal(reached.length, 1);
  } finally { bindSpaceBrowser(null); resetRoom(); }
});

// Sixth look C, the module's side: a browser a person watched or held in the last minute is not closed to make room, though its agent is idle and past its 10 s.
test("a browser a person had in front of them in the last minute is not closed to make room; after a minute it may be", async () => {
  const stopped: string[] = [];
  let rows: ProfileRow[] = [];
  sbrowser();
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  sb.profiles = async () => ({ profiles: rows, maxRunning: 1 });
  sb.stop = async (id) => { stopped.push(id); rows = rows.filter((r) => r.profileId !== id); };
  resetRoom();
  setRoomWaitMs(600);
  const h = harness({ principal: { kind: "agent", id: "agt_new" }, actingFor: DANA });
  const { consumers } = await import("../impl.ts") as unknown as { consumers: Record<string, { run: (ctx: unknown, e: unknown) => Promise<unknown> }> };
  await consumers["computers.browser_turns"]!.run(h.ctx, { name: "turn.started", payload: { agentId: "agt_seen", turnId: "trn_s", threadId: "thr_1" } });
  await consumers["computers.browser_turns"]!.run(h.ctx, { name: "turn.completed", payload: { agentId: "agt_seen", turnId: "trn_s", threadId: "thr_1" } });
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 10 * 256, freeMb: 4000, cpus: 4, os: "linux" });
  h.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_seen', 'browser', 'space', 'running', ?, NULL)", h.clock.t);
  rows = [{ profileId: "agt_seen", spaceId: h.ctx.space, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now() - 30_000, personSeenAt: Date.now() - 20_000, held: 0, paused: false }];
  try {
    await assert.rejects(() => tool["computers.chrome.state"]!(h.ctx, {}), (e) => /Every browser on this server is in use/.test(JSON.stringify(e)));
    assert.deepEqual(stopped, [], "a person closed its view 20 s ago: kept");
    rows = rows.map((r) => ({ ...r, personSeenAt: Date.now() - 61_000 }));
    await tool["computers.chrome.state"]!(h.ctx, {});
    assert.deepEqual(stopped, ["agt_seen"]);
  } finally { bindSpaceBrowser(null); resetRoom(); setRoomWaitMs(null); }
});

test("taking over a browser reopened since the person last saw it: the pane says so in one line", async () => {
  const sbx = sbrowser();
  void sbx;
  const { spaceBrowser } = await import("../sbrowser/port.ts");
  const sb = spaceBrowser()!;
  let reopened = true;
  sb.takeover = async () => ({ reopened });
  resetRoom();
  const respond = { "agents.share_class": () => ({ class: "personal", ownerId: DANA, people: [] }) };
  const h = harness({ principal: { kind: "person", id: DANA }, respond });
  try {
    const { TAKEOVER_REOPENED } = await import("../sbrowser/handlers.ts");
    const got = await tool["computers.browser.take_over"]!(h.ctx, { agentId: "agt_dex" }) as { note?: string };
    assert.equal(got.note, TAKEOVER_REOPENED);
    await tool["computers.browser.give_back"]!(h.ctx, { agentId: "agt_dex" });
    reopened = false;
    assert.equal((await tool["computers.browser.take_over"]!(h.ctx, { agentId: "agt_dex" }) as { note?: string }).note, undefined);
  } finally { bindSpaceBrowser(null); resetRoom(); }
});
