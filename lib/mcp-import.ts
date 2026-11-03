// Turning what a person pastes into MCP connection drafts (Vault > Connections, Add): an address (an https URL, or a command such as `npx -y @acme/server` or `uvx acme-mcp`), or a whole
// Claude Code or Codex config (.mcp.json, ~/.claude.json, ~/.codex/config.toml). Pure: nothing here reads a disk or the network.
// Keys never travel in a command line. A value that looks like a key (by its name or its shape) is split out of env and headers into `secrets`, which the sheet saves into the Vault; the draft keeps
// the name and later gets the handle. A key written into the command itself cannot be moved safely, so that draft carries a problem and is not added until the command is changed.

export interface DraftSecret { key: string; into: "env" | "header"; value: string; /** The text around the value in a header, such as "Bearer " (the handle goes where the value was). */ prefix?: string }

export interface ConnectionDraft {
  name: string;
  url?: string;
  transport?: "http" | "sse";
  command?: string;
  args: string[];
  /** Plain values only: a secret is in `secrets`. */
  env: Record<string, string>;
  headers: Record<string, string>;
  /** Values to put in the Vault; the connection gets their handles. */
  secrets: DraftSecret[];
  /** Values the config left to the environment (${GITHUB_TOKEN}): the person types them in the sheet. */
  needs: Array<{ key: string; into: "env" | "header"; secret: boolean; prefix?: string }>;
  /** Why this draft cannot be added as it is. */
  problem?: string;
  /** Where it came from: the file kind and, for ~/.claude.json, the project folder. */
  from?: string;
}

const SECRET_NAME = /(authorization|api[-_]?key|apikey|token|secret|password|passwd|cookie|credential|private[-_]?key|bearer|access[-_]?key)/i;
/** Shapes of real keys: the prefixes services put on them (sk-, ghp_, xoxb-, AKIA, a JWT), and long random runs. */
const KEY_PREFIX = /^(sk-|sk_|pk_live|rk_live|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abpr]-|AKIA|AIza|ya29\.|eyJ[A-Za-z0-9_-]{10,}\.|glpat-|ntn_|secret_|lin_api_|shpat_|sntrys_|BSA[A-Za-z0-9]{20,})/;
const LONG_RUN = /^[A-Za-z0-9_\-+/=]{32,}$/;
const SECRET_SHAPE = { test: (v: string): boolean => KEY_PREFIX.test(v) || (LONG_RUN.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v)) };
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

export const looksSecret = (key: string, value: string): boolean => !HANDLE.test(value.replace(/^Bearer\s+/i, "")) && (SECRET_NAME.test(key) || SECRET_SHAPE.test(value.replace(/^Bearer\s+/i, "")));

/** A command-line argument that is (or carries) a key: `--api-key=sk-...`, `--token sk-...` (the value after a flag named like a key), or a bare key-shaped value. */
export function secretInArgs(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = /^--?([A-Za-z0-9_-]+)=(.+)$/.exec(a);
    if (eq && (SECRET_NAME.test(eq[1]!) || SECRET_SHAPE.test(eq[2]!)) && !HANDLE.test(eq[2]!) && !/^\$\{?[A-Z_]+\}?$/.test(eq[2]!)) return i;
    if (/^--?[A-Za-z0-9_-]+$/.test(a) && SECRET_NAME.test(a) && i + 1 < args.length && !/^-/.test(args[i + 1]!)) return i + 1;
    if (KEY_PREFIX.test(a) || (LONG_RUN.test(a) && /[0-9]/.test(a) && /[A-Z]/.test(a) && /[a-z]/.test(a))) return i;
    if (HANDLE.test(a)) return i;
  }
  return -1;
}

const RUNNERS = new Set(["npx", "uvx", "uv", "pipx", "node", "deno", "bun", "bunx", "pnpx", "pnpm", "yarn", "python", "python3", "docker", "podman", "go", "java", "dotnet", "ruby", "php", "cargo"]);
const nameOf = (raw: string): string => (raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 40) || "server");

/** Splits a shell-like line into words: quotes group, backslash escapes. */
export function words(line: string): string[] {
  const out: string[] = [];
  let cur = "", q: "'" | '"' | null = null, has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === q) q = null; else if (c === "\\" && q === '"' && i + 1 < line.length) cur += line[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === "\\" && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** A name for a command's server: the package it runs (@acme/github-mcp becomes github), else the program. */
function nameFromCommand(command: string, args: readonly string[]): string {
  const pkg = args.find((a) => !a.startsWith("-") && a !== "run") ?? command;
  const bare = pkg.replace(/^@[^/]+\//, "").replace(/[@=:].*$/, "").split("/").pop() ?? pkg;
  return nameOf(bare.replace(/^(mcp-server-|server-|mcp-)/, "").replace(/(-mcp-server|-mcp|-server)$/, ""));
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.hostname.split(".").filter((p) => !["www", "mcp", "api", "com", "io", "dev", "ai", "app", "net", "org", "server"].includes(p));
    return nameOf(parts[0] ?? u.hostname);
  } catch { return "server"; }
}

/** Puts env and headers through the secret test: a plain value stays, a key moves to `secrets`, a ${VAR} reference becomes a need. */
function sortValues(d: ConnectionDraft, into: "env" | "header", map: Record<string, unknown>): void {
  for (const [k, raw] of Object.entries(map)) {
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const v = String(raw);
    const ref = /^(Bearer\s+)?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(v);
    if (ref) { d.needs.push({ key: k, into, secret: SECRET_NAME.test(k) || SECRET_NAME.test(ref[2]!), ...(ref[1] ? { prefix: ref[1] } : {}) }); continue; }
    if (looksSecret(k, v)) {
      const bearer = /^(Bearer\s+)(.+)$/i.exec(v);
      d.secrets.push({ key: k, into, value: bearer ? bearer[2]! : v, ...(bearer ? { prefix: bearer[1]! } : {}) });
      continue;
    }
    if (into === "env") d.env[k] = v; else d.headers[k] = v;
  }
}

function check(d: ConnectionDraft): ConnectionDraft {
  if (d.command) {
    const at = secretInArgs(d.args);
    if (at >= 0) d.problem = "A key is written into the command. Put it in an environment value instead, so it never shows in a command line.";
    if (/\s/.test(d.command)) d.problem = "The command has a space in it.";
  }
  if (d.url) {
    try { const u = new URL(d.url); if (u.protocol !== "https:" && u.protocol !== "http:") d.problem = "A remote MCP server is reached over https."; else if (u.username || u.password) d.problem = "Do not put a password in the address."; }
    catch { d.problem = "That is not an address."; }
  }
  return d;
}

const empty = (name: string): ConnectionDraft => ({ name, args: [], env: {}, headers: {}, secrets: [], needs: [] });

/**
 * One address: an https URL, or a command line. Leading `NAME=value` words become environment values (keys go to `secrets`). A pasted JSON or TOML config is handed to parseConfig.
 * Answers null for text that is none of these.
 */
export function parseAddress(text: string): ConnectionDraft[] | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("{") || /^\[mcp_servers\./m.test(t) || /^\s*\[mcp_servers/m.test(t)) { const r = parseConfig(t); return r.drafts.length ? r.drafts : null; }
  if (/^https?:\/\//i.test(t) && !/\s/.test(t)) {
    const d = empty(nameFromUrl(t));
    d.url = t;
    d.transport = /\/sse\/?$/.test(t) ? "sse" : "http";
    return [check(d)];
  }
  // `claude mcp add name -- npx ...` and `codex mcp add name -- npx ...`: the part after -- is the command, the word before it the name
  const w = words(t);
  if (w.length === 0) return null;
  let name: string | undefined;
  let rest = w;
  const added = /^(claude|codex)$/.test(w[0]!) && w[1] === "mcp" && w[2] === "add";
  if (added) {
    const dash = w.indexOf("--");
    const head = dash >= 0 ? w.slice(3, dash) : w.slice(3);
    const envs: string[] = [];
    const positional: string[] = [];
    for (let i = 0; i < head.length; i++) {
      const a = head[i]!;
      if ((a === "-e" || a === "--env") && head[i + 1]) { envs.push(head[++i]!); continue; }
      if (/^--?(transport|scope|s|t)$/.test(a)) { i++; continue; }
      if (a.startsWith("-")) continue;
      positional.push(a);
    }
    name = positional[0];
    rest = [...envs, ...(dash >= 0 ? w.slice(dash + 1) : positional.slice(1))];
    if (rest.length === 1 && /^https?:\/\//.test(rest[0]!)) { const d = empty(nameOf(name ?? nameFromUrl(rest[0]!))); d.url = rest[0]!; d.transport = "http"; return [check(d)]; }
  }
  const env: Record<string, string> = {};
  while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]!)) { const [k, ...v] = rest[0]!.split("="); env[k!] = v.join("="); rest = rest.slice(1); }
  if (rest.length === 0) return null;
  const command = rest[0]!;
  if (!/^[A-Za-z0-9_./~-]+$/.test(command)) return null;
  // a program people run MCP servers with, a path to one, or one named like a server; prose is not a command
  const prog = command.split("/").pop() ?? command;
  if (!RUNNERS.has(prog) && !command.includes("/") && !/mcp/i.test(prog)) return null;
  const d = empty(nameOf(name ?? nameFromCommand(command, rest.slice(1))));
  d.command = command;
  d.args = rest.slice(1);
  sortValues(d, "env", env);
  return [check(d)];
}

/** A server entry of a JSON config (Claude Code, Cursor, VS Code shapes). */
function fromJsonEntry(name: string, raw: unknown, from: string): ConnectionDraft | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const d = empty(nameOf(name));
  d.from = from;
  const url = typeof e["url"] === "string" ? e["url"] : typeof e["serverUrl"] === "string" ? e["serverUrl"] : undefined;
  if (url) {
    d.url = url;
    d.transport = e["type"] === "sse" || e["transport"] === "sse" ? "sse" : "http";
    if (e["headers"] && typeof e["headers"] === "object") sortValues(d, "header", e["headers"] as Record<string, unknown>);
    return check(d);
  }
  if (typeof e["command"] !== "string") return null;
  const cmd = words(e["command"]);
  d.command = cmd[0] ?? "";
  d.args = [...cmd.slice(1), ...(Array.isArray(e["args"]) ? (e["args"] as unknown[]).map(String) : [])];
  if (e["env"] && typeof e["env"] === "object") sortValues(d, "env", e["env"] as Record<string, unknown>);
  return check(d);
}

export interface ParsedConfig { kind: "claude" | "claude-user" | "codex" | "unknown"; drafts: ConnectionDraft[]; error?: string }

/**
 * A config file's text: .mcp.json ({ mcpServers }), ~/.claude.json (mcpServers at the top and under projects.<folder>.mcpServers), VS Code's { servers }, or ~/.codex/config.toml
 * ([mcp_servers.<name>] with command, args, env, url, http_headers, bearer_token_env_var). The same server name twice keeps the first.
 */
export function parseConfig(text: string): ParsedConfig {
  const t = text.trim();
  if (!t) return { kind: "unknown", drafts: [], error: "The file is empty." };
  if (t.startsWith("{")) {
    let j: Record<string, unknown>;
    try { j = JSON.parse(t) as Record<string, unknown>; } catch { return { kind: "unknown", drafts: [], error: "That is not valid JSON." }; }
    const out: ConnectionDraft[] = [];
    const seen = new Set<string>();
    const take = (map: unknown, from: string): void => {
      if (!map || typeof map !== "object") return;
      for (const [n, v] of Object.entries(map as Record<string, unknown>)) {
        const d = fromJsonEntry(n, v, from);
        if (d && !seen.has(d.name)) { seen.add(d.name); out.push(d); }
      }
    };
    take(j["mcpServers"], ".mcp.json");
    take(j["servers"], "mcp.json");
    const projects = j["projects"];
    if (projects && typeof projects === "object") for (const [folder, p] of Object.entries(projects as Record<string, unknown>)) take((p as Record<string, unknown> | null)?.["mcpServers"], folder);
    const kind = projects && typeof projects === "object" ? "claude-user" : "claude";
    return out.length ? { kind, drafts: out } : { kind, drafts: [], error: "No MCP servers in that file." };
  }
  const toml = readToml(t);
  if (toml.error) return { kind: "codex", drafts: [], error: toml.error };
  const servers = toml.value["mcp_servers"];
  const out: ConnectionDraft[] = [];
  if (servers && typeof servers === "object") {
    for (const [n, raw] of Object.entries(servers as Record<string, unknown>)) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const d = empty(nameOf(n));
      d.from = "config.toml";
      if (typeof e["url"] === "string") {
        d.url = e["url"];
        d.transport = "http";
        if (e["http_headers"] && typeof e["http_headers"] === "object") sortValues(d, "header", e["http_headers"] as Record<string, unknown>);
        if (typeof e["bearer_token_env_var"] === "string") d.needs.push({ key: "Authorization", into: "header", secret: true, prefix: "Bearer " });
      } else if (typeof e["command"] === "string") {
        d.command = e["command"];
        d.args = Array.isArray(e["args"]) ? (e["args"] as unknown[]).map(String) : [];
        if (e["env"] && typeof e["env"] === "object") sortValues(d, "env", e["env"] as Record<string, unknown>);
        if (Array.isArray(e["env_vars"])) for (const k of e["env_vars"] as unknown[]) d.needs.push({ key: String(k), into: "env", secret: SECRET_NAME.test(String(k)) });
      } else continue;
      out.push(check(d));
    }
  }
  return out.length ? { kind: "codex", drafts: out } : { kind: "codex", drafts: [], error: "No [mcp_servers] in that file." };
}

// ---- a small TOML reader: tables, dotted keys, strings, numbers, booleans, arrays and inline tables. Enough for config.toml; anything else is skipped, never guessed.

type Toml = Record<string, unknown>;

function readToml(text: string): { value: Toml; error?: string } {
  const root: Toml = {};
  let table = root;
  const lines = text.split(/\r?\n/);
  const at = (path: string[], from: Toml = root): Toml => {
    let cur = from;
    for (const p of path) { if (!cur[p] || typeof cur[p] !== "object" || Array.isArray(cur[p])) cur[p] = {}; cur = cur[p] as Toml; }
    return cur;
  };
  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i]!).trim();
    if (!line) continue;
    const head = /^\[\s*([^\[\]]+?)\s*\]$/.exec(line);
    if (head) { table = at(keyPath(head[1]!)); continue; }
    if (/^\[\[/.test(line)) { table = {}; continue; }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    // a value may run over several lines (an array)
    let val = line.slice(eq + 1).trim();
    while (unbalanced(val) && i + 1 < lines.length) { val += " " + stripComment(lines[++i]!).trim(); }
    line = line.slice(0, eq).trim();
    const path = keyPath(line);
    const parsed = value(val);
    if (parsed === undefined) continue;
    at(path.slice(0, -1), table)[path[path.length - 1]!] = parsed;
  }
  return { value: root };
}

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function unbalanced(v: string): boolean {
  let depth = 0, q: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth > 0;
}

function keyPath(k: string): string[] {
  const out: string[] = [];
  let cur = "", q: string | null = null;
  for (const c of k) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ".") { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter((p) => p !== "");
}

function value(v: string): unknown {
  const r = readValue(v, 0);
  return r ? r.v : undefined;
}

function readValue(s: string, i: number): { v: unknown; i: number } | null {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  const c = s[i];
  if (c === '"' || c === "'") {
    let out = "";
    let j = i + 1;
    for (; j < s.length && s[j] !== c; j++) {
      if (c === '"' && s[j] === "\\" && j + 1 < s.length) { const n = s[++j]!; out += n === "n" ? "\n" : n === "t" ? "\t" : n; }
      else out += s[j];
    }
    return { v: out, i: j + 1 };
  }
  if (c === "[") {
    const out: unknown[] = [];
    let j = i + 1;
    for (;;) {
      while (j < s.length && /[\s,]/.test(s[j]!)) j++;
      if (j >= s.length) return null;
      if (s[j] === "]") return { v: out, i: j + 1 };
      const r = readValue(s, j);
      if (!r) return null;
      out.push(r.v);
      j = r.i;
    }
  }
  if (c === "{") {
    const out: Toml = {};
    let j = i + 1;
    for (;;) {
      while (j < s.length && /[\s,]/.test(s[j]!)) j++;
      if (j >= s.length) return null;
      if (s[j] === "}") return { v: out, i: j + 1 };
      const eq = s.indexOf("=", j);
      if (eq < 0) return null;
      const key = keyPath(s.slice(j, eq).trim());
      const r = readValue(s, eq + 1);
      if (!r) return null;
      let t = out;
      for (const p of key.slice(0, -1)) { if (!t[p] || typeof t[p] !== "object") t[p] = {}; t = t[p] as Toml; }
      t[key[key.length - 1]!] = r.v;
      j = r.i;
    }
  }
  const m = /^(true|false|[+-]?\d+(\.\d+)?)/.exec(s.slice(i));
  if (m) return { v: m[1] === "true" ? true : m[1] === "false" ? false : Number(m[1]), i: i + m[0].length };
  return null;
}
