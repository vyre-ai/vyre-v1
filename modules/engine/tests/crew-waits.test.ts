// The checks a crew's lead waits on (crew-waits.ts): the host reads them as the person who set the wait, keeps the progress, and wakes the lead once with one message when they end.
import test from "node:test";
import assert from "node:assert/strict";
import { wait } from "../handlers/crew.ts";
import { sweepWaits, waitWords } from "../crew-waits.ts";
import { harness } from "../fixtures/harness.ts";

const NOW = 1_760_000_000_000;

function scene(answers: Array<{ state: string; runs: Array<{ name: string; status: string; conclusion?: string }> }>) {
  const h = harness();
  const posts: Array<{ cap: string; input: Record<string, unknown>; as?: string }> = [];
  const ctx = Object.assign(Object.create(h.ctx as object), {
    now: () => NOW,
    principal: { kind: "person", id: "usr_dana" },
    call: async (cap: string) => { if (cap === "threads.get") return { thread: { agents: [{ agentId: "agt_lead", mode: "lead" }] } }; throw new Error(`unexpected ${cap}`); },
  });
  let i = 0;
  const host = { call: async (cap: string, input: unknown, as?: string) => {
    if (cap === "github.pull_request.checks") return answers[Math.min(i++, answers.length - 1)];
    posts.push({ cap, input: input as Record<string, unknown>, ...(as ? { as } : {}) });
    return {};
  } };
  return { ctx, h, host, posts };
}

test("a wait is made for the chat's lead, refuses a repository that is not owner/name, and the sweep keeps the progress then wakes the lead once", async () => {
  const s = scene([
    { state: "pending", runs: [{ name: "unit", status: "completed", conclusion: "success" }, { name: "e2e", status: "in_progress" }] },
    { state: "failing", runs: [{ name: "unit", status: "completed", conclusion: "success" }, { name: "e2e", status: "completed", conclusion: "failure" }] },
  ]);
  await assert.rejects(wait(s.ctx, { threadId: "thr_lead", repo: "not a repo", number: 1 }), /owner\/name/);
  const made = await wait(s.ctx, { threadId: "thr_lead", repo: "acme/site", number: 12 });
  assert.deepEqual([made.wait.label, made.wait.state], ["acme/site#12", "pending"]);
  const db = { db: s.ctx.db, host: s.host, now: () => NOW };
  assert.deepEqual(await sweepWaits(db), []);
  const row = s.ctx.db.all("SELECT done, total, state FROM engine_crew_wait")[0] as Record<string, unknown>;
  assert.deepEqual([row["done"], row["total"], row["state"]], [1, 2, "pending"], "progress is kept for the Crew tab");
  assert.equal(s.posts.length, 0, "nothing is posted while it runs");
  assert.equal((await sweepWaits(db)).length, 1);
  assert.equal(s.posts.length, 1);
  const post = s.posts[0]!;
  assert.deepEqual([post.cap, post.as, post.input["threadId"]], ["chat.post", "usr_dana", "thr_lead"]);
  assert.deepEqual(post.input["mentions"], [{ kind: "agent", id: "agt_lead" }]);
  assert.match(String(post.input["body"]), /checks of acme\/site#12 failed: e2e/);
  assert.deepEqual(await sweepWaits(db), [], "an ended wait is not looked at again");
  assert.equal(s.posts.length, 1);
});

test("the words for each ending", () => {
  assert.equal(waitWords("a/b#1", { state: "passing", runs: [{ name: "x", status: "completed", conclusion: "success" }] }), "The checks of a/b#1 passed (1).");
  assert.match(waitWords("a/b#1", { state: "none", runs: [] }), /nothing to report/);
});
