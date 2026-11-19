// A turn that had called tools when its host died is resumed from its journal (r42-runtime): finished calls are told to the resumed turn and never run again; a call that was in flight is asked again only when that is safe
// (a read, or a call with an idempotency key the server answers once); a call that may have changed the world ends the turn host_lost for a person to decide.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, createMemoryLeases, createMemoryQueue, scriptedProvider } from "../src/turn-engine/index.ts";
import { createMemoryJournal, scrubInput } from "../src/turn-engine/journal.ts";
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
    r.b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_resumed"),
    "the old turn is closed honestly, and says it was carried on",
  );
  assert.ok(!r.b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"));
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

test("what another node of the work told this turn is handed to the model at the next step boundary, once, with who it is from", async () => {
  const told: Array<{ from: string; body: string }> = [{ from: "Pine", body: "Pine's price changed to 3,820" }];
  const p = scriptedProvider({
    script: [
      { type: "tool_call", id: "c1", name: "read_prices", input: {} },
      { type: "tool_call", id: "c2", name: "read_policy", input: {} },
      { type: "done" },
    ],
  });
  const asked: string[] = [];
  const engine = createTurnEngine({
    holder: "host:a",
    openSession: p.openSession,
    callTool: async () => ({ ok: true, content: {} }),
    takeNotes: async (c) => {
      asked.push(c.turnId);
      return told.splice(0, told.length);
    },
    toolSafety: SAFETY,
  });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "Compare the bids" });
  await engine.idle("T");
  const injected = p.sessions[0]!.injected.map((m) => [m.author.id, m.body]);
  assert.deepEqual(injected, [["Pine", "Pine's price changed to 3,820"]], "once, though two calls asked");
  assert.equal(asked.length, 2);
});

test("journal first, then act: when a call cannot be written down as started, a call that may change something is not made, and a read still is", async () => {
  const ran: string[] = [];
  const bad = {
    put: () => {
      throw new Error("disk full");
    },
    list: () => [],
    drop: () => undefined,
  };
  const p = scriptedProvider({
    script: [
      { type: "tool_call", id: "c1", name: "send_email", input: {} },
      { type: "tool_call", id: "c2", name: "read_prices", input: {} },
      { type: "done" },
    ],
  });
  const results: Array<{ id: string; ok: boolean; code?: string }> = [];
  const engine = createTurnEngine({
    holder: "host:a",
    openSession: p.openSession,
    journal: bad,
    toolSafety: SAFETY,
    callTool: async (c) => {
      ran.push(c.id);
      return { ok: true, content: {} };
    },
  });
  engine.openThread(thread("T"));
  engine.receive({ threadId: "T", author: person("dana"), body: "Send it" });
  await engine.idle("T");
  assert.deepEqual(ran, ["c2"], "the email was not sent; the read was");
  for (const r of p.sessions[0]!.toolResults)
    results.push({ id: r.id, ok: r.result.ok, code: (r.result.content as { code?: string }).code });
  assert.deepEqual(
    results.find((r) => r.id === "c1"),
    { id: "c1", ok: false, code: "journal_failed" },
  );
});

test("what is kept of a call has no secrets in it: a field named like one, a key, a held token; a Vault reference stays because it is not a value", () => {
  const out = scrubInput({
    to: "a@b.example",
    password: "hunter2",
    nested: { apiKey: "abc", fine: "hello" },
    list: ["ok", "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"],
    ref: "#Mail.password",
    n: 3,
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.value, {
    to: "a@b.example",
    password: "[secret]",
    nested: { apiKey: "[secret]", fine: "hello" },
    list: ["ok", "[secret]"],
    ref: "#Mail.password",
    n: 3,
  });
  assert.equal(scrubInput({ title: "Call the supplier", count: 2 }).changed, false);
});

test("a call that had a secret in its input and was in flight is not asked again: the turn ends host_lost", async () => {
  const r = await crash([
    { type: "tool_call", id: "c1", name: "read_prices", input: {} },
    { type: "tool_call", id: "c2", name: "keyed_create_task", input: { title: "x", apiKey: "abc123" } },
    { type: "done" },
  ]);
  assert.equal(r.pb.sessions.length, 0);
  assert.equal(r.ranB.length, 0);
  assert.ok(r.b.events("T").some((e) => e.type === "turn.failed" && e.code === "host_lost"));
  await r.release();
});
