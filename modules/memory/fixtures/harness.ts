// Test harness for the memory handlers: a real in-memory SQLite behind the host's ctx.db guard (memory_* tables only), the host's real ctx.seal, a recording ctx, scripted
// stand-ins for the capabilities the handlers call (agents.get, projects.get, threads.get, files.*, tasks.*, settings.get), and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { createCtxSeal } from "../../../host/src/ctx/seal.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ensure, mintId, sealText } from "../projections.ts";
import type { Layer, MemCtx } from "../projections.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_000_000_000;
export const DAY = 86_400_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
export type Responder = (input: Record<string, unknown>) => unknown;

export interface HarnessOptions {
  raw?: RawDb;
  principal?: MemCtx["principal"];
  actingFor?: string;
  clock?: { t: number };
  /** Caller holds memory.admin. */
  admin?: boolean;
  /** Resources the caller may not view, as "type:id". */
  deny?: string[];
  /** Resources the caller may view but not edit, as "type:id". */
  readOnly?: string[];
  /** Answers for capabilities the handlers call; an unlisted capability throws. */
  respond?: Record<string, Responder>;
  /** Space settings by key. */
  settings?: Record<string, unknown>;
}

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_memorytest", projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

const SEAL = createCtxSeal({ key: "memory-test-seal-key-0123456789abcdef", keyId: "k1" });

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const respond: Record<string, Responder> = { ...(o.respond ?? {}) };
  const deny = new Set(o.deny ?? []);
  const readOnly = new Set(o.readOnly ?? []);
  const settings: Record<string, unknown> = { ...(o.settings ?? {}) };
  let admin = o.admin === true;
  let tasks = 0;
  const db = scopedDb("memory", raw, TRACE);
  const ctx: MemCtx & { actingFor?: string | undefined } = {
    space: "spc_memorytest",
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
      assertStrictInput(cap, input);
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const r = respond[cap];
      if (r) return r(body);
      if (cap === "agents.get") return { agent: { folderId: `fld_${String(body["agentId"]).replace(/^agt_/, "")}`, ownerId: "usr_boss" } };
      if (cap === "projects.get") return { project: { folderId: `fld_${String(body["projectId"]).replace(/^prj_/, "")}`, lead: "usr_lead" } };
      if (cap === "settings.get") return { row: settings[String(body["key"])] === undefined ? undefined : { value: settings[String(body["key"])] } };
      if (cap === "tasks.create") return { task: { id: `tsk_prom${++tasks}` } };
      if (cap === "tasks.transition") return { task: { id: String(body["taskId"]) } };
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(action, resource) {
      if (action.perm === "memory.admin") return { effect: admin ? "allow" : "deny" };
      const key = `${resource.type}:${resource.id}`;
      if (deny.has(key)) return { effect: "deny" };
      if (action.level !== "view" && readOnly.has(key)) return { effect: "deny" };
      return { effect: "allow" };
    },
    seal: SEAL,
    log: { warn() {} },
  };
  return {
    ctx, raw, db, emitted, called, clock, respond, settings,
    advance(ms: number) { clock.t += ms; },
    setAdmin(v: boolean) { admin = v; },
    deny(key: string) { deny.add(key); },
    allow(key: string) { deny.delete(key); },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** The same database and clock as another caller (a second person on one Space). */
export function asPerson(h: Harness, principal: MemCtx["principal"], extra: Omit<HarnessOptions, "raw" | "principal" | "clock"> = {}): Harness {
  return harness({ ...extra, raw: h.raw, principal, clock: h.clock });
}

export interface SeedFact {
  id: string; layer: Layer; text: string; owner?: string; agentId?: string | null; projectId?: string | null; kind?: string | null; status?: "proposed" | "current" | "closed" | "removed";
  validFrom?: number; validTo?: number | null; learnedAt?: number; sourceKind?: string; sourceRef?: string; sourcePerson?: string; noteId?: string | null; lowRisk?: boolean;
}

/** Insert a fact row exactly as given (sealed for a person layer), so a test controls its dates and status. */
export function seedFact(h: Harness, f: SeedFact): void {
  ensure(h.db);
  const owner = f.owner ?? (f.layer === "person" ? "usr_dana" : f.layer === "agent" ? f.agentId ?? "agt_intake" : f.layer === "project" ? f.projectId ?? "prj_harlow" : "spc_memorytest");
  const sealed = f.layer === "person";
  h.db.run(
    "INSERT INTO memory_facts (id, layer, owner_ref, agent_id, project_id, note_id, kind, text, sealed, enc, valid_from, valid_to, learned_at, closed_at, source_kind, source_ref, source_link, source_person, proposed_by, status, low_risk, subject, replaces, promoted_from, promoted_by, promoted_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)",
    f.id, f.layer, owner, f.agentId ?? null, f.projectId ?? null, f.noteId ?? null, f.kind ?? null, sealed ? "" : f.text, sealed ? sealText(h.ctx, owner, f.text) : null, sealed ? 2 : 0,
    f.validFrom ?? NOW - 30 * DAY, f.validTo ?? null, f.learnedAt ?? NOW - 30 * DAY, f.status === "closed" || f.status === "removed" ? (f.validTo ?? NOW - 5 * DAY) : null,
    f.sourceKind ?? "chat", f.sourceRef ?? "thr_seed", f.sourcePerson ?? owner, f.sourcePerson ?? owner, f.status ?? "current", f.lowRisk ? 1 : 0,
  );
}

export interface SeedNote { fileId: string; title: string; body: string; layer: Layer; agentId?: string | null; projectId?: string | null; path?: string; area?: string; owner?: string }

/** Insert a note index row, as index_graph would. */
export function seedNote(h: Harness, n: SeedNote): string {
  ensure(h.db);
  const noteId = `not_${n.fileId.replace(/^[a-z]+_/, "")}`;
  const owner = n.owner ?? (n.layer === "agent" ? n.agentId ?? "agt_intake" : n.layer === "project" ? n.projectId ?? "prj_harlow" : "spc_memorytest");
  h.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
    noteId, n.fileId, n.path ?? `Agents/${n.agentId ?? "x"}/memory/notes/${n.title}.md`, n.title, n.layer, owner, n.agentId ?? null, n.projectId ?? null, n.area ?? "notes", n.body, NOW - 10 * DAY,
  );
  return noteId;
}

export const idOf = (prefix: string): string => mintId(prefix, NOW);

/** Errors of an event payload against the frozen event schema. */
export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** Every event the harness saw conforms to its schema. */
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
