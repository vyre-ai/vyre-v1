// chat.history.search: word-for-word recall over messages and transcript rows, only for chats the ASKER could open. An agent that sat in a chat does not carry its people's chats to someone else.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, LEO, MAYA, harness as baseHarness, openRaw } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { contractErrors } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const key = () => `h${++n}`;
const as = (raw: ReturnType<typeof openRaw>, principal: { kind: "person" | "agent"; id: string }, actingFor?: string): Harness =>
  baseHarness({ raw, principal, ...(actingFor ? { actingFor } : {}) });

test("a person finds the exact words of their own chat, with a link to the message", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const thread = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const posted = await h["chat.post"]!(dana.ctx, { threadId: thread, body: "The Henderson retainer is capped at 4,500 dollars per month, no exceptions.", idempotencyKey: key() });
  await h["chat.post"]!(dana.ctx, { threadId: thread, body: "Lunch on Friday works for me", idempotencyKey: key() });
  assert.deepEqual(contractErrors("chat.history.search", "in", { q: "Henderson retainer cap" }), []);
  const out = await h["chat.history.search"]!(dana.ctx, { q: "what is the Henderson retainer cap?" });
  assert.deepEqual(contractErrors("chat.history.search", "out", out), []);
  assert.equal(out.hits.length, 1);
  const hit = out.hits[0];
  assert.equal(hit.text, "The Henderson retainer is capped at 4,500 dollars per month, no exceptions.");
  assert.equal(hit.messageId, posted.message.messageId);
  assert.deepEqual(hit.author, { kind: "person", id: DANA });
  assert.equal(hit.link, `vyre://thread/${thread}?m=${posted.message.messageId}`);
  const one = await h["chat.history.search"]!(dana.ctx, { ref: posted.message.messageId });
  assert.equal(one.hits[0].text, hit.text);
});

test("someone who was not in the chat gets nothing, and neither does an agent acting for them", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const thread = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const posted = await h["chat.post"]!(dana.ctx, { threadId: thread, body: "My settlement walk-away number is 310 thousand", idempotencyKey: key() });
  const q = { q: "settlement walk-away number" };
  assert.equal((await h["chat.history.search"]!(dana.ctx, q)).hits.length, 1);
  // Maya was never in the chat
  const maya = as(raw, { kind: "person", id: MAYA });
  assert.deepEqual((await h["chat.history.search"]!(maya.ctx, q)).hits, []);
  assert.deepEqual((await h["chat.history.search"]!(maya.ctx, { ref: posted.message.messageId })).hits, []);
  // the intake agent is in the chat; asked by Maya it still brings nothing out
  const viaAgent = as(raw, { kind: "agent", id: INTAKE }, MAYA);
  assert.deepEqual((await h["chat.history.search"]!(viaAgent.ctx, q)).hits, []);
  assert.deepEqual((await h["chat.history.search"]!(viaAgent.ctx, { ref: posted.message.messageId })).hits, []);
  // the same agent asked by Dana does
  const forDana = as(raw, { kind: "agent", id: INTAKE }, DANA);
  assert.equal((await h["chat.history.search"]!(forDana.ctx, q)).hits.length, 1);
});

test("channels: a member finds the line, a person outside an invite-only channel does not", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const ch = (await h["channels.create"]!(dana.ctx, { name: "Probate desk", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key() })).channel;
  const closed = (await h["channels.create"]!(dana.ctx, { name: "Hiring", visibility: "public", memberIds: [], agentIds: [INTAKE], idempotencyKey: key() })).channel;
  await h["channels.update"]!(dana.ctx, { channelId: closed.channelId, visibility: "invite" });
  await h["chat.post"]!(dana.ctx, { threadId: ch.mainThreadId, body: "The filing deadline for the Alvarez estate is 14 November", idempotencyKey: key() });
  await h["chat.post"]!(dana.ctx, { threadId: closed.mainThreadId, body: "The offer for the paralegal role is 82 thousand", idempotencyKey: key() });
  const maya = as(raw, { kind: "person", id: MAYA });
  assert.equal((await h["chat.history.search"]!(maya.ctx, { q: "Alvarez estate filing deadline" })).hits.length, 1);
  assert.deepEqual((await h["chat.history.search"]!(maya.ctx, { q: "paralegal offer" })).hits, []);
  const leo = as(raw, { kind: "person", id: LEO });
  assert.deepEqual((await h["chat.history.search"]!(leo.ctx, { q: "Alvarez estate filing deadline" })).hits, [], "a person who never joined the channel");
});

test("transcript rows are found as steps, and the current chat can be left out", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const a = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const b = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.transcript.append"]!(dana.ctx, { threadId: a, turnId: "trn_1", rows: [{ role: "tool", kind: "tool_result", content: { text: "invoice INV-4471 total 12,300 sent to Acme" }, toolName: "mail_send" }] });
  await h["chat.transcript.append"]!(dana.ctx, { threadId: b, turnId: "trn_2", rows: [{ role: "tool", kind: "tool_result", content: { text: "invoice INV-4471 total 12,300 sent to Acme" }, toolName: "mail_send" }] });
  const all = await h["chat.history.search"]!(dana.ctx, { q: "invoice INV-4471 total" });
  assert.equal(all.hits.length, 2);
  assert.equal(all.hits[0].source, "step");
  assert.match(all.hits[0].link, /\?step=\d+$/);
  const rest = await h["chat.history.search"]!(dana.ctx, { q: "invoice INV-4471 total", excludeThreadId: b });
  assert.deepEqual(rest.hits.map((x: any) => x.threadId), [a]);
  const one = await h["chat.history.search"]!(dana.ctx, { ref: all.hits[0].ref });
  assert.equal(one.hits[0].text, "invoice INV-4471 total 12,300 sent to Acme");
});

test("filler words alone find nothing", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const thread = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(dana.ctx, { threadId: thread, body: "A plain line about the zebra contract", idempotencyKey: key() });
  assert.equal((await h["chat.history.search"]!(dana.ctx, { q: "zebra contract" })).hits.length, 1);
  assert.deepEqual((await h["chat.history.search"]!(dana.ctx, { q: "what did they about the" })).hits, []);
});
