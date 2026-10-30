// One request built from a stored connector action. The key is put on the request here, in memory, at the moment of sending, and is scrubbed from whatever comes back.
// Nothing in this file reads the Vault or the network.
import { pointerGet } from "./connector-def.ts";
import type { ActionDef, AuthMap, ConnectorDef, Param } from "./connector-def.ts";

export interface Built {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  body?: string;
}
export interface KeyValues {
  /** The Vault value of auth.field. */
  secret?: string;
  /** basic: the Vault value of auth.userField. */
  user?: string;
}
export type BuildResult = { ok: true; request: Built } | { ok: false; reason: string; missing?: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalar(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
}

function fits(p: Param, v: unknown): boolean {
  switch (p.type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "object": return isRecord(v);
    case "array": return Array.isArray(v);
  }
}

/** The names of the required parameters a caller did not give. */
export function missingParams(action: ActionDef, input: Record<string, unknown>): string[] {
  return action.params.filter((p) => p.required && (input[p.name] === undefined || input[p.name] === null)).map((p) => p.name);
}

function authHeaders(auth: AuthMap, key: KeyValues): { headers: Record<string, string>; query?: [string, string] } | { reason: string } {
  if (auth.type === "none") return { headers: {} };
  if (key.secret === undefined || key.secret === "") return { reason: "The key is empty." };
  if (/[\r\n\0]/.test(key.secret)) return { reason: "The key holds a character a header cannot carry." };
  if (auth.type === "basic") {
    if (key.user === undefined) return { reason: "The user name is empty." };
    const token = Buffer.from(`${key.user}:${key.secret}`).toString("base64");
    return { headers: { [auth.header ?? "Authorization"]: `${auth.prefix ?? "Basic "}${token}` } };
  }
  if (auth.query !== undefined) return { headers: {}, query: [auth.query, key.secret] };
  return { headers: { [auth.header ?? "Authorization"]: `${auth.prefix ?? ""}${key.secret}` } };
}

export function buildRequest(def: ConnectorDef, action: ActionDef, rawInput: Record<string, unknown>, key: KeyValues, extraQuery: Record<string, string> = {}): BuildResult {
  const known = new Set(action.params.map((p) => p.name));
  const strays = Object.keys(rawInput).filter((k) => !known.has(k));
  if (strays.length > 0) return { ok: false, reason: `${action.key} takes no ${strays.slice(0, 3).join(", ")}. It takes: ${[...known].join(", ") || "nothing"}.` };
  const missing = missingParams(action, rawInput);
  if (missing.length > 0) return { ok: false, reason: `${action.key} needs ${missing.join(", ")}.`, missing };
  for (const p of action.params) {
    const v = rawInput[p.name];
    if (v === undefined || v === null) continue;
    if (!fits(p, v)) return { ok: false, reason: `${p.name} must be a ${p.type}.` };
  }
  const host = action.host ?? def.domains[0];
  if (host === undefined) return { ok: false, reason: "The connector names no host." };

  let path = action.path;
  for (const p of action.params) {
    if (p.in !== "path") continue;
    const v = scalar(rawInput[p.name]);
    if (v === undefined || v === "") return { ok: false, reason: `${p.name} must be a value.` };
    path = path.split(`{${p.name}}`).join(encodeURIComponent(v));
  }
  const auth = authHeaders(def.auth, key);
  if ("reason" in auth) return { ok: false, reason: auth.reason };

  const search = new URLSearchParams();
  for (const p of action.params) {
    if (p.in !== "query") continue;
    const v = rawInput[p.name];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { for (const item of v) { const s = scalar(item); if (s === undefined) return { ok: false, reason: `${p.name} holds a value a query cannot carry.` }; search.append(p.name, s); } continue; }
    const s = scalar(v);
    if (s === undefined) return { ok: false, reason: `${p.name} holds a value a query cannot carry.` };
    search.set(p.name, s);
  }
  for (const [k, v] of Object.entries(extraQuery)) search.set(k, v);
  if (auth.query) search.set(auth.query[0], auth.query[1]);

  const headers: Record<string, string> = { accept: "application/json", "user-agent": "Vyre-Automations", ...auth.headers };
  for (const p of action.params) {
    if (p.in !== "header") continue;
    const s = scalar(rawInput[p.name]);
    if (s === undefined) continue;
    if (/[\r\n\0]/.test(s)) return { ok: false, reason: `${p.name} holds a character a header cannot carry.` };
    headers[p.name.toLowerCase()] = s;
  }

  let body: string | undefined;
  const bodyParams = action.params.filter((p) => p.in === "body");
  if (bodyParams.length > 0) {
    const obj: Record<string, unknown> = {};
    for (const p of bodyParams) if (rawInput[p.name] !== undefined && rawInput[p.name] !== null) obj[p.name] = rawInput[p.name];
    body = JSON.stringify(obj);
    headers["content-type"] = "application/json";
  }
  const qs = search.toString();
  return { ok: true, request: { method: action.method, url: `https://${host}${path}${qs ? `?${qs}` : ""}`, host, headers, ...(body !== undefined ? { body } : {}) } };
}

/** Replace every spelling of a key value in a text. Short values are left alone, since they would also match ordinary words. */
export function scrubValues(textIn: string, values: readonly (string | undefined)[]): string {
  let out = textIn;
  for (const v of values) {
    if (v === undefined || v.length < 6) continue;
    for (const form of new Set([v, encodeURIComponent(v), Buffer.from(v).toString("base64"), JSON.stringify(v).slice(1, -1)])) out = out.split(form).join("[redacted]");
  }
  return out;
}

/** A reply read as JSON when it is JSON, else as text, then narrowed by the action's output pointer. */
export function readReply(textIn: string, action: ActionDef): unknown {
  let whole: unknown;
  try { whole = JSON.parse(textIn); } catch { return textIn.length > 8_000 ? `${textIn.slice(0, 8_000)}` : textIn; }
  if (action.output === undefined) return whole;
  const picked = pointerGet(whole, action.output);
  return picked === undefined ? null : picked;
}

/** The structure of a value and nothing else: keys and types, the first element of a list. For a writer to map fields without seeing the data. */
export function shapeOf(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? [] : [depth > 5 ? "…" : shapeOf(value[0], depth + 1)];
  if (typeof value === "object") {
    if (depth > 5) return "object";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) out[k] = shapeOf(v, depth + 1);
    return out;
  }
  return typeof value;
}
