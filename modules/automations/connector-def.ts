// A connector an agent or a person writes by hand: one app, the hosts it may reach, how its key travels, its actions and its triggers.
// The definition holds no key. The auth block names a Vault field, never a value. A definition is checked here before it is stored, and a stored one is always at a draft level until a read proves it.

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export type Method = (typeof METHODS)[number];

export type AuthKind = "api_key" | "bearer" | "basic" | "none";
export interface AuthMap {
  type: AuthKind;
  /** The Vault field that holds the key or the token. basic: the password field. */
  field?: string;
  /** basic: the Vault field that holds the user name. */
  userField?: string;
  /** The header the key travels in. Authorization for bearer and basic. */
  header?: string;
  /** Text put before the key in the header, such as "Bearer ". */
  prefix?: string;
  /** api_key sent in the query string instead of a header. */
  query?: string;
}

export interface Param {
  name: string;
  in: "path" | "query" | "header" | "body";
  required: boolean;
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
}

export interface ActionDef {
  key: string;
  title: string;
  description?: string;
  method: Method;
  /** Starts with a slash. {name} is replaced by the path parameter of that name. */
  path: string;
  params: Param[];
  /** A JSON pointer into the reply. Absent: the whole reply. */
  output?: string;
  /** One of the connector's hosts. Absent: the first. */
  host?: string;
  effect: "read" | "outward";
  /** A non-GET call that only reads, such as a search. Needed before it is tried with a key. */
  markedSafe?: boolean;
}

export type Cursor =
  | { mode: "none" }
  | { mode: "updated_since"; param: string; field: string; format: "iso" | "epoch_s" | "epoch_ms" }
  | { mode: "after_id"; param: string }
  | { mode: "next_token"; param: string; from: string };

export interface PollTrigger {
  key: string;
  title: string;
  kind: "poll";
  /** The key of a read action that lists items. */
  action: string;
  intervalSec: number;
  /** A JSON pointer to the list in the reply. Empty: the reply is the list. */
  items: string;
  /** The field of an item that is its id. A JSON pointer or a plain name. */
  idField: string;
  /** Which end of the list holds the newest item. */
  order: "newest_first" | "oldest_first";
  cursor: Cursor;
}
export interface WebhookTrigger {
  key: string;
  title: string;
  kind: "webhook";
  /** The field of the posted body that names the delivery, so a repeat is dropped. Absent: every post counts. */
  idField?: string;
  sample?: unknown;
}
export type TriggerDef = PollTrigger | WebhookTrigger;

export interface ConnectorDef {
  app: string;
  title: string;
  docsUrl?: string;
  domains: string[];
  auth: AuthMap;
  actions: ActionDef[];
  triggers: TriggerDef[];
}

export type Normalized = { ok: true; def: ConnectorDef } | { ok: false; problems: string[] };

export const APP_KEY = /^[a-z][a-z0-9_]{1,31}$/;
export const PART_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
/** Headers a connector must not set itself: the key travels in the auth block only. */
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "set-cookie", "host", "content-length", "connection", "proxy-authorization", "x-forwarded-for"]);
const MAX_BYTES = 96 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : undefined);

const SECRETISH = [
  /\bbearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
  /\bsk[-_](?:live|test|proj|ant)[-_][A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
/** A string that looks like a live key or token. Words such as api_key are names, not keys, and pass. */
export function looksLikeSecret(value: string): boolean {
  const collapsed = value.replace(/\s+/g, "");
  if (SECRETISH.some((re) => re.test(value) || re.test(collapsed))) return true;
  return /^[A-Za-z0-9+/_=-]{40,}$/.test(value.trim()) && /\d/.test(value) && /[A-Za-z]/.test(value);
}
function secretIn(v: unknown): boolean {
  if (typeof v === "string") return looksLikeSecret(v);
  if (Array.isArray(v)) return v.some(secretIn);
  if (isRecord(v)) return Object.values(v).some(secretIn);
  return false;
}

function pointerOk(p: string): boolean {
  return p === "" || /^(\/[^/~]*(~[01][^/~]*)*)+$/.test(p);
}

function normalizeAuth(raw: unknown, problems: string[]): AuthMap {
  if (!isRecord(raw)) { problems.push("auth is required. Use type none when the app needs no key."); return { type: "none" }; }
  const type = raw["type"];
  if (type !== "api_key" && type !== "bearer" && type !== "basic" && type !== "none") {
    problems.push("auth.type must be api_key, bearer, basic or none.");
    return { type: "none" };
  }
  const out: AuthMap = { type };
  if (type === "none") return out;
  const field = raw["field"] === undefined ? (type === "api_key" ? "api_key" : type === "bearer" ? "token" : "password") : raw["field"];
  if (typeof field !== "string" || !FIELD.test(field)) problems.push("auth.field must be the name of a Vault field, such as api_key.");
  else out.field = field;
  if (type === "basic") {
    const user = raw["userField"] === undefined ? "username" : raw["userField"];
    if (typeof user !== "string" || !FIELD.test(user)) problems.push("auth.userField must be the name of a Vault field, such as username.");
    else out.userField = user;
  }
  if (raw["query"] !== undefined) {
    if (type !== "api_key") problems.push("auth.query is only for api_key.");
    else if (typeof raw["query"] !== "string" || !NAME.test(raw["query"])) problems.push("auth.query must be a query parameter name.");
    else out.query = raw["query"];
  }
  if (out.query === undefined) {
    const header = raw["header"] === undefined ? (type === "api_key" ? "X-API-Key" : "Authorization") : raw["header"];
    if (typeof header !== "string" || !HEADER.test(header)) problems.push("auth.header must be a header name.");
    else out.header = header;
    const prefix = raw["prefix"] === undefined ? (type === "bearer" ? "Bearer " : "") : raw["prefix"];
    if (typeof prefix !== "string" || prefix.length > 24 || looksLikeSecret(prefix.trim()) || /[\r\n]/.test(prefix)) problems.push("auth.prefix must be short text such as \"Bearer \".");
    else if (prefix !== "") out.prefix = prefix;
  }
  return out;
}

function normalizeParam(raw: unknown, where: string, problems: string[]): Param | undefined {
  if (!isRecord(raw)) { problems.push(`${where}: a parameter is an object.`); return undefined; }
  const name = raw["name"];
  if (typeof name !== "string" || !NAME.test(name)) { problems.push(`${where}: a parameter needs a name.`); return undefined; }
  const place = raw["in"];
  if (place !== "path" && place !== "query" && place !== "header" && place !== "body") { problems.push(`${where}.${name}: in must be path, query, header or body.`); return undefined; }
  const type = raw["type"] === undefined ? "string" : raw["type"];
  if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean" && type !== "object" && type !== "array") { problems.push(`${where}.${name}: type is not one the connector knows.`); return undefined; }
  if (place === "header" && FORBIDDEN_HEADERS.has(name.toLowerCase())) { problems.push(`${where}.${name}: this header is set by the Vyre. Put the key in auth.`); return undefined; }
  const required = place === "path" ? true : raw["required"] === true;
  const description = text(raw["description"], 300);
  return { name, in: place, required, type, ...(description ? { description } : {}) };
}

function normalizeAction(raw: unknown, index: number, auth: AuthMap, domains: readonly string[], problems: string[]): ActionDef | undefined {
  const at = `actions[${index}]`;
  if (!isRecord(raw)) { problems.push(`${at} is not an object.`); return undefined; }
  const key = raw["key"];
  if (typeof key !== "string" || !PART_KEY.test(key)) { problems.push(`${at}.key must be lowercase letters, digits and underscores, such as list_customers.`); return undefined; }
  const where = `action ${key}`;
  const title = text(raw["title"], 120);
  if (!title) problems.push(`${where}: a title is required.`);
  const method = typeof raw["method"] === "string" ? raw["method"].toUpperCase() : "";
  if (!(METHODS as readonly string[]).includes(method)) { problems.push(`${where}: method must be one of ${METHODS.join(", ")}.`); return undefined; }
  const path = raw["path"];
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 300 || /[?#\s]/.test(path) || path.includes("//") || path.split("/").includes("..")) {
    problems.push(`${where}: path must start with / and carry no query, fragment or host. Put query values in params.`);
    return undefined;
  }
  const placeholders = [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_.-]{0,63})\}/g)].map((m) => m[1]!);
  const stripped = path.replace(/\{[^}]*\}/g, "");
  if (/[{}]/.test(stripped)) { problems.push(`${where}: path has a brace that is not a {name}.`); return undefined; }
  const paramsRaw = raw["params"] === undefined ? [] : raw["params"];
  if (!Array.isArray(paramsRaw) || paramsRaw.length > 40) { problems.push(`${where}: params is a list of at most 40.`); return undefined; }
  const params: Param[] = [];
  const seen = new Set<string>();
  for (const p of paramsRaw) {
    const one = normalizeParam(p, where, problems);
    if (!one) continue;
    const id = `${one.in}:${one.name}`;
    if (seen.has(id)) { problems.push(`${where}.${one.name}: listed twice.`); continue; }
    seen.add(id);
    params.push(one);
  }
  for (const name of placeholders) if (!params.some((p) => p.in === "path" && p.name === name)) problems.push(`${where}: path names {${name}} but no path parameter has that name.`);
  for (const p of params) if (p.in === "path" && !placeholders.includes(p.name)) problems.push(`${where}.${p.name}: a path parameter the path does not use.`);
  if (auth.header !== undefined) for (const p of params) if (p.in === "header" && p.name.toLowerCase() === auth.header.toLowerCase()) problems.push(`${where}.${p.name}: this header carries the key. Remove the parameter.`);
  if (auth.query !== undefined) for (const p of params) if (p.in === "query" && p.name === auth.query) problems.push(`${where}.${p.name}: this query value carries the key. Remove the parameter.`);
  if ((method === "GET" || method === "HEAD") && params.some((p) => p.in === "body")) problems.push(`${where}: a ${method} call has no body.`);
  let output: string | undefined;
  if (raw["output"] !== undefined) {
    if (typeof raw["output"] !== "string" || !pointerOk(raw["output"])) problems.push(`${where}: output must be a JSON pointer such as /data.`);
    else output = raw["output"];
  }
  const readMethod = method === "GET" || method === "HEAD";
  const effect = raw["effect"] === undefined ? (readMethod ? "read" : "outward") : raw["effect"];
  if (effect !== "read" && effect !== "outward") { problems.push(`${where}: effect must be read or outward.`); return undefined; }
  const markedSafe = raw["markedSafe"] === true;
  if (effect === "read" && !readMethod && !markedSafe) problems.push(`${where}: a ${method} call is outward unless markedSafe is true. Mark it only when it reads.`);
  if (effect === "outward" && readMethod) problems.push(`${where}: a ${method} call reads. Set effect to read.`);
  const description = text(raw["description"], 400);
  let host: string | undefined;
  if (raw["host"] !== undefined) {
    const named = typeof raw["host"] === "string" ? raw["host"].trim().toLowerCase() : "";
    if (!domains.includes(named)) problems.push(`${where}: host must be one of the connector's domains.`);
    else host = named;
  }
  if (!title) return undefined;
  return { key, title, ...(description ? { description } : {}), method: method as Method, path, params, ...(output !== undefined ? { output } : {}), ...(host ? { host } : {}), effect, ...(markedSafe ? { markedSafe: true } : {}) };
}

function normalizeCursor(raw: unknown, where: string, problems: string[]): Cursor {
  if (raw === undefined) return { mode: "none" };
  if (!isRecord(raw)) { problems.push(`${where}: cursor is an object.`); return { mode: "none" }; }
  const mode = raw["mode"];
  const param = raw["param"];
  const paramOk = typeof param === "string" && NAME.test(param);
  if (mode === "none") return { mode: "none" };
  if (mode === "updated_since") {
    const field = raw["field"];
    const format = raw["format"] === undefined ? "iso" : raw["format"];
    if (!paramOk) problems.push(`${where}: cursor.param is the query value the app takes, such as updated_since.`);
    if (typeof field !== "string" || field === "") problems.push(`${where}: cursor.field is the item field that holds its update time.`);
    if (format !== "iso" && format !== "epoch_s" && format !== "epoch_ms") problems.push(`${where}: cursor.format is iso, epoch_s or epoch_ms.`);
    if (!paramOk || typeof field !== "string" || field === "" || (format !== "iso" && format !== "epoch_s" && format !== "epoch_ms")) return { mode: "none" };
    return { mode, param: param as string, field, format };
  }
  if (mode === "after_id") {
    if (!paramOk) { problems.push(`${where}: cursor.param is the query value the app takes, such as after.`); return { mode: "none" }; }
    return { mode, param: param as string };
  }
  if (mode === "next_token") {
    const from = raw["from"];
    if (!paramOk || typeof from !== "string" || !pointerOk(from) || from === "") { problems.push(`${where}: cursor.param and cursor.from (a JSON pointer to the next token) are required.`); return { mode: "none" }; }
    return { mode, param: param as string, from };
  }
  problems.push(`${where}: cursor.mode is none, updated_since, after_id or next_token.`);
  return { mode: "none" };
}

function normalizeTrigger(raw: unknown, index: number, actions: readonly ActionDef[], problems: string[]): TriggerDef | undefined {
  const at = `triggers[${index}]`;
  if (!isRecord(raw)) { problems.push(`${at} is not an object.`); return undefined; }
  const key = raw["key"];
  if (typeof key !== "string" || !PART_KEY.test(key)) { problems.push(`${at}.key must be lowercase letters, digits and underscores, such as new_customer.`); return undefined; }
  const where = `trigger ${key}`;
  const title = text(raw["title"], 120);
  if (!title) { problems.push(`${where}: a title is required.`); return undefined; }
  if (raw["kind"] === "webhook") {
    const idField = raw["idField"];
    if (idField !== undefined && (typeof idField !== "string" || idField === "")) problems.push(`${where}: idField is the body field that names a delivery.`);
    if (raw["sample"] !== undefined && JSON.stringify(raw["sample"]).length > 4000) problems.push(`${where}: sample is too long. Keep it under 4000 characters.`);
    return { key, title, kind: "webhook", ...(typeof idField === "string" && idField !== "" ? { idField } : {}), ...(raw["sample"] !== undefined ? { sample: raw["sample"] } : {}) };
  }
  if (raw["kind"] !== "poll") { problems.push(`${where}: kind is poll or webhook.`); return undefined; }
  const action = raw["action"];
  const source = actions.find((a) => a.key === action);
  if (typeof action !== "string" || !source) { problems.push(`${where}: action must be the key of an action listed in actions.`); return undefined; }
  if (source.effect !== "read" || source.method !== "GET") problems.push(`${where}: a polling trigger reads with a GET action. ${source.key} is ${source.method}.`);
  if (source.params.some((p) => p.required && p.in !== "path")) problems.push(`${where}: ${source.key} has a required parameter. A polling trigger can only call an action that needs none.`);
  if (source.params.some((p) => p.in === "path")) problems.push(`${where}: ${source.key} has a path parameter. A polling trigger can only call a list.`);
  const interval = raw["intervalSec"] === undefined ? 300 : raw["intervalSec"];
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 60 || interval > 86_400) problems.push(`${where}: intervalSec is a whole number from 60 to 86400.`);
  const items = raw["items"] === undefined ? "" : raw["items"];
  if (typeof items !== "string" || !pointerOk(items)) problems.push(`${where}: items is a JSON pointer to the list, such as /data. Leave it empty when the reply is the list.`);
  const idField = raw["idField"] === undefined ? "id" : raw["idField"];
  if (typeof idField !== "string" || idField === "" || (idField.startsWith("/") && !pointerOk(idField))) problems.push(`${where}: idField names the item field that is its id.`);
  const order = raw["order"] === undefined ? "newest_first" : raw["order"];
  if (order !== "newest_first" && order !== "oldest_first") problems.push(`${where}: order is newest_first or oldest_first.`);
  const cursor = normalizeCursor(raw["cursor"], where, problems);
  if (cursor.mode !== "none" && source.params.some((p) => p.in === "query" && p.name === cursor.param) === false) {
    problems.push(`${where}: ${source.key} has no query parameter ${cursor.param}. Add it to the action so the poller can send the cursor.`);
  }
  return { key, title, kind: "poll", action: action as string, intervalSec: typeof interval === "number" ? interval : 300, items: typeof items === "string" ? items : "", idField: typeof idField === "string" ? idField : "id", order: order === "oldest_first" ? "oldest_first" : "newest_first", cursor };
}

/** Check a definition and return the form that is stored. Every problem is listed so a writer can fix them all in one pass. */
export function normalizeConnector(input: unknown): Normalized {
  const problems: string[] = [];
  if (!isRecord(input)) return { ok: false, problems: ["The connector is an object."] };
  if (JSON.stringify(input).length > MAX_BYTES) return { ok: false, problems: ["The connector is too large. Keep it under 96 KB."] };
  if (secretIn(input)) return { ok: false, problems: ["The connector holds something that looks like a key. A key lives in the Vault. Name its field in auth.field and remove the value."] };
  const app = input["app"];
  if (typeof app !== "string" || !APP_KEY.test(app)) problems.push("app must be lowercase letters, digits and underscores, 2 to 32 long, such as stripe.");
  const title = text(input["title"], 80);
  if (!title) problems.push("title is required, such as Stripe.");
  let docsUrl: string | undefined;
  if (input["docsUrl"] !== undefined) {
    try {
      const u = new URL(String(input["docsUrl"]));
      if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") throw new Error("bad");
      docsUrl = u.href;
    } catch { problems.push("docsUrl is an https address without a user name, query or fragment."); }
  }
  const domainsRaw = input["domains"];
  const domains: string[] = [];
  if (!Array.isArray(domainsRaw) || domainsRaw.length === 0 || domainsRaw.length > 8) problems.push("domains lists 1 to 8 hosts the connector may reach, such as api.stripe.com.");
  else {
    for (const d of domainsRaw) {
      const host = typeof d === "string" ? d.trim().toLowerCase().replace(/\.$/, "") : "";
      if (!HOST.test(host) || /^\d+(\.\d+){3}$/.test(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) problems.push(`domains: ${JSON.stringify(d)} is not a public host name.`);
      else if (!domains.includes(host)) domains.push(host);
    }
  }
  const auth = normalizeAuth(input["auth"], problems);
  const actionsRaw = input["actions"] === undefined ? [] : input["actions"];
  const actions: ActionDef[] = [];
  if (!Array.isArray(actionsRaw) || actionsRaw.length > 80) problems.push("actions is a list of at most 80.");
  else {
    actionsRaw.forEach((a, i) => {
      const one = normalizeAction(a, i, auth, domains, problems);
      if (!one) return;
      if (actions.some((x) => x.key === one.key)) problems.push(`action ${one.key}: listed twice.`);
      else actions.push(one);
    });
  }
  const triggersRaw = input["triggers"] === undefined ? [] : input["triggers"];
  const triggers: TriggerDef[] = [];
  if (!Array.isArray(triggersRaw) || triggersRaw.length > 20) problems.push("triggers is a list of at most 20.");
  else {
    triggersRaw.forEach((t, i) => {
      const one = normalizeTrigger(t, i, actions, problems);
      if (!one) return;
      if (triggers.some((x) => x.key === one.key)) problems.push(`trigger ${one.key}: listed twice.`);
      else triggers.push(one);
    });
  }
  if (actions.length === 0 && triggers.length === 0) problems.push("Add at least one action or trigger.");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, def: { app: app as string, title: title as string, ...(docsUrl ? { docsUrl } : {}), domains, auth, actions, triggers } };
}

/** The key a step uses for one action. It is the app and the action joined by a hyphen, so it never matches a built-in step. */
export function actionStepKey(app: string, action: string): string {
  return `${app}-${action}`;
}
export function triggerLevelKey(app: string, trigger: string): string {
  return `trigger:${app}.${trigger}`;
}
/** Split a step key into its app and action. Neither part holds a hyphen. */
export function splitStepKey(stepKey: string): { app: string; action: string } | undefined {
  const m = /^([a-z][a-z0-9_]{1,31})-([a-z][a-z0-9_]{0,40})$/.exec(stepKey);
  return m ? { app: m[1]!, action: m[2]! } : undefined;
}

/** What a level depends on. A change to any of it sends the action back to draft. */
export function actionFingerprint(def: ConnectorDef, action: ActionDef): string {
  return fingerprint(JSON.stringify({ d: def.domains, a: def.auth, x: action }));
}
export function triggerFingerprint(def: ConnectorDef, trigger: TriggerDef): string {
  const source = trigger.kind === "poll" ? def.actions.find((a) => a.key === trigger.action) : undefined;
  return fingerprint(JSON.stringify({ d: def.domains, a: def.auth, t: trigger, s: source }));
}

/** Two 53-bit hashes of the text, as 28 hex digits. It notices a change; it is not a security measure. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x7f4a7c15;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822519); h4 = Math.imul(h4 ^ c, 3266489917);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  return [h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("").slice(0, 28);
}

/** A JSON pointer read. A missing step answers undefined. */
export function pointerGet(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let at: unknown = value;
  for (const raw of pointer.split("/").slice(1)) {
    const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(at)) at = /^\d+$/.test(part) ? at[Number(part)] : undefined;
    else if (isRecord(at)) at = Object.hasOwn(at, part) ? at[part] : undefined;
    else return undefined;
  }
  return at;
}
