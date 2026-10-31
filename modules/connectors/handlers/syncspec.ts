// sync_specs.*: bring an app's records into Records from one document the agent fills (SyncSpec, syncspec.ts). validate and preview read a real page through the Vault handle
// (read-only GET, deps.probe) and write nothing; apply compiles the spec into a live connector (with generated tests, no app data), a connection, record types (through schema.apply) and
// synced-type bindings, then starts the first pull. The spec is kept per connector so Edit mapping can open the agent with it.
// @reads /modules/connectors/migrations/0004_sync_specs.sql
import { canonical } from "../../../lib/canonical.ts";
import { ensureTables, nowOf, pointerGet, refuse, seedBuiltins } from "../projections.ts";
import type { ConnectorDef, ConnectorsCtx, ProbeRequest, TestCase } from "../projections.ts";
import { coerceValue, compileSpec, firstPageRequest, parseSpec, readPage, unflatten } from "../syncspec.ts";
import type { Compiled, CompiledType, Problem, SpecObject, SyncSpec } from "../syncspec.ts";
import { createConnectionsHandlers } from "./connections.ts";
import { diffDefs, runCases } from "./runtime.ts";
import type { TestResult } from "./runtime.ts";
import { shapeList } from "./shape.ts";
import { createSyncHandlers, ensureSyncTables } from "./sync.ts";
import type { SyncDeps } from "./sync.ts";

export interface ObjectCheck { remote: string; items: number; hasNext: boolean; fieldsFound: number; fieldsMissing: string[]; status: number }
export interface Validation { ok: boolean; problems: Problem[]; objects: ObjectCheck[] }
export interface TypePreview { type: string; remote: string; isNew: boolean; title: string; fields: { key: string; label: string; type: string; dir: string }[]; existing: number }
export interface SamplePreview { type: string; remote: string; title: string; fields: { key: string; label: string; value: unknown }[] }
export interface PreviewOut extends Validation { types: TypePreview[]; samples: SamplePreview[]; summary: string }
export interface ApplyOut { connector: string; connectionId: string; version: string; types: { type: string; syncTypeId: string; runId?: string }[]; live: "polling" }
export interface SpecRow { spec: SyncSpec; connector: string; connectionId: string; appliedAt: number; types: { type: string; remote: string }[] }

export interface SpecHandlers {
  "sync_specs.validate"(ctx: ConnectorsCtx, input: { spec: unknown }): Promise<Validation>;
  "sync_specs.preview"(ctx: ConnectorsCtx, input: { spec: unknown }): Promise<PreviewOut>;
  "sync_specs.apply"(ctx: ConnectorsCtx, input: { spec: unknown; idempotencyKey: string }): Promise<ApplyOut>;
  "sync_specs.get"(ctx: ConnectorsCtx, input: { type?: string; connector?: string }): Promise<SpecRow>;
  "sync_specs.backfill"(ctx: ConnectorsCtx, input: { type: string; idempotencyKey: string }): Promise<{ runId?: string }>;
}

const SENSITIVE = /(ssn|social_?security|password|passwd|secret|token|tax_?id|birth|dob|salary|iban|account_?number|card|passport|licen[cs]e)/i;
const SAMPLE_ITEMS = 10;

/** The text of a sampled page as JSON, or the reason it is not. */
function parseBody(text: string): { ok: true; body: unknown } | { ok: false } {
  try { return { ok: true, body: text === "" ? null : (JSON.parse(text) as unknown) }; } catch { return { ok: false }; }
}

export const urlOf = (domain: string, path: string, query: Record<string, string>): string => {
  const u = new URL(`https://${domain}${path}`);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
};

export function probeRequest(spec: SyncSpec, url: string): ProbeRequest {
  const style = spec.auth.style === "bearer" || spec.auth.style === "header" || spec.auth.style === "basic" ? spec.auth.style : "bearer";
  return { handle: spec.auth.vaultHandle, style, ...(spec.auth.header ? { header: spec.auth.header } : {}), ...(spec.auth.prefix !== undefined ? { prefix: spec.auth.prefix } : {}), ...(spec.auth.headers ? { headers: spec.auth.headers } : {}), domain: spec.app.domain, url };
}

/** Fake but well-typed items for the generated tests: no app data is ever written into a connector. */
function synthItem(o: SpecObject, paths: string[]): Record<string, unknown> {
  const flat: Record<string, unknown> = { [o.id]: "1" };
  if (o.updatedAt) flat[o.updatedAt] = "2020-01-01T00:00:00.000Z";
  for (const p of paths) {
    const f = o.fields.find((x) => x.path === p);
    const first = f?.choices?.[0]?.value;
    flat[p] = f?.type === "number" || f?.type === "money" ? 1 : f?.type === "bool" ? true : f?.type === "date" ? "2020-01-01T00:00:00.000Z" : f?.type === "url" ? "https://example.test" : f?.type === "choice" ? (first ?? "x") : f?.type === "multi" ? [first ?? "x"] : "x";
  }
  return unflatten(flat);
}

function testsOf(spec: SyncSpec, compiled: Compiled): TestCase[] {
  const tests: TestCase[] = [];
  for (const t of compiled.types) {
    const o = spec.objects.find((x) => x.remote === t.remote)!;
    const m = spec.mapping.find((x) => x.remote === t.remote)!;
    const action = compiled.connector.actions.find((a) => a.name === compiled.connector.objects![t.remote]!.list)!;
    const paths = m.fields.filter((f) => f.direction !== "off").map((f) => f.path);
    const item = synthItem(o, paths);
    const cursor = o.list.cursor ?? { kind: "none" as const };
    let body: unknown = o.itemsAt === "/" || o.itemsAt === "" ? [item] : unflatten({ [o.itemsAt]: [item] });
    let link: string | undefined;
    if (cursor.kind === "cursor" && cursor.next) body = { ...(body as Record<string, unknown>), ...unflatten({ [cursor.next]: "tok2" }) };
    if (cursor.kind === "link" && cursor.next) body = { ...(body as Record<string, unknown>), ...unflatten({ [cursor.next]: `https://${spec.app.domain}${o.list.path}?page=2` }) };
    else if (cursor.kind === "link") link = `<https://${spec.app.domain}${o.list.path}?page=2>; rel="next"`;
    const first = shapeList(body, link, action.shape!, undefined);
    tests.push({
      name: `${t.remote}: first page`, action: action.name, responses: [{ method: "GET", url: `https://${spec.app.domain}${o.list.path}`, status: 200, body, ...(link ? { link } : {}) }],
      expect: { requests: 1, output: first },
    });
  }
  return tests;
}

export function createSpecHandlers(deps: SyncDeps): SpecHandlers {
  const { tx } = deps;
  const sync = createSyncHandlers(deps);
  const connections = createConnectionsHandlers(deps);
  const prep = (): void => { ensureTables(tx); ensureSyncTables(tx); seedBuiltins(deps); };
  const actorOf = (ctx: ConnectorsCtx): string => ctx.actor ?? "system";

  const parse = (ctx: ConnectorsCtx, raw: unknown): SyncSpec => {
    const r = parseSpec(raw);
    if (!r.spec) return refuse(ctx, "validation.bad_input", `The spec is not complete: ${r.problems.slice(0, 3).map((p) => p.message).join(" ")}`, { problems: r.problems });
    return r.spec;
  };

  /** Check a spec against real pages. Reads only; the pages are fetched with the Vault handle by the host and the key is never seen here. */
  const check = async (ctx: ConnectorsCtx, spec: SyncSpec): Promise<{ result: Validation; pages: Map<string, { body: unknown; link?: string }> }> => {
    const problems: Problem[] = [];
    const objects: ObjectCheck[] = [];
    const pages = new Map<string, { body: unknown; link?: string }>();
    const err = (at: string, message: string): void => { problems.push({ level: "error", at, message }); };
    const warn = (at: string, message: string): void => { problems.push({ level: "warn", at, message }); };
    if (!deps.probe) return refuse(ctx, "internal.unavailable", "Reading the app is not available right now.");
    const probe = deps.probe;
    const mapped = new Map(spec.mapping.map((m) => [m.remote, m]));
    const types = new Set<string>();
    for (const m of spec.mapping) {
      if (types.has(m.recordType)) err(`mapping.${m.remote}.recordType`, `${m.recordType} is used by two mappings.`);
      types.add(m.recordType);
      if (!spec.objects.some((o) => o.remote === m.remote)) err(`mapping.${m.remote}`, `${m.remote} is mapped but not listed in objects.`);
    }
    for (const o of spec.objects) if (!mapped.has(o.remote)) warn(`objects.${o.remote}`, `${o.remote} is described but not mapped, so it is not brought in.`);

    for (const o of spec.objects) {
      const m = mapped.get(o.remote);
      if (!m) continue;
      const at = `objects.${o.remote}`;
      const cursor = o.list.cursor ?? { kind: "none" as const };
      const req = firstPageRequest(spec, o);
      let reply;
      try { reply = await probe(ctx, probeRequest(spec, urlOf(spec.app.domain, req.path, req.query))); } catch (e) {
        err(`${at}.list`, `The app could not be read: ${(e as { error?: { message?: string } })?.error?.message ?? (e instanceof Error ? e.message : "request failed")}`);
        continue;
      }
      if (reply.status === 401 || reply.status === 403) { err(`${at}.list`, `The app refused the key (${reply.status}). Check the Vault item and its scopes.`); continue; }
      if (reply.status < 200 || reply.status >= 300) { err(`${at}.list`, `The list answered ${reply.status}. Check the path and parameters.`); continue; }
      const parsed = parseBody(reply.text);
      if (!parsed.ok) { err(`${at}.list`, "The list did not answer with JSON."); continue; }
      pages.set(o.remote, { body: parsed.body, ...(reply.link ? { link: reply.link } : {}) });
      const first = pointerGet(parsed.body, o.itemsAt);
      if (!Array.isArray(first)) { err(`${at}.itemsAt`, `There is no list at ${o.itemsAt || "/"} in the answer.`); continue; }
      const items = first.slice(0, SAMPLE_ITEMS);
      if (items.length === 0) warn(`${at}.list`, "The sampled page is empty, so the fields could not be checked against records.");
      // ids
      const ids = items.map((it) => pointerGet(it, o.id));
      if (items.length && ids.some((v) => typeof v !== "string" && typeof v !== "number")) err(`${at}.id`, `Some items have no id at ${o.id}.`);
      else if (new Set(ids.map(String)).size !== ids.length) err(`${at}.id`, `The ids at ${o.id} repeat inside one page.`);
      if (o.updatedAt && items.length && !items.some((it) => { const v = pointerGet(it, o.updatedAt!); return typeof v === "string" ? Number.isFinite(Date.parse(v)) : typeof v === "number"; })) warn(`${at}.updatedAt`, `${o.updatedAt} holds no date in the sample, so newest wins falls back to when the sync saw the change.`);
      // pagination: the next page must be reachable and different
      const page = readPage(parsed.body, reply.link, o, cursor, undefined) ?? { items: [] as unknown[] };
      let hasNext = (page as { next?: string }).next !== undefined;
      if (cursor.kind !== "none" && !hasNext && items.length > 0 && (cursor.size === undefined || items.length >= cursor.size)) warn(`${at}.list.cursor`, "No next page was found after the first page. Fine if there is only one page; otherwise check cursor.next or the link header.");
      if (hasNext) {
        const more = (page as { next: string }).next;
        const nextUrl = cursor.kind === "link" ? more : urlOf(spec.app.domain, req.path, { ...req.query, [cursor.param!]: more });
        try {
          if (cursor.kind === "link" && new URL(nextUrl).hostname !== spec.app.domain) { err(`${at}.list.cursor`, "The next link points at another host."); hasNext = false; }
          else {
            const r2 = await probe(ctx, probeRequest(spec, nextUrl));
            const p2 = parseBody(r2.text);
            const l2 = p2.ok ? pointerGet(p2.body, o.itemsAt) : undefined;
            if (r2.status !== 200 || !Array.isArray(l2)) err(`${at}.list.cursor`, `The second page did not answer with a list (${r2.status}).`);
            else if (l2.length && ids.length && String(pointerGet(l2[0], o.id)) === String(ids[0])) err(`${at}.list.cursor`, "The second page repeats the first: the page parameter or cursor is not doing anything.");
          }
        } catch (e) { err(`${at}.list.cursor`, `The second page could not be read: ${(e as { error?: { message?: string } })?.error?.message ?? (e instanceof Error ? e.message : "request failed")}`); }
      }
      // fields
      const missing: string[] = [];
      let found = 0;
      for (const mf of m.fields) {
        const f = o.fields.find((x) => x.path === mf.path);
        const fa = `${at}.fields.${mf.path}`;
        if (!f) { err(fa, `${mf.path} is mapped but not described in the object's fields.`); continue; }
        if (mf.direction === "off") continue;
        const vals = items.map((it) => pointerGet(it, mf.path));
        const present = vals.filter((v) => v !== undefined);
        if (items.length && present.length === 0) { missing.push(mf.path); err(fa, `${mf.path} is not in any of the ${items.length} sampled records. Fix the path or set it off.`); continue; }
        found++;
        const choices = f.choices?.map((c) => c.value);
        const bad = present.filter((v) => v !== null && v !== "" && !coerceValue(v, f.type, choices).ok);
        if (bad.length) warn(fa, `${bad.length} of ${present.length} sampled values do not fit ${f.type}${f.type === "choice" || f.type === "multi" ? " or its choices" : ""}; those stay empty.`);
        if ((f.type === "choice" || f.type === "multi") && !f.choices?.length) warn(fa, `${f.label} has no choices listed, so it becomes plain text.`);
        if (f.type === "relation") {
          const target = spec.mapping.find((x) => x.remote === f.relationTo);
          if (!target) err(fa, `${f.label} points at ${f.relationTo}, which is not mapped. Map it too, or leave this field off.`);
        }
        if (SENSITIVE.test(`${mf.path} ${f.label}`)) warn(fa, `${f.label} looks sensitive. Bring it in only if the person wants it.`);
        if ((mf.direction === "push" || mf.direction === "both") && f.type !== "relation" && !f.readOnly && !o.update) warn(fa, `${o.remote} has no documented update, so ${f.label} is pulled only.`);
      }
      if (m.stagesFrom) { const sf = o.fields.find((x) => x.path === m.stagesFrom); if (!sf?.choices?.length) err(`mapping.${o.remote}.stagesFrom`, "stagesFrom needs a field with choices (the pipeline stages)."); }
      for (const p of m.match ?? []) if (!m.fields.some((f) => f.path === p && f.direction !== "off")) err(`mapping.${o.remote}.match`, `The match rule uses ${p}, which is not a mapped field.`);
      if (m.createAtSource && !o.create) err(`mapping.${o.remote}.createAtSource`, "Creating in the app needs a documented create.");
      if ((m.deletes ?? "off") !== "off" && !o.delete) err(`mapping.${o.remote}.deletes`, "Deleting in the app needs a documented delete.");
      objects.push({ remote: o.remote, items: items.length, hasNext, fieldsFound: found, fieldsMissing: missing, status: reply.status });
    }
    return { result: { ok: !problems.some((p) => p.level === "error"), problems, objects }, pages };
  };

  /** Existing record types decide what apply adds. */
  const describeTypes = async (ctx: ConnectorsCtx): Promise<Map<string, Set<string>>> => {
    const out = new Map<string, Set<string>>();
    const d = (await ctx.call("schema.describe", {}).catch(() => ({ types: [] }))) as { types?: { key: string; fields: { key: string }[] }[] };
    for (const t of d.types ?? []) out.set(t.key, new Set(t.fields.map((f) => f.key)));
    return out;
  };

  const typePreview = (compiled: Compiled, spec: SyncSpec, existing: Map<string, Set<string>>): TypePreview[] =>
    compiled.types.map((t) => {
      const o = spec.objects.find((x) => x.remote === t.remote)!;
      const have = existing.get(t.recordType);
      return {
        type: t.recordType, remote: t.remote, isNew: !have, title: t.title, existing: have?.size ?? 0,
        fields: t.fields.map((f) => ({ key: f.key, label: o.fields.find((x) => x.path === f.remote)?.label ?? f.key, type: t.defs.find((d) => d.key === f.key)?.type ?? "relation", dir: f.dir })),
      };
    });

  const samplesOf = (compiled: Compiled, spec: SyncSpec, pages: Map<string, { body: unknown; link?: string }>): SamplePreview[] => {
    const out: SamplePreview[] = [];
    for (const t of compiled.types) {
      const page = pages.get(t.remote);
      const o = spec.objects.find((x) => x.remote === t.remote)!;
      const action = compiled.connector.actions.find((a) => a.name === compiled.connector.objects![t.remote]!.list);
      if (!page || !action?.shape) continue;
      let rows;
      try { rows = shapeList(page.body, page.link, action.shape, undefined).rows; } catch { continue; }
      for (const r of rows.slice(0, 3)) {
        out.push({
          type: t.recordType, remote: t.remote, title: t.title,
          fields: t.fields.map((f) => ({ key: f.key, label: o.fields.find((x) => x.path === f.remote)?.label ?? f.key, value: r.data[f.remote] ?? null })),
        });
      }
    }
    return out;
  };

  /** Dependency order: a type that others relate to is pulled first, so the relations resolve in the first pass. */
  const pullOrder = (types: CompiledType[]): CompiledType[] => {
    const rank = (t: CompiledType, seen = new Set<string>()): number => {
      if (seen.has(t.recordType)) return 0;
      seen.add(t.recordType);
      return Math.max(0, ...t.relations.map((r) => { const target = types.find((x) => x.recordType === r.to); return target ? 1 + rank(target, seen) : 0; }));
    };
    return [...types].sort((a, b) => rank(a) - rank(b));
  };

  const applySpec = async (ctx: ConnectorsCtx, spec: SyncSpec, idempotencyKey: string): Promise<ApplyOut> => {
    prep();
    const { result } = await check(ctx, spec);
    if (!result.ok) return refuse(ctx, "validation.precondition_failed", `The spec does not hold up against ${spec.app.name}: ${result.problems.filter((p) => p.level === "error").slice(0, 3).map((p) => p.message).join(" ")}`, { problems: result.problems });
    const compiled = compileSpec(spec);
    const key = compiled.connector.key;
    const now = nowOf(deps);
    const def: ConnectorDef = { ...compiled.connector, tests: testsOf(spec, compiled) };

    // the record types first, as a check: what schema.diff refuses (a field key, a relation, no right to change record types) stops everything before anything is made
    const existing = await describeTypes(ctx);
    const idem = `sync_specs.apply:${idempotencyKey}`;
    const makes = compiled.types.filter((t) => !existing.has(t.recordType));
    const makeOps = makes.map((t) => ({
      op: "type.create", type: t.recordType,
      def: { title: t.title, plural: `${t.title}s`, icon: "users", label: "internal", titleField: t.titleField, ...(t.statusField ? { statusField: t.statusField } : {}), fields: t.defs.map((d) => ({ key: d.key, type: d.type, title: d.title, ...(d.options ? { options: d.options } : {}) })) },
    }));
    const adds = compiled.types.filter((t) => existing.has(t.recordType)).flatMap((t) => t.defs.filter((d) => !existing.get(t.recordType)!.has(d.key)).map((d) => ({ op: "field.add", type: t.recordType, field: d.key, def: { type: d.type, title: d.title, ...(d.options ? { options: d.options } : {}) } })));
    const rels = compiled.types.flatMap((t) => t.relations.filter((r) => !(existing.get(t.recordType)?.has(r.field))).map((r) => ({ op: "relation.add", type: t.recordType, field: r.field, def: { to: r.to, inverse: r.inverse, title: r.title, inverseTitle: r.inverseTitle } })));
    const planned = [...makeOps, ...adds, ...rels];
    if (planned.length) {
      const diff = (await ctx.call("schema.diff", { ops: planned })) as { problems?: { itemKey: string; message: string }[] };
      if (diff.problems?.length) return refuse(ctx, "validation.precondition_failed", `The record types cannot be made: ${diff.problems.slice(0, 3).map((p) => p.message).join(" ")}`, { problems: diff.problems });
    }

    // 1. the connector: tests first, then live (a failing test keeps the last good version)
    const test: TestResult = await runCases(deps, ctx, def);
    if (test.failed > 0) return refuse(ctx, "validation.precondition_failed", `The connector made from this spec failed its own tests: ${test.cases.filter((c) => !c.ok).slice(0, 2).map((c) => `${c.name}: ${c.message ?? "failed"}`).join("; ")}`, { cases: test.cases });
    const cur = tx.get<{ version: string; def: string; builtin: number }>("SELECT version, def, builtin FROM cn_connectors WHERE key = ?", key);
    if (cur?.builtin === 1) return refuse(ctx, "validation.precondition_failed", `${key} is built in and cannot be replaced.`);
    const live = cur && cur.version !== "0.0.0" ? (JSON.parse(cur.def) as ConnectorDef) : undefined;
    const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(cur?.version ?? "");
    const same = live !== undefined && canonical({ ...live, version: "" }) === canonical({ ...def, key, version: "" });
    const version = same ? cur!.version : !v || cur?.version === "0.0.0" ? "1.0.0" : diffDefs(live, def).breaking ? `${Number(v[1]) + 1}.0.0` : `${v[1]}.${v[2]}.${Number(v[3]) + 1}`;
    const next: ConnectorDef = { ...def, key, version };
    if (same) { /* the same document applied again keeps the version */ }
    else if (cur) {
      tx.run("UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, state = 'live', def = ?, updated_at = ? WHERE key = ?", next.title, next.mode, next.scope, version, JSON.stringify(next), now, key);
      tx.run("INSERT INTO cn_versions (key, version, def, at, by, note, tests) VALUES (?, ?, ?, ?, ?, ?, ?)", key, version, JSON.stringify(next), now, actorOf(ctx), "From a sync spec", test.passed);
    } else {
      tx.run("INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, 'live', ?, ?, ?)", key, next.title, next.mode, next.scope, version, JSON.stringify(next), now, now);
      tx.run("INSERT INTO cn_versions (key, version, def, at, by, note, tests) VALUES (?, ?, ?, ?, ?, ?, ?)", key, version, JSON.stringify(next), now, actorOf(ctx), "From a sync spec", test.passed);
      ctx.emit("connector.created", `connector/${key}`, { key });
    }
    if (!same) ctx.emit("connector.published", `connector/${key}`, { key, version, tests: test.passed });

    // 2. the connection: one per connector, holding the handle (never a value)
    const slot = compiled.secretSlot;
    let conn = tx.get<{ connection_id: string; secrets: string }>("SELECT connection_id, secrets FROM cn_connections WHERE connector = ? AND owner_kind = 'space' ORDER BY created_at LIMIT 1", key);
    if (conn && (JSON.parse(conn.secrets) as Record<string, string>)[slot] !== spec.auth.vaultHandle) {
      tx.run("UPDATE cn_connections SET secrets = ?, state = 'active' WHERE connection_id = ?", JSON.stringify({ [slot]: spec.auth.vaultHandle }), conn.connection_id);
      conn = tx.get<{ connection_id: string; secrets: string }>("SELECT connection_id, secrets FROM cn_connections WHERE connection_id = ?", conn.connection_id);
    }
    const connectionId = conn?.connection_id ?? (await connections["connections.create"](ctx, { connector: key, title: spec.app.name, ownerKind: "space", secrets: { [slot]: spec.auth.vaultHandle } })).connection.connectionId;

    // 3. record types: new ones whole, existing ones gain the fields they lack; relations once both ends exist
    if (makes.length) await ctx.call("schema.apply", { idempotencyKey: `${idem}:type.create`, ops: makeOps, reason: `Bring in ${spec.app.name}` });
    if (adds.length) await ctx.call("schema.apply", { idempotencyKey: `${idem}:field.add`, ops: adds, reason: `Fields from ${spec.app.name}` });
    if (rels.length) await ctx.call("schema.apply", { idempotencyKey: `${idem}:relation.add`, ops: rels, reason: `Links from ${spec.app.name}` });

    // 4. bindings: bind a new type, update one that is already synced
    const out: ApplyOut["types"] = [];
    for (const t of pullOrder(compiled.types)) {
      const fields = t.fields.map((f) => ({ key: f.key, remote: f.remote, dir: f.dir, ...(f.relation ? { relation: compiled.types.find((x) => x.remote === f.relation)?.recordType ?? f.relation } : {}), ...(f.inverse ? { inverse: f.inverse } : {}) }));
      const bound = tx.get<{ sync_type_id: string }>("SELECT sync_type_id FROM cn_synced_types WHERE type = ?", t.recordType);
      const rules = { createAtSource: t.createAtSource, deletes: t.deletes, conflict: "newest" as const };
      const row = bound
        ? (await sync["sync_types.update"](ctx, { type: t.recordType, fields, match: t.match, ...rules })).syncedType
        : (await sync["sync_types.create"](ctx, { type: t.recordType, connectionId, remote: t.remote, fields, match: t.match, ...rules, idempotencyKey: `${idem}:bind:${t.recordType}` } as Parameters<typeof sync["sync_types.create"]>[1])).syncedType;
      tx.run("INSERT INTO cn_sync_spec_types (type, connector, remote) VALUES (?, ?, ?) ON CONFLICT(type) DO UPDATE SET connector = excluded.connector, remote = excluded.remote", t.recordType, key, t.remote);
      out.push({ type: t.recordType, syncTypeId: row.syncTypeId });
    }
    tx.run(
      "INSERT INTO cn_sync_specs (connector, spec, connection_id, applied_by, applied_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connector) DO UPDATE SET spec = excluded.spec, connection_id = excluded.connection_id, updated_at = excluded.updated_at",
      key, JSON.stringify(spec), connectionId, actorOf(ctx), now, now,
    );

    // 5. the first pull, in the background, one Run per type in dependency order
    for (const o of out) {
      const started = await sync["connectors.sync_now"](ctx, { type: o.type, mode: spec.plan.backfill === "now" ? "backfill" : "incremental", idempotencyKey: `${idem}:pull:${o.type}` } as Parameters<typeof sync["connectors.sync_now"]>[1]).catch(() => undefined);
      if (started) o.runId = started.runId;
    }
    return { connector: key, connectionId, version, types: out, live: "polling" };
  };

  return {
    "sync_specs.validate": async (ctx, input) => {
      prep();
      const spec = parse(ctx, input.spec);
      return (await check(ctx, spec)).result;
    },

    "sync_specs.preview": async (ctx, input) => {
      prep();
      const spec = parse(ctx, input.spec);
      const { result, pages } = await check(ctx, spec);
      const compiled = compileSpec(spec);
      const existing = await describeTypes(ctx);
      const types = typePreview(compiled, spec, existing);
      const estimate = spec.objects.filter((o) => compiled.types.some((t) => t.remote === o.remote)).map((o) => (o.count !== undefined ? `${o.count} ${o.label}${o.count === 1 ? "" : "s"}` : `${o.label}s`));
      const summary = result.ok
        ? `Would make ${types.filter((t) => t.isNew).length} record types and bring in ${estimate.join(", ")}. ${spec.plan.firstPull.words.replace(/[.\s]+$/, "")}. Nothing is written to ${spec.app.name}.`
        : `${result.problems.filter((p) => p.level === "error").length} problems to fix first.`;
      return { ...result, types, samples: samplesOf(compiled, spec, pages), summary };
    },

    "sync_specs.apply": (ctx, input) => applySpec(ctx, parse(ctx, input.spec), input.idempotencyKey),

    "sync_specs.get": async (ctx, input) => {
      prep();
      const connector = input.connector ?? (input.type !== undefined ? tx.get<{ connector: string }>("SELECT connector FROM cn_sync_spec_types WHERE type = ?", input.type)?.connector : undefined);
      const row = connector ? tx.get<{ spec: string; connector: string; connection_id: string; applied_at: number }>("SELECT * FROM cn_sync_specs WHERE connector = ?", connector) : undefined;
      if (!row) return refuse(ctx, "validation.not_found", "No sync spec was applied for that.");
      return {
        spec: JSON.parse(row.spec) as SyncSpec, connector: row.connector, connectionId: row.connection_id, appliedAt: row.applied_at,
        types: tx.all<{ type: string; remote: string }>("SELECT type, remote FROM cn_sync_spec_types WHERE connector = ? ORDER BY rowid", row.connector),
      };
    },

    "sync_specs.backfill": async (ctx, input) => {
      prep();
      const row = tx.get<{ spec: string; connector: string }>("SELECT s.spec AS spec, s.connector AS connector FROM cn_sync_specs s JOIN cn_sync_spec_types t ON t.connector = s.connector WHERE t.type = ?", input.type);
      if (!row) return refuse(ctx, "validation.not_found", `${input.type} was not brought in from a sync spec.`);
      const spec = JSON.parse(row.spec) as SyncSpec;
      const out = await applySpec(ctx, { ...spec, plan: { ...spec.plan, backfill: "now" } }, `backfill:${input.idempotencyKey}`);
      return { runId: out.types.find((t) => t.type === input.type)?.runId };
    },
  };
}

