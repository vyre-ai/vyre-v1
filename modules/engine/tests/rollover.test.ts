// Rollover has a caller (modules/engine/rollover.ts): at the end of a turn of an engine that keeps its own session, rolloverCheck decides, and the chat's compactor ends the session so the next turn starts
// a new one from the summary and the messages after it. Real SQLite behind ctx.db; the engine, the account and the chat module are stand-ins.
import test from "node:test";
import assert from "node:assert/strict";
import type { EngineSession, OpenSession, ResolvedAccount, StoredMessage } from "../../../agent/src/turn-engine/types.ts";
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import { lastCompaction, resumeId, saveCompaction, saveResumeId } from "../cli-sessions.ts";
import { createCompactor } from "../compact.ts";
import { createRoller } from "../rollover.ts";
import { harness, NOW } from "../fixtures/harness.ts";

const T = "thr_lease", A = "agt_intake";
const CLAUDE: ResolvedAccount = { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "usr_dana", reason: "starter" };
const API: ResolvedAccount = { ref: "#Team_Anthropic", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "usr_dana", reason: "starter" } as ResolvedAccount;
const msg = (seq: number, body: string): StoredMessage => ({ id: `msg_${seq}`, threadId: T, threadSeq: seq, author: { kind: "person", id: "usr_dana" }, mentions: [], depth: 0, body, at: NOW } as StoredMessage);

function rig(o: { account: ResolvedAccount; tokensIn: number; context?: number; queued?: boolean; turnsSince?: number }) {
  const h = harness();
  const posts: string[] = [];
  let dropped = 0;
  const turns = (): unknown[] => [
    { id: "trn_now", threadId: T, agentId: A, asker: "usr_dana", model: "claude-sonnet-5-5", state: "completed", traceId: "a".repeat(32), startedAt: NOW + 100_000, tokensIn: o.tokensIn, info: { tools: [], switches: [], ...((o.context ?? o.tokensIn) > 0 ? { contextTokens: o.context ?? o.tokensIn } : {}) } },
    ...Array.from({ length: o.turnsSince ?? 0 }, (_, i) => ({ id: `trn_${i}`, threadId: T, agentId: A, asker: "usr_dana", model: "claude-sonnet-5-5", state: "completed", traceId: "x", startedAt: NOW + 1_000 + i, tokensIn: 1000 })),
  ];
  const engine = {
    turns, agents: () => [{ id: A, name: "Intake", mode: "lead" as const, model: "claude-sonnet-5-5" }],
    messages: () => [msg(1, "Review the lease."), msg(2, "And the deposit?")],
    queue: () => (o.queued ? [{ state: "queued" }] : []),
  } as unknown as TurnEngine;
  const open: OpenSession = async () => ({ warm: true, async *send() { yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession);
  const compactor = createCompactor({
    db: h.db, engine: () => engine, open, now: () => NOW + 100_000, resolve: async () => o.account,
    dropSessions: async () => { dropped += 1; return 1; },
    postAs: async (_a, post) => { posts.push(String((post.blocks[0]?.data as { text?: unknown }).text)); return {}; },
    async call(c) {
      if (c === "chat.transcript.summarize") return {};
      if (c === "chat.transcript.summary") return { summary: "Asked (turn 1): review the lease" };
      if (c === "threads.get") return { thread: { mode: "auto", agents: [{ agentId: A, model: "sonnet" }] } };
      throw new Error(`unexpected ${c}`);
    },
  });
  const roller = createRoller({ db: h.db, engine: () => engine, compactor: () => compactor });
  // each turn's end tells the roller the account it ran on, as the runtime does
  const go = (): Promise<boolean> => { roller.ranOn("trn_now", o.account); return roller.afterTurn({ threadId: T, turnId: "trn_now", agentId: A }); };
  saveResumeId(h.db, { threadId: T, agentId: A, person: "usr_dana", driver: o.account.driver }, "7c1e", NOW);
  return { h, go, posts, dropped: () => dropped };
}

test("a Claude Code chat at 85% of its window rolls over: the session is forgotten and closed, a Vyre summary stands in, and the chat is told", async () => {
  const r = rig({ account: CLAUDE, tokensIn: 170_000 });
  assert.equal(await r.go(), true);
  assert.equal(resumeId(r.h.db, { threadId: T, agentId: A, person: "usr_dana", driver: "claude_code" }), null, "the next turn starts a new session");
  assert.equal(r.dropped(), 1);
  const c = lastCompaction(r.h.db, T, A)!;
  assert.equal(c.how, "vyre");
  assert.match(c.summary, /Asked \(turn 1\): review the lease/);
  assert.match(r.posts[0]!, /^Started a fresh session to keep the window from filling \(it was 85% full, at the threshold\)\./);
});

test("below the threshold, on an API engine, or soon after a roll, nothing happens", async () => {
  const low = rig({ account: CLAUDE, tokensIn: 90_000 });
  assert.equal(await low.go(), false);
  assert.equal(low.dropped(), 0);
  const api = rig({ account: API, tokensIn: 190_000 });
  assert.equal(await api.go(), false, "an API engine rebuilds its context from the chat every turn");
  const soon = rig({ account: CLAUDE, tokensIn: 170_000, turnsSince: 3 });
  saveCompaction(soon.h.db, { threadId: T, agentId: A, how: "vyre", upToSeq: 1, summary: "s", keep: "", used: 12_000, window: 200_000, at: NOW });
  assert.equal(await soon.go(), false, "one roll per ROLL.gap turns");
  assert.equal(soon.dropped(), 0);
});

test("a queued message holds the roll for a few turn boundaries, unless the window is nearly full", async () => {
  const r = rig({ account: CLAUDE, tokensIn: 170_000, queued: true });
  for (let i = 0; i < 3; i++) assert.equal(await r.go(), false, `boundary ${i + 1}: waiting for the queued message`);
  assert.equal(await r.go(), true, "it has waited long enough");
  const full = rig({ account: CLAUDE, tokensIn: 185_000, queued: true });
  assert.equal(await full.go(), true, "past 90% it rolls whatever is queued");
});

test("a turn's summed input is not the window: 1.0M tokens in over twenty calls of a 60k context does not roll", async () => {
  const r = rig({ account: CLAUDE, tokensIn: 1_000_000, context: 60_000 });
  assert.equal(await r.go(), false);
  assert.equal(r.dropped(), 0);
  // and one with no per-call figure (an older record) is estimated from the words said, never from the sum
  const none = rig({ account: CLAUDE, tokensIn: 1_000_000, context: 0 });
  assert.equal(await none.go(), false);
});

test("with no token report the roll comes from an estimate of the characters said", async () => {
  const r = rig({ account: CLAUDE, tokensIn: 0 });
  assert.equal(await r.go(), false, "a short chat is nowhere near full");
});
