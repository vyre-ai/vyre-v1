// Watching (Vyre for Chrome): a watch is the person's own; the first reading is the baseline; a different reading is a change that is told in a chat with before and after;
// a watch on an agent's computer wakes the agent on its rhythm; a goal reads a watch for its progress.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, MINUTE } from "../fixtures/seed.ts";
import { handlers } from "../impl.ts";
import { changeWords, normalize, tick, wakeWords } from "../handlers/watches.ts";

const base = { title: "Acme pricing", url: "https://acme.example.com/pricing", mode: "region", region: { label: "Pro price", selector: "#pro .price" }, everyMinutes: 60, runsOn: "chrome" };
let n = 0;
const save = (h: Harness, over: Record<string, unknown> = {}, who = alice): Promise<any> => h.call("browser.watches.save", { ...base, idempotencyKey: `k${++n}`, ...over }, who);   // eslint-disable-line @typescript-eslint/no-explicit-any
const world = () => {
  const h = harness();
  const posts: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const members: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("chat.start", (i: any) => ({ thread: { threadId: `thr_${i.scopeId.slice(-6)}` } }));   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("chat.post", (i: any) => { posts.push(i); return { message: { messageId: "msg_1" } }; });   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("threads.members.add", (i: any) => { members.push(i); return {}; });   // eslint-disable-line @typescript-eslint/no-explicit-any
  return { h, posts, members };
};

test("readings that differ only in white space are the same reading", () => {
  assert.equal(normalize("  $49 \n per   month "), "$49 per month");
});

test("a watch is saved with its baseline, listed for its owner only, and a new look at the same page keeps one row", async () => {
  const { h } = world();
  const a = (await save(h, { value: " $49  /mo " }, alice)).watch;
  assert.deepEqual([a.title, a.host, a.mode, a.state, a.value, a.changes, a.runsOn], ["Acme pricing", "acme.example.com", "region", "on", "$49 /mo", 0, "chrome"]);
  assert.equal(a.nextDueAt, h.now() + 60 * MINUTE, "the baseline was just read, so the next look is one rhythm away");
  assert.deepEqual((await h.call("browser.watches.list", {}, alice)).watches.map((w: any) => w.watchId), [a.watchId]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual((await h.call("browser.watches.list", {}, bob)).watches, [], "nobody else sees it");
  await assert.rejects(h.call("browser.watches.report", { watchId: a.watchId, value: "x" }, bob), (e) => codeOf(e) === "validation.not_found");
  const again = (await save(h, { idempotencyKey: "same", title: "Acme pricing" }, alice)).watch;
  const twice = (await save(h, { idempotencyKey: "same" }, alice)).watch;
  assert.equal(again.watchId, twice.watchId);
});

test("a change is told in the watch's chat with what it was and what it is, once; the first reading is never a change", async () => {
  const { h, posts, members } = world();
  const w = (await save(h, { agentId: "agt_scout", tell: ["usr_bob", "usr_alice"], runsOn: "chrome" }, alice)).watch;
  assert.deepEqual(w.tell, ["usr_bob"], "the owner is always told and is not listed");
  const first = await h.call("browser.watches.report", { watchId: w.watchId, value: "$49 per month" }, alice);
  assert.equal(first.changed, false);
  assert.equal(first.watch.value, "$49 per month");
  assert.equal(posts.length, 0);
  const same = await h.call("browser.watches.report", { watchId: w.watchId, value: "$49   per month" }, alice);
  assert.equal(same.changed, false, "only layout moved");
  const moved = await h.call("browser.watches.report", { watchId: w.watchId, value: "$59 per month" }, alice);
  assert.equal(moved.changed, true);
  assert.deepEqual([moved.watch.changes, moved.watch.lastChange.before, moved.watch.lastChange.after], [1, "$49 per month", "$59 per month"]);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /Acme pricing changed \(Pro price\)\.\n\nBefore: \$49 per month\nNow: \$59 per month/);
  assert.deepEqual(members.map((m) => m.personId), ["usr_bob"]);
  assert.equal(moved.watch.threadId, posts[0].threadId);
  assert.deepEqual(h.events.map((e) => e.name), ["browser.watch.changed"]);
  await h.call("browser.watches.report", { watchId: w.watchId, value: "$59 per month" }, alice);
  assert.equal(posts.length, 1, "the same reading again says nothing more");
});

test("a page that cannot be read three times in a row marks the watch, and the next good reading clears it without a false change", async () => {
  const { h, posts } = world();
  const w = (await save(h, { agentId: "agt_scout", value: "$49" })).watch;
  for (let i = 0; i < 2; i++) assert.equal((await h.call("browser.watches.report", { watchId: w.watchId, error: "timed out" }, alice)).watch.state, "on");
  const third = (await h.call("browser.watches.report", { watchId: w.watchId, error: "timed out" }, alice)).watch;
  assert.deepEqual([third.state, third.error, third.value], ["error", "timed out", "$49"]);
  const back = await h.call("browser.watches.report", { watchId: w.watchId, value: "$49" }, alice);
  assert.deepEqual([back.changed, back.watch.state, back.watch.error], [false, "on", undefined]);
  assert.equal(posts.length, 0);
});

test("pause, resume and remove; changing what is read starts a new baseline", async () => {
  const { h } = world();
  const w = (await save(h, { value: "$49" })).watch;
  assert.equal((await h.call("browser.watches.remove", { watchId: w.watchId, op: "pause", idempotencyKey: "p1" }, alice)).watch.state, "paused");
  await assert.rejects(h.call("browser.watches.check", { watchId: w.watchId }, alice), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal((await h.call("browser.watches.remove", { watchId: w.watchId, op: "resume", idempotencyKey: "p2" }, alice)).watch.state, "on");
  const moved = (await save(h, { watchId: w.watchId, url: "https://acme.example.com/plans" })).watch;
  assert.equal(moved.value, undefined, "a different page has no earlier reading");
  assert.equal((await h.call("browser.watches.remove", { watchId: w.watchId, op: "remove", idempotencyKey: "p3" }, alice)).removed, true);
  assert.deepEqual((await h.call("browser.watches.list", {}, alice)).watches, []);
  assert.deepEqual(h.allEvents.map((e) => e.payload["op"]).filter(Boolean), ["added", "paused", "resumed", "changed", "removed"]);
});

test("Check now asks the extension for a watch in Chrome, and wakes the agent for one on its computer", async () => {
  const { h, posts } = world();
  const c = (await save(h, { value: "x" })).watch;
  assert.equal((await h.call("browser.watches.check", { watchId: c.watchId }, alice)).watch.checkNow, true);
  assert.equal((await h.call("browser.watches.report", { watchId: c.watchId, value: "x" }, alice)).watch.checkNow, false, "a report answers it");
  const k = (await save(h, { runsOn: "computer", agentId: "agt_scout", value: "x" })).watch;
  await h.call("browser.watches.check", { watchId: k.watchId }, alice);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /browser_watches_report with watchId wch_/);
});

test("an agent's computer is woken on the rhythm, and a watch in Chrome or a paused one is left alone", async () => {
  const { h, posts } = world();
  const k = (await save(h, { runsOn: "computer", agentId: "agt_scout", everyMinutes: 15 })).watch;
  await save(h, { runsOn: "chrome", title: "Mine" });
  const paused = (await save(h, { runsOn: "computer", agentId: "agt_scout", title: "Paused" })).watch;
  await h.call("browser.watches.remove", { watchId: paused.watchId, op: "pause", idempotencyKey: "pz" }, alice);
  assert.deepEqual(await tick(h.ctxFor(null, { id: "svc_host", kind: "service" })), [k.watchId], "no baseline yet: due at once");
  assert.equal(posts.length, 1);
  assert.deepEqual(await tick(h.ctxFor(null, { id: "svc_host", kind: "service" })), [], "not due again yet");
  h.advance(16 * MINUTE);
  assert.deepEqual(await tick(h.ctxFor(null, { id: "svc_host", kind: "service" })), [k.watchId]);
});

test("a watch takes only a web address, a region needs its region, and an agent's computer needs the agent", async () => {
  const { h } = world();
  await assert.rejects(save(h, { url: "javascript:alert(1)" }), (e) => codeOf(e) === "validation.bad_input");
  const { region: _gone, ...noRegion } = base;
  await assert.rejects(h.call("browser.watches.save", { ...noRegion, idempotencyKey: "nr" }, alice), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(save(h, { runsOn: "computer" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a goal reads its owner's watch: the number on the page, or how often it changed; the gateway cannot name another person", async () => {
  const { h } = world();
  const w = (await save(h, { value: "Registrations: 212" })).watch;
  const list = (who: any, depth: number, person?: string) => handlers["browser.watches.list"]({ ...h.ctxFor("browser.watches.list", who), depth }, { watchId: w.watchId, ...(person ? { person } : {}) });   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await list({ id: "svc_host", kind: "service" }, 1, "usr_alice")).watches[0]!.value, "Registrations: 212");
  assert.deepEqual((await list(bob, 0, "usr_alice")).watches, [], "at the gateway the person is the caller, whatever the input says");
  assert.deepEqual((await list(bob, 1, "usr_alice")).watches.length, 1);
});

test("the words of an alert and of an agent's wake-up", () => {
  const w = { title: "Docket", url: "https://court.example.com/c/1", mode: "page" as const, region: undefined };
  assert.equal(changeWords(w, "Hearing set", "Hearing moved to 3 Dec"), "Docket changed.\n\nBefore: Hearing set\nNow: Hearing moved to 3 Dec\n\nhttps://court.example.com/c/1");
  assert.match(changeWords(w, "a".repeat(2000), ""), /Before: a{700}\.\.\.\nNow: \(nothing\)/);
  assert.match(wakeWords({ ...w, watchId: "wch_1", everyMinutes: 60, tell: [], runsOn: "computer", state: "on", checkNow: false, changes: 0, host: "", createdAt: 0, updatedAt: 0 }), /read the whole page/);
});
