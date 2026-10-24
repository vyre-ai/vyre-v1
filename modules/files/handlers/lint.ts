// files lint: files.lint, files.save and files.share (spec 2.16, 2.6, 2.4; ARCH 7.5, ARCH 4.12).
// Guidance files (VYRE.md, AGENT.md, agent.toml, routine prompts) are linted on the server: line counts against the limits, the
// Inherits line, Override lines, a secret scan, the agent.toml form (syntax, field types, routine prompt files, handoff names)
// and repeated facts. files.save snapshots first (the current version already is the snapshot; this packet reports the diff
// against it), lints, then commits one version through the files.write rule of versions.ts. Secret values never leave this
// file: a finding carries a line number and a kind, never the text. files.share only calls access.share so an agent's file
// tool is complete (the manifest names access as the owner of grants).

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";

type Row = Record<string, unknown>;

export type LintFile = "vyre_md" | "agent_md" | "agent_toml" | "routine_prompt" | "other";
export type LintState = "ok" | "amber" | "red";
export interface LintProblem { severity: "info" | "warn" | "error"; line?: number; rule: string; message: string }
export interface LintResult {
  file: LintFile;
  lines: number;
  state: LintState;
  inherits?: boolean;
  overrides: { line: number; text: string }[];
  secrets: { line: number; kind: string }[];
  problems: LintProblem[];
}
export interface LintLimits { amber: number; red: number }
export interface LintContext {
  /** Names of the agents in the Space, for handoff checks. Undefined when the list could not be read (the check is skipped). */
  agentNames?: string[];
  /** Answers whether a file exists next to agent.toml. Undefined skips the routine prompt check. */
  fileExists?: (relPath: string) => boolean;
  /** Text of the Space VYRE.md, for repeated facts across the two files. */
  vyreText?: string;
}

export const DEFAULT_LIMITS: LintLimits = { amber: 150, red: 200 };
/** Spec 2.6: VYRE.md stays under 120 lines with at most 8 hard rules. */
export const VYRE_MD_LINES = 120;
export const VYRE_MD_HARD_RULES = 8;
export const ROLE_LINE_MAX = 160;

// ---- classification and counting ----

export function classify(name: string, folderPath: string): LintFile {
  if (name === "VYRE.md") return "vyre_md";
  if (name === "AGENT.md") return "agent_md";
  if (name === "agent.toml") return "agent_toml";
  const parts = folderPath.split("/").filter(Boolean);
  if (parts.includes("routines") && /\.(md|txt)$/i.test(name)) return "routine_prompt";
  return "other";
}

export function countLines(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

// ---- secret scan ----

const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private_key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "openai_key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { kind: "stripe_key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { kind: "url_credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s]+/i },
];
const ASSIGNMENT = /\b(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key|auth)\w*\s*[:=]\s*["']?([A-Za-z0-9/+_.=-]{16,})["']?/i;

/** Lines that hold a secret, by kind. A vault handle (#Name or vault:name) is never a secret. */
export function scanSecrets(text: string): { line: number; kind: string }[] {
  const found: { line: number; kind: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let kind: string | undefined;
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) { kind = p.kind; break; }
    }
    if (kind === undefined) {
      const m = ASSIGNMENT.exec(line);
      const value = m?.[1];
      if (value !== undefined && !value.startsWith("#") && !/^vault:/i.test(value) && !/^\$\{/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) kind = "generic_assignment";
    }
    if (kind !== undefined) found.push({ line: i + 1, kind });
  }
  return found;
}

// ---- a small TOML reader (tables, arrays of tables, strings, numbers, booleans, arrays, inline tables) ----

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export interface TomlResult { value: { [key: string]: TomlValue }; error?: { line: number; message: string }; keyLines: Map<string, number> }

class TomlError extends Error {
  line: number;
  constructor(line: number, message: string) { super(message); this.line = line; }
}

function stripComment(s: string): string {
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return s.slice(0, i);
  }
  return s;
}

function parseScalar(raw: string, line: number): TomlValue {
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
  if (/^[+-]?\d[\d_]*$/.test(s)) return Number(s.replaceAll("_", ""));
  if (/^[+-]?\d[\d_]*\.\d[\d_]*(?:[eE][+-]?\d+)?$/.test(s)) return Number(s.replaceAll("_", ""));
  if (s.startsWith("[")) return parseArray(s, line);
  if (s.startsWith("{")) return parseInline(s, line);
  throw new TomlError(line, `"${s.length > 30 ? `${s.slice(0, 30)}...` : s}" is not a value; text needs quotes.`);
}

/** Splits at top-level commas, honouring quotes and nesting. */
function splitTop(s: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let q: string | undefined;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
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

function parseArray(s: string, line: number): TomlValue[] {
  if (!s.endsWith("]")) throw new TomlError(line, "An array is not closed.");
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  const parts = splitTop(inner, line);
  if (parts.length > 0 && (parts[parts.length - 1] ?? "").trim() === "") parts.pop();
  return parts.map((p) => parseScalar(p, line));
}

function parseInline(s: string, line: number): { [key: string]: TomlValue } {
  if (!s.endsWith("}")) throw new TomlError(line, "An inline table is not closed.");
  const inner = s.slice(1, -1).trim();
  const out: { [key: string]: TomlValue } = {};
  if (inner === "") return out;
  for (const part of splitTop(inner, line)) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new TomlError(line, "An inline table entry needs key = value.");
    out[keyName(part.slice(0, eq), line)] = parseScalar(part.slice(eq + 1), line);
  }
  return out;
}

function keyName(raw: string, line: number): string {
  const k = raw.trim();
  if (/^[A-Za-z0-9_-]+$/.test(k)) return k;
  if (/^"[^"]*"$/.test(k) || /^'[^']*'$/.test(k)) return k.slice(1, -1);
  throw new TomlError(line, `"${k}" is not a valid key.`);
}

export function parseToml(text: string): TomlResult {
  const root: { [key: string]: TomlValue } = {};
  const keyLines = new Map<string, number>();
  let cur: { [key: string]: TomlValue } = root;
  let curPath = "";
  const lines = text.split("\n");
  try {
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      let line = stripComment(lines[i] ?? "").trim();
      if (line === "") continue;
      const arr = /^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/.exec(line);
      if (arr?.[1] !== undefined) {
        const name = arr[1];
        const existing = root[name];
        if (existing !== undefined && !Array.isArray(existing)) throw new TomlError(lineNo, `${name} is already a table.`);
        const list: TomlValue[] = Array.isArray(existing) ? existing : [];
        const item: { [key: string]: TomlValue } = {};
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
        const t: { [key: string]: TomlValue } = {};
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
      // an array or inline table may continue on the next lines
      while (/^[[{]/.test(rhs) && !balanced(rhs)) {
        i++;
        if (i >= lines.length) throw new TomlError(lineNo, "A bracket is not closed.");
        rhs += ` ${stripComment(lines[i] ?? "").trim()}`;
      }
      if (rhs.startsWith('"""')) throw new TomlError(lineNo, "Multi-line strings are not supported; use one line with \\n.");
      line = rhs;
      if (Object.prototype.hasOwnProperty.call(cur, key)) throw new TomlError(lineNo, `${key} is set twice.`);
      cur[key] = parseScalar(line, lineNo);
      keyLines.set(curPath === "" ? key : `${curPath}.${key}`, lineNo);
    }
  } catch (e) {
    if (e instanceof TomlError) return { value: root, error: { line: e.line, message: e.message }, keyLines };
    throw e;
  }
  return { value: root, keyLines };
}

function balanced(s: string): boolean {
  let depth = 0;
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth <= 0;
}

// ---- agent.toml form ----

const TOP_KEYS = new Set(["name", "description", "model", "fallback_model", "account_policy", "handoffs", "tools", "vault", "limits", "approvals", "memory", "routines"]);
const LIMIT_KEYS = ["per_run", "per_day", "per_month", "spend", "turns", "tokens", "minutes"];
const isTable = (v: TomlValue | undefined): v is { [key: string]: TomlValue } => typeof v === "object" && v !== null && !Array.isArray(v);

function lintToml(text: string, ctx: LintContext, add: (p: LintProblem) => void): void {
  const parsed = parseToml(text);
  if (parsed.error) {
    add({ severity: "error", line: parsed.error.line, rule: "toml.syntax", message: `${parsed.error.message} The last good agent.toml keeps running until this is fixed.` });
    return;
  }
  const doc = parsed.value;
  const at = (path: string): number | undefined => parsed.keyLines.get(path);
  for (const key of Object.keys(doc)) {
    if (!TOP_KEYS.has(key)) {
      const p: LintProblem = { severity: "warn", rule: "toml.unknown_key", message: `${key} is not a field of agent.toml and is ignored.` };
      const l = at(key); if (l !== undefined) p.line = l;
      add(p);
    }
  }
  for (const key of ["name", "description", "model", "fallback_model"] as const) {
    const v = doc[key];
    if (v !== undefined && typeof v !== "string") {
      const p: LintProblem = { severity: "error", rule: "toml.type", message: `${key} must be text.` };
      const l = at(key); if (l !== undefined) p.line = l;
      add(p);
    }
  }
  const desc = doc["description"];
  if (typeof desc === "string") {
    const dl = at("description");
    const withLine = (p: LintProblem): LintProblem => (dl !== undefined ? { ...p, line: dl } : p);
    if (desc.trim() === "") add(withLine({ severity: "warn", rule: "role_line.empty", message: "The role line is empty; people will not know when to use this agent." }));
    if (desc.includes("\n")) add(withLine({ severity: "error", rule: "role_line.multiline", message: "The role line is one line." }));
    if (desc.length > ROLE_LINE_MAX) add(withLine({ severity: "warn", rule: "role_line.long", message: `The role line is ${desc.length} characters; keep it under ${ROLE_LINE_MAX}.` }));
  }
  const handoffs = doc["handoffs"];
  if (handoffs !== undefined) {
    if (!Array.isArray(handoffs) || handoffs.some((h) => typeof h !== "string")) {
      const p: LintProblem = { severity: "error", rule: "toml.type", message: "handoffs is a list of agent names." };
      const l = at("handoffs"); if (l !== undefined) p.line = l;
      add(p);
    } else if (ctx.agentNames) {
      const known = new Set(ctx.agentNames.map((n) => n.toLowerCase()));
      for (const h of handoffs as string[]) {
        if (!known.has(h.toLowerCase())) {
          const p: LintProblem = { severity: "warn", rule: "handoff.unknown", message: `Handoff to ${h}: there is no agent with that name in this Space.` };
          const l = at("handoffs"); if (l !== undefined) p.line = l;
          add(p);
        }
      }
    }
  }
  for (const section of ["tools", "vault", "approvals", "memory", "limits"] as const) {
    const v = doc[section];
    if (v !== undefined && !isTable(v)) {
      const p: LintProblem = { severity: "error", rule: "toml.type", message: `${section} is a table.` };
      const l = at(section); if (l !== undefined) p.line = l;
      add(p);
    }
  }
  const limits = doc["limits"];
  if (isTable(limits)) {
    for (const [k, v] of Object.entries(limits)) {
      const l = at(`limits.${k}`);
      const withLine = (p: LintProblem): LintProblem => (l !== undefined ? { ...p, line: l } : p);
      if (!LIMIT_KEYS.includes(k)) add(withLine({ severity: "warn", rule: "toml.unknown_key", message: `limits.${k} is not a limit and is ignored.` }));
      else if (typeof v !== "number" || v < 0) add(withLine({ severity: "error", rule: "toml.type", message: `limits.${k} is a number, zero or more.` }));
    }
  }
  const vault = doc["vault"];
  if (isTable(vault)) {
    const keys = vault["keys"];
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((k) => typeof k !== "string"))) {
      const p: LintProblem = { severity: "error", rule: "toml.type", message: "vault.keys is a list of key names." };
      const l = at("vault.keys"); if (l !== undefined) p.line = l;
      add(p);
    }
  }
  const routines = doc["routines"];
  if (routines !== undefined) {
    if (!Array.isArray(routines) || routines.some((r) => !isTable(r))) {
      const p: LintProblem = { severity: "error", rule: "toml.type", message: "routines is a list of [[routines]] tables." };
      const l = at("routines"); if (l !== undefined) p.line = l;
      add(p);
    } else {
      routines.forEach((r, i) => {
        if (!isTable(r)) return;
        const base = `routines[${i}]`;
        const line = at(base);
        const withLine = (p: LintProblem): LintProblem => (line !== undefined ? { ...p, line } : p);
        const cron = r["cron"];
        if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) add(withLine({ severity: "error", rule: "routine.cron", message: `Routine ${i + 1} needs a cron with five fields, like "0 9 * * 1-5".` }));
        const file = r["prompt_file"];
        if (file !== undefined) {
          if (typeof file !== "string") add(withLine({ severity: "error", rule: "toml.type", message: `Routine ${i + 1}: prompt_file is a path.` }));
          else if (file.startsWith("/") || file.split("/").includes("..")) add(withLine({ severity: "error", rule: "routine.prompt_path", message: `Routine ${i + 1}: prompt_file stays inside the agent folder.` }));
          else if (ctx.fileExists && !ctx.fileExists(file)) add(withLine({ severity: "error", rule: "routine.prompt_missing", message: `Routine ${i + 1}: there is no file ${file} next to agent.toml.` }));
        } else if (typeof r["prompt"] !== "string") add(withLine({ severity: "error", rule: "routine.prompt", message: `Routine ${i + 1} needs a prompt or a prompt_file.` }));
      });
    }
  }
}

// ---- repeated facts ----

const normalize = (s: string): string => s.toLowerCase().replace(/^[\s>*+-]+|^\d+[.)]\s+/g, "").replace(/\s+/g, " ").trim();

function lintRepeats(text: string, vyreText: string | undefined, add: (p: LintProblem) => void): void {
  const seen = new Map<string, number>();
  const vyre = new Set<string>();
  if (vyreText !== undefined) for (const l of vyreText.split("\n")) { const n = normalize(l); if (n.length >= 30) vyre.add(n); }
  let fence = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence || /^\s*#/.test(raw)) continue;
    const n = normalize(raw);
    if (n.length < 30) continue;
    const first = seen.get(n);
    if (first !== undefined) add({ severity: "info", line: i + 1, rule: "repeated.fact", message: `Same line as line ${first}. Say it once.` });
    else {
      seen.set(n, i + 1);
      if (vyre.has(n)) add({ severity: "info", line: i + 1, rule: "repeated.vyre", message: "VYRE.md already says this for every agent. Remove it here." });
    }
  }
}

// ---- the whole lint ----

const INHERITS = /^\s*Inherits:\s*VYRE\.md\s*$/im;
const OVERRIDE = /^\s*Override:\s*(.*)$/i;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

export function lintText(file: LintFile, text: string, limits: LintLimits = DEFAULT_LIMITS, ctx: LintContext = {}): LintResult {
  const problems: LintProblem[] = [];
  const add = (p: LintProblem): void => { problems.push(p); };
  const lines = countLines(text);
  const amber = file === "vyre_md" ? Math.min(VYRE_MD_LINES, limits.amber) : limits.amber;
  const state: LintState = lines > limits.red ? "red" : lines > amber ? "amber" : "ok";
  if (state === "red") add({ severity: "error", rule: "lines.red", message: `${lines} lines; the hard limit is ${limits.red}. Cut ${lines - limits.red} lines.` });
  else if (state === "amber") add({ severity: "warn", rule: "lines.amber", message: `${lines} lines; keep it under ${amber}.` });

  const overrides: { line: number; text: string }[] = [];
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const m = OVERRIDE.exec(rows[i] ?? "");
    if (m) overrides.push({ line: i + 1, text: (m[1] ?? "").trim() });
  }
  for (const o of overrides) if (o.text === "") add({ severity: "warn", line: o.line, rule: "override.empty", message: "An Override line says what it loosens." });

  const secrets = scanSecrets(text);
  for (const s of secrets) add({ severity: "error", line: s.line, rule: "secret", message: `This looks like a ${s.kind.replaceAll("_", " ")}. Put it in the Vault and use its name.` });

  let inherits: boolean | undefined;
  if (file === "agent_md") {
    inherits = INHERITS.test(text);
    if (!inherits) add({ severity: "info", rule: "inherits.missing", message: "No Inherits: VYRE.md line. The agent still follows VYRE.md; the line shows it." });
  }
  if (file === "vyre_md") {
    let inRules = false;
    let count = 0;
    for (const row of rows) {
      const h = HEADING.exec(row);
      if (h) inRules = /hard rules?/i.test(h[1] ?? "");
      else if (inRules && LIST_ITEM.test(row)) count++;
    }
    if (count > VYRE_MD_HARD_RULES) add({ severity: "warn", rule: "vyre.hard_rules", message: `${count} hard rules; keep it to ${VYRE_MD_HARD_RULES}.` });
  }
  if (file === "agent_toml") lintToml(text, ctx, add);
  if (file === "vyre_md" || file === "agent_md" || file === "routine_prompt") lintRepeats(text, file === "agent_md" ? ctx.vyreText : undefined, add);

  const out: LintResult = { file, lines, state, overrides, secrets, problems };
  if (inherits !== undefined) out.inherits = inherits;
  return out;
}

// ---- line diff for the save summary ----

export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const x = a.slice(lo, ea), y = b.slice(lo, eb);
  if (x.length * y.length > 4_000_000) {
    const pool = new Map<string, number>();
    for (const l of x) pool.set(l, (pool.get(l) ?? 0) + 1);
    let common = 0;
    for (const l of y) { const n = pool.get(l) ?? 0; if (n > 0) { common++; pool.set(l, n - 1); } }
    return { added: y.length - common, removed: x.length - common };
  }
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) row[j] = x[i - 1] === y[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, row[j - 1] ?? 0);
    prev = row;
  }
  const lcs = prev[y.length] ?? 0;
  return { added: y.length - lcs, removed: x.length - lcs };
}

// ---- handlers ----

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

function record(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}
function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}
const rowsOf = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];

async function limitsOf(ctx: Ctx): Promise<LintLimits> {
  try {
    const res = (await ctx.call("settings.get", { key: "files.lint_limits" })) as { row?: { value?: { amber?: unknown; red?: unknown } } };
    const v = res.row?.value;
    if (v && typeof v.amber === "number" && typeof v.red === "number" && v.amber >= 1 && v.red >= v.amber) return { amber: v.amber, red: v.red };
  } catch { /* the defaults apply */ }
  return DEFAULT_LIMITS;
}

interface Target { fileId: string; name: string; folderId: string; folderPath: string; kind: LintFile; version: number }

async function targetOf(ctx: Ctx, fileId: string): Promise<Target> {
  const got = (await treeHandlers["files.get"](ctx, { fileId })) as { file: { name: string; folderId: string; version: number } };
  const folder = rowsOf(ctx, "SELECT * FROM files_folder WHERE id = ?", got.file.folderId)[0];
  const folderPath = folder ? String(folder.path) : "";
  return { fileId, name: got.file.name, folderId: got.file.folderId, folderPath, kind: classify(got.file.name, folderPath), version: got.file.version };
}

async function textOf(ctx: Ctx, fileId: string): Promise<string> {
  const r = (await treeHandlers["files.read"](ctx, { fileId, as: "text" })) as { text?: string };
  return r.text ?? "";
}

/** Files that sit next to agent.toml, by relative path. Walks folder names under the agent folder, one query per step. */
function existsBeside(ctx: Ctx, folderId: string): (rel: string) => boolean {
  return (rel) => {
    let folder: string | undefined = folderId;
    const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? "";
      if (i === parts.length - 1) {
        return rowsOf(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ?", folder, part).some((r) => r.deleted_at === null || r.deleted_at === undefined);
      }
      const next: Row | undefined = rowsOf(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND name = ?", folder, part).find((r) => r.deleted_at === null || r.deleted_at === undefined);
      if (!next) return false;
      folder = String(next.id);
    }
    return false;
  };
}

async function contextFor(ctx: Ctx, t: Target, text: string): Promise<LintContext> {
  const out: LintContext = {};
  if (t.kind === "agent_toml") {
    out.fileExists = existsBeside(ctx, t.folderId);
    try {
      const res = (await ctx.call("agents.list", {})) as { agents?: { name?: unknown }[] };
      if (Array.isArray(res.agents)) out.agentNames = res.agents.map((a) => String(a.name ?? "")).filter(Boolean);
    } catch { /* the handoff check is skipped */ }
  }
  if (t.kind === "agent_md" && text !== "") {
    const vyre = rowsOf(ctx, "SELECT * FROM files_file WHERE name = ?", "VYRE.md").find((r) => (r.deleted_at === null || r.deleted_at === undefined) && String(r.id) !== t.fileId);
    if (vyre) {
      try { out.vyreText = await textOf(ctx, String(vyre.id)); } catch { /* unreadable: no cross-file check */ }
    }
  }
  return out;
}

async function filesLint(ctx: Ctx, input: unknown): Promise<LintResult> {
  const o = record(ctx, input);
  const t = await targetOf(ctx, reqStr(ctx, o, "fileId"));
  const given = o["text"];
  if (given !== undefined && given !== null && typeof given !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "text" });
  const text = typeof given === "string" ? given : await textOf(ctx, t.fileId);
  return lintText(t.kind, text, await limitsOf(ctx), await contextFor(ctx, t, text));
}

async function filesSave(ctx: Ctx, input: unknown): Promise<{ versionId: string; n: number; lint: LintResult; added: number; removed: number }> {
  const o = record(ctx, input);
  const t = await targetOf(ctx, reqStr(ctx, o, "fileId"));
  const text = o["text"];
  if (typeof text !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "text" });
  if (t.kind === "other") fail(ctx, "validation.precondition_failed", "files.save is for VYRE.md, AGENT.md, agent.toml and routine prompts; use files.write for other files.", { name: t.name });
  const base = o["baseVersion"];
  if (base !== undefined && base !== null && (typeof base !== "number" || !Number.isInteger(base) || base < 1)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "baseVersion" });
  if (typeof base === "number" && base !== t.version) fail(ctx, "validation.version_conflict", "The file changed since it was read.");
  const before = await textOf(ctx, t.fileId); // the current version is the snapshot every save starts from
  const lint = lintText(t.kind, text, await limitsOf(ctx), await contextFor(ctx, t, text));
  const { added, removed } = lineDiff(before, text);
  const errors = lint.problems.filter((p) => p.severity === "error");
  const warnings = lint.problems.filter((p) => p.severity === "warn");
  if (errors.length > 0) fail(ctx, "validation.precondition_failed", `Not saved: ${errors[0]?.message ?? "the lint found an error."}`, { lint, added, removed });
  if (warnings.length > 0 && o["acceptWarnings"] !== true) fail(ctx, "validation.precondition_failed", `Not saved: ${warnings[0]?.message ?? "the lint found a warning."} Save again with the warnings accepted.`, { lint, added, removed });
  const input2: Record<string, unknown> = { fileId: t.fileId, content: { text } };
  if (typeof base === "number") input2["baseVersion"] = base;
  if (typeof o["reason"] === "string" && o["reason"] !== "") input2["reason"] = o["reason"];
  const written = (await versionHandlers["files.write"](ctx, input2)) as { file: { version: number }; versionId?: string };
  if (written.versionId === undefined) fail(ctx, "internal.unexpected", "The save did not produce a version.");
  return { versionId: written.versionId, n: written.file.version, lint, added, removed };
}

async function filesShare(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const subject = o["subject"];
  if (subject === null || typeof subject !== "object" || Array.isArray(subject)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "subject" });
  const s = subject as Record<string, unknown>;
  const level = reqStr(ctx, o, "level");
  await treeHandlers["files.get"](ctx, { fileId }); // a file that is not there is refused before any grant is made
  await ctx.call("access.share", { resource: { type: "file", id: fileId }, subject, level }, { idempotencyKey: `files.share:${fileId}:${String(s["kind"])}:${String(s["id"])}:${level}` });
  return { ok: true };
}

export const lintHandlers = {
  "files.lint": (ctx: Ctx, input: unknown) => filesLint(ctx, input),
  "files.save": (ctx: Ctx, input: unknown) => filesSave(ctx, input),
  "files.share": (ctx: Ctx, input: unknown) => filesShare(ctx, input),
};
