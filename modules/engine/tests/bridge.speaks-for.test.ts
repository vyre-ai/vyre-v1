// An agent writes for a person in a chat that person is not in (the Assistant's message to Noah, sent for Mia). The bridge reads a message as the person it speaks for, and that person is refused there: that is not a fault, so it is
// not logged as one and nothing is routed for it, as before. The same message for a person who can read the chat is routed as always (r42-runtime, 20 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../handlers/bridge.ts";
import { harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const DM = "thr_noah_dm";
const AGENT = "agt_ops";

function rig() {
  const h = harness();
  const warns: string[] = [];
  const asked: string[] = [];
  const ctx = {
    ...h.ctx,
    log: { warn: (m: string) => void warns.push(m) },
    async call(cap: string, input: unknown) {
      return h.ctx.call(cap, input);
    },
  } as unknown as EngineCtx;
  const bridge = createBridge({
    postAs: async () => undefined,
    callAs: async (cap, input, as) => {
      asked.push(`${cap} as ${as}`);
      if (cap === "threads.get") {
        // Noah's chat with the agent: Mia is not in it
        if (as !== "usr_noah" && as !== AGENT)
          throw Object.assign(new Error("That chat does not exist or is not yours."), {
            error: { code: "validation.not_found" },
          });
        return {
          thread: { threadId: DM, kind: "chat", starter: "usr_noah", agents: [], agentRepliesInThreads: false },
        };
      }
      if (cap === "chat.message.get")
        return {
          message: {
            messageId: (input as { messageId: string }).messageId,
            threadId: DM,
            threadSeq: 1,
            author: { kind: "agent", id: AGENT },
            body: "The figures are ready.",
            blocks: [],
            mentions: [],
            depth: 0,
          },
        };
      return {};
    },
  });
  bridge.attach(h.runtime({ openSession: async () => ({}) as never, schedule: () => () => {} }));
  const event = (actingFor: string) => ({
    name: "message.received",
    payload: {
      messageId: `msg_${actingFor.slice(4)}`,
      threadId: DM,
      author: { kind: "agent", id: AGENT },
      actingFor,
      mentions: [],
      depth: 0,
    },
  });
  return { bridge, ctx, warns, asked, event };
}

test("an agent's message for a person who is not in the chat is skipped for that reason, with no warning, and the person is asked nothing more", async () => {
  const r = rig();
  const res = await r.bridge.onEvent(r.ctx, r.event("usr_mia"));
  assert.equal(res.skipped, "speaker_not_in_thread");
  assert.deepEqual(r.warns, [], "not logged as a problem");
  assert.equal(r.asked.filter((x) => x.endsWith("as usr_mia")).length > 0, true, "it did try the person it speaks for");
});

test("a person who can read the chat is read as before, and a person writing in an unreadable chat is still warned about", async () => {
  const r = rig();
  const res = await r.bridge.onEvent(r.ctx, r.event("usr_noah"));
  assert.notEqual(res.skipped, "speaker_not_in_thread");
  assert.deepEqual(r.warns, []);
  // a person's own message in a chat they cannot read is a different matter: that one is still said
  const own = await r.bridge.onEvent(r.ctx, {
    name: "message.received",
    payload: { messageId: "msg_own", threadId: DM, author: { kind: "person", id: "usr_mia" }, mentions: [], depth: 0 },
  });
  assert.equal(own.skipped, "thread_unreadable");
  assert.equal(r.warns.length, 1, "warned once");
});
