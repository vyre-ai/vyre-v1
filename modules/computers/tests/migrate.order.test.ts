// The move of an old desktop's sign-ins must come before the agent's first use of its Space browser profile (audit bug 6): the move replaces what the profile holds, so a profile that was already in
// use would lose what was signed in since the update. And a desktop that cannot hand over its Chrome folder is said so, never recorded as a move that carried the sign-ins (audit B10).
import test from "node:test";
import assert from "node:assert/strict";
import { bindMigration, bindMigrationPort, migrateComputers, migrationRows } from "../migrate.ts";
import { sleep, sleepIdle } from "../handlers/lifecycle.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { MIN } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";
import type { World } from "./tools.fixture.ts";

const TAR = new Uint8Array([1, 2, 3, 4, 5]);

/** The Space browser, as far as these tests look: what reached it, in order. */
function browser() {
  const events: string[] = [];
  const sb = {
    async available() { return true; },
    async tool(a: { profileId: string; tool: string }) { events.push(`tool ${a.profileId} ${a.tool}`); return { tabId: "t1", url: "https://example.com/", title: "Example", loading: false }; },
    async importChrome(profileId: string, tar: Uint8Array) { events.push(`import ${profileId} ${tar.length}`); return { bytes: tar.length }; },
    async downloads() { return []; }, async stop() {}, async forget() {},
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  return events;
}
const ports = (o: { failWorkspace?: boolean } = {}): void => {
  bindMigrationPort("ensureWorkspace", async (_c, a) => { if (o.failWorkspace) throw new Error("the workspace is not ready"); return { workspaceId: `wks_${a.agentId}` }; });
};
const off = (): void => { bindSpaceBrowser(null); bindMigration(null); bindMigrationPort("ensureWorkspace", null); };
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

test("a move that fails keeps the agent on its desktop; after the third failure it goes to the Space browser", async () => {
  const events = browser();
  ports({ failWorkspace: true });
  try {
    const w = await world({ asleep: true });
    withChrome(w, { tar: TAR });
    await open(w);
    assert.deepEqual(events, [], "the first failure: still the desktop");
    assert.equal(w.d.named("chrome_open").length, 1);
    await sleep(w.h.ctx, { computerId: w.id });
    await open(w);
    await sleep(w.h.ctx, { computerId: w.id });
    assert.deepEqual(events, [], "the second failure: still the desktop");
    await open(w);
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "failed");
    assert.deepEqual(events, ["tool agt_intake chrome_open"], "given up on: the Space browser, a fresh profile, and nothing is imported over it later");
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
    assert.equal(w.h.rows("SELECT attempts, state FROM computers_migration")[0]?.["attempts"], 0, "six busy passes, no attempt used");
    assert.notEqual(migrationRows(w.h.ctx)[0]?.state, "done");
    busy = false;
    await migrateComputers(w.h.ctx);
    assert.equal(migrationRows(w.h.ctx)[0]?.state, "done");
  } finally { off(); }
});
