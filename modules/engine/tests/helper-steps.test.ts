// A helper's row while its call is held at the Gate says what it waits for, not a running step (lead, 12 Nov 2026); and a step's words never carry the command or an address, only what it does.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { helpersStatus } from "../handlers/helpers.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { stepWords } from "../../../lib/plain-words.ts";
import type { EngineCtx } from "../projections.ts";

test("a held call shows its waiting state, not a running step", async () => {
  const h = harness();
  ensureExtra(h.ctx.db);
  h.ctx.db.run(`INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
    VALUES ('trn_1', 'thr_help', 'agt_x', 'usr_dana', NULL, 'api', 'm', 'space', 'waiting', 'tr', NULL, 1, 1, NULL, 0, 0, 0, NULL, NULL)`);
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap: string) {
      if (cap === "chat.helpers.list") return { helpers: [{ threadId: "thr_help", title: "Check the site", status: "running", agentId: "agt_x", startedAt: 1 }] };
      if (cap === "chat.messages.list") return { messages: [{ author: { kind: "agent", id: "agt_x" }, body: "", blocks: [{ type: "turn_status", data: { state: "waiting", taskId: "tsk_1" } }] }] };
      if (cap === "tasks.get") return { task: { title: "Check the site wants to run sleep 120 && echo finished-long" } };
      return {};
    },
  } as EngineCtx;
  const [row] = (await helpersStatus(ctx, { threadId: "thr_lead" })).helpers;
  assert.equal(row?.state, "needs_you");
  assert.match(row?.step ?? "", /^Needs your OK/);
  assert.notEqual(row?.step, "Running a command");
});

test("a step's words never carry the command or an address, only what it is doing", () => {
  assert.equal(stepWords("terminal_run", "sleep 120 && echo finished-long"), "Running a command");
  assert.equal(stepWords("Bash", "rm -rf build"), "Running a command");
  assert.equal(stepWords("read_link", "https://pine-works.example/pricing"), "Reading a page");
  assert.equal(stepWords("WebFetch", "www.example.com/a"), "Reading a page");
  assert.equal(stepWords("Read", "model.ts"), "Reading model.ts", "a file's name is what it reads, and stays");
});
