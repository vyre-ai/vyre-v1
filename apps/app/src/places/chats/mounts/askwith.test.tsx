// askWith: the person's open Ask thread with that agent on that object is reused; otherwise a new Ask thread starts, carrying "bring this conversation" when asked.
import test from "node:test";
import assert from "node:assert/strict";
import { askWith } from "./data.ts";

type Call = { cap: string; input: Record<string, unknown> };
const rtOf = (threads: unknown[] | Error, calls: Call[], started = "thr_new") => ({
  call: async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "chat.asks_of") { if (threads instanceof Error) throw threads; return { threads }; }
    if (cap === "chat.start") return { thread: { threadId: started } };
    if (cap === "chat.transcript.summary") return { summary: "We were drafting the letter." };
    if (cap === "chat.messages.list") return { messages: [{ body: "draft it", author: { kind: "person" } }, { body: "Here is a draft", author: { kind: "agent" } }] };
    throw new Error(`unexpected ${cap}`);
  },
});
const ask = (threadId: string, agentId: string, closedAt?: number) => ({ threadId, agents: [{ agentId }], ...(closedAt !== undefined ? { closedAt } : {}) });

test("an open Ask with the same agent on the same object is reused, and nothing is started", async () => {
  const calls: Call[] = [];
  const id = await askWith(rtOf([ask("thr_other", "agt_b"), ask("thr_mine", "agt_a")], calls), "agt_a", "record", "rec_1", null);
  assert.equal(id, "thr_mine");
  assert.deepEqual(calls.map((c) => c.cap), ["chat.asks_of"]);
  assert.deepEqual(calls[0]!.input, { resourceType: "record", resourceId: "rec_1", limit: 20 });
});

test("a closed Ask, or one with another agent, is not reused: a new Ask starts about the object", async () => {
  const calls: Call[] = [];
  const id = await askWith(rtOf([ask("thr_closed", "agt_a", 5), ask("thr_other", "agt_b")], calls), "agt_a", "record", "rec_1", null);
  assert.equal(id, "thr_new");
  const start = calls.find((c) => c.cap === "chat.start")!;
  assert.equal(start.input["kind"], "ask");
  assert.deepEqual(start.input["agentIds"], ["agt_a"]);
  assert.equal(start.input["scopeType"], "record");
  assert.equal(start.input["scopeId"], "rec_1");
  assert.equal("first" in start.input, false);
});

test("bringing a conversation starts the new Ask with its summary and last messages as the first message", async () => {
  const calls: Call[] = [];
  await askWith(rtOf([], calls), "agt_a", "record", "rec_1", "thr_old");
  const first = String(calls.find((c) => c.cap === "chat.start")!.input["first"]);
  assert.match(first, /We were drafting the letter\./);
  assert.match(first, /Me: draft it/);
  assert.match(first, /Agent: Here is a draft/);
});

test("when the history cannot be read a new Ask still starts, and when that fails the answer is null", async () => {
  assert.equal(await askWith(rtOf(new Error("denied"), []), "agt_a", "record", "rec_1", null), "thr_new");
  const failing = { call: async (cap: string): Promise<unknown> => { if (cap === "chat.asks_of") return { threads: [] }; throw new Error("no"); } };
  assert.equal(await askWith(failing, "agt_a", "record", "rec_1", null), null);
});
