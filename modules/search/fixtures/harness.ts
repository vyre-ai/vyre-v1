// Test harness for the search handlers: a real in-memory SQLite (FTS5 included) behind the host's ctx.db guard (search_* tables only), a recording ctx, scripted stand-ins for the
// capabilities the sources call (records.get, files.get, threads.get ...), a permission rule the tests set per resource, and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { DIM, ensure, normalise, putDoc } from "../projections.ts";
import type { IndexDoc, SearchCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const DAY = 86_400_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
export type Responder = (input: Record<string, unknown>) => unknown;

export interface HarnessOptions {
  raw?: RawDb;
  principal?: SearchCtx["principal"];
  clock?: { t: number };
  /** Resources the caller may not view, as "type:id". */
  deny?: string[];
  /** Answers for capabilities the sources call; an unlisted capability throws. */
  respond?: Record<string, Responder>;
  space?: string;
}

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_searchtest", projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

let spaces = 0;

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const respond: Record<string, Responder> = { ...(o.respond ?? {}) };
  const deny = new Set(o.deny ?? []);
  const db = scopedDb("search", raw, TRACE);
  const space = o.space ?? `spc_search${++spaces}`;
  const ctx: SearchCtx = {
    space,
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
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
      const r = respond[cap];
      if (r) return r(body);
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(_action, resource) {
      return { effect: deny.has(`${resource.type}:${resource.id}`) ? "deny" : "allow" };
    },
    log: { warn() {} },
  };
  return {
    ctx, raw, db, space, emitted, called, clock, respond,
    advance(ms: number) { clock.t += ms; },
    deny(key: string) { deny.add(key); },
    allow(key: string) { deny.delete(key); },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** The same database and clock as another caller (a second person on one Space). */
export function asPerson(h: Harness, principal: SearchCtx["principal"], extra: Omit<HarnessOptions, "raw" | "principal" | "clock" | "space"> = {}): Harness {
  return harness({ ...extra, raw: h.raw, principal, clock: h.clock, space: h.space });
}

/** Put a document in the index exactly as given. */
export function seed(h: Harness, d: Partial<IndexDoc> & { id: string; title: string }): number {
  ensure(h.db);
  const kind = d.kind ?? "record";
  const entity = d.entity ?? (kind === "chat" ? "thread" : kind);
  const doc: IndexDoc = {
    entity, id: d.id, kind, title: d.title, body: d.body ?? "", link: d.link ?? `vyre://${entity}/${d.id}`, label: d.label ?? 0,
    resource: d.resource ?? { type: kind === "chat" ? "thread" : kind, id: d.id },
    ...(d.path ? { path: d.path } : {}), ...(d.folderId ? { folderId: d.folderId } : {}), ...(d.recordType ? { recordType: d.recordType } : {}), ...(d.updatedAt !== undefined ? { updatedAt: d.updatedAt } : {}),
  };
  return putDoc(h.db, h.space, doc, h.clock.t);
}

/** Insert many documents quickly (multi-row statements on the raw handle): the perf seeds. `make(i)` gives title, body, kind and entity of document i. */
export function bulk(h: Harness, count: number, make: (i: number) => { title: string; body: string; kind: string; entity: string; recordType?: string }, o: { updatedAt?: (i: number) => number } = {}): void {
  ensure(h.db);
  const STEP = 400;
  const start = Number((h.raw.all("SELECT COALESCE(MAX(n), 0) AS m FROM search_docs")[0] as { m: number }).m);
  for (let i = 0; i < count; i += STEP) {
    const docs: string[] = [];
    const fts: string[] = [];
    const dArgs: unknown[] = [];
    const fArgs: unknown[] = [];
    for (let j = i; j < Math.min(count, i + STEP); j++) {
      const d = make(j);
      const id = `${d.entity}_${j}`;
      const n = start + j + 1;
      docs.push("(?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, NULL, ?, ?, 0)");
      dArgs.push(n, d.entity, id, d.kind, d.title, d.body, `vyre://${d.entity}/${id}`, d.kind === "chat" ? "thread" : d.kind, id, d.recordType ?? null, o.updatedAt ? o.updatedAt(j) : NOW - j * 1000);
      fts.push("(?, ?, ?, ?, ?, ?)");
      fArgs.push(n, d.title, d.body, d.kind, d.recordType ?? "", "");
    }
    h.raw.run(`INSERT INTO search_docs (n, entity, id, kind, title, body, path, link, label, res_type, res_id, folder_id, record_type, updated_at, embedded) VALUES ${docs.join(", ")}`, ...dArgs);
    h.raw.run(`INSERT INTO search_fts (rowid, title, body, kind, rtype, folder) VALUES ${fts.join(", ")}`, ...fArgs);
  }
}

/** A unit vector from a seed: reproducible, spread over the sphere. */
export function randomUnit(seed: number, into?: Float32Array): Float32Array {
  const v = into ?? new Float32Array(DIM);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < DIM; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    v[i] = (x / 0xffffffff) * 2 - 1;
  }
  return normalise(v);
}

/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** Every event the harness saw conforms to its schema. */
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

/** The error a capability call throws, in the shape the host's own errors have. */
export const notFound = (): never => { throw Object.assign(new Error("not found"), { error: { code: "validation.not_found" } }); };
export const codeOf = (err: unknown): string => (err as { error?: { code?: string } } | null)?.error?.code ?? "";
