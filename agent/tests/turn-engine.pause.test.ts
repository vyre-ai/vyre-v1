// A turn paused at a safe point and gone on with (r42-runtime): the pause waits for the call the turn is on, stops there with everything it did kept, its row waits as paused (surviving a restart), and the resume is a turn of its
// own that is told what was done and does not repeat it.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, createMemoryQueue, scriptedProvider } from "../src/turn-engine/index.ts";
import { createMemoryJournal } from "../src/turn-engine/journal.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";
import { gate, until } from "../src/turn-engine/harness.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (id: string): OpenThread => ({ id, kind: "chat", starter: "dana", agents: agents() });
const ok: DriverEvent[] = [
  { type: "text", text: "Done." },
  { type: "usage", inputTokens: 10, outputTokens: 2 },
  { type: "done" },
];
const SAFETY = (n: string): "read" | "keyed" | "unsafe" =>
  n.startsWith("read_") ? "read" : n.startsWith("keyed_") ? "keyed" : "unsafe";
const calls = (): DriverEvent[] => [
  { type: "tool_call", id: "c1", name: "read_prices", input: {} },
  { type: "tool_call", id: "c2", name: "read_policy", input: {} },
  { type: "tool_call", id: "c3", name: "read_template", input: {} },
  { type: "done" },
];

function rig() {
  const queue = createMemoryQueue();
  const journal = createMemoryJournal();
  const hold = gate();
  const ran: string[] = [];
  const mk = (script: DriverEvent[], slow: boolean) => {
    const p = scriptedProvider({ script });
    const e = createTurnEngine({
      holder: "host:a",
      openSession: p.openSession,
      queue,
      journal,
      toolSafety: SAFETY,
      lostTurn: () => lostId(),
      callTool: async (c) => {
        ran.push(c.id);
        if (slow && c.id === "c2") await hold.wait;
        return { ok: true, content: { id: c.id } };
      },
    });
    e.openThread(thread("T"));
    return { e, p };
  };
  let first = "";
  const lostId = (): string => first;
  return { queue, journal, hold, ran, mk, setFirst: (id: string) => (first = id) };
}

test("a pause waits for the call the turn is on, stops at that safe point, keeps what it did, and the row waits as paused", async () => {
  const r = rig();
  const a = r.mk(calls(), true);
  a.e.receive({ threadId: "T", author: person("dana"), body: "Compare the bids" });
  await until(() => r.ran.includes("c2"));
  assert.equal(a.e.pause("T", { reason: "its limit" }), 1);
  assert.equal(a.e.pause("T", { reason: "again" }), 0, "asked once");
  r.hold.open();
  await a.e.idle("T");
  assert.deepEqual(r.ran, ["c1", "c2"], "the call it was on finished; the next one never started");
  const t = a.e.turns("T")[0]!;
  r.setFirst(t.id);
  assert.equal(t.state, "cancelled");
  assert.equal(a.e.paused("T").length, 1);
  const ev = a.e.events("T").find((e) => e.type === "turn.cancelled");
  assert.ok(ev && ev.type === "turn.cancelled" && ev.reason === "paused");
  assert.deepEqual(
    r.journal.list(t.id).map((j) => [j.callId, j.state]),
    [
      ["c1", "done"],
      ["c2", "done"],
    ],
    "its place is kept",
  );
});

test("going on is a turn of its own, told what was done: nothing finished is run again", async () => {
  const r = rig();
  const a = r.mk(calls(), true);
  a.e.receive({ threadId: "T", author: person("dana"), body: "Compare the bids" });
  await until(() => r.ran.includes("c2"));
  a.e.pause("T", { reason: "its limit" });
  r.hold.open();
  await a.e.idle("T");
  r.setFirst(a.e.turns("T")[0]!.id);
  // the resumed turn's model only has to finish: the calls it made are not made again
  const b = r.mk([{ type: "tool_call", id: "c3", name: "read_template", input: {} }, ...ok], false);
  assert.deepEqual(b.e.resumePaused("T"), { resumed: 1, lost: 0 });
  await b.e.idle("T");
  const input = b.p.sessions[0]!.inputs[0] as { notice?: string };
  assert.match(String(input.notice), /paused at a safe point/);
  assert.match(String(input.notice), /Done: read_prices answered/);
  assert.match(String(input.notice), /Done: read_policy answered/);
  assert.deepEqual(
    r.ran.filter((x) => x === "c1" || x === "c2"),
    ["c1", "c2"],
    "c1 and c2 ran once",
  );
  assert.equal(b.e.turns("T").at(-1)?.state, "completed");
  assert.equal(b.e.paused("T").length, 0);
  assert.deepEqual(b.e.resumePaused("T"), { resumed: 0, lost: 0 }, "nothing left to go on with");
});

test("a paused row survives a restart: another engine over the same queue and journal goes on with it", async () => {
  const r = rig();
  const a = r.mk(calls(), true);
  a.e.receive({ threadId: "T", author: person("dana"), body: "Go" });
  await until(() => r.ran.includes("c2"));
  a.e.pause("T", { reason: "x" });
  r.hold.open();
  await a.e.idle("T");
  r.setFirst(a.e.turns("T")[0]!.id);
  const fresh = r.mk(ok, false); // a new process: nothing in memory but the queue and the journal
  assert.equal(fresh.e.paused("T").length, 1);
  assert.deepEqual(fresh.e.resumePaused("T"), { resumed: 1, lost: 0 });
  await fresh.e.idle("T");
  assert.equal(fresh.e.turns("T").at(-1)?.state, "completed");
});

test("a pause whose place is no longer kept (its journal is gone) cannot go on: the turn ends host_lost, once, and nothing runs", async () => {
  const r = rig();
  const a = r.mk(calls(), true);
  a.e.receive({ threadId: "T", author: person("dana"), body: "Go" });
  await until(() => r.ran.includes("c2"));
  a.e.pause("T", { reason: "x" });
  r.hold.open();
  await a.e.idle("T");
  const id = a.e.turns("T")[0]!.id;
  r.setFirst(id);
  r.journal.drop(id);
  const b = r.mk(ok, false);
  assert.deepEqual(b.e.resumePaused("T"), { resumed: 0, lost: 1 });
  assert.equal(b.p.sessions.length, 0);
  assert.ok(b.e.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"));
  assert.equal(b.e.paused("T").length, 0);
});

test("pause names the agent: another agent's turn is not touched; nothing running means nothing paused", async () => {
  const r = rig();
  const a = r.mk(calls(), true);
  assert.equal(a.e.pause("T", { reason: "x" }), 0);
  a.e.receive({ threadId: "T", author: person("dana"), body: "Go" });
  await until(() => r.ran.includes("c2"));
  assert.equal(a.e.pause("T", { agentId: "someone-else", reason: "x" }), 0);
  assert.equal(a.e.pause("T", { agentId: "intake", reason: "x" }), 1);
  r.hold.open();
  await a.e.idle("T");
});

test("a turn on an engine that runs its own tools is not paused here and is not counted as paused: it is named, so a limit can hold its next call at the hook; an API turn beside it is paused", async () => {
  const acct = (driver: string) => ({
    ref: "#A",
    driver,
    provider: driver,
    kind: "api_key" as const,
    payer: "dana",
    reason: "starter" as const,
  });
  for (const [driver, cli] of [
    ["claude_code", true],
    ["anthropic", false],
  ] as const) {
    const hold = gate();
    const p = scriptedProvider({
      script: [
        { type: "tool_call", id: "c1", name: "read_prices", input: {} },
        { type: "tool_call", id: "c2", name: "read_policy", input: {} },
        { type: "done" },
      ],
    });
    const ran: string[] = [];
    const e = createTurnEngine({
      holder: "host:a",
      openSession: p.openSession,
      toolSafety: SAFETY,
      resolveAccount: async () => acct(driver),
      callTool: async (c) => {
        ran.push(c.id);
        if (c.id === "c1") await hold.wait;
        return { ok: true, content: {} };
      },
    });
    e.openThread(thread("T"));
    e.receive({ threadId: "T", author: person("dana"), body: "Go" });
    await until(() => ran.includes("c1"));
    assert.equal(
      e.pause("T", { reason: "x" }),
      cli ? 0 : 1,
      `${driver}: only an engine we can hold between calls is paused`,
    );
    assert.deepEqual(e.cliRunning("T"), cli ? ["intake"] : []);
    hold.open();
    await e.idle("T");
    assert.equal(
      ran.includes("c2"),
      cli,
      `${driver}: the CLI turn is not stopped by pause itself; the API one stops at its safe point`,
    );
  }
});
