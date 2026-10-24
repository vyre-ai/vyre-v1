import test from "node:test";
import assert from "node:assert/strict";
import { route, nextDepth, DEFAULT_AGENT_HOPS } from "../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../lib/route.ts";
import { createTurnEngine, scriptedSession, defaultMode, LEASE_HEARTBEAT_MS, LEASE_TTL_MS } from "../src/turn-engine/index.ts";
import type { DriverEvent, IncomingMessage, TurnEngine, TurnEngineOptions, TurnRow } from "../src/turn-engine/index.ts";

const person = (id: string): { kind: "person"; id: string } => ({ kind: "person", id });
const agent = (id: string): { kind: "agent"; id: string } => ({ kind: "agent", id });

const TRIO: RouteThread = {
  agents: [
    { id: "intake", mode: "lead" },
    { id: "docs", mode: "listen" },
    { id: "billing", mode: "listen" },
  ],
};

const okEvents: readonly DriverEvent[] = [
  { type: "text", text: "ok" },
  { type: "usage", inputTokens: 1, outputTokens: 1, costMicros: 1 },
  { type: "done" },
];

function manualClock(start = 1_000_000): { now(): number; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function engineWith(open: TurnEngineOptions["open"] = () => scriptedSession({ events: okEvents }), clock?: { now(): number }): TurnEngine {
  return createTurnEngine({
    holder: "host:spc_a",
    ...(clock ? { clock } : {}),
    open,
  });
}

function slot<T>(): { get: () => T; set: (value: T) => void } {
  let value: T | undefined;
  return {
    get: () => {
      if (value === undefined) throw new Error("not ready");
      return value;
    },
    set: (next) => {
      value = next;
    },
  };
}

function openTrio(engine: TurnEngine, id = "thr"): void {
  engine.openThread({
    id,
    kind: "chat",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    agents: [
      { id: "intake", mode: "lead", name: "Intake" },
      { id: "docs", mode: "listen", name: "Docs", role: "reviews docs" },
      { id: "billing", mode: "listen", name: "Billing" },
    ],
  });
}

function bodyOf(engine: TurnEngine, turn: TurnRow | undefined): string {
  const id = turn?.messageId;
  if (!id) return "";
  return engine.message(id)?.body ?? "";
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("route() decisions match lib route.test.ts", () => {
  let opens = 0;
  const engine = engineWith(() => {
    opens += 1;
    return scriptedSession({ events: okEvents });
  });
  openTrio(engine);
  engine.openThread({
    id: "thr-nolead",
    kind: "channel",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    agents: [{ id: "docs", mode: "listen", name: "Docs" }],
  });

  const rows: { threadId: string; message: RouteMessage; line?: string }[] = [
    { threadId: "thr", message: { author: person("dana"), mentions: [] }, line: "Intake will reply" },
    { threadId: "thr", message: { author: person("dana"), mentions: [agent("docs")] } },
    { threadId: "thr", message: { author: person("dana"), mentions: [agent("billing"), agent("docs"), agent("billing")] }, line: "Billing, Docs will reply" },
    { threadId: "thr", message: { author: person("dana"), mentions: [person("sam")] }, line: "No agent will reply, type @ to ask one" },
    { threadId: "thr", message: { author: person("dana"), mentions: [person("sam"), agent("docs")] } },
    { threadId: "thr-nolead", message: { author: person("dana"), mentions: [] }, line: "No agent will reply, type @ to ask one" },
    { threadId: "thr", message: { author: agent("docs"), mentions: [agent("billing")], depth: DEFAULT_AGENT_HOPS - 1 } },
    { threadId: "thr", message: { author: agent("docs"), mentions: [agent("billing")], depth: DEFAULT_AGENT_HOPS } },
    { threadId: "thr", message: { author: person("dana"), mentions: [], depth: 99 } },
    { threadId: "thr", message: { author: agent("intake"), mentions: [agent("intake")], depth: 0 } },
    { threadId: "thr", message: { author: agent("intake"), mentions: [], depth: 0 } },
    { threadId: "thr", message: { author: agent("docs"), mentions: [], depth: 0 } },
  ];

  for (const row of rows) {
    const thread = row.threadId === "thr" ? TRIO : { agents: [{ id: "docs", mode: "listen" as const }] };
    const direct = route(thread, row.message);
    const incoming: IncomingMessage = { threadId: row.threadId, ...row.message };
    const preview = engine.preview(incoming);
    assert.deepEqual(preview.responders, direct.responders, row.threadId);
    assert.equal(preview.reason, direct.reason);
    assert.deepEqual(preview.listeners, direct.listeners);
    if (row.line) assert.equal(preview.line, row.line);
    const before = engine.queueItems(row.threadId).length;
    const queued = engine.receive(incoming);
    assert.deepEqual(queued.responders, direct.responders);
    assert.equal(queued.reason, direct.reason);
    const added = engine.queueItems(row.threadId).slice(before).map((item) => item.agentId);
    assert.deepEqual(added, direct.responders);
  }

  const limited = createTurnEngine({
    holder: "host:spc_a",
    policy: { agentHops: 1 },
    open: () => scriptedSession({ events: okEvents }),
  });
  openTrio(limited, "thr-hops");
  const hopMessage: RouteMessage = { author: agent("docs"), mentions: [agent("billing")], depth: 1 };
  const hopDirect = route(TRIO, hopMessage, { agentHops: 1 });
  const hopQueued = limited.receive({ threadId: "thr-hops", ...hopMessage });
  assert.deepEqual(hopQueued.responders, hopDirect.responders);
  assert.equal(hopQueued.reason, "hop_limit");
  assert.equal(opens, 0, "routing does not call the provider");
});

test("hop limit stops an agent-to-agent loop", async () => {
  const calls: string[] = [];
  const engine = engineWith((who) => scriptedSession({
    events: okEvents,
    onSend: () => calls.push(who.id),
  }));
  openTrio(engine);
  let author: { kind: "person" | "agent"; id: string } = person("dana");
  let depth = 0;
  let mentions: RouteMessage["mentions"] = [agent("docs")];
  let stopped = false;
  for (let i = 0; i < 8; i++) {
    const before = calls.length;
    const message: RouteMessage = { author, mentions, depth };
    const direct = route(TRIO, message);
    const queued = engine.receive({ threadId: "thr", ...message, body: `ping ${i}` });
    assert.deepEqual(queued.responders, direct.responders);
    assert.equal(queued.reason, direct.reason);
    await engine.drain("thr");
    assert.equal(calls.length - before, direct.responders.length);
    if (direct.reason === "hop_limit") {
      stopped = true;
      break;
    }
    const responder = direct.responders[0];
    if (!responder) throw new Error("expected a responder");
    const nextAuthor = agent(responder);
    depth = nextDepth({ author, depth });
    author = nextAuthor;
    mentions = [agent(responder === "docs" ? "billing" : "docs")];
  }
  assert.equal(stopped, true);
  assert.equal(calls.length, DEFAULT_AGENT_HOPS + 1);
  const frozen = calls.length;
  engine.receive({
    threadId: "thr",
    author: agent("docs"),
    mentions: [agent("billing")],
    depth: DEFAULT_AGENT_HOPS,
    body: "again",
  });
  await engine.drain("thr");
  assert.equal(calls.length, frozen);
});

test("queue follows thread_seq, and two mentions run in mention order", async () => {
  const engine = engineWith();
  openTrio(engine);
  engine.receive({ threadId: "thr", threadSeq: 5, author: person("dana"), body: "five" });
  engine.receive({ threadId: "thr", threadSeq: 2, author: person("dana"), body: "two" });
  await engine.drain("thr");
  const ordered = engine.turns("thr").map((turn) => bodyOf(engine, turn));
  assert.deepEqual(ordered, ["two", "five"]);
  assert.equal(engine.turns("thr")[0]?.blocks[0]?.text, "ok");

  engine.receive({
    threadId: "thr",
    author: person("dana"),
    mentions: [agent("billing"), agent("docs"), agent("billing")],
    body: "both",
  });
  await engine.drain("thr");
  const both = engine.turns("thr").slice(2).map((turn) => turn.agentId);
  assert.deepEqual(both, ["billing", "docs"]);
});

test("one turn runs at a time", async () => {
  const gate = deferred();
  const entered = deferred();
  let opens = 0;
  const held = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      opens += 1;
      return scriptedSession({
        events: [
          { type: "tool_call", id: "c", name: "search", input: {} },
          { type: "text", text: "ok" },
          { type: "done" },
        ],
      });
    },
    callTool: async () => {
      entered.resolve();
      await gate.promise;
      return { ok: true, data: {} };
    },
  });
  openTrio(held);
  held.receive({ threadId: "thr", author: person("dana"), body: "one" });
  held.receive({ threadId: "thr", author: person("dana"), body: "two" });
  const running = held.drain("thr");
  await entered.promise;
  assert.equal(opens, 1);
  gate.resolve();
  await running;
  assert.equal(opens, 2);
  assert.equal(held.turns("thr").length, 2);
});

test("steering is injected at the next tool boundary and does not cancel", async () => {
  const injected: string[] = [];
  const rounds: string[][] = [];
  let cancels = 0;
  const self = slot<TurnEngine>();
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => scriptedSession({
      events: [
        { type: "tool_call", id: "c1", name: "search", input: {} },
        { type: "text", text: "after" },
        { type: "done" },
      ],
      onCancel: () => {
        cancels += 1;
      },
      onInject: (msg) => injected.push(msg.content),
      onSend: (input) => rounds.push(input.messages.map((row) => row.content)),
    }),
    callTool: async () => {
      self.get().receive({
        threadId: "thr",
        author: person("sam"),
        body: "look at the invoice",
        accountRef: "#Sam_Key",
      });
      return { ok: true, data: {} };
    },
  });
  self.set(engine);
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "start" });
  await engine.drain("thr");
  assert.equal(cancels, 0);
  assert.deepEqual(injected, ["look at the invoice"]);
  assert.equal(rounds.length, 2);
  assert.ok(rounds[1]?.includes("look at the invoice"));
  assert.equal(engine.turns("thr").length, 1);
  assert.equal(engine.turns("thr")[0]?.state, "completed");
  const steered = engine.queueItems("thr").find((item) => item.from === "sam");
  assert.equal(steered?.state, "consumed");
  assert.equal(steered?.account.reason, "steerer");
  assert.equal(steered?.account.accountRef, "#Sam_Key");
});

test("interrupt cancels now and runs ahead of an earlier queued message", async () => {
  let cancels = 0;
  let phase = 0;
  const self = slot<TurnEngine>();
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      phase += 1;
      if (phase === 1) {
        return scriptedSession({
          events: [
            { type: "tool_call", id: "c1", name: "search", input: {} },
            { type: "text", text: "should not send" },
            { type: "done" },
          ],
          onCancel: () => {
            cancels += 1;
          },
        });
      }
      return scriptedSession({ events: [{ type: "text", text: "ok" }, { type: "done" }] });
    },
    callTool: async () => {
      const current = self.get();
      current.receive({ threadId: "thr", author: person("dana"), body: "later", threadSeq: 50 });
      await current.interrupt("thr", { threadId: "thr", author: person("sam"), body: "stop and send", accountRef: "#Sam_Key", threadSeq: 51 });
      return { ok: true, data: {} };
    },
  });
  self.set(engine);
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "start" });
  await engine.drain("thr");
  const turns = engine.turns("thr");
  assert.equal(cancels, 1);
  assert.equal(turns[0]?.state, "cancelled");
  assert.equal(bodyOf(engine, turns[1]), "stop and send");
  assert.equal(turns[1]?.state, "completed");
  assert.equal(turns[1]?.payerReason, "steerer");
  assert.equal(turns[1]?.accountRef, "#Sam_Key");
  assert.equal(turns[1]?.asker, "sam");
  assert.equal(bodyOf(engine, turns[2]), "later");
  assert.equal(turns[2]?.state, "completed");
  assert.equal(turns[2]?.payerReason, "starter");
});

test("stop drops queued work and cancels the running turn", async () => {
  let opens = 0;
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      opens += 1;
      return scriptedSession({ events: okEvents });
    },
  });
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "one" });
  engine.receive({ threadId: "thr", author: person("dana"), body: "two" });
  assert.equal(engine.stopAll("thr").stopped, 2);
  await engine.drain("thr");
  assert.equal(opens, 0);
  assert.equal(engine.turns("thr").length, 0);
  assert.ok(engine.queueItems("thr").every((item) => item.state === "cancelled"));

  const self = slot<TurnEngine>();
  const running = createTurnEngine({
    holder: "host:spc_a",
    open: () => scriptedSession({
      events: [
        { type: "tool_call", id: "c", name: "search", input: {} },
        { type: "text", text: "ok" },
        { type: "done" },
      ],
    }),
    callTool: async () => {
      self.get().stop("thr", "intake");
      return { ok: true, data: {} };
    },
  });
  self.set(running);
  openTrio(running, "thr");
  running.receive({ threadId: "thr", author: person("dana"), body: "go" });
  await running.drain("thr");
  assert.equal(running.turns("thr")[0]?.state, "cancelled");
  assert.ok(running.events.some((event) => event.type === "turn.cancelled"));
});

test("a failed turn releases the lease and the next message is a fresh turn", async () => {
  let n = 0;
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      n += 1;
      if (n === 1) throw new Error("down");
      return scriptedSession({ events: [{ type: "text", text: "back" }, { type: "done" }] });
    },
  });
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "first" });
  await engine.drain("thr");
  assert.equal(engine.turns("thr")[0]?.state, "failed");
  assert.equal(engine.turns("thr")[0]?.error?.message, "down");
  assert.equal(engine.leases.current("thr"), undefined);
  engine.receive({ threadId: "thr", author: person("dana"), body: "second" });
  await engine.drain("thr");
  assert.equal(engine.turns("thr")[1]?.state, "completed");
  assert.equal(engine.turns("thr")[1]?.blocks[0]?.text, "back");
  assert.equal(engine.leases.current("thr"), undefined);
});

test("no account does not call the provider", async () => {
  let opens = 0;
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      opens += 1;
      return scriptedSession({ events: okEvents });
    },
  });
  engine.openThread({
    id: "thr",
    kind: "chat",
    starter: "dana",
    agents: [{ id: "intake", mode: "lead", name: "Intake" }],
  });
  engine.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  await engine.drain("thr");
  assert.equal(opens, 0);
  assert.equal(engine.turns("thr")[0]?.state, "failed");
  assert.equal(engine.turns("thr")[0]?.error?.code, "account.none");
});

test("a steer message pays on the steerer's account and a wake stays on the starter", async () => {
  let steered = false;
  const self = slot<TurnEngine>();
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => scriptedSession({
      events: okEvents,
      onSend: () => {
        if (steered) return;
        steered = true;
        self.get().receive({
          threadId: "thr",
          author: person("sam"),
          body: "please also check",
          accountRef: "#Sam_Key",
        });
      },
    }),
  });
  self.set(engine);
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  await engine.drain("thr");
  const turns = engine.turns("thr");
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.payerReason, "starter");
  assert.equal(turns[0]?.accountRef, "#Dana_Key");
  assert.equal(turns[0]?.asker, "dana");
  assert.equal(turns[1]?.payerReason, "steerer");
  assert.equal(turns[1]?.accountRef, "#Sam_Key");
  assert.equal(turns[1]?.asker, "sam");
  engine.wake("thr", "intake");
  await engine.drain("thr");
  const wake = engine.turns("thr")[2];
  assert.equal(wake?.kind, "wake");
  assert.equal(wake?.payerReason, "starter");
  assert.equal(wake?.accountRef, "#Dana_Key");
  assert.equal(wake?.state, "completed");
});

test("spend over the run cap stops the turn", async () => {
  const engine = createTurnEngine({
    holder: "host:spc_a",
    limits: () => ({ costMicros: 5 }),
    open: () => scriptedSession({
      events: [
        { type: "text", text: "x" },
        { type: "usage", inputTokens: 4, outputTokens: 2, costMicros: 9 },
        { type: "done" },
      ],
    }),
  });
  openTrio(engine);
  engine.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  await engine.drain("thr");
  const turn = engine.turns("thr")[0];
  assert.equal(turn?.state, "failed");
  assert.equal(turn?.error?.code, "permission.limit");
  assert.ok(engine.events.some((event) => event.type === "agent.limit_hit"));
  assert.equal(engine.spend("intake").costMicros, 9);
  assert.equal(engine.spend("docs").rows, 0);
});

test("leases are compare-and-set, heartbeat every 5 s, and expire after 20 s", () => {
  const clock = manualClock();
  const engine = createTurnEngine({
    holder: "host:a",
    clock,
    open: () => scriptedSession({ events: okEvents }),
  });
  const first = engine.leases.acquire("thr", "host:a", "turn");
  assert.equal(first.acquired, true);
  assert.equal(first.expiresAt, clock.now() + LEASE_TTL_MS);
  assert.equal(engine.leases.acquire("thr", "host:b", "turn").acquired, false);
  assert.equal(engine.leases.heartbeat("thr", "host:b").ok, false);
  assert.equal(engine.leases.release("thr", "host:b").ok, false);
  assert.equal(engine.leases.current("thr")?.holder, "host:a");

  clock.advance(1_000);
  const again = engine.leases.acquire("thr", "host:a", "turn");
  assert.equal(again.acquired, true);
  assert.ok(again.expiresAt > first.expiresAt);

  clock.advance(LEASE_HEARTBEAT_MS);
  const before = engine.leases.heartbeatCount;
  const beat = engine.leases.heartbeat("thr", "host:a");
  assert.equal(beat.ok, true);
  assert.equal(beat.expiresAt, clock.now() + LEASE_TTL_MS);
  assert.equal(engine.leases.heartbeatCount, before + 1);
  clock.advance(LEASE_TTL_MS - 1_000);
  assert.equal(engine.leases.acquire("thr", "host:b", "turn").acquired, false);
  clock.advance(1_000);
  assert.equal(engine.leases.heartbeat("thr", "host:a").ok, false);
  assert.equal(engine.leases.acquire("thr", "host:b", "turn").acquired, true);
  assert.equal(engine.leases.release("thr", "host:a").ok, false);
  assert.equal(engine.leases.release("thr", "host:b").ok, true);
  assert.equal(engine.leases.current("thr"), undefined);
});

test("the worker holds the lease, heartbeats a long turn, and stops when it expires", async () => {
  const clock = manualClock();
  const self = slot<TurnEngine>();
  const held = createTurnEngine({
    holder: "host:spc_a",
    clock,
    open: () => scriptedSession({
      events: [
        { type: "tool_call", id: "c", name: "search", input: {} },
        { type: "text", text: "ok" },
        { type: "done" },
      ],
    }),
    callTool: async () => {
      assert.equal(self.get().leases.acquire("thr", "host:other", "turn").acquired, false);
      clock.advance(LEASE_HEARTBEAT_MS);
      return { ok: true, data: {} };
    },
  });
  self.set(held);
  openTrio(held);
  held.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  const beats = held.leases.heartbeatCount;
  await held.drain("thr");
  assert.ok(held.leases.heartbeatCount > beats);
  assert.equal(held.turns("thr")[0]?.state, "completed");

  const clock2 = manualClock();
  const lost = createTurnEngine({
    holder: "host:spc_a",
    clock: clock2,
    open: () => scriptedSession({
      events: [
        { type: "tool_call", id: "c", name: "search", input: {} },
        { type: "text", text: "ok" },
        { type: "done" },
      ],
    }),
    callTool: async () => {
      clock2.advance(LEASE_TTL_MS);
      return { ok: true, data: {} };
    },
  });
  openTrio(lost, "thr");
  lost.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  await lost.drain("thr");
  assert.equal(lost.turns("thr")[0]?.state, "failed");
  assert.equal(lost.turns("thr")[0]?.error?.code, "lease.lost");
  assert.equal(lost.leases.current("thr"), undefined);
  assert.equal(lost.leases.acquire("thr", "device:other", "turn").acquired, true);
});

test("placement hands the lease off when the turn is not for this worker", async () => {
  let opens = 0;
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: () => {
      opens += 1;
      return scriptedSession({ events: okEvents });
    },
  });
  engine.openThread({
    id: "thr",
    kind: "chat",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    where: "device",
    agents: [{ id: "intake", mode: "lead", name: "Intake" }],
  });
  engine.receive({ threadId: "thr", author: person("dana"), body: "hi" });
  await engine.drain("thr");
  assert.equal(opens, 0);
  assert.equal(engine.queueItems("thr")[0]?.state, "queued");
  assert.ok(engine.events.some((event) => event.type === "agent.handoff" && event.to === "device"));
  assert.equal(engine.leases.current("thr"), undefined);
});

test("exactly one lead, and creation defaults", () => {
  assert.equal(defaultMode("chat", "person"), "lead");
  assert.equal(defaultMode("ask", "person"), "lead");
  assert.equal(defaultMode("channel", "person"), "listen");
  assert.equal(defaultMode("thread", "person"), "listen");
  assert.equal(defaultMode("thread", "agent"), "lead");
  assert.equal(defaultMode("channel", "agent"), "listen");

  const engine = engineWith();
  openTrio(engine);
  const promoted = engine.setMode("thr", "docs", "lead");
  assert.equal(promoted.mode, "lead");
  assert.equal(promoted.leadAgentId, "docs");
  assert.equal(engine.thread("thr")?.leadId, "docs");
  assert.equal(engine.thread("thr")?.agents.find((row) => row.id === "intake")?.mode, "listen");
  const preview = engine.preview({ threadId: "thr", author: person("dana"), mentions: [] });
  assert.deepEqual(preview.responders, ["docs"]);
  assert.equal(preview.line, "Docs will reply");
  const demoted = engine.setMode("thr", "docs", "listen");
  assert.equal(demoted.leadAgentId, null);
  assert.deepEqual(engine.preview({ threadId: "thr", author: person("dana"), mentions: [] }).responders, []);
});

test("a watcher acts unmentioned and is logged as a routine, except when the message is for a person", async () => {
  const opened: string[] = [];
  const engine = createTurnEngine({
    holder: "host:spc_a",
    open: (who) => {
      opened.push(who.id);
      return scriptedSession({ events: okEvents });
    },
  });
  engine.openThread({
    id: "thr",
    kind: "channel",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    agents: [
      { id: "intake", mode: "lead", name: "Intake" },
      { id: "docs", mode: "listen", name: "Docs", watching: true },
    ],
  });
  engine.receive({ threadId: "thr", author: person("dana"), body: "hello channel" });
  const queued = engine.queueItems("thr");
  assert.deepEqual(queued.map((item) => item.agentId), ["intake", "docs"]);
  assert.equal(queued[0]?.routine, false);
  assert.equal(queued[1]?.routine, true);
  await engine.drain("thr");
  assert.deepEqual(opened, ["intake", "docs"]);

  const before = engine.queueItems("thr").length;
  const addressed = engine.receive({ threadId: "thr", author: person("dana"), mentions: [person("sam")], body: "sam?" });
  assert.deepEqual(addressed.responders, []);
  assert.equal(engine.queueItems("thr").length, before);
});
