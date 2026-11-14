// A Stop that may reach only the turns one person asked for (a guest's, lead ruling 14 Nov 2026): running, starting, queued and parked turns are all filtered by who asked.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider, toolRunnerFrom } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";
import { gate, until } from "../src/turn-engine/harness.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const agents = (): EngineAgent[] => [
  { id: "dex", mode: "lead" },
  { id: "nova", mode: "listen" },
];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const says: DriverEvent[] = [{ type: "text", text: "ok" }, { type: "done" }];
const state = (e: ReturnType<typeof createTurnEngine>, id: string): string | undefined =>
  e.turns("T").find((t) => t.agentId === id)?.state;

test("askedBy: a Stop reaches only the running turns that person asked for", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: says,
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" });
  engine.receive({ threadId: "T", author: person("sam"), mentions: [agent("nova")], body: "b" });
  await until(() => p.sessions.length === 2);
  const none = await engine.stop("T", { agentId: "dex", askedBy: "sam" });
  assert.deepEqual(none.stopped, [], "Sam did not ask Dex");
  const mine = await engine.stop("T", { clearQueue: true, askedBy: "sam" });
  assert.deepEqual(
    mine.stopped.map((x) => x.agentId),
    ["nova"],
  );
  hold.open();
  await engine.idle("T");
  assert.deepEqual([state(engine, "dex"), state(engine, "nova")], ["completed", "cancelled"]);
});

test("askedBy: queued rows and a turn still starting are the asker's alone", async () => {
  const slow = gate();
  const p = scriptedProvider({ script: says });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    admit: async ({ agentId }) => {
      if (agentId === "dex") await slow.wait;
      return null;
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" }); // starting
  engine.receive({ threadId: "T", author: person("sam"), mentions: [agent("dex")], body: "b" }); // queued behind it
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "c" }); // queued behind it
  await until(() => engine.queue("T").some((r) => r.state === "running"));
  const r = await engine.stop("T", { clearQueue: true, askedBy: "sam" });
  assert.equal(r.starting ?? 0, 0, "the turn that is starting is Dana's");
  assert.deepEqual(
    r.dropped.map((x) => x.from),
    ["sam"],
    "only Sam's queued message is dropped",
  );
  const d = await engine.stop("T", { clearQueue: true, askedBy: "dana" });
  assert.equal(d.starting, 1, "Dana's own starting turn is marked");
  slow.open();
  await engine.idle("T");
});

test("a stopped turn says who stopped it: the one who pressed Stop, the one whose new message stopped it, or the system", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: says,
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("nova")], body: "b" });
  await until(() => p.sessions.length === 2);
  await engine.stop("T", { agentId: "dex", by: { id: "usr_maya", kind: "person" } });
  await engine.stop("T", { agentId: "nova", reason: "limit" });
  hold.open();
  await engine.idle("T");
  const by = (id: string) => {
    const e = engine.events("T").find((x) => x.type === "turn.cancelled" && x.agentId === id);
    return e && e.type === "turn.cancelled" ? e.stoppedBy : "none";
  };
  assert.deepEqual(by("dex"), { id: "usr_maya", kind: "person" });
  assert.deepEqual(by("nova"), { id: "system", kind: "system" }, "a limit is the system's");
});

test("stop and send names the person who sent", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: says,
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("nova")], body: "b" });
  await until(() => p.sessions.length === 2);
  const m = engine.receive(
    { threadId: "T", author: person("sam"), mentions: [agent("dex")], body: "stop, do this" },
    { interrupt: true },
  );
  assert.ok(m.qseqs.length > 0);
  hold.open();
  await engine.idle("T");
  const named = engine.events("T").filter((x) => x.type === "turn.cancelled");
  assert.equal(named.length, 2, "it stops every turn of the chat");
  for (const e of named) assert.deepEqual((e as { stoppedBy?: unknown }).stoppedBy, { id: "sam", kind: "person" });
});

test("a stop that does not say who pressed it carries no stopper", async () => {
  const hold = gate();
  const p = scriptedProvider({
    script: says,
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" });
  await until(() => p.sessions.length === 1);
  await engine.stop("T", { agentId: "dex" });
  hold.open();
  await engine.idle("T");
  const e = engine.events("T").find((x) => x.type === "turn.cancelled")!;
  assert.equal("stoppedBy" in e, false);
});

test("askedBy: a parked turn (waiting on an approval) is released only by the person who asked it", async () => {
  const p = scriptedProvider({
    script: (_i, spec) => [
      { type: "tool_call", id: `c_${spec.agent.id}`, name: "mail_send", input: {} },
      { type: "done" },
    ],
  });
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    callTool: toolRunnerFrom(async (c) => ({
      kind: "held",
      result: { ok: false, content: { held: true } },
      taskId: `tsk_${c.id}`,
    })),
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("dex")], body: "a" });
  engine.receive({ threadId: "T", author: person("sam"), mentions: [agent("nova")], body: "b" });
  await engine.idle("T");
  assert.deepEqual(
    engine
      .waiting("T")
      .map((w) => w.agentId)
      .sort(),
    ["dex", "nova"],
    "both turns are parked on an approval",
  );
  const r = await engine.stop("T", { clearQueue: true, askedBy: "sam" });
  assert.deepEqual(
    r.released.map((x) => x.agentId),
    ["nova"],
    "Sam's Stop all releases only Sam's parked turn",
  );
  assert.deepEqual(
    engine.waiting("T").map((w) => w.agentId),
    ["dex"],
    "Dana's approval is still waiting",
  );
});
