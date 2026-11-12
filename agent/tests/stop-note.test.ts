// After a Stop, the agent's next turn must not redo the stopped work (lead, 12 Nov 2026: real model, "sleep 120 && echo finished-long" ran again before "What is 2 plus 2?" was answered).
// The next turn is told the stopped turn is closed (stopNote, in input.notice, which both the API and CLI drivers put before the model). The stand-in model here does what the real one did:
// it finishes any open work it can see unless the history says that work is closed.
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLeases, createMemoryMessages, createMemoryQueue, createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import { stopNote } from "../src/turn-engine/engine.ts";
import { threadMessages } from "../src/drivers/api/messages.ts";
import { defaultPrompt } from "../src/drivers/cli/prompt.ts";
import type { DriverEvent, OpenThread, ResolvedAccount, TurnInput } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (kind: OpenThread["kind"] = "chat"): OpenThread => ({ id: "T", kind, starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
const account = (): ResolvedAccount => ({ ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter", itemId: "vit_1" });
const LONG = "Run `sleep 120 && echo finished-long` in the terminal";

/** The stand-in: a long ask holds (so it can be stopped); any later turn first redoes the long ask it can see, unless it was told that turn is closed. */
function model(hold: { at: "start" | "text" | "tool" }) {
  let release = (): void => undefined;
  const held = new Promise<void>((res) => { release = res; });
  let holding = false;
  const answered: string[] = [];
  const script = (input: TurnInput): DriverEvent[] => {
    const now = input.trigger?.body ?? "";
    if (now === LONG) return hold.at === "tool"
      ? [{ type: "tool_call", id: "c1", name: "terminal_run", input: { command: "sleep 120 && echo finished-long" } }, { type: "text", text: "finished-long" }, { type: "done" }]
      : [{ type: "text", text: "Starting the long command" }, { type: "text", text: " ...finished-long" }, { type: "done" }];
    const sawLong = input.history.some((m) => m.body === LONG) || threadMessages(input).some((m) => m.role === "user" && m.text.includes("sleep 120"));
    const closed = (input.notice ?? "").includes("That turn is closed");
    const out = sawLong && !closed ? `REDO sleep 120; then: ${now}` : `ANSWER ${now}`;
    answered.push(out);
    return [{ type: "text", text: out }, { type: "done" }];
  };
  const p = scriptedProvider({ script, beforeEvent: async (i, ev) => { if (hold.at === "text" && ev.type === "text" && i === 1 && !holding) { holding = true; await held; } } });
  return { p, answered, release: () => release(), tool: () => held };
}

async function until(f: () => boolean): Promise<void> { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); }

test("the note says the stopped turn is closed, quotes its ask, and says how it was stopped", () => {
  const n = stopNote("stop", LONG);
  assert.match(n, /That turn is closed/);
  assert.match(n, /sleep 120/);
  assert.match(n, /pressed Stop/);
  assert.match(n, /did not finish/);
  assert.match(n, /Do not repeat or continue its work/);
  assert.match(stopNote("interrupt", "x"), /interrupted it with a new message/);
});

test("both drivers put the note before the model: the API messages end with it, the CLI prompt carries it", () => {
  const input = { threadId: "T", turnId: "t2", agent: { id: "intake", mode: "lead" }, asker: "dana", listeners: [],
    history: [{ id: "m1", threadId: "T", threadSeq: 1, author: person, mentions: [], depth: 0, body: LONG }, { id: "m2", threadId: "T", threadSeq: 2, author: person, mentions: [], depth: 0, body: "What is 2 plus 2?" }],
    trigger: { id: "m2", threadId: "T", threadSeq: 2, author: person, mentions: [], depth: 0, body: "What is 2 plus 2?" }, notice: stopNote("stop", LONG) } as unknown as TurnInput;
  const api = threadMessages(input);
  assert.ok(api.at(-1)!.text.includes("That turn is closed"), JSON.stringify(api.at(-1)));
  assert.ok(defaultPrompt(input, false).includes("That turn is closed"));
});

for (const at of ["text", "tool", "start"] as const) {
  test(`Stop while ${at === "text" ? "text streams" : at === "tool" ? "a tool runs" : "the turn is starting"}: the next ask is answered, the stopped work is not redone`, async () => {
    const m = model({ at });
    let releaseAccount = (): void => undefined;
    let asked = 0;
    let toolStarted = false;
    const engine = createTurnEngine({
      holder: "host:s", openSession: m.p.openSession,
      resolveAccount: async () => { asked += 1; if (at === "start" && asked === 1) await new Promise<void>((r) => { releaseAccount = r; }); return account(); },
      ...(at === "tool" ? { callTool: async () => { toolStarted = true; await m.tool(); return { ok: true, content: "finished-long" }; } } : {}),
    } as never);
    engine.openThread(thread());
    engine.receive({ threadId: "T", author: person, body: LONG });
    if (at === "start") await until(() => asked === 1);
    else if (at === "tool") await until(() => toolStarted);
    else await until(() => m.p.sends() === 1);
    await engine.stop("T");
    releaseAccount(); m.release();
    await engine.idle("T");
    engine.receive({ threadId: "T", author: person, body: "What is 2 plus 2?" });
    await engine.idle("T");
    assert.deepEqual(m.answered, ["ANSWER What is 2 plus 2?"], "only the new ask");
    const last = m.p.sessions.at(-1)!.inputs.at(-1)!;
    assert.match(last.notice ?? "", /That turn is closed/);
    // read once: the turn after that is told nothing
    engine.receive({ threadId: "T", author: person, body: "Thanks" });
    await engine.idle("T");
    assert.equal(m.p.sessions.at(-1)!.inputs.at(-1)!.notice, undefined);
  });
}

test("an interrupt by a new message: the old work does not resume", async () => {
  const m = model({ at: "text" });
  const engine = createTurnEngine({ holder: "host:s", openSession: m.p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: LONG });
  await until(() => m.p.sends() === 1);
  engine.receive({ threadId: "T", author: person, body: "What is 2 plus 2?" }, { interrupt: true });
  m.release();
  await engine.idle("T");
  assert.deepEqual(m.answered, ["ANSWER What is 2 plus 2?"]);
  assert.match(m.p.sessions.at(-1)!.inputs.at(-1)!.notice ?? "", /interrupted it with a new message/);
});

test("a helper's stopped turn is closed for its next turn too", async () => {
  const m = model({ at: "text" });
  const engine = createTurnEngine({ holder: "host:s", openSession: m.p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread("helper"));
  engine.receive({ threadId: "T", author: person, body: LONG });
  await until(() => m.p.sends() === 1);
  await engine.stop("T");
  m.release();
  await engine.idle("T");
  engine.receive({ threadId: "T", author: person, body: "What is 2 plus 2?" });
  await engine.idle("T");
  assert.deepEqual(m.answered, ["ANSWER What is 2 plus 2?"]);
});

test("Stop, then the daemon restarts before the turn ended: after recover the next ask is still told the stopped turn is closed", async () => {
  const queue = createMemoryQueue(), messages = createMemoryMessages();
  let asked = 0;
  let n = 0;
  const newId = (p: string): string => `${p}_${++n}`;   // two hosts on one store need unique ids, as the daemon's are
  const first = createTurnEngine({ holder: "host:a", queue, messages, newId, leases: createMemoryLeases(), openSession: scriptedProvider({ script: () => [{ type: "done" }] }).openSession,
    resolveAccount: async () => { asked += 1; return new Promise<ResolvedAccount>(() => undefined); } });
  first.openThread(thread());
  first.receive({ threadId: "T", author: person, body: LONG });
  await until(() => asked === 1);
  await first.stop("T");
  const m = model({ at: "text" });
  const second = createTurnEngine({ holder: "host:b", queue, messages, newId, leases: createMemoryLeases(), openSession: m.p.openSession, resolveAccount: async () => account() });
  second.openThread(thread());
  second.recover("T");
  second.receive({ threadId: "T", author: person, body: "What is 2 plus 2?" });
  await second.idle("T");
  assert.deepEqual(m.answered, ["ANSWER What is 2 plus 2?"]);
});
