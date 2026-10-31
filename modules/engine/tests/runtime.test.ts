// The engine runtime on a daemon (P-L2_23): built on first use from the host half, a turn resolves its account through engine.account.resolve, a turn with no account raises one
// Unblock and wakes again when it is answered, usage goes to engine.turn.record_usage with the Vault item, and a thread a dead host left mid-turn is recovered at boot.
// @reads /modules/engine/migrations/0001_init.sql
// @reads /modules/engine/migrations/0003_unblock.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, consumers, hostSeams } from "../impl.ts";
import { ensureRuntime, wakeAfterUnblock } from "../runtime.ts";
import { boundEngine, bindEngine, sqlMessages, sqlQueue } from "../projections.ts";
import { harness, openRaw } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_est";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];
const say: DriverEvent[] = [{ type: "text", text: "Hello." }, { type: "usage", inputTokens: 10, outputTokens: 4 }, { type: "done" }];

interface Fake { calls: Array<{ cap: string; input: Record<string, unknown>; as: string | undefined }>; haveKey: boolean; accountsDown: boolean }
function hostFor(p: ReturnType<typeof scriptedProvider>, f: Fake): EngineHostSeam {
  return {
    holder: "host:spc_enginetest", openSession: p.openSession, now: () => 1_760_000_000_000,
    async call(cap, input, as) {
      const body = input as Record<string, unknown>;
      f.calls.push({ cap, input: body, as });
      if (cap === "engine.account.resolve") {
        if (f.accountsDown) throw new Error("down");
        return f.haveKey ? { accountRef: "#Dana_Anthropic", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" } : { accountRef: null, payer: null, reason: "none", allowed: false };
      }
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Anthropic", driver: "claude_code", kind: "subscription", status: "ok" }] };
      if (cap === "tasks.create") return { task: { id: "tsk_unblock1" } };
      if (cap === "engine.turn.record_usage") return {};
      throw new Error(`unexpected ${cap}`);
    },
  };
}

test("a daemon without the host half leaves the engine unbound; with it, the first call builds and binds the runtime once", async () => {
  bindEngine(null);
  const h = harness({ threads: THREADS });
  assert.equal(await ensureRuntime(h.ctx), null);
  assert.throws(() => boundEngine(h.ctx), (e) => (e as { error?: { code?: string } }).error?.code === "internal.unavailable");
  const f: Fake = { calls: [], haveKey: true, accountsDown: false };
  hostSeams.setEngineHost(hostFor(scriptedProvider({ script: say }), f));
  const a = await ensureRuntime(h.ctx);
  assert.ok(a);
  assert.equal(await ensureRuntime(h.ctx), a, "built once");
  assert.equal(boundEngine(h.ctx), a);
  hostSeams.setEngineHost(null);
  assert.throws(() => boundEngine(h.ctx));
});

test("a turn runs on the account engine.account.resolve names, for the payer, and its usage is metered against the Vault item", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: true, accountsDown: false };
  hostSeams.setEngineHost(hostFor(p, f));
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);   // opens the thread through threads.get
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
  await engine.idle(THREAD);
  assert.deepEqual(f.calls.filter((c) => c.cap === "engine.account.resolve").map((c) => [c.input.threadId, c.input.agentId, c.input.askerId, c.as]), [[THREAD, "agt_intake", "usr_dana", "usr_dana"]]);
  assert.equal(p.specs[0]?.account?.ref, "#Dana_Anthropic");
  assert.deepEqual([p.specs[0]?.account?.driver, p.specs[0]?.account?.provider, p.specs[0]?.account?.itemId], ["claude_code", "anthropic", "vit_aaaaaaaaaaaa"]);
  const usage = f.calls.filter((c) => c.cap === "engine.turn.record_usage");
  assert.equal(usage.length, 1);
  assert.deepEqual([usage[0]!.input.tokensIn, usage[0]!.input.tokensOut, usage[0]!.input.itemId, usage[0]!.as], [10, 4, "vit_aaaaaaaaaaaa", "usr_dana"]);
  hostSeams.setEngineHost(null);
});

test("no account in a chat: no session, no Unblock task (the chat says so inline), and the turn ends failed with no_account", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: false, accountsDown: false };
  hostSeams.setEngineHost(hostFor(p, f));
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
  const codes: string[] = [];
  engine.subscribe((e) => { if (e.type === "turn.failed") codes.push(e.code); });
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello again" });
  await engine.idle(THREAD);
  assert.equal(p.sessions.length, 0);
  assert.deepEqual(codes, ["no_account", "no_account"], "every message ends failed with no_account so the inline line shows");
  assert.equal(f.calls.filter((c) => c.cap === "tasks.create").length, 0, "no task per failed message");
  assert.equal(h.rows("SELECT * FROM engine_unblock").length, 0);
  hostSeams.setEngineHost(null);
});

const WATCH_THREADS = [{ threadId: THREAD, kind: "channel", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "listen" as const, watches: true }] }];

test("no account on an unattended (watching) turn: one Unblock per person, however many messages, and when it is done the agent wakes and answers", async () => {
  const h = harness({ threads: WATCH_THREADS });
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: false, accountsDown: false };
  hostSeams.setEngineHost(hostFor(p, f));
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "one" });
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "two" });
  await engine.idle(THREAD);
  assert.equal(p.sessions.length, 0);
  const made = f.calls.filter((c) => c.cap === "tasks.create");
  assert.ok(made.length >= 1);
  assert.ok(made.every((c) => c.input.idempotencyKey === "no-account:usr_dana"), "de-duplicated by person: the same key every run");
  assert.deepEqual([made[0]!.input.kind, made[0]!.input.assigned, made[0]!.as], ["unblock", { kind: "person", id: "usr_dana" }, "usr_dana"]);
  assert.deepEqual(h.rows("SELECT task_id FROM engine_unblock"), [{ task_id: "tsk_unblock1" }]);
  f.haveKey = true;
  assert.deepEqual(await consumers["engine.unblock"].run(h.ctx as never, { payload: { taskId: "tsk_unblock1" } }), ["tsk_unblock1"]);
  await engine.idle(THREAD);
  assert.equal(p.sessions.length, 1, "the agent ran");
  assert.equal(h.rows("SELECT * FROM engine_unblock").length, 0);
  assert.equal(await wakeAfterUnblock(h.ctx, "tsk_other"), false, "a task that was not an Unblock of ours wakes nothing");
  hostSeams.setEngineHost(null);
});

test("an open no-account task (either title) closes by itself once its person has a working AI account; a person without one keeps theirs", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: true, accountsDown: false };
  const open: Array<{ id: string; title: string; assigned: { kind: string; id: string } }> = [];
  const later = [
    { id: "tsk_a", title: "Connect an AI account", assigned: { kind: "person", id: "usr_dana" } },
    { id: "tsk_b", title: "Add a key so your agent can answer", assigned: { kind: "person", id: "usr_dana" } },
    { id: "tsk_c", title: "Connect an AI account", assigned: { kind: "person", id: "usr_noah" } },
    { id: "tsk_d", title: "Review the filing", assigned: { kind: "person", id: "usr_dana" } },
  ];
  const base = hostFor(p, f);
  hostSeams.setEngineHost({
    ...base,
    async call(cap, input, as) {
      if (cap === "tasks.list") { f.calls.push({ cap, input: input as Record<string, unknown>, as }); return { tasks: open }; }
      if (cap === "tasks.transition") { f.calls.push({ cap, input: input as Record<string, unknown>, as }); return {}; }
      if (cap === "engine.accounts.list" && as === "usr_noah") return { accounts: [] };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Anthropic", driver: "claude_code", kind: "subscription", status: "ok" }] };
      return base.call(cap, input, as);
    },
  });
  await ensureRuntime(h.ctx);
  await new Promise((r) => setTimeout(r, 20));   // the boot sweep ran against an empty list
  open.push(...later);
  h.ctx.db.run("INSERT INTO engine_unblock (task_id, thread_id, agent_id, asker, at) VALUES ('tsk_a', ?, 'agt_intake', 'usr_dana', 1)", THREAD);
  const closed = await consumers["engine.no_account_sweep"].run(h.ctx as never);
  assert.deepEqual(closed, ["tsk_a", "tsk_b"]);
  const moves = f.calls.filter((c) => c.cap === "tasks.transition");
  assert.deepEqual(moves.map((c) => [c.input.taskId, c.input.to, c.as]), [["tsk_a", "canceled", "usr_dana"], ["tsk_b", "canceled", "usr_dana"]]);
  assert.equal(h.rows("SELECT * FROM engine_unblock").length, 0, "the wake row goes with the task");
  hostSeams.setEngineHost(null);
});

test("a thread a dead host left with queued work is opened and run when the runtime is built", async () => {
  const raw = openRaw();
  const a = harness({ raw, threads: THREADS });
  // the dead host stored a message and queued the turn, then died
  const msg = sqlMessages(a.db, () => a.clock.t).append({ id: "msg_dead1", threadId: THREAD, author: { kind: "person", id: "usr_dana" }, mentions: [], depth: 0, body: "hello", at: a.clock.t } as never);
  sqlQueue(a.db).enqueue({ threadId: THREAD, kind: "message", messageId: msg.id, agentId: "agt_intake", from: "usr_dana", priority: 1, enqueuedAt: a.clock.t, routine: false, steer: false });
  const b = harness({ raw, threads: THREADS });
  bindEngine(null);
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: true, accountsDown: false };
  hostSeams.setEngineHost(hostFor(p, f));
  const engine = (await ensureRuntime(b.ctx))!;
  await engine.idle(THREAD);
  assert.equal(p.sessions.length, 1, "the queued turn ran on the new host");
  assert.deepEqual(engine.turns(THREAD).map((t) => t.state), ["completed"]);
  hostSeams.setEngineHost(null);
});
test("with postAs the chat bridge is attached: the agent's reply is posted to the chat by the agent, once, under the id the engine gave it", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  const f: Fake = { calls: [], haveKey: true, accountsDown: false };
  const posts: Array<{ agentId: string; threadId: string; body: string; clientId: string }> = [];
  hostSeams.setEngineHost({ ...hostFor(p, f), postAs: async (agentId, post) => { posts.push({ agentId, threadId: post.threadId, body: post.body, clientId: post.clientId }); return {}; } });
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
  await engine.idle(THREAD);
  await until(() => posts.length > 0);
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0]!.agentId, posts[0]!.threadId, posts[0]!.body], ["agt_intake", THREAD, "Hello."]);
  assert.equal(posts[0]!.clientId, engine.messages(THREAD).filter((m) => m.author.kind === "agent")[0]!.id, "the chat message id is the engine message id");
  hostSeams.setEngineHost(null);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
