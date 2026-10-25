// The ConnectorDef runtime and the connector framework capabilities (spec 2.10, 4.18, ARCH 8).
// executeAction is the one path every call to an app takes: the connection must be usable (not paused, not pending, not waiting for a sign-in), the secrets are read from the Vault by
// name at call time, the request is built from the action template, egress is checked against the connector's declared domains before ctx.http is touched, the rate limit is applied,
// the answer becomes an output through a JSON pointer, and EVERY string that leaves (output, error, log, dry-run preview) has the secret values scrubbed out of it.
// The replay harness runs the same path against recorded responses, so a connector that passes its tests behaves the same live.
import { objectsOf } from "./get.ts";
import type { ObjectActions } from "./get.ts";
import { canonical } from "../../../lib/canonical.ts";
import { ensureTables, mintShort, nowOf, pointerGet, refuse, scrubber, secretsIn, seedBuiltins, takeToken, checkEgress, fillString, fillValue, clone, PAGE } from "../projections.ts";
import type { ActionDef, ConnectionDb, ConnectorDef, ConnectorState, ConnectorsCtx, ConnectorsDeps, Mode, Scope, TestCase } from "../projections.ts";

export interface ConnectorRow {
  key: string; title: string; mode: Mode; scope: Scope; builtin: boolean; version: string; state: ConnectorState; domains: string[]; secrets: { name: string; description: string }[];
  connections: number; syncedTypes: string[]; actions: string[]; sources: string[];
  objects?: Record<string, ObjectActions>;
}
export interface TestResult { passed: number; failed: number; cases: { name: string; ok: boolean; message?: string }[] }

export interface RuntimeHandlers {
  "connectors.list"(ctx: ConnectorsCtx, input: { state?: ConnectorState; cursor?: string; limit?: number }): Promise<{ connectors: ConnectorRow[]; next?: string; total?: number }>;
  "connectors.get"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ connector: ConnectorRow }>;
  "connectors.init"(ctx: ConnectorsCtx, input: { key: string; title: string; mode: Mode; docsUrl?: string }): Promise<{ key: string; folderId: string }>;
  "connectors.build"(ctx: ConnectorsCtx, input: { key: string; docsUrl?: string; notes?: string }): Promise<{ runId: string; draftId: string }>;
  "connectors.test"(ctx: ConnectorsCtx, input: { key: string; draftId?: string }): Promise<{ result: TestResult }>;
  "connectors.run"(ctx: ConnectorsCtx, input: { key: string; action: string; connectionId: string; input: unknown; dryRun?: boolean }): Promise<{ output: unknown; dryRun: boolean }>;
  "connectors.diff"(ctx: ConnectorsCtx, input: { key: string; draftId?: string }): Promise<{ files: { path: string; added: number; removed: number }[]; breaking: boolean }>;
  "connectors.publish"(ctx: ConnectorsCtx, input: { key: string; draftId?: string; note?: string }): Promise<{ published: boolean; version?: string; result: TestResult }>;
  "connectors.versions"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ versions: { version: string; at: number; by: string; note?: string; tests: number }[] }>;
  "connectors.rollback"(ctx: ConnectorsCtx, input: { key: string; version: string }): Promise<{ ok: boolean }>;
  "connectors.export"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ folderId: string }>;
  "connectors.remove"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ removed: boolean }>;
  "connectors.health"(ctx: ConnectorsCtx, input: Record<string, never>): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number; failing: string[] }>;
}

type Http = ConnectorsCtx["http"];
export interface ExecOpts {
  connection?: ConnectionDb; input?: unknown; dryRun?: boolean;
  /** Secret values by declared name (the harness and tests); otherwise they are resolved from the connection. */
  secrets?: Record<string, string>;
  http?: Http; persist?: boolean; actor?: string;
}
export interface ExecResult { output: unknown; dryRun: boolean; status?: number; ms?: number }

const KEY = /^[a-z][a-z0-9_-]{0,40}$/;
const MODES: readonly Mode[] = ["api", "mcp", "dwd", "oauth_app", "webhook_only"];
const connectionSecrets = (c: ConnectionDb | undefined): Record<string, string> => (c ? (JSON.parse(c.secrets) as Record<string, string>) : {});

function markReconnect(deps: ConnectorsDeps, ctx: ConnectorsCtx, c: ConnectionDb): void {
  const cur = deps.tx.get<{ state: string }>("SELECT state FROM cn_connections WHERE connection_id = ?", c.connection_id);
  if (!cur || cur.state === "needs_reconnect") return;
  deps.tx.run("UPDATE cn_connections SET state = 'needs_reconnect' WHERE connection_id = ?", c.connection_id);
  ctx.emit("connection.needs_reconnect", `connection/${c.connection_id}`, { connectionId: c.connection_id, connector: c.connector });
}

/** Run one action of a connector. Throws the catalogue error for anything that goes wrong; the message and details never hold a secret. */
export async function executeAction(deps: ConnectorsDeps, ctx: ConnectorsCtx, def: ConnectorDef, actionName: string, o: ExecOpts = {}): Promise<ExecResult> {
  ensureTables(deps.tx);
  const action = def.actions.find((a) => a.name === actionName);
  if (!action) refuse(ctx, "validation.bad_input", `${def.key} has no action ${actionName}.`);
  const a = action!;
  if (!a.url) refuse(ctx, "validation.unsupported", `${def.key}.${actionName} is not run by the connector runtime: its module provides it.`);
  const conn = o.connection;
  const persist = o.persist !== false;
  const actor = o.actor ?? ctx.actor ?? "system";
  if (conn) {
    if (conn.connector !== def.key) refuse(ctx, "validation.bad_input", "That connection belongs to another connector.");
    if (conn.state === "paused") refuse(ctx, "validation.precondition_failed", `The connection is paused${conn.paused_by ? ` by ${conn.paused_by}` : ""}: resume it first.`);
    if (conn.state === "pending") refuse(ctx, "validation.precondition_failed", "The connection is still pending: finish connecting it first.");
    if (conn.state === "needs_reconnect") refuse(ctx, "provider.auth_failed", "The app rejected the sign-in: reconnect the connection.");
    if (conn.owner_kind === "person" && conn.owner_id !== actor) refuse(ctx, "permission.no_grant", "This connection belongs to someone else.");
  }
  if (secretsIn(a.url).size) refuse(ctx, "validation.bad_input", "A secret cannot be part of the address.");

  // secrets, by name, at call time
  const needed = new Set<string>([...secretsIn(a.headers), ...secretsIn(a.body)]);
  if (def.auth.type !== "none" && def.auth.secret) needed.add(def.auth.secret);
  const values: Record<string, string> = {};
  for (const name of needed) {
    if (!def.secrets.some((s) => s.name === name)) refuse(ctx, "validation.bad_input", `${def.key}.${actionName} reads ${name}, which the connector does not declare.`);
    let v = o.secrets?.[name];
    if (v === undefined && conn) {
      const handle = connectionSecrets(conn)[name];
      if (!handle) refuse(ctx, "validation.precondition_failed", `The connection has no Vault item for ${name}.`);
      v = deps.resolveSecret ? await deps.resolveSecret(handle!) : undefined;
      if (v === undefined) refuse(ctx, "validation.precondition_failed", `The Vault item for ${name} has no value.`);
    }
    if (v === undefined) refuse(ctx, "validation.precondition_failed", `No value for ${name}.`);
    values[name] = v!;
  }
  // Scrub every secret value the connection holds, not just the ones this action reads: an app may echo any of them.
  const everySecret = [...Object.values(values), ...Object.values(o.secrets ?? {})];
  if (conn && deps.resolveSecret) {
    for (const [name, handle] of Object.entries(connectionSecrets(conn))) {
      if (name in values) continue;
      try { const v = await deps.resolveSecret(handle); if (v) everySecret.push(v); } catch { /* an unreadable item has nothing to scrub */ }
    }
  }
  const scrub = scrubber(everySecret);

  // the request
  const scope = { input: o.input ?? {}, secret: values, connection: { id: conn?.connection_id ?? "con_test" } };
  let method: string;
  let url: URL;
  let headers: Record<string, string>;
  let body: string | undefined;
  try {
    method = a.method ?? "GET";
    const u = new URL(fillString(a.url, scope, true));
    for (const [k, v] of Object.entries(a.query ?? {})) u.searchParams.set(k, fillString(v, scope));
    const egress = checkEgress(u.toString(), def.domains);
    if (!egress.ok) refuse(ctx, "permission.no_grant", `Egress refused: ${egress.reason}.`, { connector: def.key, action: actionName });
    url = (egress as { ok: true; url: URL }).url;
    headers = {};
    if (def.auth.type === "api_key" && def.auth.secret) headers[def.auth.header ?? "Authorization"] = `${def.auth.prefix ?? ""}${values[def.auth.secret]}`;
    else if ((def.auth.type === "bearer" || def.auth.type === "oauth2") && def.auth.secret) headers["Authorization"] = `Bearer ${values[def.auth.secret]}`;
    for (const [k, v] of Object.entries(a.headers ?? {})) headers[k] = fillString(v, scope);
    if (a.body !== undefined && method !== "GET") {
      body = JSON.stringify(fillValue(a.body, scope));
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
    }
  } catch (e) {
    if ((e as { error?: unknown }).error) throw e;
    return refuse(ctx, "validation.bad_input", scrub.text(`The request for ${actionName} could not be built: ${e instanceof Error ? e.message : String(e)}.`));
  }

  if (o.dryRun) return { output: { request: scrub.value({ method, url: url.toString(), headers, ...(body !== undefined ? { body: JSON.parse(body) as unknown } : {}) }) }, dryRun: true };

  if (conn && !takeToken(conn.connection_id, def.rate, nowOf(deps))) refuse(ctx, "rate_limit.exceeded", `The connection is at its rate limit (${def.rate!.rps} per second).`);
  const http = o.http ?? ctx.http;
  const started = nowOf(deps);
  const logRow = (status: number | null, error: string | null): void => {
    if (!persist) return;
    deps.tx.run("INSERT INTO cn_log (at, connection_id, connector, action, method, host, path, status, ms, error, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      started, conn?.connection_id ?? null, def.key, actionName, method, url.hostname, url.pathname, status, nowOf(deps) - started, error === null ? null : scrub.text(error).slice(0, 300), actor);
  };
  let res: { status: number; text(): Promise<string> };
  try {
    res = await http(url.toString(), { method, headers, ...(body !== undefined ? { body } : {}) });
  } catch (e) {
    const msg = scrub.text(e instanceof Error ? e.message : String(e));
    logRow(null, msg);
    return refuse(ctx, "provider.network", `The app could not be reached: ${msg}`);
  }
  const text = await res.text();
  const ms = nowOf(deps) - started;
  if (res.status === 401 || res.status === 403) {
    logRow(res.status, "rejected the sign-in");
    if (conn && persist) markReconnect(deps, ctx, conn);
    return refuse(ctx, "provider.auth_failed", "The app rejected the key or sign-in.", { status: res.status });
  }
  if (res.status === 429) { logRow(res.status, "rate limited"); return refuse(ctx, "provider.rate_limited", "The app is rate limiting this connection.", { status: res.status }); }
  if (res.status >= 500) { logRow(res.status, "server error"); return refuse(ctx, "provider.unavailable", `The app answered ${res.status}.`, { status: res.status }); }
  if (res.status >= 400) {
    logRow(res.status, "refused the request");
    return refuse(ctx, "provider.bad_response", `The app refused the request (${res.status}).`, { status: res.status, body: scrub.text(text).slice(0, 200) });
  }
  let parsed: unknown = text;
  try { parsed = text === "" ? null : (JSON.parse(text) as unknown); } catch { /* the output is the text */ }
  const output = scrub.value(a.output !== undefined ? (pointerGet(parsed, a.output) ?? null) : parsed);
  logRow(res.status, null);
  return { output, dryRun: false, status: res.status, ms };
}

// ---- the replay harness ----

/** Static checks and recorded-response cases of a definition. Nothing is sent anywhere. */
export async function runCases(deps: ConnectorsDeps, ctx: ConnectorsCtx, def: ConnectorDef): Promise<TestResult> {
  const cases: TestResult["cases"] = [];
  const add = (name: string, ok: boolean, message?: string): void => { cases.push({ name, ok, ...(ok || !message ? {} : { message }) }); };

  // static
  const declared = new Set(def.secrets.map((s) => s.name));
  const used = new Set<string>(def.auth.secret ? [def.auth.secret] : []);
  const bad: string[] = [];
  for (const a of def.actions) {
    if (!a.url) continue;
    secretsIn(a.headers, used);
    secretsIn(a.body, used);
    if (secretsIn(a.url).size) bad.push(`${a.name}: a secret in the address`);
    const probe = a.url.replace(/\{(input|connection)\.[A-Za-z0-9_.]+\}/g, "x");
    const eg = checkEgress(probe, def.domains);
    if (!eg.ok) bad.push(`${a.name}: ${eg.reason}`);
  }
  add("egress: every action stays inside the declared domains", bad.length === 0, bad.join("; "));
  const undeclared = [...used].filter((n) => !declared.has(n));
  add("secrets: every secret an action reads is declared", undeclared.length === 0, `undeclared: ${undeclared.join(", ")}`);
  add("health: the health action exists", def.health === undefined || def.actions.some((a) => a.name === def.health), `no action ${def.health}`);
  if (def.auth.type === "oauth2") {
    const eg = [def.auth.authUrl, def.auth.tokenUrl].map((u) => (u ? checkEgress(u, def.domains) : { ok: false as const, reason: "missing" }));
    add("auth: sign-in and token addresses are declared domains", eg.every((e) => e.ok), eg.filter((e) => !e.ok).map((e) => (e as { reason: string }).reason).join("; "));
  }

  // recorded responses
  const synthetic = Object.fromEntries(def.secrets.map((s) => [s.name, `test-secret-${s.name}-0000`]));
  for (const t of def.tests ?? []) {
    let requests = 0;
    const fill = (v: unknown): unknown => fillValue(v, { input: t.input ?? {}, secret: synthetic, connection: { id: "con_test" } });
    const http: Http = async (url, init) => {
      requests++;
      const method = (init?.method ?? "GET").toUpperCase();
      const bare = url.split("?")[0]!;
      const hit = t.responses.find((r) => (r.method ?? "GET").toUpperCase() === method && (r.url === url || r.url === bare));
      if (!hit) throw new Error(`no recorded response for ${method} ${bare}`);
      const text = hit.body === undefined ? "" : typeof hit.body === "string" ? (fill(hit.body) as string) : JSON.stringify(fill(hit.body));
      return { status: hit.status ?? 200, text: async () => text };
    };
    try {
      const out = await executeAction(deps, ctx, def, t.action, { input: t.input ?? {}, secrets: synthetic, http, persist: false, actor: "harness" });
      if (t.expect?.error) { add(t.name, false, `expected the error ${t.expect.error}, got an output`); continue; }
      if (t.expect?.output !== undefined && canonical(out.output) !== canonical(t.expect.output)) { add(t.name, false, `output differs: got ${JSON.stringify(out.output).slice(0, 200)}`); continue; }
      if (t.expect?.requests !== undefined && requests !== t.expect.requests) { add(t.name, false, `expected ${t.expect.requests} requests, made ${requests}`); continue; }
      add(t.name, true);
    } catch (e) {
      const code = (e as { error?: { code?: string; message?: string } }).error?.code;
      if (t.expect?.error && code === t.expect.error) add(t.name, true);
      else add(t.name, false, `${code ?? "error"}: ${(e as { error?: { message?: string } }).error?.message ?? (e instanceof Error ? e.message : String(e))}`);
    }
  }
  const failed = cases.filter((c) => !c.ok).length;
  return { passed: cases.length - failed, failed, cases };
}

// ---- diff ----

const lines = (v: unknown): string[] => JSON.stringify(v, null, 2).split("\n");
function lineDiff(a: unknown, b: unknown): { added: number; removed: number } {
  const x = lines(a);
  const y = lines(b);
  const count = new Map<string, number>();
  for (const l of x) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of y) { const n = count.get(l) ?? 0; if (n > 0) count.set(l, n - 1); else added++; }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}

function splitFiles(d: ConnectorDef | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!d) return out;
  const { actions, tests, version: _version, ...main } = d;
  void _version;
  out.set("connector.toml", main);
  for (const a of actions) out.set(`actions/${a.name}.json`, a);
  for (const t of tests ?? []) out.set(`tests/${t.name}.json`, t);
  return out;
}

export function diffDefs(live: ConnectorDef | undefined, draft: ConnectorDef): { files: { path: string; added: number; removed: number }[]; breaking: boolean } {
  const a = splitFiles(live);
  const b = splitFiles(draft);
  const files: { path: string; added: number; removed: number }[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    if (x !== undefined && y !== undefined && canonical(x) === canonical(y)) continue;
    const d = lineDiff(x ?? null, y ?? null);
    files.push({ path, added: x === undefined ? lines(y).length : d.added, removed: y === undefined ? lines(x).length : d.removed });
  }
  let breaking = false;
  if (live) {
    for (const act of live.actions) {
      const next = draft.actions.find((n) => n.name === act.name);
      if (!next || (act.method ?? "GET") !== (next.method ?? "GET") || act.url !== next.url) breaking = true;
    }
    if (live.secrets.some((s) => !draft.secrets.some((n) => n.name === s.name))) breaking = true;
    if (canonical(live.auth) !== canonical(draft.auth) || live.mode !== draft.mode || live.scope !== draft.scope) breaking = true;
    if (live.domains.some((dom) => !draft.domains.includes(dom))) breaking = true;
  }
  return { files, breaking };
}

const bump = (v: string, breaking: boolean): string => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m || v === "0.0.0") return "1.0.0";
  return breaking ? `${Number(m[1]) + 1}.0.0` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
};

// ---- handlers ----

interface ConnectorDb { key: string; title: string; mode: Mode; scope: Scope; builtin: number; version: string; state: ConnectorState; def: string; created_at: number; updated_at: number }
interface DraftDb { draft_id: string; key: string; def: string; note: string | null; created_by: string | null; created_at: number; updated_at: number }

export function createRuntimeHandlers(deps: ConnectorsDeps): RuntimeHandlers {
  const { tx } = deps;
  const ready = (): void => { ensureTables(tx); seedBuiltins(deps); };
  const need = (ctx: ConnectorsCtx, key: string): ConnectorDb => {
    ready();
    return tx.get<ConnectorDb>("SELECT * FROM cn_connectors WHERE key = ?", key) ?? refuse(ctx, "validation.not_found", `There is no connector ${key}.`);
  };
  const rowOf = (r: ConnectorDb): ConnectorRow => {
    const def = JSON.parse(r.def) as ConnectorDef;
    return {
      key: r.key, title: r.title, mode: r.mode, scope: r.scope, builtin: r.builtin === 1, version: r.version, state: r.state, domains: def.domains, secrets: def.secrets,
      connections: tx.get<{ n: number }>("SELECT count(*) AS n FROM cn_connections WHERE connector = ?", r.key)?.n ?? 0,
      syncedTypes: def.syncedTypes ?? [], actions: def.actions.map((a) => a.name), sources: def.sources ?? [],
      ...(objectsOf(def) ? { objects: objectsOf(def)! } : {}),
    };
  };
  const draftOf = async (ctx: ConnectorsCtx, key: string, draftId?: string): Promise<{ row: DraftDb; def: ConnectorDef }> => {
    const row = draftId !== undefined
      ? tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE draft_id = ? AND key = ?", draftId, key)
      : tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", key);
    if (!row) return refuse(ctx, "validation.not_found", draftId ? `There is no draft ${draftId} of ${key}.` : `${key} has no draft: build one first.`);
    let def = JSON.parse(row.def) as ConnectorDef;
    const fromFolder = deps.loadFolderDef ? await deps.loadFolderDef(key) : undefined;
    if (fromFolder) {
      def = { ...fromFolder, key };
      tx.run("UPDATE cn_drafts SET def = ?, updated_at = ? WHERE draft_id = ?", JSON.stringify(def), nowOf(deps), row.draft_id);
    }
    return { row, def };
  };
  const folderFiles = (def: ConnectorDef): { path: string; content: string }[] => {
    const { actions, tests, ...main } = def;
    return [
      { path: "connector.toml", content: JSON.stringify(main, null, 2) },
      ...actions.map((a) => ({ path: `actions/${a.name}.json`, content: JSON.stringify(a, null, 2) })),
      ...(tests ?? []).map((t) => ({ path: `tests/${t.name}.json`, content: JSON.stringify(t, null, 2) })),
      { path: "README.md", content: `# ${def.title}\n\nConnector ${def.key} (${def.mode}). Domains: ${def.domains.join(", ") || "none yet"}.\n` },
    ];
  };

  return {
    "connectors.list": async (_ctx, input) => {
      ready();
      const rows = tx.all<ConnectorDb>(`SELECT * FROM cn_connectors ${input.state !== undefined ? "WHERE state = ?" : ""} ORDER BY builtin DESC, key`, ...(input.state !== undefined ? [input.state] : [])).map(rowOf);
      const { start, limit } = PAGE(input);
      return { connectors: rows.slice(start, start + limit), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "connectors.get": async (ctx, input) => ({ connector: rowOf(need(ctx, input.key)) }),

    "connectors.init": async (ctx, input) => {
      ready();
      if (!KEY.test(input.key)) refuse(ctx, "validation.bad_input", `${input.key} is not a connector key: lowercase letters, digits, dashes and underscores.`);
      if (!MODES.includes(input.mode)) refuse(ctx, "validation.bad_input", `${String(input.mode)} is not a connector mode.`);
      if (!input.title.trim()) refuse(ctx, "validation.bad_input", "A connector needs a title.");
      if (tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = ?", input.key)) refuse(ctx, "validation.duplicate", `There is already a connector ${input.key}.`);
      const now = nowOf(deps);
      const def: ConnectorDef = {
        key: input.key, title: input.title, mode: input.mode, scope: input.mode === "webhook_only" || input.mode === "api" ? "space" : "person", version: "0.0.0",
        auth: { type: input.mode === "webhook_only" ? "none" : "api_key", ...(input.mode === "webhook_only" ? {} : { secret: `${input.title.replace(/[^A-Za-z0-9]+/g, "_")}_Key` }) },
        domains: [], secrets: input.mode === "webhook_only" ? [] : [{ name: `${input.title.replace(/[^A-Za-z0-9]+/g, "_")}_Key`, description: `API key for ${input.title}` }], actions: [], tests: [],
      };
      tx.run("INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 0, '0.0.0', 'draft', ?, ?, ?)", input.key, input.title, def.mode, def.scope, JSON.stringify(def), now, now);
      const draftId = mintShort("cdr", now);
      tx.run("INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", draftId, input.key, JSON.stringify(def), input.docsUrl ?? null, ctx.actor ?? null, now, now);
      const folderId = deps.writeFolder ? await deps.writeFolder(input.key, folderFiles(def)) : mintShort("fld", now);
      ctx.emit("connector.created", `connector/${input.key}`, { key: input.key });
      return { key: input.key, folderId };
    },

    "connectors.build": async (ctx, input) => {
      const c = need(ctx, input.key);
      const now = nowOf(deps);
      const draftId = mintShort("cdr", now);
      const base = (await draftOf(ctx, c.key).catch(() => undefined))?.def ?? (JSON.parse(c.def) as ConnectorDef);
      tx.run("INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", draftId, c.key, JSON.stringify(base), [input.docsUrl, input.notes].filter(Boolean).join("\n") || null, ctx.actor ?? null, now, now);
      const started = (await ctx.call("runs.start", { kind: "connector_build", owner: ctx.actor ?? "system", idempotencyKey: `connector_build:${c.key}:${draftId}`, name: `Build the ${c.title} connector` })) as { runId: string };
      ctx.emit("connector.built", `connector/${c.key}`, { key: c.key, draftId });
      return { runId: started.runId, draftId };
    },

    "connectors.test": async (ctx, input) => {
      const c = need(ctx, input.key);
      const useDraft = input.draftId !== undefined || (c.state === "draft" && tx.get("SELECT 1 AS x FROM cn_drafts WHERE key = ?", c.key) !== undefined);
      const def = useDraft ? (await draftOf(ctx, c.key, input.draftId)).def : (JSON.parse(c.def) as ConnectorDef);
      return { result: await runCases(deps, ctx, def) };
    },

    "connectors.run": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.state === "draft") refuse(ctx, "validation.precondition_failed", `${c.key} is a draft: publish it before running it against the app.`);
      const conn = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", input.connectionId) ?? refuse(ctx, "validation.not_found", "There is no such connection.");
      if (conn.owner_kind === "person" && conn.owner_id !== (ctx.actor ?? "system")) refuse(ctx, "validation.not_found", "There is no such connection.");
      const out = await executeAction(deps, ctx, JSON.parse(c.def) as ConnectorDef, input.action, { connection: conn, input: input.input, dryRun: input.dryRun === true });
      if (!out.dryRun) tx.run("UPDATE cn_connections SET last_sync_at = ? WHERE connection_id = ?", nowOf(deps), conn.connection_id);
      return { output: out.output, dryRun: out.dryRun };
    },

    "connectors.diff": async (ctx, input) => {
      const c = need(ctx, input.key);
      const { def } = await draftOf(ctx, c.key, input.draftId);
      return diffDefs(c.state === "draft" && c.version === "0.0.0" ? undefined : (JSON.parse(c.def) as ConnectorDef), def);
    },

    "connectors.publish": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.builtin === 1) refuse(ctx, "validation.precondition_failed", `${c.key} is built in: it changes with a release, not a publish.`);
      const { row, def } = await draftOf(ctx, c.key, input.draftId);
      const result = await runCases(deps, ctx, def);
      if (result.failed > 0) {
        ctx.emit("connector.publish_failed", `connector/${c.key}`, { key: c.key, failed: result.failed });
        return { published: false, result };
      }
      const live = c.version === "0.0.0" ? undefined : (JSON.parse(c.def) as ConnectorDef);
      const version = bump(c.version, live ? diffDefs(live, def).breaking : false);
      const now = nowOf(deps);
      const next: ConnectorDef = { ...clone(def), key: c.key, version };
      tx.run("INSERT INTO cn_versions (key, version, def, at, by, note, tests) VALUES (?, ?, ?, ?, ?, ?, ?)", c.key, version, JSON.stringify(next), now, ctx.actor ?? "system", input.note ?? null, result.passed);
      tx.run("UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, state = 'live', def = ?, updated_at = ? WHERE key = ?", next.title, next.mode, next.scope, version, JSON.stringify(next), now, c.key);
      tx.run("DELETE FROM cn_drafts WHERE draft_id = ?", row.draft_id);
      ctx.emit("connector.published", `connector/${c.key}`, { key: c.key, version, tests: result.passed });
      return { published: true, version, result };
    },

    "connectors.versions": async (ctx, input) => {
      need(ctx, input.key);
      const rows = tx.all<{ version: string; at: number; by: string; note: string | null; tests: number }>("SELECT version, at, by, note, tests FROM cn_versions WHERE key = ? ORDER BY at DESC, rowid DESC", input.key);
      return { versions: rows.map((r) => ({ version: r.version, at: r.at, by: r.by, ...(r.note !== null ? { note: r.note } : {}), tests: r.tests })) };
    },

    "connectors.rollback": async (ctx, input) => {
      const c = need(ctx, input.key);
      const v = tx.get<{ def: string }>("SELECT def FROM cn_versions WHERE key = ? AND version = ?", input.key, input.version) ?? refuse(ctx, "validation.not_found", `${c.key} has no version ${input.version}.`);
      const def = JSON.parse(v.def) as ConnectorDef;
      tx.run("UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, state = 'live', def = ?, updated_at = ? WHERE key = ?", def.title, def.mode, def.scope, input.version, v.def, nowOf(deps), c.key);
      ctx.emit("connector.rolled_back", `connector/${c.key}`, { key: c.key, version: input.version });
      return { ok: true };
    },

    "connectors.export": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (!deps.writeFolder) refuse(ctx, "internal.unavailable", "Files is not available to write the connector folder.");
      return { folderId: await deps.writeFolder!(c.key, folderFiles(JSON.parse(c.def) as ConnectorDef)) };
    },

    "connectors.remove": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.builtin === 1) refuse(ctx, "validation.precondition_failed", `${c.key} is built in and cannot be removed.`);
      const bound = deps.boundSyncedTypes ? await deps.boundSyncedTypes(c.key) : [];
      if (bound.length) refuse(ctx, "validation.precondition_failed", `${bound.join(", ")} still sync through ${c.key}: detach them first.`, { syncedTypes: bound });
      for (const conn of tx.all<{ connection_id: string }>("SELECT connection_id FROM cn_connections WHERE connector = ?", c.key)) {
        tx.run("DELETE FROM cn_oauth WHERE connection_id = ?", conn.connection_id);
        tx.run("DELETE FROM cn_connections WHERE connection_id = ?", conn.connection_id);
        ctx.emit("connection.deleted", `connection/${conn.connection_id}`, { connectionId: conn.connection_id, connector: c.key });
      }
      tx.run("DELETE FROM cn_drafts WHERE key = ?", c.key);
      tx.run("DELETE FROM cn_versions WHERE key = ?", c.key);
      tx.run("DELETE FROM cn_connectors WHERE key = ?", c.key);
      ctx.emit("connector.removed", `connector/${c.key}`, { key: c.key });
      return { removed: true };
    },

    "connectors.health": async () => {
      ready();
      const rows = tx.all<{ connection_id: string; state: string; title: string }>("SELECT connection_id, state, title FROM cn_connections WHERE state != 'paused'");
      const bad = rows.filter((r) => r.state === "failing" || r.state === "needs_reconnect");
      if (!bad.length) return { state: "healthy" as const, failing: [] };
      const down = bad.length === rows.length;
      return {
        state: down ? ("down" as const) : ("degraded" as const),
        detail: `${bad.length} of ${rows.length} connection${rows.length === 1 ? "" : "s"} ${bad.length === 1 ? "needs" : "need"} attention: ${bad.map((b) => b.title).join(", ")}`,
        failing: bad.map((b) => b.connection_id),
      };
    },
  };
}

export type { TestCase };
