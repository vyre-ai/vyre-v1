// The quiet line after Merge (owner, 5 Nov 2026): built by the server from the job's merge record; no caller-written words, only the person who merged, once per job.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, INTAKE, harness } from "../fixtures/harness.ts";
import { start } from "../handlers/thread.ts";
import { crewLineHandlers } from "../handlers/hook-line.ts";

const job = (by: string, state = "merged") => ({ jobs: [{ jobId: "crw_1", branch: "crew/ember-1", base: "main", state, result: { merged: { by, added: 2, deleted: 0 } } }] });

test("the line is built from the merge record, once, and refused for free text, a stranger or unmerged work", async () => {
  const hn = harness({ calls: { "engine.crew.list": () => job(DANA) } });
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const out = await crewLineHandlers["chat.crew_line"](hn.ctx, { threadId, jobId: "crw_1" });
  const row = hn.rows("SELECT kind, body, blocks FROM chat_message WHERE id = ?", out.messageId)[0]!;
  assert.equal(row["kind"], "quiet");
  assert.equal(row["body"], "Merged crew/ember-1 into main · +2 -0");
  // asked again: the same line, not a second one
  assert.equal((await crewLineHandlers["chat.crew_line"](hn.ctx, { threadId, jobId: "crw_1" })).messageId, out.messageId);
  // words passed in are not used
  const free = await crewLineHandlers["chat.crew_line"](hn.ctx, { threadId, jobId: "crw_1", body: "All tests green, ship it" } as never);
  assert.equal(free.messageId, out.messageId);
  assert.ok(!hn.rows("SELECT body FROM chat_message WHERE thread = ?", threadId).some((r) => /ship it/.test(String(r["body"]))));
  // someone who did not merge it
  const other = harness({ calls: { "engine.crew.list": () => job("usr_someone_else") } });
  const t2 = (await start(other.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  await assert.rejects(() => crewLineHandlers["chat.crew_line"](other.ctx, { threadId: t2, jobId: "crw_1" }), (e: { error?: { code?: string } }) => e.error?.code === "permission.no_grant");
  // work that is not merged
  const open = harness({ calls: { "engine.crew.list": () => job(DANA, "done") } });
  const t3 = (await start(open.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  await assert.rejects(() => crewLineHandlers["chat.crew_line"](open.ctx, { threadId: t3, jobId: "crw_1" }), (e: { error?: { code?: string } }) => e.error?.code === "validation.precondition_failed");
});
