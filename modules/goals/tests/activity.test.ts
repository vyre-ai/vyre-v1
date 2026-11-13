// What a goal's Activity says: every wake reason has words, a failed turn never prints its code, nothing is cut, and the story can be read back to its start.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LEAD, OWNER, T0, host, labGoal, lead, owner, step, world } from "../fixtures/world.ts";
import { REASON_WORDS, note, reasonWords } from "../projections.ts";
import type { World } from "../fixtures/world.ts";

const claim = (w: World, e: { payload: Record<string, any> }) => w.call("goals.wake_claim", { goalId: e.payload.goalId, wakeId: e.payload.wakeId, attempt: e.payload.attempt }, host);   // eslint-disable-line @typescript-eslint/no-explicit-any

test("every reason a wake can carry has words, and none reads as its key", () => {
  const dir = new URL("../handlers/", import.meta.url);
  const reasons = new Set<string>(["retry"]);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const line of src.split("\n")) {
      if (/queueWake\(/.test(line) && !/function queueWake/.test(line)) for (const m of line.matchAll(/(?<!=== )"([a-z_]+)"/g)) reasons.add(m[1]!);
      for (const m of line.matchAll(/resumeGoal\(ctx, g, "([a-z_]+)"\)/g)) reasons.add(m[1]!);
    }
  }
  for (const r of ["start", "checkin", "task_done", "task_blocked", "task_asked", "source_changed", "answered", "resumed", "budget_raised", "extended", "ended", "retry"]) assert.ok(reasons.has(r), `the scan found ${r}`);
  for (const r of reasons) assert.ok(REASON_WORDS[r], `reason ${r} has no words`);
  assert.equal(reasonWords("checkin,retry"), "it is time for a check-in and the last one got no reply");
  assert.equal(reasonWords("ended"), "the goal ended");
});

test("a failed wake says why in plain words, keeps the code out of the sentence, and shows it only to an admin", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  await claim(w, w.woken()[0]!);
  await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
  const read = async (who: Parameters<World["call"]>[2]) => (await w.call("goals.activity", { goalId: goal.id }, who)).activity.find((a: { kind: string; text: string }) => a.kind === "wake" && /could not check in/.test(a.text));
  const asOwner = await read(owner);
  assert.match(asOwner.tpl ?? asOwner.text, /could not check in: Vyre's server restarted while it was working\. Asking once more\./);
  assert.ok(!/host_lost|\(/.test(asOwner.text), asOwner.text);
  assert.equal(asOwner.data, undefined, "a member never sees the code");
  const asAdmin = await read({ id: "usr_admin", kind: "person", origin: "app" });
  assert.deepEqual([asAdmin.data.code, asAdmin.data.attempt], ["host_lost", 1]);
});

test("a check-in the contract allows is kept whole; an agent's own long words stop at 600 with a mark", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const full = `${"Registrations rose in every channel. ".repeat(15)}End.`.slice(0, 600);
  await w.call("goals.report", { goalId: goal.id, summary: full }, lead);
  await w.call("goals.pause", { goalId: goal.id, reason: "x".repeat(5000) }, owner);
  const rows = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity;
  assert.equal(rows.find((a: { kind: string }) => a.kind === "report").text, full);
  const paused = rows.find((a: { kind: string; text: string }) => a.kind === "status" && /^Moved from .* to Paused/.test(a.text));
  assert.equal(paused.text.length, 600);
  assert.ok(paused.text.endsWith("…"));
});

test("goals.activity reads a goal's whole story back, page by page, with no row lost at a page edge", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const ctx = w.ctx(host);
  for (let i = 0; i < 100; i++) { if (i % 10 !== 0) w.tick(1000); note(ctx, goal.id, "reading", `Reading ${i}`); }
  const total = (w.db.all("SELECT COUNT(*) AS n FROM goals_activity WHERE goal_id = ?", goal.id)[0] as { n: number }).n;
  assert.ok(total >= 100);
  const first = (await w.call("goals.get", { goalId: goal.id }, owner)).activity;
  assert.ok(first.length >= 30 && first.length < total, "goals.get shows only the latest rows");
  const seen: string[] = first.map((a: { text: string; at: number }) => `${a.at}:${a.text}`);
  let before = first.at(-1).at;
  for (let guard = 0; guard < 20; guard++) {
    const page = (await w.call("goals.activity", { goalId: goal.id, limit: 30, before }, owner)).activity;
    if (page.length === 0) break;
    seen.push(...page.map((a: { text: string; at: number }) => `${a.at}:${a.text}`));
    before = page.at(-1).at;
  }
  assert.equal(seen.length, total, "every row came back once");
  assert.equal(new Set(seen).size, total);
  assert.ok(seen.some((s) => s.endsWith("Reading 0")), "the start of the story is there");
  void OWNER; void T0;
});
