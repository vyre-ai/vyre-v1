// A helper's approval never waits where nobody looks (release gate blocker, 12 Nov). A helper runs in a thread of its own under the chat where the person asked; a call of its that is held at
// the Gate parks its turn. The approval card (the same turn_status waiting block, with the hold's task) goes to the chat the person asked in, from the helper, beside its own thread's card, so
// the person sees Allow, Always allow and Deny there; Needs you holds the same task.
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../handlers/bridge.ts";
import type { AgentPost, Bridge } from "../handlers/bridge.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";

const MAIN = "thr_lead";
const HELPER = "thr_helper1";
const LEAD = "agt_web";

interface Row {
  messageId: string;
  threadId: string;
  threadSeq: number;
  author: { kind: string; id: string };
  body: string;
  blocks: unknown[];
  mentions: unknown[];
  depth: number;
}
const reply = (text: string): DriverEvent[] => [
  { type: "text", text },
  { type: "usage", inputTokens: 5, outputTokens: 2 },
  { type: "done" },
];

function setup(o: {
  kind?: string;
  on?: boolean;
  script?: DriverEvent[];
  held?: boolean;
  agents?: Array<{ agentId: string; mode: "lead" | "listen" }>;
  calls?: (cap: string, input: Record<string, unknown>) => unknown;
}) {
  const h = harness();
  const chat: Row[] = [];
  const made: Array<{ threadId: string; messageId: string }> = [];
  const asks: Array<{ threadId: string; messageId: string }> = [];
  const threads = new Map<string, string>(); // asking message -> its thread
  const agents = o.agents ?? [{ agentId: LEAD, mode: "lead" as const }];
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap: string, input: unknown) {
      const b = input as { threadId: string; messageId?: string };
      const extra = o.calls?.(cap, input as Record<string, unknown>);
      if (extra !== undefined) return extra;
      if (cap === "gate.grants.ask") {
        asks.push(input as (typeof asks)[number]);
        return { ok: true };
      }
      if (cap === "threads.get") {
        if (b.threadId === MAIN)
          return {
            thread: { threadId: MAIN, kind: "chat", starter: "usr_dana", agents, agentRepliesInThreads: false },
          };
        return {
          thread: {
            threadId: b.threadId,
            kind: o.kind ?? "helper",
            parentThreadId: MAIN,
            parentMessageId: "msg_line",
            title: "Docs",
            starter: "usr_dana",
            agents,
          },
        };
      }
      if (cap === "agents.get") throw new Error("no such agent");
      if (cap === "chat.thread") {
        made.push(b as { threadId: string; messageId: string });
        const id = threads.get(b.messageId!) ?? `thr_under_${b.messageId}`;
        threads.set(b.messageId!, id);
        return { thread: { threadId: id } };
      }
      if (cap === "chat.message.get")
        return { message: chat.find((r) => r.messageId === b.messageId && r.threadId === b.threadId) };
      if (cap === "chat.messages.list")
        return { messages: chat.filter((r) => r.threadId === b.threadId), hasMore: false };
      return h.ctx.call(cap, input);
    },
  };
  let bridge: Bridge;
  const postAs = async (agentId: string, p: AgentPost): Promise<void> => {
    const row: Row = {
      messageId: p.clientId,
      threadId: p.threadId,
      threadSeq: chat.length + 1,
      author: { kind: "agent", id: agentId },
      body: p.body,
      blocks: p.blocks,
      mentions: p.mentions,
      depth: 1,
    };
    chat.push(row);
    await bridge.onEvent(ctx, {
      name: "message.received",
      payload: {
        messageId: row.messageId,
        threadId: p.threadId,
        author: { kind: "agent", id: agentId },
        mentions: p.mentions,
        depth: 1,
      },
    });
  };
  bridge = createBridge({ postAs });
  const provider = scriptedProvider({ script: o.script ?? reply("Done.") });
  const open = bridge.tap(provider.openSession);
  const held = toolRunnerFrom(async () => ({
    kind: "held",
    result: { ok: false, content: { held: true } },
    taskId: "tsk_gate1",
  }));
  const engine = h.runtime({
    openSession: (spec) => open(spec),
    schedule: () => () => {},
    ...(o.held ? { callTool: held } : {}),
  });
  bridge.attach(engine);
  async function say(
    body: string,
    where = MAIN,
    mentions: Array<{ kind: "agent" | "person"; id: string }> = [],
    id = `msg_p${chat.length + 1}`,
  ) {
    chat.push({
      messageId: id,
      threadId: where,
      threadSeq: chat.length + 1,
      author: { kind: "person", id: "usr_dana" },
      body,
      blocks: [],
      mentions,
      depth: 0,
    });
    const result = await bridge.onEvent(ctx, {
      name: "message.received",
      payload: {
        messageId: id,
        threadId: where,
        author: { kind: "person", id: "usr_dana" },
        mentions,
        depth: 0,
        typed: true,
      },
    });
    if (result.receivedAs)
      for (const t of new Set([where, ...threads.values()])) {
        try {
          await engine.idle(t);
        } catch {
          /* not open here */
        }
      }
    await bridge.flush();
    return { id, result };
  }
  return { chat, made, asks, say, engine, bridge };
}

const readLink: DriverEvent[] = [
  { type: "text", text: "Looking it up." },
  { type: "tool_call", id: "call_1", name: "read_link", input: { url: "https://www.harborquotes.com/rates" } },
  { type: "done" },
];

test("a helper's held call shows its approval card in the chat the person asked in, with the hold's task, naming the helper's thread", async () => {
  const s = setup({ held: true, script: readLink });
  await s.say("Find the current rates.", HELPER);
  const inHelper = s.chat.filter((r) => r.threadId === HELPER && r.author.kind === "agent");
  assert.ok(
    inHelper.some((r) => JSON.stringify(r.blocks).includes('"waiting"')),
    "the helper's own thread keeps its card",
  );
  const up = s.chat.filter((r) => r.threadId === MAIN && r.author.kind === "agent");
  assert.equal(up.length, 1, "one card in the lead chat");
  assert.equal(up[0]!.author.id, LEAD, "from the helper");
  const blocks = up[0]!.blocks as Array<{ type: string; data: Record<string, unknown> }>;
  const card = blocks.find((b) => b.type === "turn_status");
  assert.equal(card?.data["state"], "waiting");
  assert.equal(card?.data["taskId"], "tsk_gate1", "the same task Needs you holds: answering either answers both");
  assert.ok(
    blocks.some((b) => b.type === "from_thread" && b.data["threadId"] === HELPER),
    "and it opens the helper's thread",
  );
});

test("a thread that is not a helper's keeps its card where it is", async () => {
  const s = setup({ held: true, script: readLink, kind: "task" });
  await s.say("Find the current rates.", HELPER);
  assert.equal(s.chat.filter((r) => r.threadId === MAIN && r.author.kind === "agent").length, 0);
});

// a helper told to wait for others (chat.helper.start dependsOn): its node is made queued behind theirs when its brief arrives, the brief is kept and no turn starts, and when the others are done it is woken once
function waitingRig(finish: "succeeded" | "failed" | "never") {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const state = { dep: "running" as string, me: "queued" as string };
  const s = setup({
    script: reply("Docs written."),
    calls: (cap, input) => {
      if (cap === "chat.message.get" && input["messageId"] === "msg_line")
        return {
          message: {
            blocks: [{ type: "helper", data: { helperThreadId: HELPER, agentId: LEAD, dependsOn: ["thr_numbers"] } }],
          },
        };
      if (cap === "runs.node.start") {
        calls.push({ cap, input });
        return { node: { id: "run_docs" }, created: true };
      }
      if (cap === "runs.node.find") return { byThread: {}, byKey: { [`helper:${HELPER}`]: "run_docs" } };
      if (cap === "runs.node.get")
        return input["runId"] === "run_docs"
          ? { node: { id: "run_docs", status: state.me, dependsOn: ["run_numbers"] } }
          : { node: { id: "run_numbers", status: state.dep } };
      return undefined;
    },
  });
  return { s, calls, state, finish };
}

test("a helper that waits: its node is made queued behind the others, its brief is kept and nothing starts; when they are done it is woken once", async () => {
  const { s, calls, state } = waitingRig("succeeded");
  await s.say("Write the docs from the numbers.", HELPER);
  assert.equal(calls.length, 1, "its node was made once");
  assert.deepEqual(calls[0]!.input["dependsOnThreads"], ["thr_numbers"]);
  assert.equal(calls[0]!.input["idemKey"], `helper:${HELPER}`);
  assert.equal(calls[0]!.input["parentThread"], MAIN);
  assert.equal(
    s.chat.filter((r) => r.threadId === HELPER && r.author.kind === "agent").length,
    0,
    "no turn started: the helper did not answer yet",
  );
  state.dep = "succeeded";
  await new Promise((r) => setTimeout(r, 1800));
  await s.engine.idle(HELPER).catch(() => undefined);
  await s.bridge.flush();
  assert.ok(
    s.chat.some((r) => r.threadId === HELPER && r.author.kind === "agent" && r.body.includes("Docs written")),
    "woken when the others were done",
  );
  assert.equal(calls.length, 1, "and its node was not made again");
});

test("a helper that waits for work that did not finish is never woken", async () => {
  const { s, state } = waitingRig("failed");
  await s.say("Write the docs from the numbers.", HELPER);
  state.dep = "failed";
  state.me = "failed";
  await new Promise((r) => setTimeout(r, 1800));
  await s.bridge.flush();
  assert.equal(s.chat.filter((r) => r.threadId === HELPER && r.author.kind === "agent").length, 0);
});

test("a helper that waits for nothing starts as before, and its node is not made here", async () => {
  const calls: string[] = [];
  const s = setup({
    script: reply("Done."),
    calls: (cap, input) => {
      if (cap === "chat.message.get" && input["messageId"] === "msg_line")
        return { message: { blocks: [{ type: "helper", data: { helperThreadId: HELPER, agentId: LEAD } }] } };
      if (cap === "runs.node.start") calls.push(cap);
      return undefined;
    },
  });
  await s.say("Find the rates.", HELPER);
  assert.equal(calls.length, 0);
  assert.ok(s.chat.some((r) => r.threadId === HELPER && r.author.kind === "agent"));
});
