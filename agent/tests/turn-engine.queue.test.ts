import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../../lib/route.ts";
import type { RouteMessage, RouteMention } from "../../lib/route.ts";
import { createTurnEngine, createMemoryLeases, createMemoryQueue, scriptedProvider, assignDefaults, withMode, defaultMode } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";
import { gate, manualClock, until } from "../src/turn-engine/harness.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const ok: DriverEvent[] = [{ type: "text", text: "ok" }, { type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const quiet: DriverEvent[] = [{ type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }, { id: "docs", mode: "listen" }, { id: "billing", mode: "listen" }];
const thread = (id: string, over: Partial<OpenThread> = {}): OpenThread => ({ id, kind: "chat", starter: "dana", agents: agents(), ...over });

test("route decisions in the engine match lib route() for the whole table", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T"));
  const table: RouteMessage[] = [
    { author: person("dana"), mentions: [] },
    { author: person("dana"), mentions: [agent("docs")] },
    { author: person("dana"), mentions: [agent("billing"), agent("docs"), agent("billing")] },
    { author: person("dana"), mentions: [person("sam")] },
    { author: person("dana"), mentions: [person("sam"), agent("docs")] },
    { author: agent("docs"), mentions: [agent("billing")], depth: 3 },
    { author: agent("docs"), mentions: [agent("billing")], depth: 4 },
    { author: agent("intake"), mentions: [agent("intake")], depth: 0 },
    { author: agent("docs"), mentions: [], depth: 0 },
  ];
  for (const m of table) {
    const want = route({ agents: agents() }, m);
    const got = engine.receive({ threadId: "T", author: m.author, mentions: m.mentions, ...(m.depth === undefined ? {} : { depth: m.depth }) });
    assert.deepEqual(got.responders, want.responders);
    assert.equal(got.reason, want.reason);
    assert.equal(got.qseqs.length, want.responders.length);
  }
  await engine.idle("T");
});

test("one turn at a time per thread, in queue order", async () => {
  let live = 0, peak = 0;
  const order: string[] = [];
  const p = scriptedProvider({
    script: quiet,
    beforeEvent: async (i, _ev, spec) => {
      if (i === 0) { live++; peak = Math.max(peak, live); order.push(spec.agent.id); await new Promise<void>((r) => setImmediate(r)); live--; }
    },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "one" });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("docs")], body: "two" });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("billing")], body: "three" });
  await engine.idle("T");
  assert.equal(peak, 1);
  assert.deepEqual(order, ["intake", "docs", "billing"]);
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["completed", "completed", "completed"]);
  assert.deepEqual(engine.turns("T").map((t) => t.qseq), [1, 2, 3]);
});

test("different threads run at the same time", async () => {
  const hold = gate();
  const p = scriptedProvider({ script: ok, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("A"));
  engine.openThread(thread("B"));
  engine.receive({ threadId: "A", author: person("dana") });
  engine.receive({ threadId: "B", author: person("dana") });
  await until(() => p.sessions.length === 2);
  hold.open();
  await Promise.all([engine.idle("A"), engine.idle("B")]);
  assert.equal(engine.turns().length, 2);
});

test("steering: a message during a turn is injected at the next step boundary, not run as a second turn", async () => {
  const hold = gate();
  const seen: string[] = [];
  const p = scriptedProvider({
    script: [{ type: "tool_call", id: "c1", name: "files.read", input: {} }, { type: "text", text: "done" }, { type: "done" }],
    beforeEvent: async (i) => { if (i === 0) await hold.wait; },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: async (c) => { seen.push(c.name); return { ok: true, content: "x" }; } });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "start" });
  await until(() => p.sessions.length === 1);
  const second = engine.receive({ threadId: "T", author: person("dana"), body: "also this" });
  assert.equal(engine.queue("T").find((r) => r.qseq === second.qseqs[0])?.steer, true);
  hold.open();
  await engine.idle("T");
  assert.equal(p.sends(), 1, "steering is not a second provider call");
  assert.deepEqual(p.sessions[0]?.injected.map((m) => m.body), ["also this"]);
  assert.deepEqual(seen, ["files.read"]);
  assert.equal(engine.turns("T").length, 1);
  assert.equal(engine.turns("T")[0]?.injected, 1);
  assert.equal(engine.queue("T").find((r) => r.qseq === second.qseqs[0])?.state, "consumed");
  assert.ok(engine.events("T").some((e) => e.type === "queue.consumed"));
});

test("a waiting message that no step boundary reached runs as its own turn afterwards", async () => {
  const hold = gate();
  const p = scriptedProvider({ script: ok, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "first" });
  await until(() => p.sessions.length === 1);
  engine.receive({ threadId: "T", author: person("dana"), body: "second" });
  hold.open();
  await engine.idle("T");
  assert.equal(engine.turns("T").length, 2);
  assert.equal(p.sessions[0]?.injected.length, 0);
  assert.equal(p.sessions[1]?.inputs[0]?.trigger?.body, "second");
});

test("interrupt cancels the running turn now and runs first, ahead of earlier queued items", async () => {
  const hold = gate();
  const started: string[] = [];
  const p = scriptedProvider({
    script: quiet,
    beforeEvent: async (i, _e, spec) => { if (i === 0) { started.push(spec.agent.id); if (started.length === 1) await hold.wait; } },
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "long job" });
  await until(() => p.sessions.length === 1);
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("billing")], body: "queued behind" });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("docs")], body: "stop and send" }, { interrupt: true });
  await engine.idle("T");
  const turns = engine.turns("T");
  assert.deepEqual(turns.map((t) => [t.agentId, t.state]), [["intake", "cancelled"], ["docs", "completed"], ["billing", "completed"]]);
  assert.equal(turns[1]?.kind, "interrupt");
  assert.equal(p.sessions[0]?.cancelled, true);
  assert.ok(engine.events("T").some((e) => e.type === "turn.cancelled"));
});

test("stop cancels the running turn; clearQueue also drops what waits", async () => {
  const hold = gate();
  const p = scriptedProvider({ script: ok, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "a" });
  await until(() => p.sessions.length === 1);
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("docs")], body: "b" });
  await engine.stop("T", { clearQueue: true });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["cancelled"]);
  assert.equal(engine.queue("T").filter((r) => r.state === "cancelled").length, 2);
  // the thread is not stuck: the next message runs fresh
  hold.open();
  engine.receive({ threadId: "T", author: person("dana"), body: "again" });
  await engine.idle("T");
  assert.equal(engine.turns("T").at(-1)?.state, "completed");
});

test("hop limit: two agents mentioning each other stop after 4 hops and wait for a person", async () => {
  const p = scriptedProvider({
    script: (_in, spec) => [{ type: "text", text: "your turn" }, { type: "done", mentions: [agent(spec.agent.id === "a" ? "b" : "a")] as RouteMention[] }],
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "C", kind: "channel", starter: "dana", agents: [{ id: "a", mode: "listen" }, { id: "b", mode: "listen" }] });
  engine.receive({ threadId: "C", author: person("dana"), mentions: [agent("a")] });
  await engine.idle("C");
  assert.deepEqual(engine.turns("C").map((t) => t.agentId), ["a", "b", "a", "b", "a"]);
  assert.equal(engine.events("C").filter((e) => e.type === "turn.waiting").length, 1);
  // a person reply resets the count
  engine.receive({ threadId: "C", author: person("dana"), mentions: [agent("b")] });
  await engine.idle("C");
  assert.equal(engine.turns("C").length, 10);
});

test("hop limit is configurable through policy", async () => {
  const p = scriptedProvider({ script: (_in, spec) => [{ type: "done", mentions: [agent(spec.agent.id === "a" ? "b" : "a")] as RouteMention[] }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, policy: { agentHops: 1 } });
  engine.openThread({ id: "C", kind: "channel", starter: "dana", agents: [{ id: "a", mode: "listen" }, { id: "b", mode: "listen" }] });
  engine.receive({ threadId: "C", author: person("dana"), mentions: [agent("a")] });
  await engine.idle("C");
  assert.deepEqual(engine.turns("C").map((t) => t.agentId), ["a", "b"]);
});

test("a failed turn writes turn.failed, frees the lease, and the next message runs fresh", async () => {
  let n = 0;
  const leases = createMemoryLeases();
  const clock = manualClock();
  const p = scriptedProvider({ script: () => (++n === 1 ? [{ type: "error", code: "provider_down", message: "503" }] : ok) });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, leases, now: clock.now });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana") });
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "failed");
  assert.equal(engine.turns("T")[0]?.error?.code, "provider_down");
  assert.equal(leases.get("T", clock.now()), null, "lease released");
  engine.receive({ threadId: "T", author: person("dana") });
  await engine.idle("T");
  assert.equal(engine.turns("T")[1]?.state, "completed");
});

test("a driver that throws is a failed turn, not a stuck thread", async () => {
  const engine = createTurnEngine({ holder: "host:s", openSession: async () => { throw new Error("no sandbox"); } });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana") });
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "failed");
  assert.ok(engine.events("T").some((e) => e.type === "turn.failed"));
});

test("account: the starter pays by default, whoever steers pays for the turn their message causes, a wake runs on the starter", async () => {
  const p = scriptedProvider({ script: ok });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread("T", { starter: "dana" }));
  engine.receive({ threadId: "T", author: person("dana") });
  engine.receive({ threadId: "T", author: person("sam") });
  engine.wake("T", "intake");
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.asker, t.payerReason]), [["dana", "starter"], ["sam", "steerer"], ["dana", "starter"]]);
  assert.deepEqual(engine.spend().map((s) => s.payer), ["dana", "sam", "dana"]);
  assert.equal(engine.turns("T")[2]?.kind, "wake");
});

test("lease: compare-and-set, expiry after 20 s, renew only by the holder", () => {
  const clock = manualClock();
  const l = createMemoryLeases();
  assert.ok(l.acquire("T", "host:a", clock.now()));
  assert.equal(l.acquire("T", "device:d", clock.now()), null);
  assert.ok(l.acquire("T", "host:a", clock.now()), "re-acquire by the holder is a renew");
  clock.advance(19_000);
  assert.equal(l.renew("T", "host:a", clock.now()), true);
  assert.equal(l.renew("T", "device:d", clock.now()), false);
  clock.advance(19_999);
  assert.equal(l.acquire("T", "device:d", clock.now()), null);
  clock.advance(2);
  assert.ok(l.acquire("T", "device:d", clock.now()), "free after expiry");
  assert.equal(l.renew("T", "host:a", clock.now()), false, "the old holder learns it lost");
  assert.equal(l.release("T", "host:a"), false);
  assert.equal(l.release("T", "device:d"), true);
});

test("heartbeat: a holder that lost its lease stops its turn and leaves the queue row to the new holder", async () => {
  const clock = manualClock();
  const leases = createMemoryLeases();
  const beats: Array<() => void> = [];
  const hold = gate();
  const p = scriptedProvider({ script: ok, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const engine = createTurnEngine({ holder: "host:a", openSession: p.openSession, leases, now: clock.now, schedule: (fn) => { beats.push(fn); return () => {}; } });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana") });
  await until(() => p.sessions.length === 1 && beats.length === 1);
  beats[0]?.();   // healthy beat
  assert.equal(engine.turns("T")[0]?.state, "running");
  clock.advance(21_000);
  assert.ok(leases.acquire("T", "host:b", clock.now()), "another host takes the expired lease");
  beats[0]?.();
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "failed");
  assert.equal(engine.turns("T")[0]?.error?.code, "lease_lost");
  assert.equal(engine.queue("T")[0]?.state, "running", "the new holder owns the row");
  assert.ok(!engine.events("T").some((e) => e.type === "turn.completed" || e.type === "turn.failed"));
});

test("crash: after the lease expires another host requeues what the dead one ran and resumes the thread", async () => {
  const clock = manualClock();
  const queue = createMemoryQueue();
  const leases = createMemoryLeases();
  const hold = gate();
  const pa = scriptedProvider({ script: ok, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const a = createTurnEngine({ holder: "host:a", openSession: pa.openSession, queue, leases, now: clock.now });
  const pb = scriptedProvider({ script: ok });
  const b = createTurnEngine({ holder: "host:b", openSession: pb.openSession, queue, leases, now: clock.now });
  a.openThread(thread("T"));
  b.openThread(thread("T"));
  a.receive({ threadId: "T", author: person("dana") });
  await until(() => pa.sessions.length === 1);
  assert.equal(b.recover("T"), false, "the holder is still beating");
  clock.advance(21_000);
  assert.equal(b.recover("T"), true);
  await b.idle("T");
  assert.equal(b.turns("T")[0]?.state, "completed");
  assert.ok(b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"));
  hold.open();
  await a.stop("T");
  await a.idle("T");
  assert.equal(queue.list("T").filter((r) => r.state === "done").length, 1);
});

test("placement: an item that belongs on a device is handed off, and the device engine runs it", async () => {
  const queue = createMemoryQueue();
  const leases = createMemoryLeases();
  const host = createTurnEngine({ holder: "host:s", openSession: scriptedProvider({ script: ok }).openSession, queue, leases, place: () => "device" });
  const pd = scriptedProvider({ script: ok });
  const device = createTurnEngine({ holder: "device:laptop", openSession: pd.openSession, queue, leases });
  host.openThread(thread("T"));
  device.openThread(thread("T"));
  host.receive({ threadId: "T", author: person("dana") });
  await host.idle("T");
  assert.equal(host.turns("T").length, 0);
  assert.deepEqual(host.events("T").filter((e) => e.type === "agent.handoff").map((e) => e.type === "agent.handoff" && e.to), ["device"]);
  assert.equal(leases.get("T", Date.now()), null);
  device.recover("T");
  await device.idle("T");
  assert.equal(device.turns("T").length, 1);
  assert.equal(queue.list("T")[0]?.state, "done");
});

test("watches this channel: with no lead a watching agent acts unmentioned, logged as a routine", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "C", kind: "channel", starter: "dana", agents: [{ id: "scout", mode: "listen", watching: true }, { id: "docs", mode: "listen" }] });
  engine.receive({ threadId: "C", author: person("dana"), body: "new lead came in" });
  engine.receive({ threadId: "C", author: person("dana"), mentions: [person("sam")], body: "@sam ok?" });
  await engine.idle("C");
  assert.deepEqual(engine.turns("C").map((t) => [t.agentId, t.routine]), [["scout", true]]);
});

test("modes: defaults, one lead per thread, and the composer line comes from route()", () => {
  assert.equal(defaultMode("chat"), "lead");
  assert.equal(defaultMode("ask"), "lead");
  assert.equal(defaultMode("channel"), "listen");
  assert.equal(defaultMode("thread"), "listen");
  assert.equal(defaultMode("thread", { startedByAgent: true }), "lead");
  assert.deepEqual(assignDefaults("channel", ["a", "b"]).map((a) => a.mode), ["listen", "listen"]);
  assert.deepEqual(assignDefaults("chat", ["a", "b"]).map((a) => a.mode), ["lead", "listen"]);
  const swapped = withMode(agents(), "docs", "lead");
  assert.deepEqual(swapped.map((a) => [a.id, a.mode]), [["intake", "listen"], ["docs", "lead"], ["billing", "listen"]]);
  assert.throws(() => withMode(agents(), "nobody", "lead"), RangeError);
  const engine = createTurnEngine({ holder: "host:s", openSession: scriptedProvider({ script: quiet }).openSession });
  assert.throws(() => engine.openThread({ id: "X", kind: "chat", starter: "d", agents: [{ id: "a", mode: "lead" }, { id: "b", mode: "lead" }] }), RangeError);
  engine.openThread(thread("T", { agents: [{ id: "intake", name: "Intake", mode: "lead" }, { id: "docs", name: "Docs", mode: "listen" }] }));
  assert.equal(engine.preview("T", { author: person("dana") }).line, "Intake will reply");
  assert.equal(engine.preview("T", { author: person("dana"), mentions: [agent("docs")] }).line, "Docs will reply");
  assert.equal(engine.preview("T", { author: person("dana"), mentions: [person("sam")] }).line, "");
  engine.setMode("T", "docs", "lead");
  assert.equal(engine.preview("T", { author: person("dana") }).line, "Docs will reply");
});
