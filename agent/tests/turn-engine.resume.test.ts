// A turn that had called tools when its host died is resumed from its journal (r42-runtime): finished calls are told to the resumed turn and never run again; a call that was in flight is asked again only when that is safe
// (a read, or a call with an idempotency key the server answers once); a call that may have changed the world ends the turn host_lost for a person to decide.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, createMemoryLeases, createMemoryQueue, scriptedProvider } from "../src/turn-engine/index.ts";
import { createMemoryJournal } from "../src/turn-engine/journal.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";
import { gate, manualClock, until } from "../src/turn-engine/harness.ts";
import { readsEpoch } from "../src/tools/reads-epoch.ts";

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

/** Host A runs a turn whose second call never answers; the host dies; host B takes the thread over. */
async function crash(script: DriverEvent[], opts: { toolSafety?: boolean } = {}) {
  const clock = manualClock();
  const queue = createMemoryQueue();
  const leases = createMemoryLeases();
  const journal = createMemoryJournal();
  const hold = gate();
  const ranA: string[] = [];
  const keysA = new Map<string, string | undefined>();
  const pa = scriptedProvider({ script });
  const a = createTurnEngine({
    holder: "host:a",
    openSession: pa.openSession,
    queue,
    leases,
    journal,
    now: clock.now,
    ...(opts.toolSafety === false ? {} : { toolSafety: SAFETY }),
    callTool: async (c, ctx) => {
      ranA.push(c.id);
      keysA.set(c.id, ctx.callKey);
      if (c.id === "c1") return { ok: true, content: { rows: 3 } };
      await hold.wait;
      return { ok: true, content: {} };
    },
  });
  const ranB: Array<{ id: string; turnId: string; input: unknown; callKey?: string | undefined }> = [];
  const pb = scriptedProvider({ script: ok });
  const b = createTurnEngine({
    holder: "host:b",
    openSession: pb.openSession,
    queue,
    leases,
    journal,
    now: clock.now,
    ...(opts.toolSafety === false ? {} : { toolSafety: SAFETY }),
    lostTurn: () => a.turns("T")[0]!.id,
    callTool: async (c, ctx) => {
      ranB.push({ id: c.id, turnId: ctx.turnId, input: c.input, callKey: ctx.callKey });
      return { ok: true, content: { replayed: c.name } };
    },
  });
  a.openThread(thread("T"));
  b.openThread(thread("T"));
  a.receive({ threadId: "T", author: person("dana"), body: "Update the prices" });
  await until(() => ranA.length >= 2);
  clock.advance(21_000);
  assert.equal(b.recover("T"), true);
  await b.idle("T");
  const lost = a.turns("T")[0]!;
  return {
    a,
    b,
    pb,
    ranA,
    ranB,
    keysA,
    journal,
    lost,
    release: async () => {
      hold.open();
      await a.stop("T");
      await a.idle("T");
    },
  };
}
const notice = (r: { pb: ReturnType<typeof scriptedProvider> }): string =>
  String((r.pb.sessions[0]?.inputs[0] as { notice?: string } | undefined)?.notice ?? "");

test("a read in flight is asked again under its old call id, the finished call is told to the resumed turn and not run again", async () => {
  const r = await crash([
    { type: "tool_call", id: "c1", name: "read_prices", input: { sheet: "A" } },
    { type: "tool_call", id: "c2", name: "read_policy", input: { doc: "B" } },
    { type: "done" },
  ]);
  assert.equal(r.pb.sessions.length, 1, "the turn was resumed");
  assert.deepEqual(
    r.ranB.map((c) => [c.id, c.turnId]),
    [["c2", r.lost.id]],
    "only the call in flight was asked again, as the same call of the same turn",
  );
  assert.equal(
    readsEpoch(r.lost.id) > 0,
    true,
    "what the lost turn had read is forgotten, so a replayed read comes back whole",
  );
  assert.match(notice(r), /server stopped/);
  assert.match(notice(r), /Done: read_prices answered: \{"rows":3\}/);
  assert.match(notice(r), /read_policy was running when it stopped; it was asked again and answered/);
  assert.equal(r.b.turns("T").at(-1)?.state, "completed");
  assert.ok(
    r.b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"),
    "the old turn is closed honestly",
  );
  await r.release();
});

test("a keyed write in flight is asked again once, under the same id, so the server's key answers it and nothing goes out twice", async () => {
  const r = await crash([
    { type: "tool_call", id: "c1", name: "read_prices", input: {} },
    { type: "tool_call", id: "c2", name: "keyed_create_task", input: { title: "Call the supplier" } },
    { type: "done" },
  ]);
  assert.equal(r.pb.sessions.length, 1);
  assert.deepEqual(
    r.ranB.map((c) => [c.id, c.input]),
    [["c2", { title: "Call the supplier" }]],
  );
  assert.match(notice(r), /keyed_create_task was running when it stopped/);
  await r.release();
});

test("a write that may have changed something and has no key is NOT asked again and the turn is not resumed: it ends host_lost", async () => {
  const r = await crash([
    { type: "tool_call", id: "c1", name: "read_prices", input: {} },
    { type: "tool_call", id: "c2", name: "send_email", input: { to: "a@b.example" } },
    { type: "done" },
  ]);
  assert.equal(r.pb.sessions.length, 0);
  assert.equal(r.ranB.length, 0, "the send is not run a second time");
  assert.ok(r.b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"));
  await r.release();
});

test("an engine that ran its own tool in the turn is not resumed: we cannot ask its call again", async () => {
  const r = await crash([
    { type: "block", kind: "tool_call", payload: { id: "own1", name: "Read" } },
    { type: "tool_call", id: "c1", name: "read_prices", input: {} },
    { type: "tool_call", id: "c2", name: "read_policy", input: {} },
    { type: "done" },
  ]);
  assert.equal(r.pb.sessions.length, 0);
  assert.equal(r.ranB.length, 0);
  await r.release();
});

test("with no safety rule wired the engine behaves as before: a turn that called a tool ends host_lost", async () => {
  const r = await crash(
    [
      { type: "tool_call", id: "c1", name: "read_prices", input: {} },
      { type: "tool_call", id: "c2", name: "read_policy", input: {} },
      { type: "done" },
    ],
    { toolSafety: false },
  );
  assert.equal(r.pb.sessions.length, 0);
  await r.release();
});

test("a resumed turn that finishes leaves nothing in the journal, and the resume happens once however often recover runs", async () => {
  const r = await crash([
    { type: "tool_call", id: "c1", name: "read_prices", input: {} },
    { type: "tool_call", id: "c2", name: "read_policy", input: {} },
    { type: "done" },
  ]);
  assert.equal(r.journal.list(r.lost.id).length, 0, "consumed by the resume");
  assert.equal(r.b.recover("T"), true);
  await r.b.idle("T");
  assert.equal(r.pb.sessions.length, 1, "no second resume");
  await r.release();
});
