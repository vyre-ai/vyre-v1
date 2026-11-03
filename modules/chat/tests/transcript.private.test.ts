// Tool results are the asker's private turn detail (agent-visibility gap 2). On an API engine the first 4,000 characters of every tool result used to land in the chat's shared transcript, which
// anyone who may open the chat reads: in a public channel, the whole Space. Now a tool result row is kept for the person whose turn it was: they (and an agent working for them) read it; nobody
// else does, by transcript get, read, search, the rolling summary or exact-words history. The words of the turn and the one-line summary of each call stay shared, as the chat shows them anyway.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, harness as baseHarness, openRaw } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = () => `tp${++n}`;
const as = (raw: ReturnType<typeof openRaw>, principal: { kind: "person" | "agent"; id: string }, actingFor?: string): Harness => baseHarness({ raw, principal, ...(actingFor ? { actingFor } : {}) });
const SECRET = "Henderson settlement walk-away 310k";

async function channelWithDanasTurn() {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const ch = (await h["channels.create"]!(dana.ctx, { name: "Probate desk", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key() })).channel;
  const threadId = ch.mainThreadId as string;
  // the engine writes Dana's turn as Dana: her words, the agent's words, a call and what the call answered
  await h["chat.transcript.append"]!(dana.ctx, { threadId, turnId: "trn_pdana1", rows: [{ role: "user", kind: "text", content: "Intake, what is in the Henderson file?" }] });
  await h["chat.transcript.append"]!(dana.ctx, {
    threadId, turnId: "trn_adana1", rows: [
      { role: "assistant", kind: "tool_call", content: "Read file henderson.docx", toolName: "files_read", toolCallId: "tc1" },
      { role: "tool", kind: "tool_result", content: `The file says: ${SECRET}.`, toolCallId: "tc1" },
      { role: "assistant", kind: "text", content: "I read it; the details are in the file." },
    ],
  });
  return { raw, threadId, dana };
}

test("Maya, in the same public channel, cannot read Dana's tool output: not by get, read, search or exact words", async () => {
  const { raw, threadId } = await channelWithDanasTurn();
  for (const who of [as(raw, { kind: "person", id: MAYA }), as(raw, { kind: "agent", id: INTAKE }, MAYA)]) {
    const got = await h["chat.transcript.get"]!(who.ctx, { threadId, turnId: "trn_adana1" });
    assert.ok(!JSON.stringify(got).includes("walk-away"), `get: ${JSON.stringify(got)}`);
    assert.ok(got.rows.some((r: { kind: string }) => r.kind === "tool_call"), "the one-line call is still there");
    assert.ok(got.rows.some((r: { kind: string; content: unknown }) => r.kind === "text" && /I read it/.test(String(r.content))), "and the words of the turn");
    const read = await h["chat.transcript.read"]!(who.ctx, { threadId });
    assert.ok(!read.markdown.includes("walk-away"), read.markdown);
    assert.deepEqual((await h["chat.transcript.search"]!(who.ctx, { q: "walk-away settlement", threadId })).hits, []);
    assert.deepEqual((await h["chat.history.search"]!(who.ctx, { q: "Henderson settlement walk-away" })).hits.filter((x: { text: string }) => x.text.includes("walk-away")), []);
    const rows = raw.all("SELECT idx FROM chat_transcript_row WHERE thread = ? AND kind = 'tool_result'", threadId) as Array<{ idx: number }>;
    assert.deepEqual((await h["chat.history.search"]!(who.ctx, { ref: `${threadId}#${rows[0]!.idx}` })).hits, [], "not by its ref either");
  }
});

test("Dana, and an agent working for her, still read her own tool output", async () => {
  const { raw, threadId, dana } = await channelWithDanasTurn();
  for (const who of [dana, as(raw, { kind: "agent", id: INTAKE }, DANA)]) {
    assert.ok(JSON.stringify(await h["chat.transcript.get"]!(who.ctx, { threadId, turnId: "trn_adana1" })).includes("walk-away"));
    assert.ok((await h["chat.transcript.read"]!(who.ctx, { threadId })).markdown.includes("walk-away"));
    assert.equal((await h["chat.transcript.search"]!(who.ctx, { q: "walk-away", threadId })).hits.length, 1);
  }
});

test("the rolling summary, which everyone in the chat reads, never carries a tool result", async () => {
  const { raw, threadId, dana } = await channelWithDanasTurn();
  for (let i = 2; i <= 24; i++) await h["chat.transcript.append"]!(dana.ctx, { threadId, turnId: `trn_pdana${i}`, rows: [{ role: "user", kind: "text", content: `question ${i}` }] });
  await h["chat.transcript.summarize"]!(dana.ctx, { threadId });
  const sum = await h["chat.transcript.summary"]!(as(raw, { kind: "person", id: MAYA }).ctx, { threadId });
  assert.ok(sum.upToIdx > 0, "the summary covers Dana's turn");
  assert.ok(!sum.summary.includes("walk-away"), sum.summary);
});
