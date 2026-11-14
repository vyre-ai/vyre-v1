// Agents asked together run together (ARCH 6.2, changed 14 Nov 2026): at most one turn per agent per thread, so two agents tagged in one message start at once, each answers alone, and replies are
// posted in the order they finish. Design: DESIGN-multi-tag-and-assistant.md Part 1 ("every tagged agent, at once"), Part 3 B and C.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryLeases,
  createMemoryMessages,
  createMemoryQueue,
  createTurnEngine,
  scriptedProvider,
} from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread, SessionSpec } from "../src/turn-engine/index.ts";
import { gate, manualClock, until } from "../src/turn-engine/harness.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const agents = (): EngineAgent[] => [
  { id: "dex", mode: "lead" },
  { id: "nova", mode: "listen" },
  { id: "sol", mode: "listen" },
];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const says = (text: string): DriverEvent[] => [
  { type: "text", text },
  { type: "usage", inputTokens: 5, outputTokens: 2 },
  { type: "done" },
];
const ask = (engine: ReturnType<typeof createTurnEngine>, who: string[], body = "do your part") =>
  engine.receive({ threadId: "T", author: person("dana"), mentions: who.map(agent), body });
const replies = (engine: ReturnType<typeof createTurnEngine>): string[] =>
  engine
    .messages("T")
    .filter((m) => m.author.kind === "agent")
    .map((m) => `${m.author.id}:${m.body}`);

test("two agents tagged in one message both start at once and both finish", async () => {
  const hold = gate();
  const startedAt = new Map<string, number>();
  const p = scriptedProvider({
    script: (_i, spec) => says(`${spec.agent.id} here`),
    beforeEvent: async (i, _e, spec) => {
      if (i === 0) {
        startedAt.set(spec.agent.id, Date.now());
        await hold.wait;
      }
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await until(() => p.sessions.length === 2); // both opened while neither has finished
  await until(() => startedAt.size === 2);
  assert.ok(Math.abs(startedAt.get("dex")! - startedAt.get("nova")!) < 250, "they start within a beat of each other");
  assert.equal(engine.turns("T").filter((t) => t.state === "running").length, 2);
  hold.open();
  await engine.idle("T");
  assert.deepEqual(
    engine.turns("T").map((t) => t.state),
    ["completed", "completed"],
  );
  assert.deepEqual(replies(engine).sort(), ["dex:dex here", "nova:nova here"]);
});

test("replies follow in finishing order, and each streams as it is written", async () => {
  const slow = gate();
  const p = scriptedProvider({
    script: (_i, spec) => says(`${spec.agent.id} done`),
    beforeEvent: async (i, _e, spec) => {
      if (i === 0 && spec.agent.id === "dex") await slow.wait; // Dex is asked first and finishes last
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await until(() => replies(engine).length === 1);
  assert.deepEqual(replies(engine), ["nova:nova done"], "Nova's reply is posted while Dex is still working");
  const seq = engine.messages("T").find((m) => m.author.id === "nova")!.threadSeq;
  slow.open();
  await engine.idle("T");
  assert.deepEqual(replies(engine), ["nova:nova done", "dex:dex done"]);
  assert.equal(
    engine.messages("T").find((m) => m.author.id === "nova")!.threadSeq,
    seq,
    "nothing reordered after it was shown",
  );
});

test("three agents asked together all run together", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: (_i, spec) => says(spec.agent.id),
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova", "sol"]);
  await until(() => p.sessions.length === 3);
  hold.open();
  await engine.idle("T");
  assert.equal(engine.turns("T").filter((t) => t.state === "completed").length, 3);
  assert.equal(replies(engine).length, 3);
});

test("each agent reads the chat as it was when the message arrived, never the other's answer", async () => {
  const slow = gate();
  const p = scriptedProvider({
    script: (_i, spec) => says(`${spec.agent.id} answer`),
    beforeEvent: async (i, _e, spec) => {
      if (i === 0 && spec.agent.id === "dex") await slow.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  const sent = ask(engine, ["dex", "nova"]);
  await until(() => replies(engine).length === 1); // Nova answered while Dex still works
  slow.open();
  await engine.idle("T");
  const seen = (id: string): string[] =>
    p.sessions.find((s) => s.spec.agent.id === id)!.inputs[0]!.history.map((m) => m.id);
  assert.deepEqual(seen("dex"), [sent.messageId]);
  assert.deepEqual(seen("nova"), [sent.messageId]);
});

test("the same agent asked twice never runs two turns at once: the second waits, then runs", async () => {
  const hold = gate();
  const live = new Map<string, number>();
  let worst = 0,
    total = 0,
    peakAll = 0;
  const p = scriptedProvider({
    script: (_i, spec) => says(spec.agent.id),
    beforeEvent: async (i, _e, spec) => {
      if (i === 0) {
        const n = (live.get(spec.agent.id) ?? 0) + 1;
        live.set(spec.agent.id, n);
        worst = Math.max(worst, n);
        total++;
        peakAll = Math.max(peakAll, total);
        await hold.wait;
        live.set(spec.agent.id, n - 1);
        total--;
      }
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"], "first");
  await until(() => p.sessions.length === 2);
  // another person's message to Dex while Dex runs for Dana is not steering: it waits for Dex's own turn; Nova is untouched
  engine.receive({ threadId: "T", author: person("sam"), mentions: [agent("dex")], body: "second" });
  assert.equal(p.sessions.length, 2, "Dex's second turn has not started");
  hold.open();
  await engine.idle("T");
  assert.equal(worst, 1, "no agent ever ran two turns at once");
  assert.equal(peakAll, 2);
  assert.ok(engine.turns("T").filter((t) => t.agentId === "dex").length >= 2);
});

test("one agent fails while the other finishes: the failure is its own and the other's reply stands", async () => {
  const p = scriptedProvider({
    script: (_i, spec) =>
      spec.agent.id === "dex" ? [{ type: "error", code: "provider.boom", message: "no" }] : says("fine"),
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await engine.idle("T");
  const state = (id: string): string | undefined => engine.turns("T").find((t) => t.agentId === id)?.state;
  assert.equal(state("dex"), "failed");
  assert.equal(state("nova"), "completed");
  assert.deepEqual(replies(engine), ["nova:fine"]);
});

test("Stop on one agent stops that turn only; Stop everyone stops all", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: (_i, spec) => says(spec.agent.id),
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  ask(engine, ["dex", "nova", "sol"]);
  await until(() => p.sessions.length === 3);
  const one = await engine.stop("T", { agentId: "nova" });
  assert.deepEqual(
    one.stopped.map((x) => x.agentId),
    ["nova"],
  );
  assert.equal(p.sessions.find((s) => s.spec.agent.id === "nova")!.cancelled, true);
  assert.equal(p.sessions.find((s) => s.spec.agent.id === "dex")!.cancelled, false);
  const all = await engine.stop("T");
  assert.deepEqual(all.stopped.map((x) => x.agentId).sort(), ["dex", "sol"]);
  hold.open();
  await engine.idle("T");
  const state = (id: string): string | undefined => engine.turns("T").find((t) => t.agentId === id)?.state;
  assert.deepEqual([state("dex"), state("nova"), state("sol")], ["cancelled", "cancelled", "cancelled"]);
  assert.deepEqual(replies(engine), []);
});

test("Stop pressed on one agent while it is still starting marks that agent only", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: (_i, spec) => says(spec.agent.id),
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    admit: async ({ agentId }) => {
      if (agentId === "nova") await new Promise((r) => setTimeout(r, 60)); // Nova is slow to start
      return null;
    },
  });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await until(() => p.sessions.length === 1);
  const r = await engine.stop("T", { agentId: "nova" });
  assert.equal(r.starting, 1);
  assert.deepEqual(r.stopped, []);
  hold.open();
  await engine.idle("T");
  const state = (id: string): string | undefined => engine.turns("T").find((t) => t.agentId === id)?.state;
  assert.deepEqual([state("dex"), state("nova")], ["completed", "cancelled"]);
});

test("a person's message that tags nobody, mid-round, steers every agent still working for them", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: [{ type: "tool_call", id: "c1", name: "files.read", input: {} }, ...says("ok")],
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    callTool: async () => ({ ok: true, content: "x" }),
  });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await until(() => p.sessions.length === 2);
  const steer = engine.receive({ threadId: "T", author: person("dana"), body: "also check the dates" });
  assert.deepEqual(steer.responders.sort(), ["dex", "nova"]);
  assert.ok(
    engine
      .queue("T")
      .filter((r) => steer.qseqs.includes(r.qseq))
      .every((r) => r.steer),
  );
  hold.open();
  await engine.idle("T");
  for (const s of p.sessions)
    assert.deepEqual(
      s.injected.map((m) => m.body),
      ["also check the dates"],
    );
  assert.equal(p.sends(), 2, "steering started no third turn");
});

test("a message that tags one agent mid-round steers that agent only", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: [{ type: "tool_call", id: "c1", name: "files.read", input: {} }, ...says("ok")],
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    callTool: async () => ({ ok: true, content: "x" }),
  });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await until(() => p.sessions.length === 2);
  ask(engine, ["nova"], "nova, use the old file");
  hold.open();
  await engine.idle("T");
  const by = (id: string) => p.sessions.find((s) => s.spec.agent.id === id)!;
  assert.deepEqual(
    by("nova").injected.map((m) => m.body),
    ["nova, use the old file"],
  );
  assert.deepEqual(by("dex").injected, []);
});

test("an approval held by one agent leaves the other free to finish; the answer wakes only the held one", async () => {
  const p = scriptedProvider({
    script: (input, spec) =>
      spec.agent.id === "nova"
        ? says("nova done")
        : input.resumed
          ? says("sent")
          : [{ type: "tool_call", id: "c1", name: "mail_send", input: {} }, { type: "done" }],
  });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    callTool: async () => ({ ok: false, content: { held: true }, held: { taskId: "tsk_1" } }),
  });
  engine.openThread(thread());
  ask(engine, ["dex", "nova"]);
  await engine.idle("T");
  assert.equal(engine.turns("T").find((t) => t.agentId === "dex")?.state, "waiting");
  assert.equal(engine.turns("T").find((t) => t.agentId === "nova")?.state, "completed");
  assert.deepEqual(replies(engine), ["nova:nova done"]);
  assert.notEqual(engine.resume("tsk_1", { approved: true }), null);
  await engine.idle("T");
  assert.deepEqual(replies(engine), ["nova:nova done", "dex:sent"]);
});

test("a restart mid-round: a turn that had called no tool runs again, one that had is marked lost, and each agent only once", async () => {
  const clock = manualClock();
  const queue = createMemoryQueue();
  const leases = createMemoryLeases();
  const messages = createMemoryMessages(); // the chat itself outlives the host, as the real store does
  const hold = gate();
  const pa = scriptedProvider({
    script: (_i, spec) =>
      spec.agent.id === "dex" ? [{ type: "tool_call", id: "c1", name: "send", input: {} }, ...says("x")] : says("y"),
    beforeEvent: async (i, _e, spec) => {
      if (i === 0 && spec.agent.id === "nova") await hold.wait; // Nova has called nothing when the host dies
    },
  });
  const a = createTurnEngine({
    holder: "host:a",
    openSession: pa.openSession,
    queue,
    leases,
    messages,
    now: clock.now,
    callTool: async () => {
      await hold.wait; // Dex is inside a tool call
      return { ok: true, content: {} };
    },
  });
  const pb = scriptedProvider({ script: says("again") });
  const b = createTurnEngine({
    holder: "host:b",
    openSession: pb.openSession,
    queue,
    leases,
    messages,
    now: clock.now,
    lostTurn: (r) => `lost${r.qseq}`,
  });
  a.openThread(thread());
  ask(a, ["dex", "nova"]);
  await until(() => queue.list("T").some((r) => r.agentId === "dex" && r.touched === true) && pa.sessions.length === 2);
  clock.advance(21_000);
  b.openThread(thread()); // the new host opens the chat from the stored messages
  assert.equal(b.recover("T"), true);
  await b.idle("T");
  const lost = b.events("T").filter((e) => e.type === "turn.failed");
  assert.deepEqual(
    lost.map((e) => (e.type === "turn.failed" ? [e.agentId, e.code] : [])),
    [["dex", "host_lost"]],
  );
  assert.deepEqual(
    pb.sessions.map((s) => s.spec.agent.id),
    ["nova"],
    "Nova ran again, Dex was not replayed",
  );
  assert.deepEqual(
    queue.list("T").map((r) => [r.agentId, r.state]),
    [
      ["dex", "done"],
      ["nova", "done"],
    ],
  );
  hold.open();
  await a.stop("T");
  await a.idle("T");
});

test("a single agent chat behaves as before: one turn, one reply, lease released", async () => {
  const leases = createMemoryLeases();
  const p = scriptedProvider({ script: says("hello") });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, leases });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), body: "hi" });
  await engine.idle("T");
  assert.deepEqual(replies(engine), ["dex:hello"]);
  assert.equal(leases.get("T", Date.now()), null);
});

export type _Unused = SessionSpec;
