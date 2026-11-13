// A Stop pressed in the moment between the queue and the run (the turn is off the queue and its account is being read) must stop that turn, not find nothing and let it run to the end
// (lead, 12 Nov 2026: the polish walk's Stop that never took under load).
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryLeases,
  createMemoryMessages,
  createMemoryQueue,
  createTurnEngine,
  scriptedProvider,
} from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
const account = (): ResolvedAccount => ({
  ref: "#Dana_Claude",
  driver: "claude_code",
  provider: "anthropic",
  kind: "subscription",
  payer: "dana",
  reason: "starter",
  itemId: "vit_1",
});

test("Stop while the turn's account is still being read stops that turn", async () => {
  const p = scriptedProvider({
    script: () => [
      ...Array.from({ length: 40 }, (_, i) => ({ type: "text" as const, text: `word${i} ` })),
      { type: "done" as const },
    ],
    beforeEvent: () => new Promise<void>((r) => setTimeout(r, 20)),
  });
  let release = (): void => undefined;
  const slow = new Promise<void>((res) => {
    release = res;
  });
  let asked = 0;
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    resolveAccount: async () => {
      asked += 1;
      await slow;
      return account();
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "write the long plan" });
  for (let i = 0; i < 50 && asked === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(asked, 1, "the turn is off the queue, reading its account");
  const t0 = Date.now();
  const r = await engine.stop("T");
  assert.ok(Date.now() - t0 < 200, "the press answers at once, it does not wait for the turn to start");
  assert.equal(r.starting, 1, "the Stop found the starting turn");
  release();
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled", "it ended cancelled, nothing ran to the end");
  assert.equal(p.sessions[0]?.cancelled ?? true, true);
});

test("a Stop that marked a starting turn never stops the next one", async () => {
  const p = scriptedProvider({ script: () => [{ type: "text", text: "ok" }, { type: "done" }] });
  let release = (): void => undefined;
  let n = 0;
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    resolveAccount: async () => {
      n += 1;
      if (n === 1)
        await new Promise<void>((res) => {
          release = res;
        });
      return account();
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "first" });
  for (let i = 0; i < 50 && n === 0; i++) await new Promise((r) => setTimeout(r, 5));
  await engine.stop("T");
  release();
  await engine.idle("T");
  engine.receive({ threadId: "T", author: person, body: "second" });
  await engine.idle("T");
  assert.deepEqual(
    engine.turns("T").map((x) => x.state),
    ["cancelled", "completed"],
    "the second turn runs",
  );
});

test("a turn stopped while starting opens no session, fires no hook and sends no prompt (review F1)", async () => {
  const p = scriptedProvider({ script: () => [{ type: "text", text: "never" }, { type: "done" }] });
  const fired: string[] = [];
  let release = (): void => undefined;
  let asked = 0;
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    hooks: {
      fire: async (f) => {
        fired.push(f.event);
        return { block: null, notes: [], ran: 0 };
      },
    },
    resolveAccount: async () => {
      asked += 1;
      await new Promise<void>((res) => {
        release = res;
      });
      return account();
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  for (let i = 0; i < 50 && asked === 0; i++) await new Promise((r) => setTimeout(r, 5));
  await engine.stop("T");
  release();
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
  assert.equal(p.sessions.length, 0, "no session was opened");
  assert.equal(p.sends(), 0, "no prompt was sent");
  assert.deepEqual(fired, [], "no hook fired");
});

test("a Stop while the session is opening lets it go before any hook or prompt (review F1)", async () => {
  const base = scriptedProvider({ script: () => [{ type: "text", text: "never" }, { type: "done" }] });
  let opened = (): void => undefined;
  let opening = 0;
  const fired: string[] = [];
  const engine = createTurnEngine({
    holder: "host:s",
    hooks: {
      fire: async (f) => {
        fired.push(f.event);
        return { block: null, notes: [], ran: 0 };
      },
    },
    resolveAccount: async () => account(),
    openSession: async (spec) => {
      opening += 1;
      await new Promise<void>((res) => {
        opened = res;
      });
      return base.openSession(spec);
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  for (let i = 0; i < 50 && opening === 0; i++) await new Promise((r) => setTimeout(r, 5));
  await engine.stop("T");
  opened();
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
  assert.equal(base.sends(), 0, "nothing was sent");
  assert.deepEqual(fired, [], "no session.start or prompt.submit");
  assert.equal(base.sessions[0]?.cancelled, true, "the opened session was let go");
});

test("a turn stopped while starting asks nobody for an account (review F2)", async () => {
  const p = scriptedProvider({ script: () => [{ type: "done" }] });
  let release = (): void => undefined;
  let asked = 0,
    unblocks = 0;
  const engine = createTurnEngine({
    holder: "host:s",
    openSession: p.openSession,
    onNoAccount: async () => {
      unblocks += 1;
    },
    resolveAccount: async () => {
      asked += 1;
      await new Promise<void>((res) => {
        release = res;
      });
      return null;
    },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  for (let i = 0; i < 50 && asked === 0; i++) await new Promise((r) => setTimeout(r, 5));
  await engine.stop("T");
  release();
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
  assert.equal(unblocks, 0, "no Unblock filed for a stopped turn");
});

test("a turn stopped while starting is not handed out again after a restart (review F3)", async () => {
  const queue = createMemoryQueue(),
    messages = createMemoryMessages();
  let asked = 0;
  const first = createTurnEngine({
    holder: "host:a",
    queue,
    messages,
    leases: createMemoryLeases(),
    openSession: scriptedProvider({ script: () => [{ type: "done" }] }).openSession,
    resolveAccount: async () => {
      asked += 1;
      return new Promise<ResolvedAccount>(() => undefined);
    },
  }); // the host dies while it reads the account
  first.openThread(thread());
  first.receive({ threadId: "T", author: person, body: "write the long plan" });
  for (let i = 0; i < 50 && asked === 0; i++) await new Promise((r) => setTimeout(r, 5));
  await first.stop("T");
  // the server is back: a new engine on the same queue, with the old lease gone, recovers the thread
  const p = scriptedProvider({ script: () => [{ type: "text", text: "ran again" }, { type: "done" }] });
  const second = createTurnEngine({
    holder: "host:b",
    queue,
    messages,
    leases: createMemoryLeases(),
    openSession: p.openSession,
    resolveAccount: async () => account(),
  });
  second.openThread(thread());
  second.recover("T");
  await second.idle("T");
  assert.equal(p.sends(), 0, "the stopped turn did not run after the restart");
});
