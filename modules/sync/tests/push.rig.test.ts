// @reads /modules/sync/migrations/0001_pull.sql
// The rig the push tests share: a real log with the sync.changes projection, field clocks read from it, and a fake capability that writes patches as events carrying the op's hlc.
// This file also checks the rig itself, so importing it from another test file adds one small test.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { createIdempotency } from "../../../kernel/src/idempotency/index.ts";
import type { IdemRecord } from "../../../kernel/src/idempotency/index.ts";
import { formatHlc } from "../../../lib/hlc.ts";
import type { Op, PushReq, PushRes } from "../../../sync/src/protocol.ts";
import { catalogPolicy, catalogRestricted, syncRowClocks } from "../../../sync/src/server/push/index.ts";
import type { ConflictOpen, HistoryEntry, InvokeCall, Policy, PushDeps } from "../../../sync/src/server/push/index.ts";
import type { Cells } from "../../../sync/src/server/pull/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import { createPushHandlers } from "../handlers/push.ts";
import type { PullCtx } from "../handlers/index.ts";
import { buildAccess, NOW } from "../fixtures/world.ts";

export { NOW };
export const TRACE = "0123456789abcdef0123456789abcdef";
export const hl = (ms: number, counter = 0, device = "dev_a"): string => formatHlc({ ms, counter, deviceId: device });
export const ctx = (person: string, device = "dev_a"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass: "desktop" });

export interface PushRig {
  s: SyncHandle;
  access: AccessSnapshot;
  deps: PushDeps;
  push(person: string, device: string, ops: Op[], epoch?: number): Promise<PushRes>;
  calls: InvokeCall[];
  history: HistoryEntry[];
  conflicts: (ConflictOpen & { id: string })[];
  applied: Map<string, number>;
  /** Capabilities the fake refuses with permission.no_grant. */
  refuse: Set<string>;
  /** Op ids the fake answers `held` for. */
  hold: Set<string>;
  /** While > 0, each invoke throws timeout.deadline and decrements. */
  transient: { n: number };
  epochs: Map<string, number>;
  /** Per-field policy overrides on top of the catalog. */
  policies: Map<string, Policy>;
  /** Create a row through the log. Returns its seq. */
  seed(entity: string, id: string, fields: Record<string, unknown>, ms?: number): number;
  cells(entity: string, id: string): Cells;
  value(entity: string, id: string, field: string): unknown;
}

export function pushRig(): PushRig {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  const idem = new Map<string, IdemRecord>();
  const once = createIdempotency({ get: (k) => idem.get(k) ?? null, put: (k, _p, _c, rec) => { idem.set(k, rec); } });
  const rig: PushRig = {
    s, access, calls: [], history: [], conflicts: [], applied: new Map(), refuse: new Set(), hold: new Set(), transient: { n: 0 }, epochs: new Map(), policies: new Map(),
    deps: undefined as unknown as PushDeps,
    push: async (person, device, ops, epoch = 0) => {
      const req: PushReq = { deviceId: device, epoch, ops };
      return handlers["sync.push"](ctx(person, device), JSON.parse(JSON.stringify(req)) as PushReq);
    },
    seed(entity, id, fields, ms = NOW - 100_000) {
      return s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: "svc_seed", hlc: hl(ms, 0, "srv"), vis: "space", payload: { entity, id, op: "upsert", fields, at: ms } } as never).seq;
    },
    cells: (entity, id) => JSON.parse(s.host.tx.get<{ fields: string }>("SELECT fields FROM sync_rows WHERE entity = ? AND id = ?", entity, id)?.fields ?? "{}") as Cells,
    value: (entity, id, field) => rig.cells(entity, id)[field]?.v,
  };
  const base = catalogPolicy(s.catalog, (entity, field) => rig.policies.get(`${entity}.${field}`));
  const deps: PushDeps = {
    now: () => NOW,
    hlc: s.deps.hlc,
    epochOf: (person) => rig.epochs.get(person) ?? 0,
    invoke: async (call) => {
      rig.calls.push(call);
      if (rig.transient.n > 0) { rig.transient.n--; throw new VyreErr({ code: "timeout.deadline", message: "slow", retryable: true, traceId: call.traceId, next: [{ kind: "retry", label: "Retry" }] }); }
      if (rig.refuse.has(call.cap)) throw new VyreErr({ code: "permission.no_grant", message: "No access.", retryable: false, traceId: call.traceId, next: [{ kind: "ask_access", label: "Ask for access" }] });
      if (rig.hold.has(call.idempotencyKey)) return { kind: "held", taskId: `tsk_${call.idempotencyKey}` };
      const had = rig.applied.get(call.idempotencyKey);
      if (had !== undefined) return { kind: "applied", seq: had };
      const input = call.input as { fields?: Record<string, unknown> };
      let seq = s.host.store.head.seq;
      if (call.entity && call.id && input.fields) {
        seq = s.host.append({
          type: "sync.row", sv: 1, trace_id: call.traceId, actor: call.principal, device: call.deviceId, hlc: call.hlc, vis: "space",
          payload: { entity: call.entity, id: call.id, op: "patch", fields: input.fields, at: NOW },
        } as never).seq;
      }
      rig.applied.set(call.idempotencyKey, seq);
      return { kind: "applied", seq };
    },
    clocks: syncRowClocks(s.host.tx),
    appliedSeq: (opId) => rig.applied.get(opId),
    policy: (entity, field) => base(entity, field),
    restricted: catalogRestricted(s.catalog),
    history: (e) => { rig.history.push(e); },
    openConflict: (c) => {
      const id = `cfl_${c.opId}_${c.field}`;
      if (!rig.conflicts.some((x) => x.id === id)) rig.conflicts.push({ ...c, id });
      return id;
    },
    once: (p, c, k, i, run) => once.once(p, c, k, i, run),
  };
  (rig as { deps: PushDeps }).deps = deps;
  const handlers = createPushHandlers(deps);
  return rig;
}

/** A patch op the way an outbox makes it. */
export function patchOp(o: { id?: string; entity?: string; row?: string; fields: Record<string, unknown>; base?: Record<string, number>; after?: Record<string, string>; hlc: string; cap?: string }): Op {
  const opId = o.id ?? `op_${Math.random().toString(16).slice(2, 10)}`;
  return {
    opId, traceId: TRACE, hlc: o.hlc, cap: o.cap ?? "test.patch", v: 1, entity: o.entity ?? "contact", id: o.row ?? "c1",
    input: { fields: o.fields }, baseSeq: o.base ?? {}, ...(o.after ? { after: o.after } : {}),
  };
}

test("the rig applies a patch as an event with the op's hlc and reads the clock back", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "op1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) })]);
  assert.equal(res.applied.length, 1);
  assert.equal(r.value("contact", "c1", "name"), "B");
  assert.equal(r.cells("contact", "c1")["name"]!.hlc, hl(NOW - 1000));
  assert.equal(r.cells("contact", "c1")["name"]!.actor, "usr_ada");
});
