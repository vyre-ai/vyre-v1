// chat.aside (/btw): a side question runs in a hidden read-only thread of the asker's with the chat's context written into its first message; nothing is written into the chat it came from; keeping the
// answer posts one card there.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `as-${++n}`;

async function world(live: Array<{ text: string }> = [{ text: "Drafting the closing letter for Rivera" }]) {
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "chat.transcript.summary": () => ({ summary: "We are preparing the Rivera closing." }),
      "chat.messages.list": (i: any) => (i.threadId === asideId ? { messages: aside } : { messages: [{ author: { kind: "person", id: DANA }, kind: "text", body: "Please draft the closing letter" }, { author: { kind: "agent", id: INTAKE }, kind: "agent", body: "On it." }] }),
      "engine.live_turns": () => ({ turns: live }),
    },
  });
  const parent = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  return { hn, parent };
}
let asideId = "";
let aside: Array<{ author: { kind: string; id: string }; kind: string; body: string }> = [];

test("an aside is a hidden read-only thread with the chat's context in its first message, and the chat it came from is untouched", async () => {
  const { hn, parent } = await world();
  const before = hn.rows(`SELECT COUNT(*) AS n FROM chat_message WHERE thread = ?`, parent)[0]!["n"];
  const out = await h["chat.aside"]!(hn.ctx, { threadId: parent, question: "How long will the letter take?", idempotencyKey: key() });
  asideId = out.asideThreadId;
  const t = hn.rows(`SELECT kind, listed, scopeType, scopeId, starter FROM chat_thread WHERE id = ?`, asideId)[0]!;
  assert.equal(t["kind"], "chat");
  assert.equal(Number(t["listed"]), 0, "not in any list");
  assert.equal(t["scopeType"], "aside");
  assert.equal(t["scopeId"], parent);
  assert.equal(t["starter"], DANA, "the asker's own turn, on the asker's own account");
  const first = String(hn.rows(`SELECT body FROM chat_message WHERE thread = ?`, asideId)[0]!["body"]);
  assert.match(first, /The question: How long will the letter take\?/);
  assert.match(first, /We are preparing the Rivera closing\./, "the summary");
  assert.match(first, /- You: Please draft the closing letter/, "the recent messages");
  assert.match(first, /Drafting the closing letter for Rivera/, "what the agent is writing right now");
  assert.match(first, /You can only read/);
  assert.deepEqual(hn.rows(`SELECT agentId, mode FROM chat_thread_agent WHERE thread = ? AND deleted_at IS NULL`, asideId), [{ agentId: INTAKE, mode: "lead" }]);
  assert.equal(hn.rows(`SELECT modePlan FROM chat_thread WHERE id = ?`, asideId)[0]!["modePlan"] !== undefined, true);
  assert.equal(hn.rows(`SELECT COUNT(*) AS n FROM chat_message WHERE thread = ?`, parent)[0]!["n"], before, "nothing was written into the chat the aside came from");
});

test("an aside asks for words, is asked by a person, and not from an aside or a chat with no agent", async () => {
  const { hn, parent } = await world();
  assert.equal(codeOf(await h["chat.aside"]!(hn.ctx, { threadId: parent, question: "  ", idempotencyKey: key() }).catch((e: unknown) => e)), "validation.bad_input");
  assert.equal(codeOf(await h["chat.aside"]!(hn.agent(INTAKE), { threadId: parent, question: "x", idempotencyKey: key() }).catch((e: unknown) => e)), "validation.bad_input", "an agent does not ask an aside");
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: "usr_maya", idempotencyKey: key() })).thread.threadId as string;
  assert.equal(codeOf(await h["chat.aside"]!(hn.ctx, { threadId: solo, question: "hi there", idempotencyKey: key() }).catch((e: unknown) => e)), "validation.bad_input", "no agent to ask");
  const ok = await h["chat.aside"]!(hn.ctx, { threadId: parent, question: "What is the plan?", idempotencyKey: key() });
  assert.equal(codeOf(await h["chat.aside"]!(hn.ctx, { threadId: ok.asideThreadId, question: "and?", idempotencyKey: key() }).catch((e: unknown) => e)), "validation.bad_input", "not from an aside");
});

test("keeping an aside's answer posts one card in the chat it came from; with no answer yet it says so", async () => {
  const { hn, parent } = await world();
  const out = await h["chat.aside"]!(hn.ctx, { threadId: parent, question: "How long will the letter take?", idempotencyKey: key() });
  asideId = out.asideThreadId;
  aside = [{ author: { kind: "person", id: DANA }, kind: "text", body: "A side question...\n\nThe question: How long will the letter take?" }];
  assert.equal(codeOf(await h["chat.aside_keep"]!(hn.ctx, { asideThreadId: asideId, idempotencyKey: key() }).catch((e: unknown) => e)), "validation.precondition_failed");
  aside.push({ author: { kind: "agent", id: INTAKE }, kind: "agent", body: "About ten minutes." });
  const kept = await h["chat.aside_keep"]!(hn.ctx, { asideThreadId: asideId, idempotencyKey: key() });
  const card = hn.rows(`SELECT kind, blocks FROM chat_message WHERE id = ?`, kept.messageId)[0]!;
  assert.equal(card["kind"], "system");
  const d = JSON.parse(String(card["blocks"]))[0].data;
  assert.equal(d.lead, "Aside");
  assert.equal(d.title, "How long will the letter take?");
  assert.equal(d.body, "About ten minutes.");
  assert.equal(d.by, DANA);
});
