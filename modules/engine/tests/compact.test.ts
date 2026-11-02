// engine.compact and what a chat keeps between engine sessions (lane l-sessions): the resume ids per chat, agent, person and engine; "Keep this every time"; the compactor's two paths (Claude Code
// compacts itself, Vyre compacts for the others and for a Claude Code session that is gone); every later turn after Vyre's compaction is sent the summary and only the messages after it; the meter.
// Real SQLite behind ctx.db; the engine session, the account and the chat module are stand-ins. New shapes are checked against the manifest itself (the generated registry is rebuilt by CI).
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/engine.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent, EngineSession, OpenSession, ResolvedAccount, StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import { forgetSessions, keepEvery, keepFor, keepsSession, lastCompaction, resumeId, saveCompaction, saveResumeId, setKeepEvery } from "../cli-sessions.ts";
import { compactLine, createCompactor, vyreSummary, withCompaction } from "../compact.ts";
import type { CompactRequest } from "../compact.ts";
import { compact } from "../handlers/compact.ts";
import { usageGet } from "../handlers/usage.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { codeOf, harness, NOW } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_lease", A = "agt_intake";
const cap = (name: string) => manifest.capabilities!.find((c) => c.name === name)!;
const evt = (name: string) => manifest.events!.find((e) => e.name === name)!;
const msg = (seq: number, body: string, who: "person" | "agent" = "person"): StoredMessage => ({ id: `msg_${seq}`, threadId: T, threadSeq: seq, author: { kind: who, id: who === "person" ? "usr_dana" : A }, mentions: [], depth: 0, body });
const CLAUDE: ResolvedAccount = { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "usr_dana", reason: "starter" };
const CODEX: ResolvedAccount = { ref: "#Dana_Codex", driver: "codex", provider: "openai", kind: "subscription", payer: "usr_dana", reason: "starter" };

test("resume ids are kept per chat, agent, person and engine; null and a compaction forget them; a session of no chat is never kept", () => {
  const h = harness();
  const k = { threadId: T, agentId: A, person: "usr_dana", driver: "claude_code" };
  assert.equal(resumeId(h.db, k), null);
  saveResumeId(h.db, k, "7c1e-aa", NOW);
  saveResumeId(h.db, { ...k, driver: "codex" }, "019a-bb", NOW);
  saveResumeId(h.db, { ...k, person: "usr_maya" }, "maya-cc", NOW);
  assert.equal(resumeId(h.db, k), "7c1e-aa");
  assert.equal(resumeId(h.db, { ...k, driver: "codex" }), "019a-bb");
  assert.equal(resumeId(h.db, { ...k, person: "usr_maya" }), "maya-cc", "two people in one chat never share an engine session");
  saveResumeId(h.db, k, "7c1e-dd", NOW + 1);
  assert.equal(resumeId(h.db, k), "7c1e-dd");
  saveResumeId(h.db, k, null, NOW + 2);
  assert.equal(resumeId(h.db, k), null);
  assert.equal(forgetSessions(h.db, T, A), 2);
  assert.equal(resumeId(h.db, { ...k, driver: "codex" }), null);
  assert.equal(keepsSession({ threadId: T }), true);
  assert.equal(keepsSession({ threadId: T, tools: "none" }), false, "an automation's AI step");
  assert.equal(keepsSession({ threadId: "oneshot_lz3" }), false, "a one-shot job");
});

test("Keep this every time is kept per chat and cleared by empty words; one compaction keeps its own words and the standing ones", () => {
  const h = harness();
  assert.equal(keepEvery(h.db, T), "");
  assert.equal(setKeepEvery(h.db, T, "  the lease dates ", "usr_dana", NOW), "the lease dates");
  assert.equal(keepEvery(h.db, T), "the lease dates");
  assert.equal(keepEvery(h.db, "thr_other"), "");
  assert.equal(keepFor("the open questions", "the lease dates"), "the open questions; the lease dates");
  assert.equal(keepFor("the lease dates", "the lease dates"), "the lease dates");
  assert.equal(keepFor(undefined, ""), "");
  setKeepEvery(h.db, T, "", "usr_dana", NOW);
  assert.equal(keepEvery(h.db, T), "");
});

test("Vyre's summary starts with what to keep, word for word, then the rolling summary and the latest messages; the line says what was kept and the context left", () => {
  const s = vyreSummary("the lease dates", "Asked (turn 1): review the lease", [msg(1, "Review the lease."), msg(2, "Done. It starts in May.", "agent"), msg(3, "")], (id) => (id === A ? "Intake" : "Dana"));
  assert.equal(s.split("\n")[0], "Keep this, as the person asked: the lease dates");
  assert.match(s, /In short:\nAsked \(turn 1\): review the lease/);
  assert.match(s, /The latest messages before the compaction:\nDana: Review the lease\.\nIntake: Done\. It starts in May\.$/);
  assert.doesNotMatch(vyreSummary("", "", [msg(1, "hi")]), /Keep this/);
  assert.equal(compactLine({ keep: "the lease dates", used: 14_200, window: 200_000 }), "Compacted. Kept: the lease dates. Context now about 14k of 200k tokens.");
  assert.equal(compactLine({ keep: "", used: null, window: null }), "Compacted.");
});

/** A fake of what the compactor reaches: the engine (agents, messages), the chat module (the rolling summary) and the chat line. */
function rig(o: { account: ResolvedAccount | null; events?: DriverEvent[]; messages?: StoredMessage[]; model?: string }) {
  const h = harness();
  const opened: Array<{ spec: unknown; inputs: TurnInput[]; closed: boolean; cancelled: boolean }> = [];
  const posts: Array<{ agentId: string; text: string }> = [];
  const calls: string[] = [];
  let dropped = 0;
  const engine = {
    agents: () => [{ id: A, name: "Intake", mode: "lead" as const, model: o.model ?? "claude-sonnet-5-5" }],
    messages: () => o.messages ?? [msg(1, "Review the lease."), msg(2, "It starts in May.", "agent"), msg(3, "And the deposit?")],
  } as unknown as TurnEngine;
  const open: OpenSession = async (spec) => {
    const rec = { spec, inputs: [] as TurnInput[], closed: false, cancelled: false };
    opened.push(rec);
    return {
      warm: true,
      async *send(input: TurnInput) { rec.inputs.push(input); for (const e of o.events ?? [{ type: "done" }]) yield e; },
      sendToolResult() {}, inject() {}, async cancel() { rec.cancelled = true; }, async close() { rec.closed = true; },
    } as EngineSession;
  };
  const compactor = createCompactor({
    db: h.db, engine: () => engine, open, now: () => NOW, resolve: async () => o.account,
    dropSessions: async () => { dropped += 1; return 1; },
    postAs: async (agentId, post) => { posts.push({ agentId, text: String((post.blocks[0]?.data as { text?: unknown }).text) }); return {}; },
    async call(c) {
      calls.push(c);
      if (c === "chat.transcript.summarize") return { upToIdx: 0 };
      if (c === "chat.transcript.summary") return { summary: "Asked (turn 1): review the lease" };
      if (c === "threads.get") return { thread: { mode: "auto", agents: [{ agentId: A, model: o.model ?? "sonnet", effort: "high" }] } };
      throw new Error(`unexpected ${c}`);
    },
  });
  const req: CompactRequest = { threadId: T, agentId: A, asker: "usr_dana", keep: "the lease dates", traceId: "a".repeat(32) };
  return { h, compactor, req, opened, posts, calls, dropped: () => dropped };
}

test("Claude Code compacts itself: the chat's own session is sent the compact with what to keep, and the line carries the context it reported", async () => {
  const r = rig({ account: CLAUDE, events: [{ type: "block", kind: "compacted", payload: { before: 91_000, after: 5_100 } }, { type: "usage", inputTokens: 91_000, outputTokens: 800 }, { type: "done" }] });
  const out = await r.compactor.run(r.req);
  assert.deepEqual([out.engine, out.how, out.fellBack], ["claude_code", "engine", false]);
  assert.equal(out.line, "Compacted. Kept: the lease dates. Context now about 5k of 200k tokens.");
  assert.deepEqual(out.context, { used: 5_100, window: 200_000 });
  assert.equal(r.opened.length, 1);
  const spec = r.opened[0]!.spec as { account?: { driver?: string }; mode?: string; agent: { model?: string; effort?: string } };
  assert.deepEqual([spec.account?.driver, spec.mode, spec.agent.model, spec.agent.effort], ["claude_code", "auto", "sonnet", "high"], "the chat's own settings, so the pool hands the chat's own session");
  assert.deepEqual(r.opened[0]!.inputs[0]?.compact, { keep: "the lease dates" });
  assert.equal(r.opened[0]!.closed, true);
  assert.equal(r.opened[0]!.cancelled, false, "given back warm: it now holds the compacted context");
  assert.equal(r.dropped(), 1, "an older warm process of the chat is closed first");
  assert.deepEqual(r.posts, [{ agentId: A, text: out.line }]);
  const c = lastCompaction(r.h.db, T, A);
  assert.deepEqual([c?.how, c?.used, c?.window, c?.keep], ["engine", 5_100, 200_000, "the lease dates"]);
});

for (const code of ["engine.nothing_to_compact", "engine.session_gone"]) {
  test(`Claude Code with ${code} falls back to Vyre's summary, and the line says so`, async () => {
    const r = rig({ account: CLAUDE, events: [{ type: "error", code, message: "x" }] });
    saveResumeId(r.h.db, { threadId: T, agentId: A, person: "usr_dana", driver: "claude_code" }, "7c1e", NOW);
    const out = await r.compactor.run(r.req);
    assert.deepEqual([out.how, out.fellBack], ["vyre", true]);
    assert.match(out.line, code === "engine.session_gone" ? /Claude Code no longer had this chat's session, so Vyre compacted it from the chat's summary\.$/ : /Claude Code had nothing of this chat yet/);
    assert.match(out.line, /^Compacted\. Kept: the lease dates\. Context now about \d+k of 200k tokens\./);
    assert.equal(r.opened[0]!.cancelled, code !== "engine.nothing_to_compact");
    assert.equal(resumeId(r.h.db, { threadId: T, agentId: A, person: "usr_dana", driver: "claude_code" }), null, "the engine session is forgotten: the next turn starts from the summary");
    assert.equal(r.posts.length, 1);
  });
}

test("Codex compacts through Vyre: no engine session is opened, the summary carries what to keep, the engine sessions are forgotten and the warm ones closed", async () => {
  const r = rig({ account: CODEX, model: "gpt-5-codex" });
  saveResumeId(r.h.db, { threadId: T, agentId: A, person: "usr_dana", driver: "codex" }, "019a", NOW);
  const out = await r.compactor.run(r.req);
  assert.deepEqual([out.engine, out.how, out.fellBack], ["codex", "vyre", false]);
  assert.equal(r.opened.length, 0);
  assert.deepEqual(r.calls.filter((c) => c.startsWith("chat.")), ["chat.transcript.summarize", "chat.transcript.summary"]);
  const c = lastCompaction(r.h.db, T, A)!;
  assert.equal(c.how, "vyre");
  assert.equal(c.upToSeq, 3);
  assert.match(c.summary, /^Keep this, as the person asked: the lease dates\n\nIn short:\nAsked \(turn 1\): review the lease\n\nThe latest messages before the compaction:\nPerson: Review the lease\.\nIntake: It starts in May\.\nPerson: And the deposit\?$/);
  assert.equal(c.window, 258_400);
  assert.ok(c.used !== null && c.used > 12_000 && c.used < 13_000, "the summary and what the agent's prompt holds");
  assert.equal(resumeId(r.h.db, { threadId: T, agentId: A, person: "usr_dana", driver: "codex" }), null);
  assert.equal(r.dropped(), 1);
  assert.equal(r.posts[0]?.text, out.line);
});

test("after Vyre's compaction every turn is sent the summary and only the messages after it, with the chat's keep text; the engine's own compaction changes nothing", async () => {
  const h = harness();
  const seen: TurnInput[] = [];
  const inner: OpenSession = async () => ({ warm: true, async *send(i: TurnInput) { seen.push(i); yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession);
  const open = withCompaction(inner, h.db);
  const spec = { threadId: T, agent: { id: A, mode: "lead" as const }, asker: "usr_dana", turnId: "t", traceId: "x" };
  const input = (): TurnInput => ({
    threadId: T, turnId: "t", agent: { id: A, mode: "lead" }, trigger: msg(7, "next"), history: [msg(4, "a"), msg(5, "b"), msg(6, "c"), msg(7, "next")], listeners: [], asker: "usr_dana",
    context: { names: {}, keepHistory: 20, sections: [{ id: "identity", stable: true, text: "You are Intake." }, { id: "earlier", stable: false, text: "rolling" }] },
  });
  const send = async (i: TurnInput): Promise<TurnInput> => { const s = await open(spec); for await (const _ of s.send(i)) { /* drain */ } return seen.at(-1)!; };

  let got = await send(input());
  assert.deepEqual(got.history.map((m) => m.threadSeq), [4, 5, 6, 7], "no compaction: as it was");
  assert.equal(got.keep, undefined);

  setKeepEvery(h.db, T, "the lease dates", "usr_dana", NOW);
  saveCompaction(h.db, { threadId: T, agentId: A, how: "vyre", upToSeq: 5, summary: "Keep this, as the person asked: the lease dates\n\nIn short: ...", keep: "the lease dates", used: 13_000, window: 200_000, at: NOW });
  got = await send(input());
  assert.deepEqual(got.history.map((m) => m.threadSeq), [6, 7]);
  assert.equal(got.keep, "the lease dates", "for the engine's own automatic compaction");
  assert.deepEqual(got.context?.sections.map((s) => s.id), ["identity", "compacted"], "the rolling summary is left out while every message after the compaction is shown");
  assert.match(got.context!.sections.find((s) => s.id === "compacted")!.text, /^Keep this, as the person asked: the lease dates/);
  assert.equal(got.context!.sections.find((s) => s.id === "compacted")!.once, true, "a resumed CLI session is sent it once");

  const bare = input();
  delete (bare as { context?: unknown }).context;
  got = await send(bare);
  assert.deepEqual(got.context?.sections.map((s) => s.id), ["compacted"], "a turn whose context could not be built still gets the summary");

  const compactTurn = { ...input(), compact: { keep: "x" } };
  got = await send(compactTurn);
  assert.equal(got, compactTurn, "a compact turn passes through untouched");

  saveCompaction(h.db, { threadId: T, agentId: A, how: "engine", upToSeq: 6, summary: "", keep: "", used: 5_000, window: 200_000, at: NOW + 1 });
  got = await send(input());
  assert.deepEqual(got.history.map((m) => m.threadSeq), [4, 5, 6, 7], "Claude Code holds its own summary");
});

test("engine.compact: the lead's chat is compacted with its words and the standing ones, Keep this every time is kept or cleared, and the answer and event match the manifest", async () => {
  const h = harness({ threads: [{ threadId: T, agents: [{ agentId: A, mode: "lead", model: "claude-sonnet-5-5" }] }] });
  h.runtime({ openSession: scriptedProvider({ script: [{ type: "done" }] }).openSession, schedule: () => () => {} });
  const asked: CompactRequest[] = [];
  const worker = { run: async (req: CompactRequest) => { asked.push(req); return { engine: "codex", how: "vyre" as const, line: "Compacted.", context: { used: 13_000, window: 258_400 }, fellBack: false }; } };

  const first = await compact(h.ctx, { threadId: T, keep: "the lease dates", always: true }, worker);
  assert.deepEqual(validate(cap("engine.compact").output, first, "", {}), []);
  assert.equal(first.keepEvery, "the lease dates");
  assert.deepEqual([asked[0]?.agentId, asked[0]?.asker, asked[0]?.keep], [A, "usr_dana", "the lease dates"]);

  const second = await compact(h.ctx, { threadId: T, keep: "the deposit" }, worker);
  assert.equal(asked[1]?.keep, "the deposit; the lease dates", "every compaction keeps the standing words");
  assert.equal(second.keepEvery, "the lease dates", "not ticked: left as it is");

  await compact(h.ctx, { threadId: T, always: true }, worker);
  assert.equal(keepEvery(h.db, T), "", "ticked with no words clears it");
  assert.equal(asked[2]?.keep, "");

  const ev = h.named("turn.compacted");
  assert.equal(ev.length, 3);
  for (const e of ev) assert.deepEqual(validate(evt("turn.compacted").payload, e.payload, "", {}), []);
  assert.deepEqual(ev[0]?.payload, { threadId: T, agentId: A, engine: "codex", how: "vyre", kept: true, used: 13_000, window: 258_400, by: "usr_dana" });
  assert.deepEqual(validate(cap("engine.compact").input, { threadId: T, keep: "x", always: true, idempotencyKey: "k1" }, "", {}), [], "what the composer sends");

  await assert.rejects(compact(h.ctx, { threadId: T, agentId: "agt_nobody" }, worker), (e) => codeOf(e) === "validation.not_found");
});

test("the meter shows what a compaction left until a later turn says otherwise, and the chat's standing keep words come with it", async () => {
  const h = harness({ threads: [{ threadId: T, agents: [{ agentId: A, mode: "lead", model: "claude-sonnet-5-5" }] }] });
  ensureExtra(h.db);
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(c, input) {
      if (c === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", title: "Claude Code", mine: true, status: "ok" }] };
      if (c === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true };
      return h.ctx.call(c, input);
    },
  };
  const turn = (n: number, tokensIn: number, at: number): void => {
    h.db.run(`INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, `trn_m${n}`, T, A, "usr_dana", "#Dana_Claude", "claude_code", "claude-sonnet-5-5", "host", "completed", "0".repeat(32), null, n, at, at + 5, tokensIn, 10, 0, null, null);
  };
  turn(1, 150_000, NOW - 10_000);
  saveCompaction(h.db, { threadId: T, agentId: A, how: "engine", upToSeq: 3, summary: "", keep: "", used: 6_000, window: 200_000, at: NOW - 5_000 });
  setKeepEvery(h.db, T, "the lease dates", "usr_dana", NOW);
  let out = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual(out.context, { used: 6_000, window: 200_000 });
  assert.equal(out.keepEvery, "the lease dates");
  assert.deepEqual(validate(cap("engine.usage.get").output, out, "", {}), []);
  turn(2, 9_000, NOW - 1_000);
  out = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual(out.context, { used: 9_000, window: 200_000 }, "the next turn's own figure wins");
});
