// Test harness for the conflicts handlers: a real in-memory SQLite behind the host's ctx.db guard (conflicts_* tables only), a recording ctx, a small record store that answers
// records.get and records.update the way the host would, scripted runs and tasks, and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ensure, mintId, setPorts, toJson } from "../projections.ts";
import type { CfCtx } from "../projections.ts";
import type { ConflictOpen } from "../../../sync/src/server/push/types.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  raw?: RawDb;
  principal?: CfCtx["principal"];
  actingFor?: string;
  clock?: { t: number };
  /** Resources the caller may not edit, as "type:id". */
  readOnly?: string[];
  /** Resources the caller may not even view. */
  deny?: string[];
  /** Resources held by a hold, as "type:id". */
  hold?: string[];
  /** The record store shared by every caller of one Space. */
  records?: Map<string, Record<string, unknown>>;
  /** Make a capability throw, by name. */
  throws?: Record<string, Error>;
}

export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_conflictstest", projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const records = o.records ?? new Map<string, Record<string, unknown>>();
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const logs: string[] = [];
  const readOnly = new Set(o.readOnly ?? []);
  const deny = new Set(o.deny ?? []);
  const hold = new Set(o.hold ?? []);
  const throws: Record<string, Error> = { ...(o.throws ?? {}) };
  let tasks = 0;
  let runs = 0;
  const db = scopedDb("conflicts", raw, TRACE);
  const ctx: CfCtx = {
    space: "spc_conflictstest",
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
    ...(o.actingFor ? { actingFor: o.actingFor } : {}),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const boom = throws[cap];
      if (boom) throw boom;
      if (cap === "records.get") {
        const r = records.get(String(body["recordId"]));
        if (!r) throw new Error("no such record");
        return { record: { id: body["recordId"], type: body["type"], fields: r } };
      }
      if (cap === "records.update") {
        const r = records.get(String(body["recordId"]));
        if (!r) throw new Error("no such record");
        Object.assign(r, body["patch"] as Record<string, unknown>);
        return { record: { id: body["recordId"], type: body["type"], fields: r } };
      }
      if (cap === "tasks.create") return { task: { id: `tsk_conflict${++tasks}` } };
      if (cap === "tasks.transition") return { task: { id: String(body["taskId"]) } };
      if (cap === "runs.start") return { runId: `run_conflict${++runs}` };
      if (cap === "runs.finish") return { run: { id: String(body["runId"]) } };
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(_action, resource) {
      const key = `${resource.type}:${resource.id}`;
      if (deny.has(key)) return { effect: "deny" };
      if (readOnly.has(key) && _action.level !== "view") return { effect: "deny" };
      if (hold.has(key) && _action.level !== "view") return { effect: "hold" };
      return { effect: "allow" };
    },
    log: { warn(msg) { logs.push(msg); } },
  };
  return {
    ctx, raw, db, emitted, called, clock, records, logs, throws,
    advance(ms: number) { clock.t += ms; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** The same database, clock and records as another caller. */
export function asPerson(h: Harness, principal: CfCtx["principal"], extra: Omit<HarnessOptions, "raw" | "principal" | "clock" | "records"> = {}): Harness {
  return harness({ ...extra, raw: h.raw, principal, clock: h.clock, records: h.records });
}

/** A collision as sync.push reports it. Dana's edit (theirs) was parked against Bea's current value (ours). */
export function collision(over: Partial<ConflictOpen> = {}): ConflictOpen {
  return {
    entity: "client_plan", id: "rec_acme", field: "status", ours: "Active", theirs: "Paused", base: 12, oursActor: "usr_bea", theirsActor: "usr_dana",
    opId: "op_1", traceId: TRACE, deviceId: "dev_phone", plainChoice: false, ...over,
  };
}

/** Record fields a test starts from. */
export function seedRecord(h: Harness, id: string, fields: Record<string, unknown>): void {
  h.records.set(id, { ...fields });
}

/** Mint-and-insert a conflict row directly, for tests of the reads. */
export function seedConflict(h: Harness, over: { id?: string; person?: string; state?: string; entity?: string; field?: string; openedAt?: number } = {}): string {
  ensure(h.db);
  const id = over.id ?? mintId("cfl", NOW);
  h.db.run(
    'INSERT INTO conflicts_conflict (id, entity, recordId, field, ours, theirs, base, state, plainChoice, summary, openedAt, person, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0, ?)',
    id, over.entity ?? "client_plan", "rec_acme", over.field ?? "note", toJson("a"), toJson("b"), toJson(1), over.state ?? "open", over.openedAt ?? NOW, over.person ?? "usr_dana", NOW,
  );
  h.db.run(
    "INSERT INTO conflicts_detail (conflict_id, op_id, field, kind, protected, ours_actor, theirs_actor, trace_id) VALUES (?, ?, ?, 'field', 0, 'usr_bea', ?, ?)",
    id, `op_${id}`, over.field ?? "note", over.person ?? "usr_dana", TRACE,
  );
  return id;
}

export function resetPorts(): void {
  setPorts(null);
}

/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** Errors of an event payload against the frozen event schema. */
export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** Every event the harness saw conforms to its schema. */
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
