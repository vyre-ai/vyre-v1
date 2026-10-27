// Test harness for the import module: a real in-memory SQLite behind the host's ctx.db guard (import_* tables only), a recording ctx, a clock the tests move, and a small world standing in for the
// modules an import calls (files, schema, records, runs, google) and for the apps it reads (Airtable, Notion), plus checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { setHost } from "../projections.ts";
import type { ImportCtx, Principal } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const HOUR = 3_600_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_importtest";
export const DANA = "usr_dana";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: any; key?: string | undefined }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (input: any, opts?: { idempotencyKey?: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { error: { code, message } }); };

export interface FieldDef { key: string; type: string; title: string; required?: boolean; default?: unknown; options?: Record<string, unknown> }
export const CONTACT: FieldDef[] = [
  { key: "name", type: "text", title: "Name", required: true },
  { key: "email", type: "email", title: "Email" },
  { key: "phone", type: "phone", title: "Phone" },
  { key: "company", type: "text", title: "Company" },
  { key: "joined", type: "datetime", title: "Joined" },
  { key: "vip", type: "checkbox", title: "VIP" },
  { key: "amount", type: "number", title: "Amount" },
  { key: "stage", type: "choice", title: "Stage", options: { choices: [{ key: "lead", title: "Lead" }, { key: "client", title: "Client" }] } },
  { key: "links", type: "relation", title: "Linked" },
];

/** The neighbours of Import, in memory. Each keeps what it was told, so a test can look at what the import asked for. */
export function fakeWorld(clock: { t: number }) {
  const files = new Map<string, { text?: string; bytes?: Uint8Array }>();
  const types = new Map<string, FieldDef[]>([["contact", [...CONTACT]]]);
  const store = new Map<string, Array<{ id: string; fields: Record<string, unknown> }>>();
  const runs = new Map<string, { status: string }>();
  const sheets = new Map<string, { sheets: Array<{ title: string; values: string[][] }> }>();
  const http: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const routes: Array<{ match: (url: string, method: string) => boolean; answer: (url: string, body?: string) => { status: number; json?: unknown } }> = [];
  const secrets = new Map<string, string>();
  const keys = new Map<string, unknown>();
  const down = new Set<string>();
  const failBatch = { at: -1 };
  let n = 0;
  const next = (prefix: string): string => `${prefix}_${(++n).toString(36).padStart(6, "0")}`;
  const keyed = (o: { idempotencyKey?: string } | undefined, scope: string, make: () => unknown): unknown => {
    const k = o?.idempotencyKey ? `${scope}:${o.idempotencyKey}` : undefined;
    if (k && keys.has(k)) return keys.get(k);
    const out = make();
    if (k) keys.set(k, out);
    return out;
  };
  const keyOf = (fields: Record<string, unknown>, match: string[]): string | undefined => (match.some((k) => fields[k] === undefined) ? undefined : JSON.stringify(match.map((k) => fields[k])));
  let bulkCalls = 0;
  const handlers: Record<string, Handler> = {
    "projects.create": (i, o) => keyed(o, "project", () => ({ projectId: next("prj"), recordId: next("rec"), channelId: next("chn"), folderId: next("fld") })),
    "chat.start": (i, o) => keyed(o, "chat", () => ({ thread: { threadId: next("thr"), kind: i.kind, listed: true } })),
    "files.read": (i) => {
      const f = files.get(i.fileId) ?? fail("validation.not_found", "no such file");
      if (i.as === "base64") return { base64: Buffer.from(f.bytes ?? new TextEncoder().encode(f.text ?? "")).toString("base64"), mime: "application/octet-stream", size: 1, version: 1, truncated: false };
      return { text: f.text ?? new TextDecoder().decode(f.bytes ?? new Uint8Array()), mime: "text/csv", size: 1, version: 1, truncated: false };
    },
    "schema.types.get": (i) => { const f = types.get(i.type) ?? fail("validation.not_found", "no such type"); return { type: { key: i.type, title: i.type, plural: i.type, icon: "x", label: 0, system: false, fields: f, version: 1 } }; },
    "schema.apply": (i, o) => keyed(o, "sa", () => {
      for (const op of i.ops) if (op.op === "field.add") types.get(op.type)!.push(op.def);
      return { changeId: next("sch"), applied: i.ops.length, items: [] };
    }),
    "records.query": (i) => {
      const rows = store.get(i.type) ?? [];
      const ors = (i.filter?.or ?? []) as Array<{ and: Array<{ field: string; value: unknown }> }>;
      const hit = rows.filter((r) => ors.some((o) => o.and.every((c) => JSON.stringify(r.fields[c.field]) === JSON.stringify(c.value))));
      return { rows: hit.map((r) => ({ id: r.id, type: i.type, version: 1, label: 0, fields: r.fields, createdAt: clock.t, updatedAt: clock.t, holds: 0 })), total: hit.length };
    },
    "records.bulk_upsert": (i, o) => keyed(o, "bu", () => {
      const call = bulkCalls++;
      if (failBatch.at === call) fail("internal.unexpected", "the store is full");
      const rows = store.get(i.type) ?? [];
      store.set(i.type, rows);
      let created = 0, updated = 0;
      for (const r of i.rows) {
        const k = i.match.length > 0 ? keyOf(r, i.match) : undefined;
        const hit = k === undefined ? undefined : rows.find((x) => keyOf(x.fields, i.match) === k);
        if (hit) { Object.assign(hit.fields, r); updated++; } else { rows.push({ id: next("rec"), fields: { ...r } }); created++; }
      }
      return { created, updated, skipped: 0 };
    }),
    "runs.start": (i, o) => keyed(o, "rs", () => { const runId = next("run"); runs.set(runId, { status: "running" }); return { runId }; }),
    "runs.get": (i) => ({ run: { id: i.runId, status: runs.get(i.runId)?.status ?? "running" } }),
    "runs.finish": (i) => { const r = runs.get(i.runId); if (r) r.status = i.status; return { run: { id: i.runId, status: i.status } }; },
    "google.sheets.get_spreadsheet": (i) => { const s = sheets.get(i.spreadsheetId) ?? fail("validation.not_found", "no such sheet"); return { title: "Sheet", sheets: s.sheets.map((t, x) => ({ sheetId: x, title: t.title })) }; },
    "google.sheets.get_values": (i) => {
      const s = sheets.get(i.spreadsheetId) ?? fail("validation.not_found", "no such sheet");
      const title = String(i.range).replace(/^'|'$/g, "").replace(/''/g, "'");
      return { values: (s.sheets.find((t) => t.title === title) ?? fail("validation.bad_input", "no such tab")).values };
    },
  };
  const request = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    http.push({ url, method, headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const r = routes.find((x) => x.match(url, method));
    if (!r) return { status: 404, text: async () => "{}" };
    const a = r.answer(url, init?.body);
    return { status: a.status, text: async () => JSON.stringify(a.json ?? {}) };
  };
  return {
    files, types, store, runs, sheets, http, routes, secrets, handlers, down, failBatch, request, next,
    get bulkCalls(): number { return bulkCalls; },
    /** Put a text or binary file in Files and give back its id. */
    file(content: string | Uint8Array): string { const id = next("fil"); files.set(id, typeof content === "string" ? { text: content } : { bytes: content }); return id; },
    rows(type: string): Array<Record<string, unknown>> { return (store.get(type) ?? []).map((r) => r.fields); },
    seed(type: string, ...rows: Array<Record<string, unknown>>): void { const l = store.get(type) ?? []; for (const r of rows) l.push({ id: next("rec"), fields: r }); store.set(type, l); },
  };
}
export type FakeWorld = ReturnType<typeof fakeWorld>;

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export interface HarnessOptions {
  raw?: RawDb; principal?: Principal; actingFor?: string; clock?: { t: number }; world?: FakeWorld; space?: string; personalSpace?: string;
  sessionDestination?: NonNullable<ImportCtx["sessionDestination"]>;
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const warned: string[] = [];
  const world = o.world ?? fakeWorld(clock);
  const calls: Called[] = [];
  const db = scopedDb("import", raw, TRACE);
  setHost({ secret: async (_ctx, handle) => world.secrets.get(handle) ?? Promise.reject(Object.assign(new Error("no such handle"), { error: { code: "validation.not_found", message: "no such handle" } })) });
  const ctx: ImportCtx = {
    space: o.space ?? SPACE,
    principal: o.principal ?? { kind: "person", id: DANA },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    async call(cap, input, opts) {
      calls.push({ cap, input, key: opts?.idempotencyKey });
      const f = world.handlers[cap];
      if (!f || world.down.has(cap)) throw Object.assign(new Error(`${cap} is not available`), { error: { code: "internal.unavailable", message: `${cap} is not available` } });
      return f(input, opts);
    },
    sessionDestination: o.sessionDestination ?? {
      async resolve(_owner, request) {
        return request.kind === "personal" ? { kind: "personal", spaceId: o.personalSpace ?? o.space ?? SPACE } : { kind: "team", spaceId: request.spaceId };
      },
      async invoke() { throw new Error("a test must provide a destination invoke route"); },
    },
    http: world.request,
    log: { warn(msg) { warned.push(msg); } },
  };
  const h = {
    ctx, raw, db, emitted, clock, world, warned, calls,
    advance(ms: number) { clock.t += ms; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    names(): string[] { return emitted.map((e) => e.name); },
    clear() { emitted.length = 0; calls.length = 0; },
    only(cap: string): Called[] { return calls.filter((c) => c.cap === cap); },
    as(principal: Principal, actingFor?: string): ImportCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }) }; },
  };
  return h;
}
export type Harness = ReturnType<typeof harness>;

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
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}
export function codeOf(err: unknown): string {
  const e = err as { error?: { code?: string }; code?: string };
  return e?.error?.code ?? e?.code ?? "unknown";
}
export function reasonOf(err: unknown): unknown {
  return ((err as { error?: { details?: { reason?: unknown } } })?.error?.details ?? {}).reason;
}
