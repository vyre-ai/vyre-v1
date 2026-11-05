// A turn that fails because the person's Vault is locked on this computer is parked once. The messages that come while it waits do not each start a turn, fail and start again (the owner's Mac failed 1,493
// turns in a row on one chat and the app update waited on them); they collapse into the one waiting turn, which runs once when the Vault opens. A parked turn is not a running one.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
const account = (): ResolvedAccount => ({ ref: "#A", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "dana", reason: "starter", itemId: "vit_1" });
const say = [{ type: "text" as const, text: "Hi." }, { type: "usage" as const, inputTokens: 10, outputTokens: 4 }, { type: "done" as const }];
const locked = [{ type: "error" as const, code: "engine.vault_locked", message: "Your Vault is locked on this computer." }];

test("a locked Vault parks the turn once; five more messages start no turn; opening it runs one turn", async () => {
  let open = false;
  const p = scriptedProvider({ script: () => (open ? say : locked) });
  const seen: string[] = [];
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  engine.subscribe((e) => { if (e.type === "turn.started" || e.type === "turn.failed" || e.type === "turn.completed") seen.push(e.type); });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "first" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(engine.parkedLocked().map((x) => [x.threadId, x.agentId, x.asker]), [["T", "intake", "dana"]]);
  for (let i = 2; i <= 6; i++) { engine.receive({ threadId: "T", author: person, body: `m${i}` }); await engine.idle("T"); }
  assert.equal(p.sessions.length, 1, "the five later messages started no turn");
  assert.equal(seen.filter((x) => x === "turn.failed").length, 1, "one failure, one line in the chat");
  assert.equal(engine.parkedLocked().length, 1, "one waiting turn, not six");
  open = true;
  assert.equal(engine.resumeLocked("dana"), 1);
  await engine.idle("T");
  assert.equal(p.sessions.length, 2, "one turn answers them all");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["failed", "completed"]);
  assert.equal(engine.parkedLocked().length, 0);
  assert.equal(engine.resumeLocked("dana"), 0, "nothing left to resume");
});

test("a parked turn does not count as running, so an update does not wait on it", async () => {
  const p = scriptedProvider({ script: () => locked });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "first" });
  await engine.idle("T");
  engine.receive({ threadId: "T", author: person, body: "again" });
  await engine.idle("T");
  assert.equal(engine.queue("T").filter((q) => q.state === "queued").length, 0, "nothing waits in the queue");
  assert.equal(engine.turns("T").filter((t) => t.state === "running").length, 0);
});

test("a host that never learns of the unlock still tries again, once, on the next message after ten minutes", async () => {
  let t = 1_000_000, open = false;
  const p = scriptedProvider({ script: () => (open ? say : locked) });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(), now: () => t });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "first" });
  await engine.idle("T");
  t += 30_000; open = true;
  engine.receive({ threadId: "T", author: person, body: "five minutes" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 1, "still parked");
  t += 11 * 60_000;
  engine.receive({ threadId: "T", author: person, body: "eleven minutes" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 2, "tried once more");
  assert.equal(engine.turns("T").at(-1)?.state, "completed");
});

test("three failures of one reason park the chat: automated messages fold in, a person's own message gets through after a minute", async () => {
  let t = 1_000_000;
  const boom = [{ type: "error" as const, code: "provider.network", message: "no route" }];
  const p = scriptedProvider({ script: () => boom });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(), now: () => t });
  engine.openThread(thread());
  const usr = { kind: "person" as const, id: "usr_dana" };
  for (let i = 1; i <= 3; i++) { engine.receive({ threadId: "T", author: usr, body: `m${i}` }); await engine.idle("T"); t += 1000; }
  assert.equal(p.sessions.length, 3);
  engine.receive({ threadId: "T", author: usr, body: "again" }); await engine.idle("T");
  assert.equal(p.sessions.length, 3, "parked: no fourth attempt inside a minute");
  t += 61_000;
  engine.receive({ threadId: "T", author: usr, body: "after a minute" }); await engine.idle("T");
  assert.equal(p.sessions.length, 4, "the person's own message tries once more");
});

test("a turn that meets a closed pool is not failed: it waits in the queue and the worker stops", async () => {
  const closed = Object.assign(new Error("the pool is closed"), { code: "engine.closing" });
  let ok = false;
  const p = scriptedProvider({ script: () => (ok ? say : [{ type: "error" as const, code: "engine.closing", message: "the pool is closed" }]) });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  void closed;
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 1, "one attempt, no spin");
  assert.deepEqual(engine.turns("T").map((x) => x.state).filter((x) => x === "failed"), [], "not a failed turn");
  assert.equal(engine.queue("T").filter((q) => q.state === "queued").length, 1, "still queued");
  ok = true;
  engine.kick("T"); await engine.idle("T");
  assert.equal(engine.turns("T").at(-1)?.state, "completed");
});

test("a missing sign-in parks the chat once like a locked Vault: the failure is said once and later automated messages fold in", async () => {
  const miss = [{ type: "error" as const, code: "engine.signin_missing", message: "Sign in again." }];
  const p = scriptedProvider({ script: () => miss });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "one" }); await engine.idle("T");
  for (let i = 0; i < 4; i++) { engine.receive({ threadId: "T", author: person, body: `more ${i}` }); await engine.idle("T"); }
  assert.equal(p.sessions.length, 1, "one attempt, then parked");
});

test("a person signs in again: the turn parked on a missing sign-in runs once, and a locked-Vault park is left for its own watcher", async () => {
  let signedIn = false;
  const p = scriptedProvider({ script: () => (signedIn ? say : [{ type: "error" as const, code: "engine.signin_missing", message: "Sign in again." }]) });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "one" }); await engine.idle("T");
  engine.receive({ threadId: "T", author: person, body: "two" }); await engine.idle("T");
  assert.equal(p.sessions.length, 1);
  assert.equal(engine.resumeLocked(undefined, "engine.vault_locked"), 0, "not this one");
  signedIn = true;
  assert.equal(engine.resumeLocked(undefined, "engine.signin_missing"), 1);
  await engine.idle("T");
  assert.equal(engine.turns("T").at(-1)?.state, "completed");
  assert.equal(p.sessions.length, 2, "one run answers the newest message");
});
