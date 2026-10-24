// The invoke pipeline (ARCH 4.4): step order, error shapes, idempotent replay, authorize and Gate, commit and publish, traces, bindings.
// Authorize is the real kernel function over a real access snapshot; the log, Gate and bus are fakes that record what the pipeline asked of them.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { createInvoke, createRateLimiter, indexCapabilities, MAX_DEPTH } from "../src/invoke.ts";
import type { AuditRow, CommitBatch, CtxSeed, GateHook, Handler, InvokeDeps, SpanRecord } from "../src/invoke.ts";
import { HostError, VyreErr, makeError } from "../src/routes/errors.ts";
import { resolveResource } from "../src/routes/resource.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";

const cap = (o: Partial<CapabilityDef> & { name: string }): CapabilityDef => ({
  v: 1, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "record", id: "/id" }, permission: "records.edit", level: "edit",
  risk: "low", effects: "write", emits: [], idempotency: "natural", surfaces: {}, examples: [], ...o,
} as unknown as CapabilityDef);

function world() {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 2, perms: ["records.edit", "records.read"], name: "Member" });
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putPrincipal({ id: "usr_eve", kind: "person", status: "active", name: "Eve" });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  s.addPrincipalRole({ holder: "usr_eve", role: "member" });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec_1", type: "record", parent_id: "root", label: 0, owner_id: null, holds: 0 });
  s.putGrant({ id: "g1", subject_kind: "actor", subject_id: "usr_dana", resource_type: "folder", resource_id: "root", level: "edit" });
  return s;
}
const seed = (o: Partial<CtxSeed> = {}): CtxSeed => ({ space: "spc_1", principal: { kind: "person", id: "usr_dana" }, ...o });

function rig(caps: CapabilityDef[], handlers: Record<string, Handler>, o: Partial<InvokeDeps> = {}) {
  const snap = world();
  const order: string[] = [], commits: CommitBatch[] = [], audits: AuditRow[] = [], published: EventEnvelope[][] = [], spans: SpanRecord[] = [], logs: { level: string; msg: string; a?: unknown }[] = [];
  const store = new Map<string, { hash: string; result: unknown }>();
  const deps: InvokeDeps = {
    caps: indexCapabilities(caps),
    validateInput: (c, _v, input) => { order.push("validate"); return (input as { bad?: boolean } | null)?.bad ? ["/bad: not allowed"] : []; },
    authorize: (req) => { order.push("authorize"); return authorize(snap, req); },
    handler: (c) => { const h = handlers[c]; return h && (async (ctx, i) => { order.push("handler"); return h(ctx, i); }); },
    commit: async (b) => { order.push("commit"); commits.push(b); return b.events.map((e, i) => ({ ...e, seq: commits.length * 10 + i + 1 })); },
    audit: (r) => { order.push("audit-deny"); audits.push(r); },
    publish: (e) => { order.push("publish"); published.push(e); },
    idem: (() => { const i = createIdempotency({ get: (k) => store.get(k) ?? null, put: (k, _p, _c, rec) => { store.set(k, rec as { hash: string; result: unknown }); } }); return { once: (p, c, k, inp, run) => { order.push("idem"); return i.once(p, c, k, inp, run); } }; })(),
    rate: createRateLimiter(),
    onSpan: (s) => spans.push(s),
    log: { debug() {}, info: (msg, a) => logs.push({ level: "info", msg, a }), warn() {}, error: (msg, a) => logs.push({ level: "error", msg, a }) },
    now: () => 1_000,
    ...o,
  };
  return { snap, deps, invoke: createInvoke(deps), order, commits, audits, published, spans, logs };
}

const expectErr = async (p: Promise<unknown>, code: string, http?: number) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof HostError, `expected HostError, got ${String(e)}`);
    assert.equal(e.error.code, code);
    if (http !== undefined) assert.equal(e.http, http);
    assert.ok(e.error.traceId.length === 32, "every error carries the 32 hex trace id");
    assert.ok(e.error.next.length > 0, "next steps are never empty");
    return e;
  }
  assert.fail(`expected ${code}, the call succeeded`);
};

test("pipeline order: resolve, validate, idempotency, authorize, handler, commit, publish", async () => {
  const c = cap({ name: "records.update", idempotency: "key", emits: ["record.updated"] as never, audit: "always" });
  const r = rig([c], { "records.update": (ctx, i) => { ctx.emit("record.updated" as never, "record/rec_1", { id: i.id }); return { ok: true }; } });
  const res = await r.invoke("records.update", { id: "rec_1", idempotencyKey: "k1" }, seed());
  assert.equal(res.status, "ok"); assert.deepEqual((res as { output: unknown }).output, { ok: true });
  assert.deepEqual(r.order, ["validate", "idem", "authorize", "handler", "commit", "publish"]);
  assert.equal(r.commits.length, 1, "one commit per call");
  assert.equal(r.commits[0]!.events.length, 1);
  assert.equal(r.commits[0]!.audit?.class, "allow", "the audit row rides in the same commit");
  assert.equal(r.commits[0]!.events[0]!.actor, "usr_dana");
  assert.equal(r.commits[0]!.events[0]!.entity, "record"); assert.equal(r.commits[0]!.events[0]!.entityId, "rec_1");
  assert.equal(r.published[0]![0]!.seq, 11, "publish carries the events as stored, after the commit");
});

test("a read with no events and no audit does not commit", async () => {
  const c = cap({ name: "records.get", effects: "read", permission: "records.read", level: "view" });
  const r = rig([c], { "records.get": () => ({ name: "x" }) });
  await r.invoke("records.get", { id: "rec_1" }, seed());
  assert.deepEqual(r.order, ["validate", "authorize", "handler"]);
  assert.equal(r.commits.length, 0);
});

test("unknown capability and bad input have the error shape with pointers", async () => {
  const r = rig([cap({ name: "records.update" })], { "records.update": () => ({}) });
  const e1 = await expectErr(r.invoke("nope.nothing", {}, seed()), "validation.unknown_capability", 422);
  assert.equal(e1.error.retryable, false);
  await expectErr(r.invoke("records.update", {}, seed({ v: 9 })), "validation.unknown_capability");
  const e2 = await expectErr(r.invoke("records.update", { id: "rec_1", bad: true }, seed()), "validation.bad_input", 422);
  assert.deepEqual((e2.error.details as { errors: string[] }).errors, ["/bad: not allowed"]);
  assert.ok(e2.error.next.some((n) => n.kind === "edit_input"));
  assert.ok(!r.order.includes("authorize") && !r.order.includes("handler"), "validation fails before authorize");
});

test("idempotent replay: same key runs once and returns the first result; different input conflicts; a failure frees the key", async () => {
  let runs = 0, fail = true;
  const c = cap({ name: "records.update", idempotency: "key" });
  const r = rig([c], { "records.update": () => { runs++; if (fail) { fail = false; throw new VyreErr(makeError("validation.duplicate", "0".repeat(32))); } return { n: runs }; } });
  await expectErr(r.invoke("records.update", { id: "rec_1", idempotencyKey: "k" }, seed()), "validation.duplicate", 422);
  const a = await r.invoke("records.update", { id: "rec_1", idempotencyKey: "k" }, seed());
  const b = await r.invoke("records.update", { id: "rec_1", idempotencyKey: "k" }, seed());
  assert.deepEqual((a as { output: unknown }).output, { n: 2 }); assert.deepEqual((b as { output: unknown }).output, { n: 2 });
  assert.equal(runs, 2, "the failed run, then one real run; the replay ran nothing");
  const e = await expectErr(r.invoke("records.update", { id: "rec_1", other: 1, idempotencyKey: "k" }, seed()), "validation.precondition_failed", 422);
  assert.equal((e.error.details as { reason: string }).reason, "idempotency_conflict");
  await expectErr(r.invoke("records.update", { id: "rec_1" }, seed()), "validation.bad_input");
  // the key is scoped to the principal: Dana's stored result is not served to Eve, whose call runs the pipeline and is denied
  await expectErr(r.invoke("records.update", { id: "rec_1", idempotencyKey: "k" }, seed({ principal: { kind: "person", id: "usr_eve" } })), "permission.no_grant", 403);
});

test("authorize deny: shaped permission error, audit deny row, handler never runs", async () => {
  const c = cap({ name: "records.update" });
  const r = rig([c], { "records.update": () => ({}) });
  const e = await expectErr(r.invoke("records.update", { id: "rec_1" }, seed({ principal: { kind: "person", id: "usr_eve" } })), "permission.no_grant", 403);
  assert.ok(e.error.next.some((n) => n.kind === "ask_access"));
  assert.equal(r.audits.length, 1); assert.equal(r.audits[0]!.class, "deny"); assert.equal(r.audits[0]!.reason, "no_grant");
  assert.match(r.audits[0]!.decisionId, /^dec_/);
  assert.ok(!r.order.includes("handler") && !r.order.includes("commit"));
  const unknown = await expectErr(r.invoke("records.update", { id: "ghost" }, seed()), "permission.not_found", 404);
  assert.ok(unknown);
  await expectErr(r.invoke("records.update", { id: "rec_1" }, seed({ principal: { kind: "person", id: "usr_nobody" } })), "auth.unauthenticated", 401);
  const sp = r.spans.find((s) => s.code === "permission.no_grant");
  assert.equal(sp?.status, "denied");
});

test("an agent acts for a person: no actingFor is refused, the intersection applies", async () => {
  const c = cap({ name: "records.update" });
  const r = rig([c], { "records.update": () => ({ ok: 1 }) });
  r.snap.putPrincipal({ id: "agt_a", kind: "agent", owner: "usr_dana", status: "active", name: "Bot" });
  r.snap.addPrincipalRole({ holder: "agt_a", role: "member" });
  r.snap.putGrant({ id: "g2", subject_kind: "actor", subject_id: "agt_a", resource_type: "folder", resource_id: "root", level: "edit" });
  await expectErr(r.invoke("records.update", { id: "rec_1" }, seed({ principal: { kind: "agent", id: "agt_a" } })), "permission.no_grant");
  const ok = await r.invoke("records.update", { id: "rec_1" }, seed({ principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_dana" }));
  assert.equal(ok.status, "ok");
  await expectErr(r.invoke("records.update", { id: "rec_1" }, seed({ principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_eve" })), "permission.no_grant");
});

test("Gate: a policy hold parks the call, returns held with ids, audit hold row; an approval token lets it through", async () => {
  const c = cap({ name: "mail.send", effects: "outward", emits: [] as never });
  const parked: unknown[] = [];
  const gate: GateHook = {
    applies: () => null,
    park: async (a) => { parked.push(a); return { taskId: "tsk_1", runId: "run_1" }; },
    verify: (tok) => tok === "good",
  };
  const r = rig([c], { "mail.send": () => ({ sent: true }) }, { gate });
  r.snap.putPrincipal({ id: "agt_a", kind: "agent", owner: "usr_dana", status: "active", name: "Bot" });
  r.snap.addPrincipalRole({ holder: "agt_a", role: "member" });
  r.snap.putGrant({ id: "g2", subject_kind: "actor", subject_id: "agt_a", resource_type: "folder", resource_id: "root", level: "edit" });
  r.snap.setPolicies([{ key: "gate1", kind: "gate", act: "email.send", approver: "role:owner", caps: ["mail.send"] }]);
  const agent = seed({ principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_dana" });
  const held = await r.invoke("mail.send", { id: "rec_1" }, agent);
  assert.deepEqual({ status: held.status, taskId: (held as { taskId: string }).taskId, runId: (held as { runId?: string }).runId }, { status: "held", taskId: "tsk_1", runId: "run_1" });
  assert.equal(parked.length, 1); assert.equal((parked[0] as { act: string }).act, "email.send");
  assert.equal(r.audits[0]!.class, "hold");
  assert.ok(!r.order.includes("handler"), "a held call has not run");
  // a person's own send skips the Gate
  assert.equal((await r.invoke("mail.send", { id: "rec_1" }, seed())).status, "ok");
  // the resume: token verified for this call, then the same invoke goes through
  assert.equal((await r.invoke("mail.send", { id: "rec_1" }, { ...agent, approval: "good" })).status, "ok");
  assert.equal((await r.invoke("mail.send", { id: "rec_1" }, { ...agent, approval: "bad" })).status, "held");
});

test("capability gate: hook decides; with no hook a declared Gate fails closed", async () => {
  const c = cap({ name: "records.delete", gate: { act: "delete", when: "actor.kind != 'person'" } as never });
  const noHook = rig([c], { "records.delete": () => ({ done: true }) });
  await expectErr(noHook.invoke("records.delete", { id: "rec_1" }, seed()), "internal.unavailable", 503);
  assert.ok(!noHook.order.includes("handler"));
  const hooked = rig([c], { "records.delete": () => ({ done: true }) }, { gate: { applies: (_c, _i, s) => (s.principal.kind === "person" ? null : { act: "delete" }), park: async () => ({ taskId: "tsk_9" }), verify: () => false } });
  assert.equal((await hooked.invoke("records.delete", { id: "rec_1" }, seed())).status, "ok");
  const none = cap({ name: "records.purge", gate: { act: "none", reason: "scratch data" } as never });
  assert.equal((await rig([none], { "records.purge": () => ({}) }).invoke("records.purge", { id: "rec_1" }, seed())).status, "ok");
});

test("handler failures: raw exceptions become internal.unexpected and never leak; VyreErr keeps its code; the stack is logged, not returned", async () => {
  const c = cap({ name: "records.update" });
  const r = rig([c], {
    "records.update": (_ctx, i) => { if (i.mode === "typed") throw new VyreErr(makeError("validation.field_locked", "1".repeat(32), { details: { field: "stage" } })); throw new Error("SECRET connection string leaked"); },
  });
  const e = await expectErr(r.invoke("records.update", { id: "rec_1" }, seed()), "internal.unexpected", 500);
  assert.ok(!JSON.stringify(e.error).includes("SECRET"));
  const logged = r.logs.find((l) => l.level === "error");
  assert.ok(logged && String((logged.a as { stack: string }).stack).includes("SECRET"), "the stack goes to the log with the trace id");
  assert.equal((logged!.a as { traceId: string }).traceId, e.error.traceId);
  const t = await expectErr(r.invoke("records.update", { id: "rec_1", mode: "typed" }, seed()), "validation.field_locked", 422);
  assert.deepEqual(t.error.details, { field: "stage" });
  assert.equal(t.error.traceId.length, 32, "the call's trace id replaces the handler's");
  assert.equal(r.commits.length, 0, "a failed handler commits nothing");
});

test("emit: an undeclared event is a bug (internal.unexpected); a commit failure publishes nothing", async () => {
  const c = cap({ name: "records.update", emits: ["record.updated"] as never });
  const r = rig([c], { "records.update": (ctx, i) => { ctx.emit((i.name ?? "record.deleted") as never, "record/rec_1", {}); return {}; } });
  await expectErr(r.invoke("records.update", { id: "rec_1" }, seed()), "internal.unexpected");
  const r2 = rig([c], { "records.update": (ctx) => { ctx.emit("record.updated" as never, "record/rec_1", {}); return {}; } }, { commit: async () => { throw new Error("disk full"); } });
  await expectErr(r2.invoke("records.update", { id: "rec_1" }, seed()), "internal.unexpected");
  assert.equal(r2.published.length, 0);
  const r3 = rig([c], { "records.update": (ctx) => { ctx.emit("record.updated" as never, "record/rec_1", { a: 1 }); return {}; } }, { validateEvent: () => ["/a: unexpected"] });
  await expectErr(r3.invoke("records.update", { id: "rec_1" }, seed()), "internal.unexpected");
});

test("traces: a new span per call under the caller's span; ctx.call nests with depth + 1 under the same trace; the depth limit stops loops", async () => {
  const outer = cap({ name: "records.update", emits: ["record.updated"] as never }), inner = cap({ name: "records.touch", emits: ["record.touched"] as never });
  const seen: { depth: number; trace: string; parent?: string | undefined; span: string }[] = [];
  const r = rig([outer, inner], {
    "records.update": async (ctx) => { seen.push({ depth: ctx.depth, trace: ctx.trace.traceId, parent: ctx.trace.parent, span: ctx.trace.spanId }); return ctx.call("records.touch" as never, { id: "rec_1" }); },
    "records.touch": (ctx) => { seen.push({ depth: ctx.depth, trace: ctx.trace.traceId, parent: ctx.trace.parent, span: ctx.trace.spanId }); ctx.emit("record.touched" as never, "record/rec_1", {}); return { touched: true }; },
  });
  const callerTrace = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
  const res = await r.invoke("records.update", { id: "rec_1" }, seed({ trace: callerTrace }));
  assert.equal(res.traceId, "a".repeat(32));
  assert.equal(seen[0]!.parent, "b".repeat(16)); assert.equal(seen[1]!.parent, seen[0]!.span);
  assert.deepEqual(seen.map((s) => s.depth), [0, 1]); assert.ok(seen.every((s) => s.trace === "a".repeat(32)));
  assert.equal(r.spans.length, 2); assert.ok(r.spans.every((s) => s.status === "ok" && s.cap.startsWith("records.")));
  assert.equal(r.commits[0]!.events[0]!.depth, 1, "events carry the self-trigger depth");
  const loop = rig([cap({ name: "loop.go" })], { "loop.go": (ctx) => ctx.call("loop.go" as never, { id: "rec_1" }) });
  const e = await expectErr(loop.invoke("loop.go", { id: "rec_1" }, seed()), "validation.precondition_failed");
  assert.equal((e.error.details as { limit: number }).limit, MAX_DEPTH);
});

test("rate limit: a token bucket per principal, per Space when declared", async () => {
  const c = cap({ name: "records.update", rate: { n: 2, perSeconds: 60, scope: "principal" } as never });
  let t = 1_000;
  const r = rig([c], { "records.update": () => ({}) }, { now: () => t });
  await r.invoke("records.update", { id: "rec_1" }, seed()); await r.invoke("records.update", { id: "rec_1" }, seed());
  const e = await expectErr(r.invoke("records.update", { id: "rec_1" }, seed()), "rate_limit.exceeded", 429);
  assert.equal(e.error.retryable, true);
  t += 31_000;
  assert.equal((await r.invoke("records.update", { id: "rec_1" }, seed())).status, "ok", "tokens refill with time");
});

test("resource bindings: pointer, create parent, dynamic ref, entity, space, resolve", () => {
  const input = { id: "rec_1", folder: "root", ref: { type: "file", id: "fil_1" }, handle: "stripe" };
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "record", id: "/id" } }), input, "spc_1"), { type: "record", id: "rec_1" });
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "record", create: true, parent: "/folder" } as never }), input, "spc_1"), { type: "record", id: null, parent: "root" });
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "dynamic", ref: "/ref", allowed: ["file", "folder"] } as never }), input, "spc_1"), { type: "file", id: "fil_1" });
  assert.throws(() => resolveResource(cap({ name: "a.b", resource: { type: "dynamic", ref: "/ref", allowed: ["folder"] } as never }), input, "spc_1"), /not allowed/);
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "entity", entity: "calendar_event", id: "/id" } as never }), input, "spc_1"), { type: "calendar_event", id: "rec_1" });
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "space" } as never }), input, "spc_1"), { type: "space", id: "spc_1" });
  assert.deepEqual(resolveResource(cap({ name: "a.b", resource: { type: "vault_item", id: "/handle", resolve: "handle" } as never }), input, "spc_1", (_t, _k, v) => `vit_${v}`), { type: "vault_item", id: "vit_stripe" });
  assert.throws(() => resolveResource(cap({ name: "a.b", resource: { type: "record", id: "/missing" } }), input, "spc_1"), /missing/);
});

test("a binding that cannot resolve is bad_input at the pointer, before authorize", async () => {
  const r = rig([cap({ name: "records.update" })], { "records.update": () => ({}) });
  const e = await expectErr(r.invoke("records.update", {}, seed()), "validation.bad_input");
  assert.match((e.error.details as { errors: string[] }).errors[0]!, /^\/id:/);
  assert.ok(!r.order.includes("authorize"));
});

test("pre-auth callers skip authorize", async () => {
  const r = rig([cap({ name: "auth.sign_in", permission: null, resource: { type: "space" } as never })], { "auth.sign_in": () => ({ ok: true }) });
  const res = await r.invoke("auth.sign_in", {}, seed({ principal: { kind: "actor", id: "anonymous" }, preAuth: true }));
  assert.equal(res.status, "ok"); assert.ok(!r.order.includes("authorize"));
});
