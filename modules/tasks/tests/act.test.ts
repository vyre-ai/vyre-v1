// tasks.act with a device-bound approval token, and stuck-task detection.
// Handlers run on an in-memory repo. CI executes this file; the SQL text is checked against the module table guard.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { checkSql } from "../../../host/src/ctx/db.ts";
import {
  STUCK_IDLE_MS,
  approvalHash,
  approvalKey,
  detectStuck,
  mintDeviceToken,
  stuckReason,
  walkDelegates,
} from "../handlers/act.ts";
import { createHandlers } from "../handlers/index.ts";
import type { HistoryRow, Repo } from "../handlers/index.ts";
import { DEFAULT_POLICY, utcDayStart } from "../handlers/state.ts";
import type { Party, Policy, TaskRecord, TaskSource } from "../handlers/state.ts";
import { SQL, handlers as liveHandlers, projections as liveProjections } from "../impl.ts";
import { inline } from "../projections.ts";

const NOW = 1_760_000_000_000;
const TRACE = { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" };

const CAPABILITIES = [
  "tasks.act",
  "tasks.assign",
  "tasks.count_needs_you",
  "tasks.create",
  "tasks.delegate",
  "tasks.dependencies.add",
  "tasks.dependencies.remove",
  "tasks.escalate",
  "tasks.followers.add",
  "tasks.followers.remove",
  "tasks.get",
  "tasks.history",
  "tasks.links.add",
  "tasks.links.remove",
  "tasks.list",
  "tasks.my_work",
  "tasks.needs_you",
  "tasks.release",
  "tasks.snooze",
  "tasks.take",
  "tasks.transition",
  "tasks.update",
  "tasks.withdraw",
  "tasks.working_notes.delete",
  "tasks.working_notes.set",
];

interface Memory extends Repo {
  setChain(from: Party, to: Party): void;
  setGrant(source: TaskSource, party: Party, allow: boolean): void;
}

function memoryRepo(policy: Policy = DEFAULT_POLICY): Memory {
  const rows = new Map<string, TaskRecord>();
  const hist: HistoryRow[] = [];
  const idem = new Map<string, string>();
  const chain = new Map<string, Party>();
  const grants = new Map<string, boolean>();
  const partyKey = (party: Party): string => `${party.kind}:${party.id}`;
  return {
    load(id) {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    },
    save(row) {
      rows.set(row.id, structuredClone(row));
    },
    all() {
      return [...rows.values()].map((row) => structuredClone(row));
    },
    history(taskId) {
      return hist.filter((row) => row.taskId === taskId).map((row) => structuredClone(row));
    },
    addHistory(row) {
      hist.push(structuredClone(row));
    },
    policy() {
      return policy;
    },
    idemGet(key) {
      return idem.get(key) ?? null;
    },
    idemPut(key, taskId) {
      idem.set(key, taskId);
    },
    delegateNext(party) {
      return chain.get(partyKey(party)) ?? null;
    },
    sourceGrant(source, party) {
      const value = grants.get(`${source.kind}:${source.id}:${party.kind}:${party.id}`);
      return value === undefined ? null : value;
    },
    setChain(from, to) {
      chain.set(partyKey(from), to);
    },
    setGrant(source, party, allow) {
      grants.set(`${source.kind}:${source.id}:${party.kind}:${party.id}`, allow);
    },
  };
}

function harness(policy: Policy = DEFAULT_POLICY) {
  const repo = memoryRepo(policy);
  const handlers = createHandlers(() => repo);
  const events: { name: string; payload: unknown }[] = [];
  let seq = 0;
  function ctx(id: string, opts?: { kind?: Ctx["principal"]["kind"]; device?: string }): Ctx {
    const kind = opts?.kind ?? "person";
    const base: Ctx = {
      space: "spc_1",
      principal: { kind, id },
      trace: TRACE,
      origin: "user",
      depth: 0,
      now: () => NOW,
      db: { all: () => [], run: () => ({ changes: 0 }) },
      emit(name, _subject, payload) {
        seq += 1;
        events.push({ name, payload });
        return {
          seq,
          id: `evt_${seq}`,
          type: name,
          sv: 1,
          hlc: "1:0",
          at: NOW,
          traceId: TRACE.traceId,
          spanId: TRACE.spanId,
          actor: id,
          depth: 0,
          label: 0,
          vis: "participants",
          enc: 0,
          payload,
        };
      },
      call: async () => {
        throw new Error("tasks does not call out");
      },
      authorize: () => ({ effect: "allow", reason: "ok", decisionId: "dec_test" }),
      vault: { fill: async () => {}, use: (handle) => ({ handle }) },
      http: async () => ({ status: 200, text: async () => "" }),
      log: { debug() {}, info() {}, warn() {}, error() {} },
      schedule: async () => "sch_test",
      seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "" }), unseal: () => new Uint8Array() },
    };
    if (opts?.device !== undefined) base.device = opts.device;
    return base;
  }
  return { repo, handlers, ctx, events };
}

function must(repo: Memory, id: string): TaskRecord {
  const row = repo.load(id);
  if (!row) throw new Error(`missing ${id}`);
  return row;
}

async function rejects(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof VyreErr);
    assert.equal(err.error.code, code);
    return true;
  });
}

function tokenEdits(token: string): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  edits.approvalToken = token;
  return edits;
}

function sqlStatements(file: string): string[] {
  return file.split(";").map((part) => part.trim()).filter((part) => part.length > 0);
}

const ASSIGNED: Party = { kind: "agent", id: "agt_worker" };
const APPROVER: Party = { kind: "person", id: "usr_approver" };

test("the live entry exposes the same 25 capabilities, and every statement stays on tasks_ tables", () => {
  const { handlers } = harness();
  assert.deepEqual(Object.keys(handlers).sort(), CAPABILITIES);
  assert.deepEqual(Object.keys(liveHandlers).sort(), CAPABILITIES);
  assert.equal(liveProjections.inline, inline);
  for (const sql of Object.values(SQL)) {
    assert.equal(sql.includes(";"), false);
    const found = checkSql("tasks", sql);
    if (!found.ok) assert.fail(`${found.why}: ${sql}`);
  }
  const migration = readFileSync(fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)), "utf8");
  assert.equal(migration.includes("tasks_meta"), false);
  const statements = sqlStatements(migration);
  assert.ok(statements.some((statement) => statement.includes("tasks_item")));
  for (const statement of statements) {
    const found = checkSql("tasks", statement);
    if (!found.ok) assert.fail(`${found.why}: ${statement}`);
  }
});

test("inline reducers mirror a transition and a send-back onto tasks_item", () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db = {
    run(sql: string, ...args: unknown[]) {
      calls.push({ sql, args });
      return { changes: 1 };
    },
  };
  inline["task.transitioned"](db, { payload: { taskId: "tsk_1", to: "doing" } }, 50);
  inline["task.sent_back"](db, { payload: { taskId: "tsk_1", reviewLoops: 2 } }, 60);
  const first = calls[0];
  const second = calls[1];
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.args, ["doing", 50, "doing", "tsk_1"]);
  assert.deepEqual(second.args, ["doing", 60, "doing", 2, "tsk_1"]);
  for (const call of calls) {
    const found = checkSql("tasks", call.sql);
    if (!found.ok) assert.fail(found.why);
  }
  assert.deepEqual(liveProjections.consumers, {});
});

test("create keeps the approval hash, replays an idempotency key, and refuses a shared slot", async () => {
  const h = harness();
  const input = {
    kind: "approve" as const,
    title: "Ship it",
    blocks: [],
    assigned: ASSIGNED,
    approver: APPROVER,
    idempotencyKey: "idem_ship",
  };
  const created = await h.handlers["tasks.create"](h.ctx("usr_maker"), input);
  assert.equal(created.task.kind, "approve");
  assert.equal(created.task.state, "awaiting_approval");
  assert.equal(created.task.blocked, false);
  assert.equal(created.task.id.startsWith("tsk_"), true);
  assert.equal("payloadHash" in created.task, false);
  assert.equal("decisionId" in created.task, false);
  const stored = must(h.repo, created.task.id);
  const expected = approvalHash("spc_1", { kind: "approve", title: "Ship it", blocks: [], assigned: ASSIGNED, source: null });
  assert.equal(stored.payloadHash, expected);
  assert.equal(stored.decisionId?.startsWith("dec_"), true);
  const before = h.events.length;
  const again = await h.handlers["tasks.create"](h.ctx("usr_maker"), input);
  assert.equal(again.task.id, created.task.id);
  assert.equal(h.events.length, before);
  const history = await h.handlers["tasks.history"](h.ctx("usr_maker"), { taskId: created.task.id });
  const types = history.entries.map((entry) => entry.type);
  assert.ok(types.includes("task.created"));
  assert.ok(types.includes("task.requested"));
  assert.ok(types.includes("task.assigned"));

  await rejects(() => h.handlers["tasks.create"](h.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    assigned: { kind: "person", id: "usr_a" },
    approver: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_self",
  }), "validation.precondition_failed");

  const floor = harness({ reviewLoopLimit: 2, allowSelfReview: false, requireHumanApprover: true });
  await rejects(() => floor.handlers["tasks.create"](floor.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    assigned: ASSIGNED,
    approver: { kind: "agent", id: "agt_boss" },
    idempotencyKey: "idem_floor",
  }), "validation.precondition_failed");
  const allowed = await floor.handlers["tasks.create"](floor.ctx("usr_maker"), input);
  assert.equal(allowed.task.state, "awaiting_approval");
});

test("tasks.act checks a device-bound token and does not fall through when it is bad", async () => {
  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    blocks: [],
    assigned: ASSIGNED,
    approver: APPROVER,
    idempotencyKey: "idem_token",
  });
  const id = created.task.id;
  const hash = must(h.repo, id).payloadHash;
  if (!hash) throw new Error("missing hash");
  const key = approvalKey("spc_1");
  const token = mintDeviceToken(key, { taskId: id, deviceId: "dev_phone", payloadHash: hash, exp: NOW + 60_000 });
  const act = (idWho: string, device: string | undefined, approvalToken: string) => h.handlers["tasks.act"](
    device === undefined ? h.ctx(idWho) : h.ctx(idWho, { device }),
    { taskId: id, action: "approve", edits: tokenEdits(approvalToken) },
  );

  await rejects(() => act("usr_approver", "dev_phone", mintDeviceToken(key, { taskId: id, deviceId: "dev_other", payloadHash: hash, exp: NOW + 60_000 })), "validation.precondition_failed");
  await rejects(() => act("usr_approver", "dev_phone", mintDeviceToken(key, { taskId: id, deviceId: "dev_phone", payloadHash: hash, exp: NOW })), "permission.expired");
  await rejects(() => act("usr_approver", "dev_phone", mintDeviceToken(key, { taskId: id, deviceId: "dev_phone", payloadHash: hash, exp: NOW - 1 })), "permission.expired");
  const head = token[0];
  if (head === undefined) throw new Error("empty token");
  await rejects(() => act("usr_approver", "dev_phone", `${head === "A" ? "B" : "A"}${token.slice(1)}`), "validation.precondition_failed");
  await rejects(() => act("usr_approver", "dev_phone", mintDeviceToken(key, { taskId: "tsk_other", deviceId: "dev_phone", payloadHash: hash, exp: NOW + 60_000 })), "validation.precondition_failed");
  await rejects(() => act("usr_approver", "dev_phone", mintDeviceToken(key, { taskId: id, deviceId: "dev_phone", payloadHash: "not-the-hash", exp: NOW + 60_000 })), "validation.precondition_failed");
  await rejects(() => act("usr_approver", undefined, token), "validation.precondition_failed");
  await rejects(() => act("usr_stranger", "dev_phone", token), "validation.precondition_failed");
  assert.equal(must(h.repo, id).state, "awaiting_approval");
  assert.equal(must(h.repo, id).version, 1);

  const from = h.events.length;
  const done = await act("usr_approver", "dev_phone", token);
  assert.equal(done.task.state, "done");
  assert.equal(done.task.blocked, false);
  assert.deepEqual(done.result, { action: "approve" });
  const names = h.events.slice(from).map((event) => event.name);
  assert.ok(names.includes("task.transitioned"));
  assert.ok(names.includes("task.approved"));
  assert.ok(names.includes("task.completed"));
  assert.equal(must(h.repo, id).version, 2);
});

test("a session act with no token still moves the slot holder, and an answer comes back", async () => {
  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    assigned: ASSIGNED,
    approver: APPROVER,
    idempotencyKey: "idem_session",
  });
  const done = await h.handlers["tasks.act"](h.ctx("usr_approver"), { taskId: created.task.id, action: "approve" });
  assert.equal(done.task.state, "done");
  assert.deepEqual(done.result, { action: "approve" });

  const asked = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "answer",
    title: "Which port?",
    assigned: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_answer",
  });
  const answered = await h.handlers["tasks.act"](h.ctx("usr_a"), { taskId: asked.task.id, action: "answer", answer: "443" });
  assert.equal(answered.task.state, "done");
  assert.deepEqual(answered.result, { action: "answer", answer: "443" });
});

test("stuck detection orders expiry, the review loop, a waiting signature, a block, and idle Doing", async () => {
  assert.equal(stuckReason({ id: "tsk_fresh", state: "doing", kind: "work", updatedAt: NOW, reviewLoops: 0 }, NOW, DEFAULT_POLICY, false), null);
  assert.equal(stuckReason({ id: "tsk_edge", state: "doing", kind: "work", updatedAt: NOW - STUCK_IDLE_MS + 1, reviewLoops: 0 }, NOW, DEFAULT_POLICY, false), null);
  assert.equal(stuckReason({ id: "tsk_idle", state: "doing", kind: "work", updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 }, NOW, DEFAULT_POLICY, false), "idle_doing");
  assert.equal(stuckReason({
    id: "tsk_exp", state: "awaiting_approval", kind: "approve", updatedAt: NOW, reviewLoops: 0, expiresAt: NOW,
  }, NOW, DEFAULT_POLICY, false), "approval_expired");
  assert.equal(stuckReason({
    id: "tsk_loop", state: "in_review", kind: "review", updatedAt: NOW, reviewLoops: 2, reviewer: { kind: "agent" },
  }, NOW, DEFAULT_POLICY, false), "review_loop_exhausted");
  assert.equal(stuckReason({
    id: "tsk_both", state: "in_review", kind: "review", updatedAt: NOW, reviewLoops: 5, expiresAt: NOW, reviewer: { kind: "agent" },
  }, NOW, DEFAULT_POLICY, false), "approval_expired");
  assert.equal(stuckReason({ id: "tsk_sig", state: "doing", kind: "signature", updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 }, NOW, DEFAULT_POLICY, false), "signature_waiting");
  assert.equal(stuckReason({ id: "tsk_block", state: "doing", kind: "work", updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 }, NOW, DEFAULT_POLICY, true), "blocked");
  assert.equal(stuckReason({ id: "tsk_todo_block", state: "todo", kind: "work", updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 }, NOW, DEFAULT_POLICY, true), "blocked");
  assert.equal(stuckReason({ id: "tsk_done", state: "done", kind: "work", updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 }, NOW, DEFAULT_POLICY, true), null);

  const found = detectStuck([
    { id: "tsk_idle", state: "doing" as const, kind: "work" as const, updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 },
    { id: "tsk_done", state: "done" as const, kind: "work" as const, updatedAt: NOW - STUCK_IDLE_MS, reviewLoops: 0 },
    { id: "tsk_exp", state: "awaiting_approval" as const, kind: "approve" as const, updatedAt: NOW, reviewLoops: 0, expiresAt: NOW },
  ], NOW, DEFAULT_POLICY, () => false);
  assert.deepEqual(found, [
    { taskId: "tsk_idle", reason: "idle_doing" },
    { taskId: "tsk_exp", reason: "approval_expired" },
  ]);

  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work",
    title: "Write it",
    assigned: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_idle",
  });
  await h.handlers["tasks.transition"](h.ctx("usr_a"), { taskId: created.task.id, to: "doing" });
  assert.equal(detectStuck(h.repo.all(), NOW, DEFAULT_POLICY, () => false).length, 0);
  const aged = must(h.repo, created.task.id);
  aged.updatedAt = NOW - STUCK_IDLE_MS;
  h.repo.save(aged);
  assert.deepEqual(detectStuck(h.repo.all(), NOW, DEFAULT_POLICY, () => false), [{ taskId: created.task.id, reason: "idle_doing" }]);
});

test("delegation walks to someone who can act and never widens access", async () => {
  const a: Party = { kind: "person", id: "usr_a" };
  const b: Party = { kind: "person", id: "usr_b" };
  const c: Party = { kind: "person", id: "usr_c" };
  assert.deepEqual(walkDelegates(a, (party) => (party.id === a.id ? b : party.id === b.id ? c : null), (party) => party.id === c.id), c);
  assert.equal(walkDelegates(a, (party) => (party.id === a.id ? b : a), () => false), null);
  assert.equal(walkDelegates(a, () => null, () => false), null);

  const h = harness();
  const work = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work",
    title: "Write it",
    assigned: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_work",
  });
  await rejects(() => h.handlers["tasks.delegate"](h.ctx("usr_a"), { taskId: work.task.id, to: { kind: "automation", id: "aut_1" } }), "validation.precondition_failed");
  assert.equal(must(h.repo, work.task.id).assigned.id, "usr_a");
  const handed = await h.handlers["tasks.delegate"](h.ctx("usr_a"), { taskId: work.task.id, to: b });
  assert.equal(handed.task.assigned.id, "usr_b");
  assert.equal(handed.task.state, "todo");
  assert.deepEqual(handed.passedTo, b);

  const source: TaskSource = { kind: "gate", id: "hold_1" };
  const approve = await h.handlers["tasks.create"](h.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    assigned: ASSIGNED,
    approver: APPROVER,
    source,
    idempotencyKey: "idem_gate",
  });
  h.repo.setChain(b, c);
  h.repo.setGrant(source, b, false);
  h.repo.setGrant(source, c, false);
  await rejects(() => h.handlers["tasks.delegate"](h.ctx("usr_approver"), { taskId: approve.task.id, to: b }), "validation.precondition_failed");
  assert.equal(must(h.repo, approve.task.id).approver?.id, "usr_approver");
  h.repo.setGrant(source, c, true);
  const passed = await h.handlers["tasks.delegate"](h.ctx("usr_approver"), { taskId: approve.task.id, to: b });
  assert.deepEqual(passed.passedTo, c);
  assert.equal(passed.task.approver?.id, "usr_c");
  assert.equal(passed.task.state, "awaiting_approval");

  const floored = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "approve",
    title: "Sign it",
    assigned: { kind: "person", id: "usr_a" },
    approver: { kind: "person", id: "usr_b" },
    idempotencyKey: "idem_floor_esc",
  });
  h.repo.setChain({ kind: "person", id: "usr_b" }, { kind: "person", id: "usr_a" });
  await rejects(() => h.handlers["tasks.escalate"](h.ctx("usr_b"), { taskId: floored.task.id, reason: "timeout" }), "validation.precondition_failed");
  assert.equal(must(h.repo, floored.task.id).approver?.id, "usr_b");

  const lead: Party = { kind: "person", id: "usr_lead" };
  h.repo.setChain(APPROVER, lead);
  h.repo.setGrant(source, lead, true);
  const escalated = await h.handlers["tasks.escalate"](h.ctx("usr_approver"), { taskId: approve.task.id, reason: "timeout" });
  assert.equal(escalated.task.approver?.id, "usr_lead");
  assert.equal(escalated.task.state, "awaiting_approval");
  assert.ok(h.events.some((event) => event.name === "task.escalated"));
});

test("transition rejects an illegal move and a stale expected status", async () => {
  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_worker"), {
    kind: "work",
    title: "Write it",
    assigned: { kind: "person", id: "usr_worker" },
    idempotencyKey: "idem_move",
  });
  const id = created.task.id;
  await rejects(() => h.handlers["tasks.transition"](h.ctx("usr_worker"), { taskId: id, to: "doing", expectedFrom: "doing" }), "validation.field_locked");
  assert.equal(must(h.repo, id).state, "todo");
  const done = await h.handlers["tasks.transition"](h.ctx("usr_worker"), { taskId: id, to: "done" });
  assert.equal(done.task.state, "done");
  await rejects(() => h.handlers["tasks.transition"](h.ctx("usr_worker"), { taskId: id, to: "doing" }), "validation.precondition_failed");
  assert.equal(must(h.repo, id).state, "done");
});

test("Take locks a group task, and the first act records who handled it", async () => {
  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_owner"), {
    kind: "work",
    title: "Rotate the secret",
    assigned: { kind: "group", id: "grp_1" },
    idempotencyKey: "idem_group",
  });
  const id = created.task.id;
  const started = await h.handlers["tasks.act"](h.ctx("usr_taker"), { taskId: id, action: "start" });
  assert.equal(started.task.state, "doing");
  assert.equal(started.task.takenBy, "usr_taker");
  assert.ok(h.events.some((event) => event.name === "task.handled"));
  await rejects(() => h.handlers["tasks.take"](h.ctx("usr_b"), { taskId: id }), "validation.precondition_failed");
  const takenBefore = h.events.filter((event) => event.name === "task.taken").length;
  const again = await h.handlers["tasks.take"](h.ctx("usr_taker"), { taskId: id });
  assert.equal(again.task.takenBy, "usr_taker");
  assert.equal(h.events.filter((event) => event.name === "task.taken").length, takenBefore);
  await rejects(() => h.handlers["tasks.release"](h.ctx("usr_b"), { taskId: id }), "validation.precondition_failed");
  const released = await h.handlers["tasks.release"](h.ctx("usr_taker"), { taskId: id });
  assert.equal(released.task.takenBy, undefined);
  await rejects(() => h.handlers["tasks.release"](h.ctx("usr_taker"), { taskId: id }), "validation.precondition_failed");
  const took = await h.handlers["tasks.take"](h.ctx("usr_b"), { taskId: id });
  assert.equal(took.task.takenBy, "usr_b");
  assert.ok(h.events.some((event) => event.name === "task.taken"));

  const person = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work",
    title: "Mine",
    assigned: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_person",
  });
  await rejects(() => h.handlers["tasks.take"](h.ctx("usr_a"), { taskId: person.task.id }), "validation.precondition_failed");
});

test("an agent reviewer can send work back twice, then a person decides", async () => {
  const h = harness();
  const created = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work",
    title: "Draft",
    assigned: { kind: "person", id: "usr_a" },
    reviewer: { kind: "agent", id: "agt_r" },
    idempotencyKey: "idem_loop",
  });
  const id = created.task.id;
  const agent = h.ctx("agt_r", { kind: "agent" });
  for (let i = 0; i < 2; i++) {
    await h.handlers["tasks.transition"](h.ctx("usr_a"), { taskId: id, to: "in_review" });
    const sent = await h.handlers["tasks.act"](agent, { taskId: id, action: "send_back", note: "fix the intro" });
    assert.equal(sent.task.state, "doing");
    assert.equal(sent.task.reviewLoops, i + 1);
  }
  await h.handlers["tasks.transition"](h.ctx("usr_a"), { taskId: id, to: "in_review" });
  assert.equal(must(h.repo, id).reviewLoops, 2);
  await rejects(() => h.handlers["tasks.act"](agent, { taskId: id, action: "send_back", note: "third" }), "validation.precondition_failed");
  assert.equal(must(h.repo, id).state, "in_review");
  assert.equal(must(h.repo, id).reviewLoops, 2);
  const decided = await h.handlers["tasks.act"](h.ctx("agt_r"), { taskId: id, action: "send_back", note: "a person decides" });
  assert.equal(decided.task.state, "doing");
  assert.equal(decided.task.reviewLoops, 3);
});

test("Needs you is ready work, due work, and work that blocks someone else", async () => {
  const h = harness();
  const approve = await h.handlers["tasks.create"](h.ctx("usr_maker"), {
    kind: "approve",
    title: "Ship it",
    assigned: ASSIGNED,
    approver: APPROVER,
    idempotencyKey: "idem_ready",
  });
  const start = utcDayStart(NOW);
  const due = await h.handlers["tasks.create"](h.ctx("usr_due"), {
    kind: "work",
    title: "Due today",
    assigned: { kind: "person", id: "usr_due" },
    due: start + 1_000,
    idempotencyKey: "idem_due",
  });
  const late = await h.handlers["tasks.create"](h.ctx("usr_late"), {
    kind: "work",
    title: "Late",
    assigned: { kind: "person", id: "usr_late" },
    due: start - 1,
    idempotencyKey: "idem_late",
  });
  const block = await h.handlers["tasks.create"](h.ctx("usr_block"), {
    kind: "work",
    title: "Hold the lane",
    assigned: { kind: "person", id: "usr_block" },
    idempotencyKey: "idem_block",
  });
  await h.handlers["tasks.create"](h.ctx("usr_other"), {
    kind: "work",
    title: "Wait",
    assigned: { kind: "person", id: "usr_other" },
    dependsOn: [block.task.id],
    idempotencyKey: "idem_wait",
  });

  const ready = await h.handlers["tasks.needs_you"](h.ctx("usr_approver"), {});
  assert.equal(ready.items.length, 1);
  assert.equal(ready.items[0]?.task.id, approve.task.id);
  assert.equal(ready.items[0]?.reason, "ready");
  assert.equal((await h.handlers["tasks.count_needs_you"](h.ctx("usr_approver"))).count, 1);
  const dueItems = await h.handlers["tasks.needs_you"](h.ctx("usr_due"), {});
  assert.equal(dueItems.items[0]?.task.id, due.task.id);
  assert.equal(dueItems.items[0]?.reason, "due_today");
  const lateItems = await h.handlers["tasks.needs_you"](h.ctx("usr_late"), {});
  assert.equal(lateItems.items[0]?.task.id, late.task.id);
  assert.equal(lateItems.items[0]?.reason, "overdue");
  const blocking = await h.handlers["tasks.needs_you"](h.ctx("usr_block"), {});
  assert.equal(blocking.items[0]?.task.id, block.task.id);
  assert.equal(blocking.items[0]?.reason, "blocking");

  await h.handlers["tasks.snooze"](h.ctx("usr_approver"), { taskId: approve.task.id, until: NOW + 5_000 });
  assert.equal((await h.handlers["tasks.needs_you"](h.ctx("usr_approver"), {})).total, 0);
  const hidden = await h.handlers["tasks.list"](h.ctx("usr_approver"), { scope: "mine" });
  assert.equal(hidden.total, 0);
  const shown = await h.handlers["tasks.list"](h.ctx("usr_approver"), { scope: "mine", includeSnoozed: true });
  assert.equal(shown.total, 1);
  await h.handlers["tasks.snooze"](h.ctx("usr_approver"), { taskId: approve.task.id, until: null });
  assert.equal((await h.handlers["tasks.count_needs_you"](h.ctx("usr_approver"))).count, 1);

  const mine = await h.handlers["tasks.my_work"](h.ctx("usr_due"), { section: "open" });
  assert.equal(mine.counts.open, 1);
  assert.equal(mine.counts.assignedByMe, 1);
  assert.equal(mine.counts.done, 0);
  assert.equal(mine.tasks[0]?.id, due.task.id);
  const missing = await h.handlers["tasks.list"](h.ctx("usr_due"), { scope: "all", cursor: "missing" });
  assert.deepEqual(missing.tasks, []);
  assert.ok(missing.total >= 1);
  await rejects(() => h.handlers["tasks.list"](h.ctx("usr_due"), { scope: "all", limit: 0 }), "validation.bad_input");
});

test("blocked is derived, and a dependency cycle is refused", async () => {
  const h = harness();
  const parent = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work",
    title: "Parent",
    assigned: { kind: "person", id: "usr_a" },
    idempotencyKey: "idem_parent",
  });
  const child = await h.handlers["tasks.create"](h.ctx("usr_b"), {
    kind: "unblock",
    title: "Need a key",
    assigned: { kind: "person", id: "usr_b" },
    parentTaskId: parent.task.id,
    idempotencyKey: "idem_child",
  });
  const blocked = await h.handlers["tasks.get"](h.ctx("usr_a"), { taskId: parent.task.id });
  assert.equal(blocked.task.blocked, true);
  const resolved = await h.handlers["tasks.act"](h.ctx("usr_b"), { taskId: child.task.id, action: "resolved" });
  assert.equal(resolved.task.state, "done");
  const clear = await h.handlers["tasks.get"](h.ctx("usr_a"), { taskId: parent.task.id });
  assert.equal(clear.task.blocked, false);

  const first = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work", title: "A", assigned: { kind: "person", id: "usr_a" }, idempotencyKey: "idem_a",
  });
  const second = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "work", title: "B", assigned: { kind: "person", id: "usr_a" }, idempotencyKey: "idem_b",
  });
  await h.handlers["tasks.dependencies.add"](h.ctx("usr_a"), { taskId: second.task.id, dependsOnId: first.task.id });
  await rejects(() => h.handlers["tasks.dependencies.add"](h.ctx("usr_a"), { taskId: first.task.id, dependsOnId: second.task.id }), "validation.precondition_failed");
  await rejects(() => h.handlers["tasks.dependencies.add"](h.ctx("usr_a"), { taskId: first.task.id, dependsOnId: first.task.id }), "validation.precondition_failed");
  await rejects(() => h.handlers["tasks.dependencies.add"](h.ctx("usr_a"), { taskId: first.task.id, dependsOnId: "tsk_missing" }), "validation.precondition_failed");
  assert.deepEqual(must(h.repo, first.task.id).dependsOn, []);
});

test("withdraw cancels the open tasks of a stopped source", async () => {
  const h = harness();
  const source = { kind: "chat" as const, id: "chat_1" };
  const first = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "answer", title: "One", assigned: { kind: "person", id: "usr_a" }, source, idempotencyKey: "idem_w1",
  });
  const second = await h.handlers["tasks.create"](h.ctx("usr_a"), {
    kind: "answer", title: "Two", assigned: { kind: "person", id: "usr_a" }, source, idempotencyKey: "idem_w2",
  });
  await rejects(() => h.handlers["tasks.withdraw"](h.ctx("usr_a"), { taskId: first.task.id, note: "  " }), "validation.bad_input");
  const out = await h.handlers["tasks.withdraw"](h.ctx("usr_a"), { sourceKind: "chat", sourceId: "chat_1", note: "the chat stopped" });
  assert.equal(out.withdrawn, 2);
  assert.equal(must(h.repo, first.task.id).state, "canceled");
  assert.equal(must(h.repo, second.task.id).state, "canceled");
  assert.ok(h.events.some((event) => event.name === "task.withdrawn"));
  const again = await h.handlers["tasks.withdraw"](h.ctx("usr_a"), { sourceKind: "chat", sourceId: "chat_1", note: "again" });
  assert.equal(again.withdrawn, 0);
});
