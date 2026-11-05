// The quiet line a hook leaves, and its answer (lane l-hooks): the line carries one `hook` block; answering a stop (Allow, Always allow or Deny) marks that block, so the stop stays answered after a reload and
// for everyone who reads the chat. An id that is not a hook line in this chat is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { INTAKE, harness } from "../fixtures/harness.ts";
import { hookLine, hookLineResolve } from "../handlers/hook-line.ts";
import { start } from "../handlers/thread.ts";

const chatOf = async (hn: ReturnType<typeof harness>): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
const blockOf = (hn: ReturnType<typeof harness>, messageId: string): Record<string, unknown> => (JSON.parse(String(hn.rows("SELECT blocks FROM chat_message WHERE id = ?", messageId)[0]!["blocks"])) as Array<{ data: Record<string, unknown> }>)[0]!.data;

test("answering a stop marks its block, for everyone and after a reload, and carries who answered", async () => {
  const hn = harness({ calls: {} });
  const threadId = await chatOf(hn);
  const { messageId } = hookLine(hn.ctx, { threadId, body: "A hook stopped this: no", kind: "blocked", hookId: "hok_1", tool: "mail_send" });
  assert.equal(blockOf(hn, messageId)["resolved"], undefined);
  assert.deepEqual(hookLineResolve(hn.ctx, { threadId, messageId, resolution: "denied", by: "usr_maya" }), { ok: true });
  const data = blockOf(hn, messageId);
  assert.deepEqual([data["resolved"], data["resolvedBy"], data["kind"]], ["denied", "usr_maya", "blocked"]);
  hookLineResolve(hn.ctx, { threadId, messageId, resolution: "always", by: "usr_dana" });
  assert.equal(blockOf(hn, messageId)["resolved"], "always", "the latest answer stands");
});

test("a message that is not a hook line, or is in another chat, is refused", async () => {
  const hn = harness({ calls: {} });
  const threadId = await chatOf(hn);
  const other = await chatOf(hn);
  const { messageId } = hookLine(hn.ctx, { threadId, body: "A hook stopped this: no", kind: "blocked", hookId: "hok_1" });
  assert.throws(() => hookLineResolve(hn.ctx, { threadId: other, messageId, resolution: "denied", by: "usr_maya" }), /not in this chat/);
  assert.throws(() => hookLineResolve(hn.ctx, { threadId, messageId: "msg_nope", resolution: "denied", by: "usr_maya" }), /not in this chat/);
});
