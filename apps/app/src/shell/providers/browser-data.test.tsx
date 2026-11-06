// The Browser section's data in the shell: the profile as the pane draws it from computers.browser.profiles, take over and give back, the sentence a refusal carries, and the live view's helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { browserData, browserView } from "./browser-data.tsx";
import type { BrowserRowLike } from "./browser-data.tsx";
import { BROWSER_VIEW, keyMessages, pointOf, socketUrl, viewUrl } from "../../places/chats/rightpane/BrowserLive.tsx";

const row = (o: Partial<BrowserRowLike> = {}): BrowserRowLike => ({ agentId: "agt_dex", running: true, tabs: 3, busy: false, viewers: 0, paired: true, access: "admin", ...o });
const d = { me: "usr_me", nameOf: (id: string) => ({ usr_maya: "Maya" } as Record<string, string>)[id] ?? id };

test("an unlisted profile is closed; a running one is open with its tabs and says when the agent is in it; a closed one is closed", () => {
  assert.deepEqual(browserView("agt_dex", [], d), { state: "closed", canTakeOver: true, sites: [] });
  assert.deepEqual(browserView("agt_dex", [row()], d), { state: "open", tabs: 3, canTakeOver: true, sites: [] });
  assert.equal(browserView("agt_dex", [row({ busy: true })], d).caption, "Working in it now");
  assert.equal(browserView("agt_dex", [row({ running: false })], d).state, "closed");
  assert.equal(browserView("agt_dex", [row({ agentId: "agt_other" })], d).state, "closed", "another agent's row is not this one");
});

test("who has the controls: me, or a named person; a viewer may watch but not take over", () => {
  assert.deepEqual(browserView("agt_dex", [row({ takeoverBy: "usr_me" })], d), { state: "takeover", tabs: 3, takenBy: "You", mine: true, canTakeOver: true, sites: [] });
  const other = browserView("agt_dex", [row({ takeoverBy: "usr_maya" })], d);
  assert.equal(other.takenBy, "Maya");
  assert.equal(other.mine, false);
  const viewer = browserView("agt_dex", [row({ access: "viewer" })], d);
  assert.deepEqual([viewer.canTakeOver, viewer.cannotTakeOver], [false, "You can watch this browser but not take it over."]);
});

function wire(over: { fail?: string; rows?: BrowserRowLike[] } = {}) {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const ticks: Array<() => void> = [];
  const data = browserData({
    call: async (cap, input) => {
      calls.push({ cap, input });
      if (over.fail && cap !== "computers.browser.profiles" && cap !== "computers.browser.sessions") throw new Error(over.fail);
      if (cap === "computers.browser.sessions") return { sessions: [{ site: "app.clio.com", signedInAs: "intake@x.example", since: 5, lastSeen: 6 }] };
      return cap === "computers.browser.profiles" ? { profiles: over.rows ?? [row()], maxRunning: 4 } : {};
    },
    ...d, every: (f) => { ticks.push(f); return () => { ticks.splice(ticks.indexOf(f), 1); }; },
  });
  return { data, calls, ticks };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("watch reads the profiles now and on every tick, and a take over or give back refreshes it at once; stopping ends the ticks", async () => {
  const w = wire();
  const seen: string[] = [];
  const off = w.data.watch("agt_dex", (v) => seen.push(v.state));
  await flush();
  assert.deepEqual(seen, ["open"]);
  assert.equal(w.ticks.length, 1);
  w.ticks[0]!();
  await flush();
  assert.equal(seen.length, 2);
  await w.data.takeOver("agt_dex");
  await flush();
  assert.deepEqual(w.calls.filter((c) => c.cap === "computers.browser.take_over").map((c) => c.input), [{ agentId: "agt_dex" }]);
  assert.equal(seen.length, 3, "refreshed after the take over");
  await w.data.giveBack("agt_dex");
  assert.deepEqual(w.calls.filter((c) => c.cap === "computers.browser.give_back").map((c) => c.input), [{ agentId: "agt_dex" }]);
  off();
  assert.equal(w.ticks.length, 0);
});

test("open asks for the live view, which wakes the browser; a refusal is the server's sentence, and signing out of a site says it is not there yet", async () => {
  const w = wire();
  await w.data.open("agt_dex");
  assert.equal(w.calls[0]?.cap, "computers.browser.stream");
  const full = wire({ fail: "Waiting for room on the Space browser." });
  await assert.rejects(() => full.data.open("agt_dex"), /Waiting for room on the Space browser\./);
  await assert.rejects(() => full.data.takeOver("agt_dex"), /Waiting for room/);
  await w.data.signOut("agt_dex", "x.com");
  assert.deepEqual(w.calls.find((c) => c.cap === "computers.browser.sign_out")?.input, { agentId: "agt_dex", site: "x.com" });
  await assert.rejects(() => full.data.signOut("agt_dex", "x.com"), /Waiting for room/);
});

test("the live view's helpers: addresses, pointer positions in the browser's own units, and what a key sends", () => {
  assert.equal(viewUrl("https://space.example/", "/browsers/agt_dex/stream?ticket=t"), "https://space.example/browsers/agt_dex/stream?ticket=t");
  assert.equal(viewUrl(undefined, "https://x/y"), "https://x/y");
  assert.equal(socketUrl("https://space.example", "/browsers/agt_dex/ws?ticket=t"), "wss://space.example/browsers/agt_dex/ws?ticket=t");
  assert.equal(socketUrl("http://localhost:3000", "/browsers/a/ws?ticket=t"), "ws://localhost:3000/browsers/a/ws?ticket=t");
  assert.deepEqual(pointOf(160, 100, { width: 320, height: 200 }), { x: BROWSER_VIEW.width / 2, y: BROWSER_VIEW.height / 2 }, "no size said: the default");
  assert.deepEqual(pointOf(150, 100, { width: 300, height: 200 }, { width: 1280, height: 713 }), { x: 640, y: 357 }, "the size the stream reported, not a constant");
  assert.deepEqual(pointOf(150, 150, { width: 300, height: 300 }, { width: 1280, height: 800 }), { x: 640, y: 400 }, "centre of a picture with bars above and below");
  assert.deepEqual(pointOf(150, 10, { width: 300, height: 300 }, { width: 1280, height: 800 }), { x: 640, y: 0 }, "a press on a bar goes to the page's edge");
  assert.deepEqual(pointOf(999, -5, { width: 300, height: 200 }), { x: 1279, y: 0 }, "clamped to the page");
  assert.deepEqual(pointOf(5, 5, { width: 0, height: 0 }), { x: 0, y: 0 });
  assert.deepEqual(keyMessages({ key: "a" }), [{ t: "type", text: "a" }]);
  assert.deepEqual(keyMessages({ key: "Enter" }), [{ t: "key", name: "Enter", down: true }, { t: "key", name: "Enter", down: false }]);
  assert.deepEqual(keyMessages({ key: "c", metaKey: true }), [{ t: "key", name: "c", down: true }, { t: "key", name: "c", down: false }]);
  assert.deepEqual(keyMessages({ key: "Dead" }), []);
});

test("a browser waiting for room or in error shows the line the server gave; the logins come from the sessions call, for a person who may take over ", async () => {
  assert.deepEqual(browserView("agt_dex", [row({ running: false, state: "waiting", line: "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." })], d).line?.slice(0, 16), "Waiting for room");
  assert.equal(browserView("agt_dex", [row({ running: false, state: "waiting" })], d).state, "waiting");
  assert.equal(browserView("agt_dex", [row({ state: "error", line: "It could not open." })], d).state, "error");
  const w = wire();
  const seen: Array<{ n: number; first?: string }> = [];
  w.data.watch("agt_dex", (v) => seen.push({ n: v.sites.length, ...(v.sites[0] ? { first: v.sites[0].site } : {}) }));
  await flush();
  assert.deepEqual(seen, [{ n: 1, first: "app.clio.com" }]);
  const sleeping = wire({ rows: [row({ running: false, state: "asleep" })] });
  const seenAsleep: number[] = [];
  sleeping.data.watch("agt_dex", (v) => seenAsleep.push(v.sites.length));
  await flush();
  assert.deepEqual(seenAsleep, [1], "a sleeping browser lists the logins it saved, and is not woken by it");
  const viewer = wire({ rows: [row({ access: "viewer" })] });
  viewer.data.watch("agt_dex", () => undefined);
  await flush();
  assert.equal(viewer.calls.some((c) => c.cap === "computers.browser.sessions"), false);
});
