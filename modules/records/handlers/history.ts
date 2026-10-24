// records.history, as_of, versions, restore_version, hold, release_hold and reveal (spec 2.9, 2.26, 4.5; ARCH 7.4).
// The kernel log is the source of truth (ruling 20): every record write is one event carrying the whole row after it and the row before. A version is one such
// event, so versions, as_of and restore_version are a replay of the entity's events and never a second copy of the data.
// Merge losers stay in records_field_history (impl.ts). Holds and reveal state live in records_holds and the log (field.revealed).
import { canonical } from "../../../lib/canonical.ts";
import { compareHlc, parseHlc } from "../../../lib/hlc.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Principal } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, EventName, NextStep, TraceContext, VyreError } from "../../../packages/contracts/src/types.ts";
import { payloadOf } from "../../../kernel/src/store/projection.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { Store, TypeDef } from "../../../kernel/src/store/types.ts";
import type { ReadQuery, StoredEvent } from "../../../kernel/src/log/types.ts";
import { mapError } from "./write.ts";
import type { RecordRow, WriteCtx, WriteHandlers } from "./write.ts";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface HistoryCtx {
  trace: TraceContext;
  principal?: Principal;
  emit: (name: EventName, subject: string, payload: Record<string, unknown>, opts?: { vis?: "space" | "participants" | "owner" | "private" }) => unknown;
  /** Host decision for an action on the record. Reveal asks it for records.reveal at level view: it is where the label against the clearance is checked. */
  authorize?: (action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }) => { effect: "allow" | "deny" | "hold"; reason: string };
}

export interface SealedRef { sealed: string; ref: string; present: boolean }

export interface HistoryDeps {
  tx: Tx;
  store: Store;
  /** The write handlers: restore_version goes through records.update so it is one event, with the same rules and the same catalogue event. */
  writes: Pick<WriteHandlers, "records.update">;
  readLog: (q: ReadQuery) => StoredEvent[];
  /** Opens a sealed reference in the Space vault. Absent when no vault is wired; reveal then refuses. */
  unseal?: (ref: SealedRef, ctx: HistoryCtx) => Promise<unknown>;
  now?: () => number;
}

export interface HistoryEntry { field: string; value: unknown; hlc: string; actor: string; reason?: string }
export interface VersionRow { versionId: string; n: number; by: string; at: number; reason?: string; name?: string }

export interface HistoryHandlers {
  "records.history"(ctx: HistoryCtx, input: { type: string; recordId: string; field?: string }): Promise<{ entries: HistoryEntry[] }>;
  "records.as_of"(ctx: HistoryCtx, input: { type: string; recordId: string; at: number }): Promise<{ record: RecordRow }>;
  "records.versions"(ctx: HistoryCtx, input: { type: string; recordId: string }): Promise<{ versions: VersionRow[] }>;
  "records.restore_version"(ctx: HistoryCtx, input: { type: string; recordId: string; versionId: string }): Promise<{ record: RecordRow }>;
  "records.hold"(ctx: HistoryCtx, input: { type: string; recordId: string; reason: string }): Promise<{ held: boolean }>;
  "records.release_hold"(ctx: HistoryCtx, input: { type: string; recordId: string }): Promise<{ released: boolean }>;
  "records.reveal"(ctx: HistoryCtx, input: { type: string; recordId: string; field: string }): Promise<{ value: unknown }>;
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Pick<HistoryCtx, "trace">, code: ErrorCode, message: string): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  throw new VyreErr(error);
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS records_holds (
    hold_id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, id TEXT NOT NULL, reason TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS records_holds_row ON records_holds (type, id)",
  `CREATE TABLE IF NOT EXISTS records_version_notes (
    type TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, reason TEXT, name TEXT, PRIMARY KEY (type, id, version)
  )`,
  "CREATE TABLE IF NOT EXISTS records_row_meta (type TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, label INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (type, id))",
  "CREATE TABLE IF NOT EXISTS records_field_history (type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL)",
];
const ready = new WeakSet<object>();
function ensureTables(tx: Tx): void {
  const key = tx as unknown as object;
  if (ready.has(key)) return;
  for (const sql of TABLES) tx.exec(sql);
  ready.add(key);
}

// ---- replay ----

interface State {
  version: number;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  /** The event that produced this state. */
  event: StoredEvent;
  kind: "created" | "updated" | "removed" | "restored";
}

interface Payload { data?: Record<string, unknown>; before?: Record<string, unknown>; version?: number; at?: number }

const KINDS: Record<string, State["kind"]> = { "record.created": "created", "record.updated": "updated", "record.removed": "removed", "record.restored": "restored" };

/** Fold the record's events in order. Each event yields the state after it. */
function replay(events: readonly StoredEvent[]): State[] {
  const out: State[] = [];
  let cur: State | undefined;
  for (const e of events) {
    const kind = KINDS[e.type];
    if (!kind) continue;
    const p = payloadOf<Payload>(e);
    const at = p.at ?? e.at;
    if (kind === "created") {
      cur = { version: p.version ?? 1, data: { ...(p.data ?? {}) }, createdAt: at, updatedAt: at, event: e, kind };
    } else if (cur) {
      if (kind === "updated") cur = { ...cur, version: p.version ?? cur.version + 1, data: { ...(p.data ?? cur.data) }, updatedAt: at, event: e, kind };
      else if (kind === "removed") cur = { ...cur, version: p.version ?? cur.version + 1, updatedAt: at, deletedAt: at, event: e, kind };
      else { const { deletedAt: _gone, ...rest } = cur; void _gone; cur = { ...rest, version: p.version ?? cur.version + 1, updatedAt: at, event: e, kind }; }
    } else continue;
    out.push(cur);
  }
  return out;
}

const versionId = (n: number): string => `ver_${n}`;
function versionNumber(ctx: Pick<HistoryCtx, "trace">, id: string): number {
  const m = /^ver_(\d+)$/.exec(id);
  if (!m) return fail(ctx, "validation.bad_input", `${id} is not a version of a record`);
  return Number(m[1]);
}

function sealedFields(def: TypeDef): Set<string> {
  return new Set(def.fields.filter((f) => f.kind === "sealed").map((f) => f.name));
}

const masked = (field: string): Record<string, unknown> => ({ sealed: field, masked: true });

export function createHistoryHandlers(deps: HistoryDeps): HistoryHandlers {
  const { tx } = deps;
  const now = deps.now ?? Date.now;

  const def = (ctx: Pick<HistoryCtx, "trace">, type: string): TypeDef => {
    if (!NAME.test(type)) fail(ctx, "validation.bad_input", `record type names are lowercase letters, digits and underscores: ${type}`);
    const r = tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type);
    if (!r) return fail(ctx, "validation.not_found", `no type ${type}`);
    return JSON.parse(r.def) as TypeDef;
  };
  const states = (type: string, id: string): State[] => {
    const events: StoredEvent[] = [];
    for (let after = 0;;) {
      const page = deps.readLog({ entity: type, entity_id: id, type: "record.*", after, limit: 5000 });
      events.push(...page);
      const last = page[page.length - 1];
      if (page.length < 5000 || !last) break;
      after = last.seq;
    }
    return replay(events);
  };
  const meta = (type: string, id: string): { label: number; holds: number } => {
    const r = tx.get<{ label: number; holds: number }>("SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?", type, id);
    return { label: r?.label ?? 0, holds: r?.holds ?? 0 };
  };
  const rowOf = (type: string, id: string, s: State): RecordRow => ({
    id, type, version: s.version, label: meta(type, id).label, fields: { ...s.data }, createdAt: s.createdAt, updatedAt: s.updatedAt, holds: meta(type, id).holds,
    ...(s.deletedAt !== undefined ? { deletedAt: s.deletedAt } : {}),
  });
  const need = (ctx: Pick<HistoryCtx, "trace">, type: string, id: string): State[] => {
    def(ctx, type);
    const all = states(type, id);
    if (!all.length) return fail(ctx, "validation.not_found", `no ${type} ${id}`);
    return all;
  };
  const guard = async <T>(ctx: HistoryCtx, run: () => Promise<T> | T): Promise<T> => {
    ensureTables(tx);
    try { return await run(); } catch (e) { return mapError(ctx as unknown as WriteCtx, e); }
  };

  return {
    "records.history": (ctx, input) => guard(ctx, () => {
      const d = def(ctx, input.type);
      const seal = sealedFields(d);
      const all = need(ctx, input.type, input.recordId);
      const entries: HistoryEntry[] = [];
      for (const s of all) {
        if (s.kind !== "updated") continue;
        const p = payloadOf<Payload>(s.event);
        const before = p.before ?? {};
        const after = p.data ?? {};
        for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const a = before[k] ?? null, b = after[k] ?? null;
          if (canonical(a) === canonical(b)) continue;
          entries.push({ field: k, value: seal.has(k) ? masked(k) : a, hlc: s.event.hlc, actor: s.event.actor, reason: "replaced" });
        }
      }
      const losers = tx.all<{ field: string; value: string | null; hlc: string; actor: string; reason: string }>(
        "SELECT field, value, hlc, actor, reason FROM records_field_history WHERE type = ? AND id = ? ORDER BY rowid", input.type, input.recordId,
      );
      for (const l of losers) {
        let value: unknown = null;
        if (l.value !== null) { try { value = JSON.parse(l.value); } catch { value = l.value; } }
        entries.push({ field: l.field, value: seal.has(l.field) ? masked(l.field) : value, hlc: l.hlc, actor: l.actor, reason: l.reason });
      }
      const order = (e: HistoryEntry): ReturnType<typeof parseHlc> => parseHlc(e.hlc);
      const sorted = entries.map((e, i) => ({ e, i })).sort((x, y) => {
        const a = order(x.e), b = order(y.e);
        return (a && b ? compareHlc(a, b) : 0) || x.i - y.i;
      }).map((x) => x.e);
      return { entries: input.field ? sorted.filter((e) => e.field === input.field) : sorted };
    }),

    "records.as_of": (ctx, input) => guard(ctx, () => {
      const all = need(ctx, input.type, input.recordId);
      let hit: State | undefined;
      for (const s of all) { if (s.updatedAt <= input.at) hit = s; else break; }
      if (!hit) return fail(ctx, "validation.not_found", `${input.recordId} did not exist at that time`);
      return { record: rowOf(input.type, input.recordId, hit) };
    }),

    "records.versions": (ctx, input) => guard(ctx, () => {
      const all = need(ctx, input.type, input.recordId);
      const notes = new Map(tx.all<{ version: number; reason: string | null; name: string | null }>(
        "SELECT version, reason, name FROM records_version_notes WHERE type = ? AND id = ?", input.type, input.recordId,
      ).map((n) => [n.version, n]));
      const versions = all.map((s) => {
        const note = notes.get(s.version);
        return {
          versionId: versionId(s.version), n: s.version, by: s.event.actor, at: payloadOf<Payload>(s.event).at ?? s.event.at,
          reason: note?.reason ?? s.kind, ...(note?.name ? { name: note.name } : {}),
        };
      });
      return { versions: versions.reverse() };
    }),

    "records.restore_version": (ctx, input) => guard(ctx, async () => {
      const n = versionNumber(ctx, input.versionId);
      const all = need(ctx, input.type, input.recordId);
      const target = all.find((s) => s.version === n);
      if (!target) return fail(ctx, "validation.not_found", `${input.recordId} has no version ${n}`);
      const current = all[all.length - 1]!;
      if (current.deletedAt !== undefined) return fail(ctx, "validation.precondition_failed", "the record is in Trash: restore it first");
      if (target.deletedAt !== undefined) return fail(ctx, "validation.precondition_failed", `version ${n} is the deletion, not a state to go back to`);
      const patch: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(current.data), ...Object.keys(target.data)])) {
        const want = target.data[k] ?? null;
        if (canonical(current.data[k] ?? null) !== canonical(want)) patch[k] = want;
      }
      if (!Object.keys(patch).length) return { record: rowOf(input.type, input.recordId, current) };
      const res = await deps.writes["records.update"](ctx as unknown as WriteCtx, { type: input.type, recordId: input.recordId, patch, baseVersion: current.version });
      tx.run(
        "INSERT INTO records_version_notes (type, id, version, reason) VALUES (?, ?, ?, ?) ON CONFLICT(type, id, version) DO UPDATE SET reason = excluded.reason",
        input.type, input.recordId, res.record.version, `restored from version ${n}`,
      );
      return res;
    }),

    "records.hold": (ctx, input) => guard(ctx, async () => {
      need(ctx, input.type, input.recordId);
      if (!input.reason || !input.reason.trim()) return fail(ctx, "validation.bad_input", "a hold needs a reason");
      tx.run("INSERT INTO records_holds (type, id, reason, by, at) VALUES (?, ?, ?, ?, ?)", input.type, input.recordId, input.reason, ctx.principal?.id ?? "unknown", now());
      tx.run(
        "INSERT INTO records_row_meta (type, id, holds) VALUES (?, ?, 1) ON CONFLICT(type, id) DO UPDATE SET holds = holds + 1",
        input.type, input.recordId,
      );
      ctx.emit("record.held", `record/${input.recordId}`, { recordId: input.recordId, type: input.type, reason: input.reason });
      return { held: true };
    }),

    "records.release_hold": (ctx, input) => guard(ctx, async () => {
      need(ctx, input.type, input.recordId);
      const n = tx.run("DELETE FROM records_holds WHERE type = ? AND id = ?", input.type, input.recordId).changes;
      if (n === 0) return { released: false };
      tx.run("UPDATE records_row_meta SET holds = MAX(holds - ?, 0) WHERE type = ? AND id = ?", n, input.type, input.recordId);
      ctx.emit("record.hold_released", `record/${input.recordId}`, { recordId: input.recordId, type: input.type });
      return { released: true };
    }),

    "records.reveal": (ctx, input) => guard(ctx, async () => {
      const d = def(ctx, input.type);
      const f = d.fields.find((x) => x.name === input.field);
      if (!f) return fail(ctx, "validation.bad_input", `${input.type} has no field ${input.field}`);
      if (f.kind !== "sealed") return fail(ctx, "validation.bad_input", `${input.field} is not a sealed field`);
      // Agents hold handles only (spec 2.9): a reveal is a person's act.
      if (!ctx.principal || ctx.principal.kind !== "person") return fail(ctx, "permission.role_lacks_permission", "only a person can reveal a sealed value; agents work with the handle");
      const all = need(ctx, input.type, input.recordId);
      const current = all[all.length - 1]!;
      if (current.deletedAt !== undefined) return fail(ctx, "validation.not_found", `no ${input.type} ${input.recordId}`);
      if (!ctx.authorize) return fail(ctx, "permission.no_grant", "no authorization is wired for reveal");
      const decision = ctx.authorize({ perm: "records.reveal", level: "view" }, { type: "record", id: input.recordId });
      if (decision.effect === "deny") return fail(ctx, /clearance|label/i.test(decision.reason) ? "permission.above_clearance" : "permission.no_grant", decision.reason);
      if (decision.effect === "hold") return fail(ctx, "permission.needs_approval", decision.reason);
      const ref = current.data[input.field];
      if (ref === null || ref === undefined) return fail(ctx, "validation.not_found", `${input.field} has no value`);
      const sealed = ref as SealedRef;
      if (sealed.present !== true) return fail(ctx, "validation.not_found", `${input.field} has no value`);
      if (!deps.unseal) return fail(ctx, "internal.unexpected", "the vault is not available");
      const value = await deps.unseal(sealed, ctx);
      // Logged before the value leaves; vis participants keeps it out of the Space feed. The value itself is never in the event.
      ctx.emit("field.revealed", `record/${input.recordId}`, { recordId: input.recordId, type: input.type, field: input.field }, { vis: "participants" });
      return { value };
    }),
  };
}

