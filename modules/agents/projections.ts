// @reads /modules/agents/migrations/0001_agents.sql
// Rows of the agents module (the agent, its routines, suggestions, snapshots and the template state), the agent.toml reader and writer, the checks a configuration must pass, the ports to Files
// (every file of an agent is a file in Agents/<name>), and the small pure helpers the handlers share (status, cron, unified diffs).
// Every statement names an agents_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintId as mint } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface Principal { kind: "person" | "agent" | "actor" | "service"; id: string }

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface AgentsCtx {
  space: string;
  principal: Principal;
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  authorize?(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Row = Record<string, unknown>;

export function raise(ctx: Pick<AgentsCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}
export const mintId = (prefix: string, now: number = Date.now()): string => mint(prefix, now).replaceAll("-", "");
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number => Number(v);
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const flag = (v: unknown): boolean => v === 1 || v === true || v === "1";
const parseJson = <T>(raw: unknown, fallback: T): T => { try { return raw === null || raw === undefined ? fallback : (JSON.parse(str(raw)) as T); } catch { return fallback; } };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The person behind a call: the person an agent acts for, else the caller. */
export const askerOf = (ctx: Pick<AgentsCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = ["0001_agents.sql", "0002_routine_watch.sql"].map((f) => readFileSync(new URL(`./migrations/${f}`, import.meta.url), "utf8")).join("\n")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** Make sure the agents tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT key FROM agents_meta WHERE key = ?", "probe"); db.all("SELECT routineId FROM agents_routine_watch WHERE routineId = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

export const meta = (db: Db, key: string): string | undefined => optStr((db.all("SELECT value FROM agents_meta WHERE key = ?", key) as Row[])[0]?.["value"]);
export const setMeta = (db: Db, key: string, value: string): void => { db.run("INSERT INTO agents_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value); };

// ---- limits of what an agent may be called ------------------------------------------------------------------------------------------------------------

export const MAX_NAME = 60;
export const MAX_ROLE = 200;
export const ROLE_WARN = 160;
export const MAX_PROMPT = 20_000;
export const MAX_DIFF = 100_000;
export const AWAKE_MS = 120_000;
export const NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/u;
export const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();
export const slug = (name: string): string => nameKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";

// ---- agent.toml ---------------------------------------------------------------------------------------------------------------------------------------

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlDoc = { [key: string]: TomlValue };
export interface TomlResult { value: TomlDoc; error?: { line: number; message: string }; keyLines: Map<string, number> }

class TomlError extends Error {
  readonly line: number;
  constructor(line: number, message: string) { super(message); this.line = line; }
}

function stripComment(s: string): string {
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = undefined; }
    else if (c === '"' || c === "'") q = c;
    else if (c === "#") return s.slice(0, i);
  }
  return s;
}
function splitTop(s: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = undefined; }
    else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    if (depth < 0) throw new TomlError(line, "A bracket closes that was never opened.");
  }
  if (q) throw new TomlError(line, "A string is not closed.");
  if (depth !== 0) throw new TomlError(line, "A bracket is not closed.");
  parts.push(s.slice(start));
  return parts;
}
function balanced(s: string): boolean {
  let depth = 0;
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = undefined; }
    else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth <= 0;
}
function keyName(raw: string, line: number): string {
  const k = raw.trim();
  if (/^[A-Za-z0-9_-]+$/.test(k)) return k;
  if (/^"[^"]*"$/.test(k) || /^'[^']*'$/.test(k)) return k.slice(1, -1);
  throw new TomlError(line, `"${k}" is not a valid key.`);
}
function scalar(raw: string, line: number): TomlValue {
  const s = raw.trim();
  if (s === "") throw new TomlError(line, "A value is missing after the equals sign.");
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) throw new TomlError(line, "A string is not closed.");
    try { return JSON.parse(s) as string; } catch { throw new TomlError(line, "A string has a bad escape."); }
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) throw new TomlError(line, "A string is not closed.");
    return s.slice(1, -1);
  }
  if (/^[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?$/.test(s)) return Number(s.replaceAll("_", ""));
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new TomlError(line, "An array is not closed.");
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    const parts = splitTop(inner, line);
    if ((parts[parts.length - 1] ?? "").trim() === "") parts.pop();
    return parts.map((p) => scalar(p, line));
  }
  if (s.startsWith("{")) {
    if (!s.endsWith("}")) throw new TomlError(line, "An inline table is not closed.");
    const inner = s.slice(1, -1).trim();
    const out: TomlDoc = {};
    if (inner === "") return out;
    for (const part of splitTop(inner, line)) {
      const eq = part.indexOf("=");
      if (eq < 0) throw new TomlError(line, "An inline table entry needs key = value.");
      out[keyName(part.slice(0, eq), line)] = scalar(part.slice(eq + 1), line);
    }
    return out;
  }
  throw new TomlError(line, `"${s.length > 30 ? `${s.slice(0, 30)}...` : s}" is not a value; text needs quotes.`);
}

/** Reads the TOML an agent.toml uses: key = value (text, numbers, true/false, lists, inline tables), [tables] and [[lists of tables]], comments. Multi-line text is not supported (use \n). */
export function parseToml(text: string): TomlResult {
  const root: TomlDoc = {};
  const keyLines = new Map<string, number>();
  let cur: TomlDoc = root;
  let curPath = "";
  const lines = text.split("\n");
  try {
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const line = stripComment(lines[i] ?? "").trim();
      if (line === "") continue;
      const arr = /^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/.exec(line);
      if (arr?.[1] !== undefined) {
        const name = arr[1];
        const existing = root[name];
        if (existing !== undefined && !Array.isArray(existing)) throw new TomlError(lineNo, `${name} is already a table.`);
        const list: TomlValue[] = Array.isArray(existing) ? existing : [];
        const item: TomlDoc = {};
        list.push(item);
        root[name] = list;
        cur = item;
        curPath = `${name}[${list.length - 1}]`;
        keyLines.set(curPath, lineNo);
        continue;
      }
      const tbl = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/.exec(line);
      if (tbl?.[1] !== undefined) {
        const name = tbl[1];
        if (root[name] !== undefined) throw new TomlError(lineNo, `${name} is defined twice.`);
        const t: TomlDoc = {};
        root[name] = t;
        cur = t;
        curPath = name;
        keyLines.set(name, lineNo);
        continue;
      }
      if (line.startsWith("[")) throw new TomlError(lineNo, "A table header is malformed.");
      const eq = line.indexOf("=");
      if (eq < 0) throw new TomlError(lineNo, "Expected key = value.");
      const key = keyName(line.slice(0, eq), lineNo);
      let rhs = line.slice(eq + 1).trim();
      while (/^[[{]/.test(rhs) && !balanced(rhs)) {
        i++;
        if (i >= lines.length) throw new TomlError(lineNo, "A bracket is not closed.");
        rhs += ` ${stripComment(lines[i] ?? "").trim()}`;
      }
      if (rhs.startsWith('"""')) throw new TomlError(lineNo, "Multi-line strings are not supported; use one line with \\n.");
      if (Object.prototype.hasOwnProperty.call(cur, key)) throw new TomlError(lineNo, `${key} is set twice.`);
      cur[key] = scalar(rhs, lineNo);
      keyLines.set(curPath === "" ? key : `${curPath}.${key}`, lineNo);
    }
  } catch (e) {
    if (e instanceof TomlError) return { value: root, error: { line: e.line, message: e.message }, keyLines };
    throw e;
  }
  return { value: root, keyLines };
}

const keyOut = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
function valueOut(v: TomlValue): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(valueOut).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${keyOut(k)} = ${valueOut(x)}`).join(", ")} }`;
}
/** Writes a document back: plain values first, then [tables], then [[lists of tables]]. Comments in a hand-written file are not kept. */
export function dumpToml(doc: TomlDoc, header = ""): string {
  const out: string[] = header === "" ? [] : [header, ""];
  const isTable = (v: TomlValue): v is TomlDoc => typeof v === "object" && !Array.isArray(v);
  const isTableList = (v: TomlValue): v is TomlDoc[] => Array.isArray(v) && v.length > 0 && v.every(isTable);
  for (const [k, v] of Object.entries(doc)) if (!isTable(v) && !isTableList(v)) out.push(`${keyOut(k)} = ${valueOut(v)}`);
  for (const [k, v] of Object.entries(doc)) {
    if (isTable(v)) { out.push("", `[${k}]`); for (const [k2, v2] of Object.entries(v)) out.push(`${keyOut(k2)} = ${valueOut(v2)}`); }
  }
  for (const [k, v] of Object.entries(doc)) {
    if (isTableList(v)) for (const item of v) { out.push("", `[[${k}]]`); for (const [k2, v2] of Object.entries(item)) out.push(`${keyOut(k2)} = ${valueOut(v2)}`); }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

// ---- the configuration an agent.toml describes -------------------------------------------------------------------------------------------------------

export interface Limits { runCostMicros?: number; dayCostMicros?: number; monthCostMicros?: number; turnsPerDay?: number; minutesPerRun?: number; tokensPerDay?: number }
export type LimitKey = keyof Limits;
export interface AgentConfig {
  name: string; description?: string; model?: string; fallbackModel?: string; accountPolicy: "asker" | "key"; accountKey?: string; handoffs: string[];
  toolsAllowed: string[]; toolsDenied: string[]; vaultKeys: string[]; limits: Limits; captureMode: "propose" | "auto_low_risk" | "off";
}
/** manifest limit name -> key in [limits] of agent.toml (the keys files.lint knows). */
export const LIMIT_TOML: Readonly<Record<LimitKey, string>> = Object.freeze({
  runCostMicros: "per_run", dayCostMicros: "per_day", monthCostMicros: "per_month", turnsPerDay: "turns", minutesPerRun: "minutes", tokensPerDay: "tokens",
});
export const LIMIT_KEYS = Object.keys(LIMIT_TOML) as LimitKey[];
const TOP_KEYS = new Set(["name", "description", "model", "fallback_model", "account_policy", "handoffs", "tools", "vault", "limits", "approvals", "memory", "routines"]);
const CAPTURE = new Set(["propose", "auto_low_risk", "off"]);

export interface Problem { line?: number; message: string }
export interface Checked { ok: boolean; errors: Problem[]; warnings: Problem[]; config?: AgentConfig }

const strList = (v: TomlValue | undefined): string[] | null => (v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

/** The checks a configuration must pass to be the one that runs. Errors keep the last good version running; warnings are said and do not stop a save. */
export function checkToml(text: string, o: { agentNames?: readonly string[]; self?: string } = {}): Checked {
  const parsed = parseToml(text);
  const errors: Problem[] = [], warnings: Problem[] = [];
  const at = (path: string): number | undefined => parsed.keyLines.get(path);
  const err = (path: string, message: string): void => { const line = at(path); errors.push(line === undefined ? { message } : { line, message }); };
  const warn = (path: string, message: string): void => { const line = at(path); warnings.push(line === undefined ? { message } : { line, message }); };
  if (parsed.error) return { ok: false, errors: [{ line: parsed.error.line, message: parsed.error.message }], warnings };
  const d = parsed.value;
  for (const k of Object.keys(d)) if (!TOP_KEYS.has(k)) warn(k, `${k} is not a field of agent.toml and is ignored.`);
  for (const k of ["name", "description", "model", "fallback_model"] as const) if (d[k] !== undefined && typeof d[k] !== "string") err(k, `${k} must be text.`);
  if (typeof d["name"] !== "string" || d["name"].trim() === "") err("name", "An agent needs a name.");
  else if (NAME_BAD.test(d["name"]) || d["name"].length > MAX_NAME) err("name", `The name is up to ${MAX_NAME} characters with none of / \\ : * ? " < > |.`);
  const desc = d["description"];
  if (typeof desc === "string") {
    if (desc.includes("\n")) err("description", "The role line is one line.");
    else if (desc.length > MAX_ROLE) err("description", `The role line is up to ${MAX_ROLE} characters.`);
    else if (desc.length > ROLE_WARN) warn("description", `The role line is ${desc.length} characters; keep it under ${ROLE_WARN}.`);
  }
  const policy = d["account_policy"];
  if (policy !== undefined && policy !== "asker" && policy !== "key") err("account_policy", 'account_policy is "asker" or "key".');
  const hand = strList(d["handoffs"]);
  if (hand === null) err("handoffs", "handoffs is a list of agent names.");
  else if (o.agentNames) {
    const known = new Set(o.agentNames.map((n) => n.toLowerCase()));
    for (const h of hand) if (!known.has(h.toLowerCase()) && h.toLowerCase() !== (o.self ?? "").toLowerCase()) warn("handoffs", `Handoff to ${h}: there is no agent with that name in this Space.`);
  }
  const table = (k: string): TomlDoc | null => { const v = d[k]; if (v === undefined) return null; if (!isObj(v)) { err(k, `${k} is a table.`); return null; } return v as TomlDoc; };
  const tools = table("tools"), vault = table("vault"), limits = table("limits"), memory = table("memory");
  table("approvals");
  let allowed: string[] = [], denied: string[] = [], keys: string[] = [];
  if (tools) {
    const a = strList(tools["allowed"]), b = strList(tools["denied"]);
    if (a === null) err("tools.allowed", "tools.allowed is a list of tool names."); else allowed = a;
    if (b === null) err("tools.denied", "tools.denied is a list of tool names."); else denied = b;
  }
  let accountKey: string | undefined;
  if (vault) {
    const k = strList(vault["keys"]);
    if (k === null) err("vault.keys", "vault.keys is a list of key names."); else keys = k;
    const ak = vault["account_key"];
    if (ak !== undefined) { if (typeof ak !== "string" || !/^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(ak)) err("vault.account_key", "vault.account_key is a Vault name like #Team_Anthropic_Key."); else accountKey = ak; }
  }
  if (policy === "key" && accountKey === undefined) err("account_policy", 'account_policy "key" needs vault.account_key, the name of the shared key.');
  const lim: Limits = {};
  if (limits) {
    for (const [k, v] of Object.entries(limits)) {
      const key = LIMIT_KEYS.find((lk) => LIMIT_TOML[lk] === k);
      if (key === undefined) { if (k !== "spend") warn(`limits.${k}`, `limits.${k} is not a limit and is ignored.`); continue; }
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) err(`limits.${k}`, `limits.${k} is a number, zero or more.`);
      else lim[key] = v;
    }
  }
  let capture: AgentConfig["captureMode"] = "propose";
  if (memory) {
    const c = memory["capture"];
    if (c !== undefined) { if (typeof c !== "string" || !CAPTURE.has(c)) err("memory.capture", 'memory.capture is "propose", "auto_low_risk" or "off".'); else capture = c as AgentConfig["captureMode"]; }
  }
  const routines = d["routines"];
  if (routines !== undefined && (!Array.isArray(routines) || routines.some((r) => !isObj(r)))) err("routines", "routines is a list of [[routines]] tables.");
  if (errors.length > 0) return { ok: false, errors, warnings };
  const config: AgentConfig = {
    name: (d["name"] as string).trim(), accountPolicy: policy === "key" ? "key" : "asker", handoffs: hand ?? [], toolsAllowed: allowed, toolsDenied: denied, vaultKeys: keys, limits: lim, captureMode: capture,
  };
  if (typeof desc === "string" && desc.trim() !== "") config.description = desc.trim();
  if (typeof d["model"] === "string" && d["model"] !== "") config.model = d["model"];
  if (typeof d["fallback_model"] === "string" && d["fallback_model"] !== "") config.fallbackModel = d["fallback_model"];
  if (accountKey !== undefined) config.accountKey = accountKey;
  return { ok: true, errors, warnings, config };
}

/** Put a configuration into a document, keeping every key it does not know (a hand-written agent.toml may hold more). */
export function writeConfig(doc: TomlDoc, c: AgentConfig): TomlDoc {
  const out: TomlDoc = { ...doc };
  const setOrDrop = (k: string, v: TomlValue | undefined): void => { if (v === undefined || v === "") delete out[k]; else out[k] = v; };
  out["name"] = c.name;
  setOrDrop("description", c.description);
  setOrDrop("model", c.model);
  setOrDrop("fallback_model", c.fallbackModel);
  out["account_policy"] = c.accountPolicy;
  out["handoffs"] = c.handoffs;
  const sub = (k: string): TomlDoc => (isObj(out[k]) ? { ...(out[k] as TomlDoc) } : {});
  const tools = sub("tools"); tools["allowed"] = c.toolsAllowed; tools["denied"] = c.toolsDenied; out["tools"] = tools;
  const vault = sub("vault"); vault["keys"] = c.vaultKeys; if (c.accountKey !== undefined) vault["account_key"] = c.accountKey; else delete vault["account_key"]; out["vault"] = vault;
  const limits = sub("limits");
  for (const k of LIMIT_KEYS) { const v = c.limits[k]; if (v === undefined) delete limits[LIMIT_TOML[k]]; else limits[LIMIT_TOML[k]] = v; }
  if (Object.keys(limits).length > 0) out["limits"] = limits; else delete out["limits"];
  const memory = sub("memory"); memory["capture"] = c.captureMode; out["memory"] = memory;
  return out;
}

const TOML_HEADER = "# agent.toml: the people who run this agent write it; Vyre validates it. A file that does not pass keeps the last good version running.";
export const tomlFor = (doc: TomlDoc): string => dumpToml(doc, TOML_HEADER);

/** The first agent.toml of an agent. */
export function newConfig(a: { name: string; role?: string | undefined; model?: string | undefined; tools?: { allowed: string[]; denied: string[] } | undefined; limits?: Limits | undefined }): AgentConfig {
  const c: AgentConfig = {
    name: a.name.trim(), accountPolicy: "asker", handoffs: [], toolsAllowed: a.tools?.allowed ?? [], toolsDenied: a.tools?.denied ?? [], vaultKeys: [], limits: { ...(a.limits ?? {}) }, captureMode: "propose",
  };
  if (a.role !== undefined && a.role.trim() !== "") c.description = a.role.trim();
  if (a.model !== undefined && a.model !== "") c.model = a.model;
  return c;
}

/** What a new configuration lets an agent do that the old one did not: more tools, more keys, more hand-offs, a bigger limit. Widening needs an admin when it arrives as a suggestion. */
export function widenings(before: AgentConfig, after: AgentConfig): string[] {
  const out: string[] = [];
  const added = (kind: string, a: readonly string[], b: readonly string[]): void => { for (const x of b) if (!a.includes(x)) out.push(`${kind} adds ${x}`); };
  added("tools.allowed", before.toolsAllowed, after.toolsAllowed);
  for (const x of before.toolsDenied) if (!after.toolsDenied.includes(x)) out.push(`tools.denied no longer denies ${x}`);
  added("vault.keys", before.vaultKeys, after.vaultKeys);
  added("handoffs", before.handoffs, after.handoffs);
  if (after.accountKey !== undefined && after.accountKey !== before.accountKey) out.push(`vault.account_key uses ${after.accountKey}`);
  for (const k of LIMIT_KEYS) {
    const b = before.limits[k], a = after.limits[k];
    if (a === undefined && b !== undefined) out.push(`limits.${LIMIT_TOML[k]} is removed`);
    else if (a !== undefined && b !== undefined && a > b) out.push(`limits.${LIMIT_TOML[k]} goes from ${b} to ${a}`);
  }
  return out;
}

export type PatchResult = { ok: true; doc: TomlDoc; config: AgentConfig; fields: string[]; face?: string } | { ok: false; code: "validation.field_locked" | "validation.bad_input"; message: string };
const LOCKED = new Set(["agentId", "ownerId", "folderId", "status", "pausedReason", "pausedBy", "templateVersion", "createdAt", "lastActiveAt", "hasComputer"]);
const SETTABLE = new Set(["name", "face", "role", "model", "fallbackModel", "accountPolicy", "accountKey", "toolsAllowed", "toolsDenied", "vaultKeys", "limits", "captureMode", "handoffs"]);

/** Apply the fields of agents.update to the current document. Nothing is half applied: the answer is the new document or the reason it cannot be. */
export function applyPatch(doc: TomlDoc, current: AgentConfig, patch: Record<string, unknown>): PatchResult {
  const next: AgentConfig = { ...current, limits: { ...current.limits }, handoffs: [...current.handoffs], toolsAllowed: [...current.toolsAllowed], toolsDenied: [...current.toolsDenied], vaultKeys: [...current.vaultKeys] };
  const fields: string[] = [];
  let face: string | undefined;
  const bad = (message: string): PatchResult => ({ ok: false, code: "validation.bad_input", message });
  for (const [k, v] of Object.entries(patch)) {
    if (LOCKED.has(k)) return { ok: false, code: "validation.field_locked", message: `${k} is not changed here.` };
    if (!SETTABLE.has(k)) return bad(`${k} is not a field of an agent.`);
    const text = (max = 200): string | PatchResult => (typeof v === "string" && v.length <= max ? v : bad(`${k} is text of up to ${max} characters.`));
    const list = (): string[] | PatchResult => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200) && v.length <= 500 ? (v as string[]) : bad(`${k} is a list of names.`));
    switch (k) {
      case "name": { const t = text(MAX_NAME); if (typeof t !== "string") return t; if (t.trim() === "" || NAME_BAD.test(t)) return bad(`The name is up to ${MAX_NAME} characters with none of / \\ : * ? " < > |.`); next.name = t.trim(); break; }
      case "face": { const t = text(60); if (typeof t !== "string") return t; if (t.trim() === "") return bad("A face needs a seed."); face = t.trim(); break; }
      case "role": {
        const t = text(MAX_ROLE); if (typeof t !== "string") return t;
        if (t.includes("\n")) return bad("The role line is one line.");
        if (t.trim() === "") delete next.description; else next.description = t.trim();
        break;
      }
      case "model": case "fallbackModel": case "accountKey": {
        if (v === null || v === "") { if (k === "model") delete next.model; else if (k === "fallbackModel") delete next.fallbackModel; else delete next.accountKey; break; }
        const t = text(); if (typeof t !== "string") return t;
        if (k === "accountKey" && !/^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(t)) return bad("The shared key is a Vault name like #Team_Anthropic_Key.");
        if (k === "model") next.model = t; else if (k === "fallbackModel") next.fallbackModel = t; else next.accountKey = t;
        break;
      }
      case "accountPolicy": if (v !== "asker" && v !== "key") return bad('accountPolicy is "asker" or "key".'); next.accountPolicy = v; break;
      case "captureMode": if (typeof v !== "string" || !CAPTURE.has(v)) return bad('captureMode is "propose", "auto_low_risk" or "off".'); next.captureMode = v as AgentConfig["captureMode"]; break;
      case "toolsAllowed": { const l = list(); if (!Array.isArray(l)) return l; next.toolsAllowed = [...new Set(l)]; break; }
      case "toolsDenied": { const l = list(); if (!Array.isArray(l)) return l; next.toolsDenied = [...new Set(l)]; break; }
      case "vaultKeys": { const l = list(); if (!Array.isArray(l)) return l; next.vaultKeys = [...new Set(l)]; break; }
      case "handoffs": { const l = list(); if (!Array.isArray(l)) return l; next.handoffs = [...new Set(l)]; break; }
      case "limits": {
        if (!isObj(v)) return bad("limits is an object.");
        const lim: Limits = {};
        for (const [lk, lv] of Object.entries(v)) {
          if (!LIMIT_KEYS.includes(lk as LimitKey)) return bad(`${lk} is not a limit.`);
          if (lv === null) continue;
          if (typeof lv !== "number" || !Number.isFinite(lv) || lv < 0) return bad(`${lk} is a number, zero or more.`);
          lim[lk as LimitKey] = lv;
        }
        next.limits = lim;
        break;
      }
      default: return bad(`${k} is not a field of an agent.`);
    }
    fields.push(k);
  }
  if (next.accountPolicy === "key" && next.accountKey === undefined) return bad('accountPolicy "key" needs accountKey, the name of the shared key.');
  return { ok: true, doc: writeConfig(doc, next), config: next, fields, ...(face !== undefined ? { face } : {}) };
}

// ---- the agent row --------------------------------------------------------------------------------------------------------------------------------------

export interface AgentRec {
  id: string; name: string; face: string; ownerId: string; folderId?: string; tomlFileId?: string; agentMdFileId?: string; tomlText: string; config: AgentConfig; configError?: Problem;
  lastGoodVersionId?: string; hasComputer: boolean; templateVersion: number; paused: boolean; pausedReason?: string; pausedBy?: string; pausedAt?: number; working: number; lastActiveAt?: number;
  createdAt: number; updatedAt: number; deletedAt?: number;
}
export function agentOf(r: Row): AgentRec {
  const o: AgentRec = {
    id: str(r["id"]), name: str(r["name"]), face: str(r["face"]), ownerId: str(r["ownerId"]), tomlText: str(r["tomlText"] ?? ""), config: parseJson<AgentConfig>(r["config"], newConfig({ name: str(r["name"]) })),
    hasComputer: flag(r["hasComputer"]), templateVersion: num(r["templateVersion"] ?? 0), paused: flag(r["paused"]), working: num(r["working"] ?? 0), createdAt: num(r["createdAt"]), updatedAt: num(r["updatedAt"]),
  };
  const set = <K extends keyof AgentRec>(k: K, v: AgentRec[K] | undefined): void => { if (v !== undefined) o[k] = v; };
  set("folderId", optStr(r["folderId"])); set("tomlFileId", optStr(r["tomlFileId"])); set("agentMdFileId", optStr(r["agentMdFileId"])); set("lastGoodVersionId", optStr(r["lastGoodVersionId"]));
  set("pausedReason", optStr(r["pausedReason"])); set("pausedBy", optStr(r["pausedBy"])); set("pausedAt", optNum(r["pausedAt"])); set("lastActiveAt", optNum(r["lastActiveAt"])); set("deletedAt", optNum(r["deletedAt"]));
  if (r["configError"] !== null && r["configError"] !== undefined) set("configError", parseJson<Problem | undefined>(r["configError"], undefined));
  return o;
}
export function agentBy(db: Db, id: string, withDeleted = false): AgentRec | null {
  const r = (db.all(`SELECT * FROM agents_agent WHERE id = ?${withDeleted ? "" : " AND deletedAt IS NULL"}`, id) as Row[])[0];
  return r ? agentOf(r) : null;
}
export function agentByName(db: Db, name: string): AgentRec | null {
  const r = (db.all("SELECT * FROM agents_agent WHERE nameKey = ? AND deletedAt IS NULL LIMIT 1", nameKey(name)) as Row[])[0];
  return r ? agentOf(r) : null;
}
export function allAgents(db: Db): AgentRec[] {
  return (db.all("SELECT * FROM agents_agent WHERE deletedAt IS NULL ORDER BY createdAt, id") as Row[]).map(agentOf);
}

export type Status = "awake" | "working" | "asleep" | "paused";
/** Paused beats working beats awake (idle for under 2 minutes) beats asleep. */
export function statusOf(a: AgentRec, now: number): Status {
  if (a.paused) return "paused";
  if (a.working > 0) return "working";
  return a.lastActiveAt !== undefined && now - a.lastActiveAt < AWAKE_MS ? "awake" : "asleep";
}

/** The agent row of the contract. */
export function agentOut(a: AgentRec, now: number): Record<string, unknown> {
  const c = a.config;
  return {
    agentId: a.id, name: a.name, face: a.face, ...(c.description !== undefined ? { role: c.description } : {}), status: statusOf(a, now),
    ...(a.paused && a.pausedReason !== undefined ? { pausedReason: a.pausedReason } : {}), ...(a.paused && a.pausedBy !== undefined ? { pausedBy: a.pausedBy } : {}),
    ownerId: a.ownerId, folderId: a.folderId ?? "fld_unset", ...(c.model !== undefined ? { model: c.model } : {}), ...(c.fallbackModel !== undefined ? { fallbackModel: c.fallbackModel } : {}),
    accountPolicy: c.accountPolicy, ...(c.accountKey !== undefined ? { accountKey: c.accountKey } : {}), toolsAllowed: c.toolsAllowed, toolsDenied: c.toolsDenied, vaultKeys: c.vaultKeys,
    limits: c.limits, captureMode: c.captureMode, hasComputer: a.hasComputer, templateVersion: a.templateVersion, createdAt: a.createdAt,
    ...(a.lastActiveAt !== undefined ? { lastActiveAt: a.lastActiveAt } : {}),
  };
}

export function insertAgent(db: Db, a: AgentRec): void {
  db.run(
    `INSERT INTO agents_agent (id, name, nameKey, face, ownerId, folderId, tomlFileId, agentMdFileId, tomlText, config, configError, lastGoodVersionId, hasComputer, templateVersion, paused, working, lastActiveAt, createdAt, updatedAt, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, ?, ?, ?, NULL)`,
    a.id, a.name, nameKey(a.name), a.face, a.ownerId, a.folderId ?? null, a.tomlFileId ?? null, a.agentMdFileId ?? null, a.tomlText, JSON.stringify(a.config), a.lastGoodVersionId ?? null, a.hasComputer ? 1 : 0,
    a.templateVersion, a.lastActiveAt ?? null, a.createdAt, a.updatedAt,
  );
}
/** Store a configuration that passed: the text, its parsed form, the version it came from, and no error. */
export function storeConfig(db: Db, id: string, c: { name: string; text: string; config: AgentConfig; versionId?: string | undefined; at: number }): void {
  db.run(
    "UPDATE agents_agent SET name = ?, nameKey = ?, tomlText = ?, config = ?, configError = NULL, lastGoodVersionId = COALESCE(?, lastGoodVersionId), updatedAt = ? WHERE id = ?",
    c.name, nameKey(c.name), c.text, JSON.stringify(c.config), c.versionId ?? null, c.at, id,
  );
}

// ---- cron: five fields, UTC ------------------------------------------------------------------------------------------------------------------------

function fieldSet(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let lo = min, hi = max;
    if (m[1] !== "*") {
      const [a, b] = (m[1] as string).split("-");
      lo = Number(a); hi = b === undefined ? (m[2] === undefined ? lo : max) : Number(b);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}
export interface Cron { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean }
export function parseCron(expr: string): Cron | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = fieldSet(f[0] as string, 0, 59), hour = fieldSet(f[1] as string, 0, 23), dom = fieldSet(f[2] as string, 1, 31), month = fieldSet(f[3] as string, 1, 12);
  const dowRaw = fieldSet((f[4] as string).replace(/\b7\b/g, "0"), 0, 6);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  return { minute, hour, dom, month, dow: dowRaw, domAny: f[2] === "*", dowAny: f[4] === "*" };
}
/** The first minute after `after` (ms, UTC) that the expression names, looking a year ahead; null when there is none (31 February). */
export function nextRun(expr: string, after: number): number | null {
  const c = parseCron(expr);
  if (!c) return null;
  const start = new Date(after - (after % 60_000) + 60_000);
  for (let d = 0; d <= 366; d++) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
    if (!c.month.has(day.getUTCMonth() + 1)) continue;
    const domOk = c.dom.has(day.getUTCDate()), dowOk = c.dow.has(day.getUTCDay());
    // cron: when both day fields are restricted, either one matching is enough
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? dowOk : c.dowAny ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of [...c.hour].sort((a, b) => a - b)) for (const m of [...c.minute].sort((a, b) => a - b)) {
      const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
      if (t >= start.getTime()) return t;
    }
  }
  return null;
}

// ---- routines ------------------------------------------------------------------------------------------------------------------------------------------

export interface RoutineRec { watchChannel?: string; id: string; agentId: string; ownerId: string; title: string; cron: string; prompt: string; channelId?: string; enabled: boolean; lastRunAt?: number; nextRunAt?: number; createdAt: number; updatedAt: number }
export function routineOf(r: Row): RoutineRec {
  const o: RoutineRec = { id: str(r["id"]), agentId: str(r["agentId"]), ownerId: str(r["ownerId"]), title: str(r["title"]), cron: str(r["cron"]), prompt: str(r["prompt"]), enabled: flag(r["enabled"]), createdAt: num(r["createdAt"]), updatedAt: num(r["updatedAt"]) };
  const ch = optStr(r["channelId"]); if (ch !== undefined) o.channelId = ch;
  const last = optNum(r["lastRunAt"]); if (last !== undefined) o.lastRunAt = last;
  const next = optNum(r["nextRunAt"]); if (next !== undefined) o.nextRunAt = next;
  return o;
}
export function routineBy(db: Db, id: string): RoutineRec | null {
  const r = (db.all("SELECT * FROM agents_routine WHERE id = ?", id) as Row[])[0];
  if (!r) return null;
  const rec = routineOf(r);
  const w = (db.all("SELECT channelId FROM agents_routine_watch WHERE routineId = ?", id) as Row[])[0];
  if (w) rec.watchChannel = str(w["channelId"]);
  return rec;
}
export function routineOut(r: RoutineRec): Record<string, unknown> {
  return {
    routineId: r.id, agentId: r.agentId, title: r.title, ...(r.watchChannel === undefined ? { cron: r.cron } : { kind: "watch", watch: { on: "message", channelId: r.watchChannel } }), prompt: r.prompt, ...(r.channelId !== undefined ? { channelId: r.channelId } : {}), enabled: r.enabled, ownerId: r.ownerId,
    ...(r.lastRunAt !== undefined ? { lastRunAt: r.lastRunAt } : {}), ...(r.nextRunAt !== undefined ? { nextRunAt: r.nextRunAt } : {}),
  };
}
/** The line under a message an agent posts because of a routine: "Sent by Intake on a routine Dana set". */
export const routineLabel = (agentName: string, ownerName: string): string => `Sent by ${agentName} on a routine ${ownerName} set`;
/** What the post carries so the label can be drawn: chat.post `via`. Only the routine's owner can open the routine itself. */
export const routineVia = (r: Pick<RoutineRec, "ownerId">): { routineOwner: string } => ({ routineOwner: r.ownerId });
/** The scheduler calls this when it starts a routine: the run is recorded and the next one is worked out from now. */
export function markRoutineRan(db: Db, id: string, at: number): RoutineRec | null {
  ensure(db);
  const r = routineBy(db, id);
  if (!r) return null;
  db.run("UPDATE agents_routine SET lastRunAt = ?, nextRunAt = ?, updatedAt = ? WHERE id = ?", at, r.enabled ? nextRun(r.cron, at) : null, at, id);
  return routineBy(db, id);
}

// ---- suggestions -----------------------------------------------------------------------------------------------------------------------------------------

export interface SuggestionRec {
  id: string; agentId: string; kind: "agent_md" | "template"; file: string; diff: string; reason?: string; widening: boolean; state: "open" | "accepted" | "dismissed"; proposedBy: string; proposedAt: number;
  taskId?: string; after?: string;
}
export function suggestionOf(r: Row): SuggestionRec {
  const o: SuggestionRec = {
    id: str(r["id"]), agentId: str(r["agentId"]), kind: str(r["kind"]) === "template" ? "template" : "agent_md", file: str(r["file"]), diff: str(r["diff"]), widening: flag(r["widening"]),
    state: str(r["state"]) as SuggestionRec["state"], proposedBy: str(r["proposedBy"]), proposedAt: num(r["proposedAt"]),
  };
  const reason = optStr(r["reason"]); if (reason !== undefined) o.reason = reason;
  const taskId = optStr(r["taskId"]); if (taskId !== undefined) o.taskId = taskId;
  const after = optStr(r["afterText"]); if (after !== undefined) o.after = after;
  return o;
}
export function suggestionBy(db: Db, id: string): SuggestionRec | null {
  const r = (db.all("SELECT * FROM agents_suggestion WHERE id = ?", id) as Row[])[0];
  return r ? suggestionOf(r) : null;
}
export function suggestionOut(s: SuggestionRec): Record<string, unknown> {
  return {
    suggestionId: s.id, agentId: s.agentId, kind: s.kind, file: s.file, diff: s.diff, ...(s.reason !== undefined ? { reason: s.reason } : {}), widening: s.widening, state: s.state,
    proposedBy: s.proposedBy, proposedAt: s.proposedAt, ...(s.taskId !== undefined ? { taskId: s.taskId } : {}),
  };
}
export function insertSuggestion(db: Db, s: SuggestionRec): void {
  db.run(
    "INSERT INTO agents_suggestion (id, agentId, kind, file, diff, reason, widening, state, proposedBy, proposedAt, taskId, afterText) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
    s.id, s.agentId, s.kind, s.file, s.diff, s.reason ?? null, s.widening ? 1 : 0, s.proposedBy, s.proposedAt, s.taskId ?? null, s.after ?? null,
  );
}

// ---- unified diffs --------------------------------------------------------------------------------------------------------------------------------------

/** Apply a unified diff to `text`. Every context and removed line must match where the hunk says (a few lines either way are tolerated); otherwise null. */
export function applyUnifiedDiff(text: string, diff: string): string | null {
  const src = text === "" ? [] : text.split("\n");
  const trailing = text.endsWith("\n");
  if (trailing) src.pop();
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let pos = 0;
  let hunks = 0;
  for (let i = 0; i < lines.length;) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i] ?? "");
    if (!h) { i++; continue; }
    hunks++;
    const body: Array<{ op: " " | "-" | "+"; text: string }> = [];
    i++;
    while (i < lines.length && !(lines[i] ?? "").startsWith("@@ ")) {
      const l = lines[i] ?? "";
      if (l.startsWith("\\")) { i++; continue; }
      const op = l[0];
      if (op === " " || op === "-" || op === "+") body.push({ op, text: l.slice(1) });
      else if (l === "") { if (i === lines.length - 1) break; body.push({ op: " ", text: "" }); }
      else return null;
      i++;
    }
    const old = body.filter((b) => b.op !== "+").map((b) => b.text);
    let at = Math.max(Number(h[1]) - 1, pos);
    if (old.length === 0) at = Math.min(at, src.length);
    else {
      let found = -1;
      for (const off of [0, 1, -1, 2, -2, 3, -3]) {
        const s = at + off;
        if (s < pos || s + old.length > src.length) continue;
        if (old.every((t, k) => src[s + k] === t)) { found = s; break; }
      }
      if (found < 0) return null;
      at = found;
    }
    out.push(...src.slice(pos, at));
    for (const b of body) if (b.op !== "-") out.push(b.text);
    pos = at + old.length;
  }
  if (hunks === 0) return null;
  out.push(...src.slice(pos));
  return out.join("\n") + (trailing || out.length > 0 ? "\n" : "");
}

/** A small unified diff between two texts (whole-file hunk), for template suggestions. */
export function simpleDiff(file: string, before: string, after: string): string {
  const a = before.split("\n"), b = after.split("\n");
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();
  return [`--- a/${file}`, `+++ b/${file}`, `@@ -${a.length === 0 ? 0 : 1},${a.length} +${b.length === 0 ? 0 : 1},${b.length} @@`, ...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)].join("\n");
}

/** Number-only hash of a text, to notice that a template changed. Not a security hash. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0; }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ---- Files and the other modules ------------------------------------------------------------------------------------------------------------------

/** Call another module's capability through the host. */
export async function call<T>(ctx: AgentsCtx, cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  if (!ctx.call) raise(ctx, "internal.unexpected", "That part of the app is not available right now.", { cap });
  return (await ctx.call(cap, input, opts)) as T;
}
/** Like `call`, but a module that is not there (or refuses) gives the fallback: what is shown on the agent page must not fail because a neighbour is down. */
export async function tolerant<T>(ctx: AgentsCtx, cap: string, input: unknown, fallback: T): Promise<T> {
  if (!ctx.call) return fallback;
  try { return ((await ctx.call(cap, input)) as T | null | undefined) ?? fallback; } catch (e) {
    ctx.log.warn("agents: a neighbour did not answer", { cap, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    return fallback;
  }
}
/** The code of an error thrown by a call, if it has one. */
export const codeOf = (e: unknown): string => { const x = e as { error?: { code?: string }; code?: string }; return x?.error?.code ?? x?.code ?? "unknown"; };
export const messageOf = (e: unknown): string => { const x = e as { error?: { message?: string }; message?: string }; return x?.error?.message ?? x?.message ?? "That did not work."; };

export interface FolderOut { folderId: string; parentId?: string; name: string; path: string }
export interface FileOut { fileId: string; folderId: string; name: string; version: number }
export interface VersionOut { versionId: string; n: number; by: string; at: number; reason?: string; name?: string }

export async function textOf(ctx: AgentsCtx, fileId: string, versionId?: string): Promise<string> {
  const r = await call<{ text?: string }>(ctx, "files.read", { fileId, as: "text", ...(versionId !== undefined ? { versionId } : {}) });
  return r.text ?? "";
}
export async function versionsOf(ctx: AgentsCtx, fileId: string): Promise<VersionOut[]> {
  const r = await call<{ versions?: VersionOut[] }>(ctx, "files.versions", { fileId });
  return r.versions ?? [];
}
/** Save a guidance file through files.save: snapshot, lint, then one version. Warnings are accepted here (the lint's errors are not). */
export async function saveFile(ctx: AgentsCtx, fileId: string, text: string, reason: string): Promise<{ versionId: string; n: number }> {
  try {
    const r = await call<{ versionId: string; n: number }>(ctx, "files.save", { fileId, text, reason, acceptWarnings: true });
    return { versionId: r.versionId, n: r.n };
  } catch (e) {
    if (codeOf(e) === "validation.precondition_failed") raise(ctx, "validation.bad_input", messageOf(e));
    throw e;
  }
}
export async function listFolder(ctx: AgentsCtx, folderId: string): Promise<{ files: FileOut[]; folders: FolderOut[] }> {
  const r = await call<{ files?: FileOut[]; folders?: FolderOut[] }>(ctx, "files.list", { section: "space", folder: folderId, limit: 500 });
  return { files: r.files ?? [], folders: r.folders ?? [] };
}
/** Every file under a folder as a relative path, folders first by depth. Bounded: a folder tree that large is not an agent's. */
export async function walkFolder(ctx: AgentsCtx, folderId: string, max = 600): Promise<Array<{ path: string; kind: "folder" | "file"; id: string }>> {
  const out: Array<{ path: string; kind: "folder" | "file"; id: string }> = [];
  const queue: Array<{ id: string; prefix: string; depth: number }> = [{ id: folderId, prefix: "", depth: 0 }];
  while (queue.length > 0 && out.length < max) {
    const cur = queue.shift() as { id: string; prefix: string; depth: number };
    const { files, folders } = await listFolder(ctx, cur.id);
    for (const f of folders) { const path = `${cur.prefix}${f.name}`; out.push({ path, kind: "folder", id: f.folderId }); if (cur.depth < 5) queue.push({ id: f.folderId, prefix: `${path}/`, depth: cur.depth + 1 }); }
    for (const f of files) out.push({ path: `${cur.prefix}${f.name}`, kind: "file", id: f.fileId });
  }
  return out;
}

// ---- the decided tree, the guide and the built-in skills -------------------------------------------------------------------------------------------

/** Folders of an agent (spec 2.6). .vyre/ and .index/ are hidden by name. */
export const TREE_FOLDERS: readonly string[] = [
  "memory", "memory/notes", "memory/proposed", "memory/recipes", "memory/journal", "skills", "routines", "knowledge", "inbox", "work", "work/drafts", "work/done", "work/scratch", "downloads", "logs", "chats", ".vyre", ".index",
];
export const GUIDE_VERSION = "1.0.0";
export const GUIDE_MD = [
  "# How Vyre works for you",
  "",
  "You are an agent in a Vyre Space. People and agents share records, files, channels and tasks here. Read this first; VYRE.md and AGENT.md come after it.",
  "",
  "- Work as the person who asked. You can do what they and your own access both allow, nothing more.",
  "- Your files are in this folder. Write drafts in work/drafts, finished things in work/done, notes in memory/.",
  "- Save what you learn as facts with memory_propose. Cite where it came from. Search memory before you ask the person.",
  "- Use secrets by name only (#Handle). Never print, store or send a value.",
  "- When you are unsure, ask with ask_question instead of guessing. In plan mode, read and plan, then propose a plan and wait.",
  "- When you hand work on, say what you need back. Four hand-offs between agents and a person has to reply.",
  "- Never copy data from one Space to another.",
  "",
].join("\n");
export const AGENT_MD_DEFAULT = (name: string, role: string | undefined): string => [
  `# ${name}`,
  "",
  "Inherits: VYRE.md",
  "",
  "## Use me when",
  role !== undefined && role.trim() !== "" ? role.trim() : "Describe here when people should ask this agent.",
  "",
  "## How I work",
  "- Say what I did, in a sentence a busy person reads in five seconds.",
  "",
].join("\n");

export const BUILTIN_SKILLS: ReadonlyArray<{ key: string; title: string; version: string; summary: string }> = [
  {
    key: "working_in_vyre", title: "Working in Vyre", version: "1.0.0",
    summary: "Save facts to the asker layer with memory_propose, propose promotions with sources, search memory before asking, use secrets only by name, never copy data across Spaces, ask a question instead of guessing, open tabs only through open_tab, stay in plan mode.",
  },
  {
    key: "create_agent", title: "Create an agent", version: "1.0.0",
    summary: "Ask what the agent is for, who may use it and what it may touch, then end with exactly one Approve card (a plan block) that lists what will be created; the agent is made only after it is approved.",
  },
];

/** The create-agent skill, as the file every agent carries. It ends in one plan block and nothing is created before the person approves it. */
export const CREATE_AGENT_SKILL = [
  "# Create an agent",
  "",
  "Use this when a person asks for a new agent.",
  "",
  "1. Ask, with ask_question, only what you cannot work out: what the agent is for (the role line), who may chat with it and who may change it, which model, whether it needs its own computer, and what it may touch (tools, Vault key names, limits).",
  "2. Do not create anything yet. Propose exactly one plan with plan_propose: the title names the agent, and the steps are what will exist afterwards (the record, the Agents/<name> folder with its files, the role line, the limits).",
  "3. That plan is the one Approve card. Wait for the person to approve it. If they edit a step, follow the edit. If they reject it, stop.",
  "4. After approval call agents.create once with what was approved, then tell the person where the agent lives.",
  "",
].join("\n");

export interface CreateAgentInput {
  name: string; role?: string; face?: string; model?: string; ownerId?: string; computer?: boolean; templateKey?: string; tools?: { allowed: string[]; denied: string[] }; limits?: Limits;
}
/** The one Approve card of the create-agent skill: the chat.plan.propose input that lists what agents.create will make. */
export function createAgentPlan(threadId: string, input: CreateAgentInput): { threadId: string; title: string; steps: Array<{ text: string; detail?: string }> } {
  const steps: Array<{ text: string; detail?: string }> = [
    { text: `Create the agent ${input.name.trim()}`, ...(input.role !== undefined && input.role.trim() !== "" ? { detail: input.role.trim() } : {}) },
    { text: `Make the folder Agents/${input.name.trim()} with AGENT.md, agent.toml and the decided tree`, detail: "memory, skills, routines, knowledge, inbox, work, downloads, logs, chats" },
  ];
  if (input.model !== undefined && input.model !== "") steps.push({ text: `Run it on ${input.model}` });
  if (input.computer === true) steps.push({ text: "Give it a computer", detail: "Team Space only" });
  const tools = input.tools;
  if (tools && (tools.allowed.length > 0 || tools.denied.length > 0)) steps.push({ text: "Set what it may use", detail: [tools.allowed.length > 0 ? `allowed: ${tools.allowed.join(", ")}` : "", tools.denied.length > 0 ? `denied: ${tools.denied.join(", ")}` : ""].filter(Boolean).join("; ") });
  if (input.limits && Object.keys(input.limits).length > 0) steps.push({ text: "Set its limits", detail: Object.entries(input.limits).map(([k, v]) => `${k} ${String(v)}`).join(", ") });
  return { threadId, title: `Create the agent ${input.name.trim()}`, steps };
}

// ---- who may see an agent -------------------------------------------------------------------------------------------------------------------------------

export const allows = (ctx: AgentsCtx, perm: string | null, level: "view" | "use" | "edit" | "manage", type: string, id: string | null): boolean =>
  !ctx.authorize || ctx.authorize({ perm, level }, { type, id }).effect === "allow";

/** The admin's "All in the Space" toggle counts only while the admin still holds the permission it needs. */
export function seesAll(ctx: AgentsCtx): boolean {
  const row = (ctx.db.all("SELECT allAgents FROM agents_visibility WHERE principal = ?", askerOf(ctx)) as Row[])[0];
  return row !== undefined && Number(row["allAgents"]) === 1 && allows(ctx, "access.manage", "manage", "space", null);
}
export function canSee(ctx: AgentsCtx, a: AgentRec): boolean {
  return a.ownerId === askerOf(ctx) || allows(ctx, null, "view", "agent", a.id) || seesAll(ctx);
}
/** An agent the caller may see, or the same answer as for one that is not there (what exists is not leaked). */
export function visible(ctx: AgentsCtx, id: string, code: ErrorCode = "validation.not_found"): AgentRec {
  ensure(ctx.db);
  const a = agentBy(ctx.db, id);
  if (!a || !canSee(ctx, a)) raise(ctx, code, "That agent does not exist.");
  return a;
}

export async function makeFolder(ctx: AgentsCtx, parentId: string, name: string, key: string, subject?: { kind: "agent"; id: string }): Promise<FolderOut> {
  return (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId, name, idempotencyKey: key, ...(subject ? { subject } : {}) }, { idempotencyKey: key })).folder;
}
export async function makeFile(ctx: AgentsCtx, folderId: string, name: string, text: string, key: string): Promise<FileOut> {
  return (await call<{ file: FileOut }>(ctx, "files.create", { folderId, name, content: { text }, idempotencyKey: key }, { idempotencyKey: key })).file;
}
