// connector.toml to a ConnectorDef (spec 2.10): the shape modules/connectors runs, plus the source and synced-type declarations the sources module binds.
// The recorded responses named by `file` in a [[tests.responses]] table are read through `readFile` and become the body of the response.
import { parseToml } from "./toml.ts";
import type { TomlTable, TomlValue } from "./toml.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ActionDef { name: string; method?: Method; url: string; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown; output?: string; write?: boolean }
export interface RecordedResponse { method?: string; url: string; status?: number; body?: unknown }
export interface TestCase { name: string; action: string; input?: unknown; responses: RecordedResponse[]; expect?: { output?: unknown; error?: string; requests?: number } }
export interface AuthDef { type: "oauth2"; secret: string; authUrl: string; tokenUrl: string; scopes: string[]; pkce: boolean }
export interface SourceDef { key: string; path: string; verify: "hmac" | "signature" | "none"; event: string; dedupe: string }
export type Dir = "pull" | "push" | "both" | "off";
export interface SyncedTypeDef {
  type: string; remote: string; fields: { key: string; remote: string; dir: Dir; transform?: string }[]; match: string[]; createAtSource: boolean; deletes: "off" | "soft" | "travel";
  conflict: "newest" | "source" | "vyre" | "ask"; polling: { activeSec: number; idleSec: number; dormantSec: number }; nightlyReconcile: boolean;
}
/** What modules/connectors executes (its ConnectorDef): actions are HTTP templates, syncedTypes are the remote object names. */
export interface RuntimeDef {
  key: string; title: string; mode: "api"; scope: "space" | "person"; version: string; auth: AuthDef; domains: string[]; secrets: { name: string; description: string }[];
  actions: ActionDef[]; sources: string[]; syncedTypes: string[]; health: string; rate: { rps: number; burst: number }; tests: TestCase[];
}
/** The frozen contract view of the same connector (packages/contracts ConnectorDef). */
export interface ContractView {
  key: string; title: string; mode: "api"; scope: "space" | "person"; auth: Omit<AuthDef, "secret">; domains: string[]; secrets: { name: string; description: string }[]; sources: SourceDef[];
  syncedTypes: SyncedTypeDef[]; actions: string[]; rate: { rps: number; burst: number }; health: string; tests: string;
}
export interface Compiled { def: RuntimeDef; sources: SourceDef[]; syncedTypes: SyncedTypeDef[]; contract: ContractView }

export class ConnectorFileError extends Error {
  constructor(message: string) { super(message); this.name = "ConnectorFileError"; }
}

const bad = (where: string, what: string): never => { throw new ConnectorFileError(`connector.toml ${where}: ${what}`); };
const isTable = (v: unknown): v is TomlTable => typeof v === "object" && v !== null && !Array.isArray(v);

function str(t: TomlTable, k: string, where: string, opt = false): string {
  const v = t[k];
  if (v === undefined && opt) return "";
  if (typeof v !== "string") return bad(where, `${k} must be a string.`);
  return v;
}
function oneOf<T extends string>(t: TomlTable, k: string, where: string, allowed: readonly T[], dflt?: T): T {
  const v = t[k] ?? dflt;
  if (typeof v !== "string" || !allowed.includes(v as T)) return bad(where, `${k} must be one of ${allowed.join(", ")}.`);
  return v as T;
}
function num(t: TomlTable, k: string, where: string): number {
  const v = t[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return bad(where, `${k} must be a number of zero or more.`);
  return v;
}
function list(t: TomlTable, k: string, where: string): TomlValue[] {
  const v = t[k];
  if (v === undefined) return [];
  if (!Array.isArray(v)) return bad(where, `${k} must be a list.`);
  return v;
}
function strings(t: TomlTable, k: string, where: string): string[] {
  return list(t, k, where).map((x) => (typeof x === "string" ? x : bad(where, `${k} holds only strings.`)));
}
function tables(t: TomlTable, k: string, where: string): TomlTable[] {
  return list(t, k, where).map((x, i) => (isTable(x) ? x : bad(`${where}.${k}[${i}]`, "must be a table.")));
}
function strMap(v: TomlValue | undefined, where: string): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  if (!isTable(v)) return bad(where, "must be a table of strings.");
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) out[k] = typeof x === "string" ? x : bad(where, `${k} must be a string.`);
  return out;
}

export function compileConnector(text: string, readFile: (relative: string) => string): Compiled {
  const root = parseToml(text);
  const key = str(root, "key", "key");
  if (!/^[a-z][a-z0-9_-]{0,40}$/.test(key)) bad("key", "must be lower case letters, digits, dash or underscore.");
  const authT = root["auth"];
  if (!isTable(authT)) return bad("[auth]", "is missing.");
  if (authT["type"] !== "oauth2") bad("[auth]", "HubSpot signs in with oauth2.");
  const auth: AuthDef = {
    type: "oauth2", secret: str(authT, "secret", "[auth]"), authUrl: str(authT, "authUrl", "[auth]"), tokenUrl: str(authT, "tokenUrl", "[auth]"),
    scopes: strings(authT, "scopes", "[auth]"), pkce: authT["pkce"] === true,
  };
  const secrets = tables(root, "secrets", "secrets").map((s, i) => ({ name: str(s, "name", `secrets[${i}]`), description: str(s, "description", `secrets[${i}]`) }));
  if (!secrets.some((s) => s.name === auth.secret)) bad("[auth]", `secret ${auth.secret} is not declared under [[secrets]].`);
  const domains = strings(root, "domains", "domains");
  if (!domains.length) bad("domains", "needs at least one domain.");
  const rateT = root["rate"];
  if (!isTable(rateT)) return bad("rate", "is missing.");
  const rate = { rps: num(rateT, "rps", "rate"), burst: num(rateT, "burst", "rate") };

  const sources = tables(root, "sources", "sources").map((s, i): SourceDef => ({
    key: str(s, "key", `sources[${i}]`), path: str(s, "path", `sources[${i}]`), verify: oneOf(s, "verify", `sources[${i}]`, ["hmac", "signature", "none"] as const),
    event: str(s, "event", `sources[${i}]`), dedupe: str(s, "dedupe", `sources[${i}]`),
  }));

  const syncedTypes = tables(root, "synced_types", "synced_types").map((s, i): SyncedTypeDef => {
    const w = `synced_types[${i}]`;
    const fields = tables(s, "fields", w).map((f, j) => ({
      key: str(f, "key", `${w}.fields[${j}]`), remote: str(f, "remote", `${w}.fields[${j}]`), dir: oneOf(f, "dir", `${w}.fields[${j}]`, ["pull", "push", "both", "off"] as const),
      ...(typeof f["transform"] === "string" ? { transform: f["transform"] } : {}),
    }));
    if (!fields.length) bad(w, "needs at least one field.");
    const match = strings(s, "match", w);
    if (!match.length) bad(w, "needs a match rule: the first sync has to pair records.");
    for (const m of match) if (!fields.some((f) => f.key === m)) bad(w, `match field ${m} is not mapped.`);
    const p = s["polling"];
    if (!isTable(p)) return bad(w, "polling is missing.");
    return {
      type: str(s, "type", w), remote: str(s, "remote", w), fields, match,
      createAtSource: s["createAtSource"] === true,
      deletes: oneOf(s, "deletes", w, ["off", "soft", "travel"] as const, "off"),
      conflict: oneOf(s, "conflict", w, ["newest", "source", "vyre", "ask"] as const, "ask"),
      polling: { activeSec: num(p, "activeSec", `${w}.polling`), idleSec: num(p, "idleSec", `${w}.polling`), dormantSec: num(p, "dormantSec", `${w}.polling`) },
      nightlyReconcile: s["nightlyReconcile"] !== false,
    };
  });

  const actions = tables(root, "actions", "actions").map((a, i): ActionDef => {
    const w = `actions[${i}]`;
    const method = oneOf(a, "method", w, ["GET", "POST", "PUT", "PATCH", "DELETE"] as const, "GET");
    const headers = strMap(a["headers"], `${w}.headers`);
    const query = strMap(a["query"], `${w}.query`);
    return {
      name: str(a, "name", w), ...(method !== "GET" ? { method } : {}), url: str(a, "url", w),
      ...(headers ? { headers } : {}), ...(query ? { query } : {}), ...(a["body"] !== undefined ? { body: a["body"] } : {}),
      ...(typeof a["output"] === "string" ? { output: a["output"] } : {}), ...(a["write"] === true ? { write: true } : {}),
    };
  });
  const names = new Set<string>();
  for (const a of actions) { if (names.has(a.name)) bad("actions", `${a.name} is declared twice.`); names.add(a.name); }
  const health = str(root, "health", "health");
  if (!names.has(health)) bad("health", `${health} is not an action.`);

  const tests = tables(root, "tests", "tests").map((t, i): TestCase => {
    const w = `tests[${i}]`;
    const action = str(t, "action", w);
    if (!names.has(action)) bad(w, `${action} is not an action.`);
    const responses = tables(t, "responses", w).map((r, j): RecordedResponse => {
      const rw = `${w}.responses[${j}]`;
      const file = str(r, "file", rw);
      let body: unknown;
      try { body = JSON.parse(readFile(file)); } catch (e) { return bad(rw, `${file} is not a readable JSON file (${e instanceof Error ? e.message : String(e)}).`); }
      return { ...(typeof r["method"] === "string" ? { method: r["method"] } : {}), url: str(r, "url", rw), ...(typeof r["status"] === "number" ? { status: r["status"] } : {}), body };
    });
    const e = t["expect"];
    return {
      name: str(t, "name", w), action, ...(t["input"] !== undefined ? { input: t["input"] } : {}), responses,
      ...(isTable(e) ? { expect: { ...(e["output"] !== undefined ? { output: e["output"] } : {}), ...(typeof e["error"] === "string" ? { error: e["error"] } : {}), ...(typeof e["requests"] === "number" ? { requests: e["requests"] } : {}) } } : {}),
    };
  });

  const def: RuntimeDef = {
    key, title: str(root, "title", "title"), mode: oneOf(root, "mode", "mode", ["api"] as const), scope: oneOf(root, "scope", "scope", ["space", "person"] as const), version: str(root, "version", "version"),
    auth, domains, secrets, actions, sources: sources.map((s) => s.key), syncedTypes: syncedTypes.map((s) => s.remote), health, rate, tests,
  };
  const { secret: _secret, ...authView } = auth;
  void _secret;
  const contract: ContractView = {
    key, title: def.title, mode: def.mode, scope: def.scope, auth: authView, domains, secrets, sources, syncedTypes, actions: strings(root, "capabilities", "capabilities"), rate,
    health: str(root, "healthCheck", "healthCheck"), tests: `connectors/${key}/tests`,
  };
  return { def, sources, syncedTypes, contract };
}
