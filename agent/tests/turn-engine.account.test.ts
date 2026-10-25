// The account a turn runs on comes from engine.account.resolve (P-L2_23): asked before every turn, its payer is the turn's asker, its account goes into the session spec, no account means no
// session, an Unblock and a failed turn (never a silent run on someone else's key), and usage is handed to onTurnEnd with the account.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { EngineAgent, OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const account = (over: Partial<ResolvedAccount> = {}): ResolvedAccount => ({ ref: "#Dana_Anthropic", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "dana", reason: "starter", itemId: "vit_1", ...over });
const say = [{ type: "text" as const, text: "Hi." }, { type: "usage" as const, inputTokens: 10, outputTokens: 4 }, { type: "done" as const }];

test("the resolved account goes into the session spec, its payer is the asker, and onTurnEnd gets the turn with that account", async () => {
  const p = scriptedProvider({ script: () => say });
  const asked: unknown[] = [];
  const ended: Array<{ id: string; asker: string; tokens: number; ref: string | null }> = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession,
    resolveAccount: async (q) => { asked.push(q); return account({ payer: "sam", reason: "steerer" }); },
    onTurnEnd: (turn, acct) => { ended.push({ id: turn.id, asker: turn.asker, tokens: turn.tokensIn + turn.tokensOut, ref: acct?.ref ?? null }); },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.deepEqual(asked, [{ threadId: "T", agentId: "intake", askerId: "dana" }], "asked once, for the person who wrote");
  const turn = engine.turns("T")[0]!;
  assert.equal(turn.asker, "sam", "the account's payer pays");
  assert.deepEqual(ended, [{ id: turn.id, asker: "sam", tokens: 14, ref: "#Dana_Anthropic" }]);
  assert.equal(p.specs[0]?.account?.ref, "#Dana_Anthropic");
});

test("no account: no session is opened, the Unblock is raised once, the turn fails with no_account and the thread keeps working", async () => {
  const p = scriptedProvider({ script: () => say });
  let have = false;
  const unblocks: string[] = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession,
    resolveAccount: async () => (have ? account() : null),
    onNoAccount: (info) => { unblocks.push(`${info.agentId}:${info.asker}`); },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 0, "nothing ran");
  assert.deepEqual(engine.turns("T").map((t) => [t.state, t.error?.code]), [["failed", "no_account"]]);
  assert.deepEqual(unblocks, ["intake:dana"]);
  assert.equal(engine.messages("T").filter((m) => m.author.kind === "agent").length, 0, "no reply was invented");
  // the person adds a key and the host wakes the agent: the same thread now runs
  have = true;
  engine.wake("T", "intake");
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["failed", "completed"]);
  assert.equal(p.sessions.length, 1);
});

test("a resolver that is down is not 'no key': the turn fails with account_unavailable and no Unblock is raised; a failing onTurnEnd never fails the turn", async () => {
  const p = scriptedProvider({ script: () => say });
  const unblocks: string[] = [];
  let down = true;
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession,
    resolveAccount: async () => { if (down) throw new Error("engine is restarting"); return account(); },
    onNoAccount: () => { unblocks.push("x"); },
    onTurnEnd: () => { throw new Error("metering is down"); },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.state, t.error?.code]), [["failed", "account_unavailable"]]);
  assert.deepEqual(unblocks, []);
  down = false;
  engine.wake("T", "intake");
  await engine.idle("T");
  assert.equal(engine.turns("T")[1]?.state, "completed", "a metering error does not fail the turn");
});

test("without resolveAccount the engine keeps its own starter and steerer choice and the spec carries no account", async () => {
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.asker, "dana");
  assert.equal(p.specs[0]?.account, undefined);
  assert.equal(typeof p.specs[0]?.turnId, "string");
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
