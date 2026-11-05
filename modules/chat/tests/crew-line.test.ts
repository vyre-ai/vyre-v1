// The quiet line after Merge (owner, 5 Nov 2026): "Merged crew/ember-1 into main · +2 -0", one quiet message that wakes nobody.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, INTAKE, harness } from "../fixtures/harness.ts";
import { start } from "../handlers/thread.ts";
import { crewLineHandlers } from "../handlers/hook-line.ts";

test("the crew leaves one quiet merge line in the chat, with the branch, base and counts", async () => {
  const hn = harness({});
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const out = crewLineHandlers["chat.crew_line"](hn.ctx, { threadId, body: "Merged crew/ember-1 into main · +2 -0", branch: "crew/ember-1", base: "main", added: 2, deleted: 0 });
  const row = hn.rows("SELECT kind, body, blocks FROM chat_message WHERE id = ?", out.messageId)[0]!;
  assert.equal(row["kind"], "quiet");
  assert.equal(row["body"], "Merged crew/ember-1 into main · +2 -0");
  const block = (JSON.parse(String(row["blocks"])) as Array<{ type: string; data: Record<string, unknown> }>)[0]!;
  assert.equal(block.type, "crew_line");
  assert.equal(block.data["branch"], "crew/ember-1");
  assert.equal(block.data["added"], 2);
  assert.throws(() => crewLineHandlers["chat.crew_line"](hn.ctx, { threadId, body: "  " }));
  void DANA;
});
