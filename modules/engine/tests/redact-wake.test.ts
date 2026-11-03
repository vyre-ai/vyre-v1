// Redaction for AI: an agent that asked to read a file in a Redacted folder gets the request card in its chat, and Done on the file wakes it there, the same way an approved held call does: a note
// from Vyre as its next turn's input and a quiet "Reviewed by" line in the chat.
// @reads /modules/engine/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { takeHeldNotes } from "../held-notes.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_redact";
const logs: string[] = [];
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_irfad", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];
const say: DriverEvent[] = [{ type: "text", text: "Reading it now." }, { type: "usage", inputTokens: 10, outputTokens: 4 }, { type: "done" }];

function hostFor(p: ReturnType<typeof scriptedProvider>, posts: { agentId: string; post: Record<string, unknown> }[]): EngineHostSeam {
  return {
    holder: "host:spc_enginetest", openSession: p.openSession, now: () => 1_760_000_000_000,
    async call(cap) {
      if (cap === "engine.account.resolve") return { accountRef: "#Irfad_Anthropic", payer: "usr_irfad", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Irfad_Anthropic", driver: "claude_code", kind: "subscription", status: "ok" }] };
      if (cap === "access.principals.get") return { principal: { name: "Irfad Imtiaz" } };
      if (cap === "engine.turn.record_usage") return {};
      if (cap === "threads.get") return { thread: THREADS[0] };
      return {};
    },
    postAs: async (agentId, post) => { posts.push({ agentId, post: post as unknown as Record<string, unknown> }); return {}; },
    log: (msg: string, attrs?: Record<string, unknown>) => { logs.push(`${msg} ${JSON.stringify(attrs ?? {})}`); },
  } as EngineHostSeam;
}

test("the request card goes into the chat it was asked in, as the agent, with the file to open", async () => {
  const h = harness({ threads: THREADS });
  const posts: { agentId: string; post: Record<string, unknown> }[] = [];
  hostSeams.setEngineHost(hostFor(scriptedProvider({ script: say }), posts));
  const done = await consumers["engine.redact_requested"].run(h.ctx as never, { payload: { requestId: "rrq_1", fileId: "fil_ret", name: "Rivera retainer.pdf", agentId: "agt_intake", actingFor: "usr_irfad", threadId: THREAD } } as never);
  assert.deepEqual(done, ["rrq_1"]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.agentId, "agt_intake");
  assert.deepEqual(posts[0]!.post.blocks, [{ type: "redact_request", v: 1, data: { requestId: "rrq_1", fileId: "fil_ret", name: "Rivera retainer.pdf", agentId: "agt_intake", state: "waiting" } }]);
  assert.deepEqual(await consumers["engine.redact_requested"].run(h.ctx as never, { payload: { requestId: "rrq_2", fileId: "fil_ret", name: "x", agentId: "agt_intake", actingFor: "usr_irfad" } } as never), [], "no chat: the files module makes a Review task instead");
  hostSeams.setEngineHost(null);
});

test("Done wakes the agent in that chat with a note to read the redacted version and not to guess", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  const posts: { agentId: string; post: Record<string, unknown> }[] = [];
  hostSeams.setEngineHost(hostFor(p, posts));
  const engine = (await ensureRuntime(h.ctx))!;
  const woke: string[] = [];
  const wake = engine.wake.bind(engine);
  engine.wake = ((threadId: string, agentId: string) => { woke.push(`${threadId}:${agentId}`); takeHeldNotes(threadId, agentId).forEach((n) => notes.push(n)); return wake(threadId, agentId); }) as typeof engine.wake;
  const notes: string[] = [];
  const done = await consumers["engine.redact_ready"].run(h.ctx as never, { payload: { requestId: "rrq_1", fileId: "fil_ret", name: "Rivera retainer.pdf", by: "usr_irfad", agentId: "agt_intake", actingFor: "usr_irfad", threadId: THREAD } } as never);
  assert.deepEqual(done, ["rrq_1"], logs.join("\n"));
  assert.deepEqual(woke, [`${THREAD}:agt_intake`]);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /Irfad Imtiaz reviewed Rivera retainer\.pdf/);
  assert.match(notes[0]!, /\[REDACTED\]/);
  assert.match(notes[0]!, /Do not guess/);
  assert.deepEqual(posts.at(-1)!.post.blocks, [{ type: "turn_status", v: 1, data: { state: "note", text: "Reviewed by Irfad Imtiaz" } }]);
  hostSeams.setEngineHost(null);
});
