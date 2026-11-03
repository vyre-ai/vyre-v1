// A watched page as a goal's progress, with the real watching handlers (modules/automations) behind automations.watches.list instead of a stand-in: the goal reads its owner's watch,
// the number on the page moves when the page does, and a watch that belongs to someone else is not the goal's to read.
import test from "node:test";
import assert from "node:assert/strict";
import { OWNER, labGoal, owner, world } from "../modules/goals/fixtures/world.ts";
import { harness as automations } from "../modules/automations/fixtures/db.ts";
import { handlers } from "../modules/automations/impl.ts";

const finish = (path?: string) => ({ kind: "number", line: "Luma shows 300 registrations", target: 300, unit: "registrations", source: { kind: "watch", watchId: "", ...(path ? { path } : {}) } });

test("the goal reads the number on a watched page, and follows it as the page changes; 'changes' counts how often it moved", async () => {
  const a = automations();
  a.callee("chat.start", () => ({ thread: { threadId: "thr_watch" } }));
  a.callee("chat.post", () => ({ message: { messageId: "msg_1" } }));
  const me = { id: OWNER, kind: "person" as const };
  const saved = (await a.call("automations.watches.save", { title: "Lab 8", url: "https://lu.ma/lab-8", mode: "region", region: { label: "Going", selector: "#going" }, everyMinutes: 30, runsOn: "chrome", agentId: "agt_ops", value: "Registrations: 212", idempotencyKey: "w1" }, me)).watch;
  const w = world({ fakes: { "automations.watches.list": (i, who) => handlers["automations.watches.list"]({ ...a.ctxFor("automations.watches.list", { id: who.id, kind: who.kind ?? "person" }), depth: who.depth ?? 0 }, i as never) } });
  const bound = (path?: string) => labGoal({ idempotencyKey: `k${path ?? "n"}${a.now()}`, finish: { ...finish(path), source: { ...finish(path).source, watchId: saved.watchId } } });
  const { goal } = await w.call("goals.create", bound());
  assert.equal(goal.progress.value, 212, "the number the page showed when the watch began");
  const byChanges = (await w.call("goals.create", bound("changes"))).goal;
  assert.equal(byChanges.progress.value, 0);
  await a.call("automations.watches.report", { watchId: saved.watchId, value: "Registrations: 301" }, me);
  w.tick(2 * 60_000); // a goal reads its source at most once a minute when asked
  const again = await w.call("goals.progress", { goalId: goal.id, refresh: true }, owner);
  assert.equal(again.progress.value, 301, "the page moved, so the goal did");
  assert.equal((await w.call("goals.progress", { goalId: byChanges.id, refresh: true }, owner)).progress.value, 1);
});

test("a watch that is not the owner's, or is gone, is not a source", async () => {
  const a = automations();
  const stranger = { id: "usr_stranger", kind: "person" as const };
  const theirs = (await a.call("automations.watches.save", { title: "Theirs", url: "https://lu.ma/x", mode: "page", everyMinutes: 60, runsOn: "chrome", value: "Registrations: 999", idempotencyKey: "w2" }, stranger)).watch;
  const w = world({ fakes: { "automations.watches.list": (i, who) => handlers["automations.watches.list"]({ ...a.ctxFor("automations.watches.list", { id: who.id, kind: who.kind ?? "person" }), depth: who.depth ?? 0 }, i as never) } });
  const { goal } = await w.call("goals.create", labGoal({ idempotencyKey: "k-theirs", finish: { ...finish(), source: { kind: "watch", watchId: theirs.watchId } } }));
  assert.equal(goal.progress.value, undefined);
  assert.match(goal.progress.error, /watch is gone or is not the owner's/);
});
