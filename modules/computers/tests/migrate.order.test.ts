// The move of an old desktop's sign-ins must come before the agent's first use of its Space browser profile (audit bug 6): the move replaces what the profile holds, so a profile that was already in
// use would lose what was signed in since the update. And a desktop that cannot hand over its Chrome folder is said so, never recorded as a move that carried the sign-ins (audit B10).
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigration, bindMigrationPort, migrateComputers, migrationRows, setMoveWait } from "../migrate.ts";
import { sleep, sleepIdle, wake } from "../handlers/lifecycle.ts";
import { bindSpaceBrowser, spaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { MIN } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";
import type { World } from "./tools.fixture.ts";

const TAR = new Uint8Array([1, 2, 3, 4, 5]);

let signedIn: string[] = [];
/** The Space browser, as far as these tests look: what reached it, in order. */
function browser() {
  const events: string[] = [];
  const sb = {
    async available() { return true; },
    async tool(a: { profileId: string; tool: string }) { events.push(`tool ${a.profileId} ${a.tool}`); return { tabId: "t1", url: "https://example.com/", title: "Example", loading: false }; },
    async importChrome(profileId: string, tar: Uint8Array) { events.push(`import ${profileId} ${tar.length}`); return { bytes: tar.length }; },
    async downloads() { return []; }, async stop() {}, async forget() {},
    async sessions() { return signedIn.map((site) => ({ site, since: 1, lastSeen: 1 })); },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  return events;
}
const ports = (o: { failWorkspace?: boolean } = {}): void => {
  bindMigrationPort("ensureWorkspace", async (_c, a) => { if (o.failWorkspace) throw new Error("the workspace is not ready"); return { workspaceId: `wks_${a.agentId}` }; });
};
const off = (): void => { signedIn = []; setMoveWait(null); bindSpaceBrowser(null); bindMigration(null); bindMigrationPort("ensureWorkspace", null); };
const withChrome = (w: World, data: { tar: Uint8Array } | null): void => { w.d.host.chromeData = async () => data; w.d.rebind(); };
const open = (w: World) => tool["computers.chrome.open"]!(w.agent().ctx, { url: "https://example.com/" });

test("an asleep desktop moves at the agent's first browser call: the sign-ins are in the profile before the profile is used", async () => {
  const events = browser();
  ports();
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    await open(w);
    assert.deepEqual(events, ["import agt_intake 5", "tool agt_intake chrome_open"], "the move first, then the first browser call");
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "done");
    await open(w);
    assert.equal(events.filter((e) => e.startsWith("import")).length, 1, "it moves once");
  } finally { off(); }
});

test("an awake desktop cannot be copied: its browser calls stay on it, and move to the Space browser once the idle pass has slept and moved it", async () => {
  const events = browser();
  ports();
  try {
    const w = await world();
    withChrome(w, { tar: TAR });
    await open(w);
    assert.deepEqual(events, [], "nothing reaches the Space browser, so nothing in its profile can be wiped");
    assert.equal(w.d.named("chrome_open").length, 1, "the desktop, where the sign-ins are, did the work");
    w.h.advance(11 * MIN);
    await sleepIdle(w.h.ctx);
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "done");
    assert.deepEqual(events, ["import agt_intake 5"]);
    await open(w);
    assert.deepEqual(events, ["import agt_intake 5", "tool agt_intake chrome_open"], "from then on the Space browser, with the sign-ins already in its profile");
    assert.equal(w.d.named("chrome_open").length, 1);
  } finally { off(); }
});

test("two browser calls at once on an asleep desktop move it once, and both wait for the move", async () => {
  const events = browser();
  ports();
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    await Promise.all([open(w), open(w)]);
    assert.deepEqual(events.filter((e) => e.startsWith("import")), ["import agt_intake 5"]);
    assert.equal(events.indexOf("import agt_intake 5"), 0, "before any browser call");
    assert.equal(events.filter((e) => e.startsWith("tool")).length, 2);
  } finally { off(); }
});

test("a move that keeps failing keeps the agent on its desktop: the Space browser is not used and nothing is imported, however many tries", async () => {
  const events = browser();
  ports({ failWorkspace: true });
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    for (let i = 0; i < 4; i++) {
      await open(w);
      await sleep(w.h.ctx, { computerId: w.id });
      w.h.advance(25 * 3_600_000);
    }
    assert.deepEqual(events, [], "never final, so never a fresh profile");
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "failed");
    assert.equal(Number(w.h.rows("SELECT attempts FROM computers_migration")[0]?.["attempts"]) >= 3, true);
  } finally { off(); }
});

test("a desktop that ran but has no Chrome folder to hand over is partial with the reason, not done with nothing", async () => {
  const events = browser();
  ports();
  try {
    const w = await world();
    withChrome(w, null);
    await sleep(w.h.ctx, { computerId: w.id });
    await sleepIdle(w.h.ctx);
    const row = migrationRows(w.h.ctx)[0];
    assert.equal(row?.state, "partial");
    assert.equal(row?.chromeBytes, 0);
    assert.match(row?.error ?? "", /not found/);
    assert.match(row?.error ?? "", /signs in again once/);
    assert.deepEqual(events.filter((e) => e.startsWith("import")), [], "nothing was imported");
  } finally { off(); }
});

test("a busy browser profile is tried again on later passes and never uses up an attempt", async () => {
  browser();
  ports();
  let busy = true;
  bindMigrationPort("importChromeData", async (_c, a) => { if (busy) throw new Error("This agent's browser is busy: its sign-ins move from the old computer at a quiet moment."); return { bytes: a.data.tar.length }; });
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    for (let i = 0; i < 6; i++) await migrateComputers(w.h.ctx);
    assert.deepEqual(w.h.rows("SELECT attempts FROM computers_migration"), [], "six busy passes: nothing recorded, no attempt used");
    busy = false;
    await migrateComputers(w.h.ctx);
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "done");
  } finally { bindMigrationPort("importChromeData", async (_c, a) => spaceBrowser()!.importChrome(a.profileId, a.data.tar)); off(); }
});

test("a profile that already holds sign-ins is never written over: partial with the plain reason, the workspace half done, the desktop kept", async () => {
  const events = browser();
  ports();
  signedIn = ["mail.example.com"];
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    await migrateComputers(w.h.ctx);
    const row = migrationRows(w.h.ctx)[0];
    assert.equal(row?.state, "partial");
    assert.equal(row?.workspaceId, "wks_agt_intake");
    assert.match(row?.error ?? "", /already uses its browser on the Space, so the sign-ins from its older desktop were not copied/);
    assert.deepEqual(events.filter((e) => e.startsWith("import")), [], "nothing overwritten");
    assert.equal(w.h.fake.named("remove").length, 0, "the desktop is kept");
  } finally { off(); }
});

test("not now: a runtime that does not answer or a browser that is not running uses no attempt and is tried again", async () => {
  browser();
  ports();
  let down = true;
  bindMigrationPort("ensureBrowserProfile", async (_c, a) => { if (down) throw Object.assign(new Error("The Space browser is not running on this host."), { code: "unavailable" }); return { profileId: `brw_${a.agentId}` }; });
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    for (let i = 0; i < 5; i++) await migrateComputers(w.h.ctx);
    assert.deepEqual(w.h.rows("SELECT attempts FROM computers_migration"), [], "no attempt used");
    down = false;
    assert.equal((await migrateComputers(w.h.ctx)).done, 1, "the next pass, with no waiting");
  } finally { bindMigrationPort("ensureBrowserProfile", async (_c, a) => ({ profileId: a.agentId })); off(); }
});

test("a desktop that is woken while the move is reading it is not copied: not now, no attempt", async () => {
  const events = browser();
  ports();
  try {
    const w = await world({ asleep: true });
    w.d.host.chromeData = async () => { w.h.db.run("UPDATE computers_computers SET state = 'working'"); return { tar: TAR }; };
    w.d.rebind();
    assert.equal((await migrateComputers(w.h.ctx)).done, 0);
    assert.deepEqual(events.filter((e) => e.startsWith("import")), [], "a copy of a desktop that started is thrown away");
    assert.deepEqual(w.h.rows("SELECT attempts FROM computers_migration"), []);
  } finally { off(); }
});

test("while a move runs nothing starts the desktop: a wake waits, then says it is being moved; the move carries on and the first browser call is bounded too", async () => {
  const events = browser();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  bindMigrationPort("ensureWorkspace", async (_c, a) => { await gate; return { workspaceId: `wks_${a.agentId}` }; });
  setMoveWait(50);
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    const moveRun = migrateComputers(w.h.ctx);
    await assert.rejects(() => wake(w.h.ctx, { computerId: w.id }), (e) => /being moved/.test(JSON.stringify(e)));
    await assert.rejects(() => open(w), (e) => /being moved/.test(JSON.stringify(e)));
    assert.equal(w.h.rows("SELECT state FROM computers_computers")[0]?.["state"], "asleep", "never started");
    assert.deepEqual(events, [], "no browser call reached the profile");
    release();
    assert.equal((await moveRun).done, 1, "the move carried on");
    await open(w);
    assert.deepEqual(events, ["import agt_intake 5", "tool agt_intake chrome_open"]);
  } finally { release(); off(); bindMigrationPort("ensureWorkspace", null); }
});

test("chrome_status and chrome_stop never start a move", async () => {
  const events = browser();
  let calls = 0;
  bindMigrationPort("ensureWorkspace", async (_c, a) => { calls++; return { workspaceId: `wks_${a.agentId}` }; });
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    await tool["computers.chrome.status"]!(w.agent().ctx, {});
    await tool["computers.chrome.stop"]!(w.agent().ctx, {});
    assert.equal(calls, 0, "no move");
    assert.deepEqual(events, []);
  } finally { off(); bindMigrationPort("ensureWorkspace", null); }
});
