// The Claude Code plugin and marketplace formats, read from a map of files (path to text) so the same code reads a clone on disk, a fixture and an upload. Formats checked against
// code.claude.com/docs/en/plugins-reference and /plugin-marketplaces (30 Oct 2026):
//   marketplace  .claude-plugin/marketplace.json  { name, owner:{name}, plugins:[{ name, source, description?, version?, strict?, ...plugin.json fields }] }
//                source is a "./relative/path" or { source: "github"|"url"|"git-subdir"|"npm"|"archive"|"command", ... }
//   plugin       .claude-plugin/plugin.json (optional, `name` required) and the standard layout:
//                skills/<name>/SKILL.md, commands/*.md, agents/*.md, hooks/hooks.json, .mcp.json
//                plugin.json may point elsewhere (`./`-prefixed paths inside the plugin) or define commands, hooks and mcpServers inline.
// Nothing here runs plugin code. It only reads files and describes what is in them.
import { parseFrontMatter, parseSkill } from "./skill-md.ts";

export type Files = Readonly<Record<string, string>>;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

export const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// ---------------------------------------------------------------- paths

/** A manifest path, normalised to a key in the file map. Null when it is not `./`-prefixed or leaves the plugin. */
export function inside(p: string): string | null {
  if (!/^\.\//.test(p) && p !== "." && p !== "./") return null;
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.join("/");
}
const under = (files: Files, dir: string): string[] => {
  const pre = dir === "" ? "" : `${dir.replace(/\/$/, "")}/`;
  return Object.keys(files).filter((p) => p.startsWith(pre)).sort();
};
const jsonAt = (files: Files, p: string, warn: string[]): unknown => {
  const t = files[p];
  if (t === undefined) return undefined;
  try { return JSON.parse(t) as unknown; } catch { warn.push(`${p} is not valid JSON.`); return undefined; }
};

// ---------------------------------------------------------------- marketplace

export type PluginSource =
  | { kind: "path"; path: string }
  | { kind: "github"; repo: string; ref?: string; sha?: string }
  | { kind: "git"; url: string; ref?: string; sha?: string; subdir?: string }
  | { kind: "npm" | "archive" | "command"; spec: string };

export interface MarketplaceEntry {
  name: string;
  source: PluginSource;
  description?: string;
  version?: string;
  category?: string;
  keywords: string[];
  strict: boolean;
  /** Fields of plugin.json the entry sets inline (commands, hooks, mcpServers, skills, agents). */
  inline: Obj;
}
export interface Marketplace { name: string; description?: string; owner: string; entries: MarketplaceEntry[]; warnings: string[] }

function sourceOf(v: unknown): PluginSource | null {
  if (typeof v === "string") { const p = inside(v); return p === null ? null : { kind: "path", path: p }; }
  if (!isObj(v)) return null;
  const k = str(v["source"]);
  const ref = str(v["ref"]), sha = str(v["sha"]);
  const pin = { ...(ref ? { ref } : {}), ...(sha ? { sha } : {}) };
  if (k === "github") { const repo = str(v["repo"]); return repo ? { kind: "github", repo, ...pin } : null; }
  if (k === "url") { const url = str(v["url"]); return url ? { kind: "git", url, ...pin } : null; }
  if (k === "git-subdir") { const url = str(v["url"]), path = str(v["path"]); return url && path ? { kind: "git", url, subdir: path, ...pin } : null; }
  if (k === "npm") { const spec = str(v["package"]) ?? str(v["spec"]); return spec ? { kind: "npm", spec } : null; }
  if (k === "archive") { const spec = str(v["url"]); return spec ? { kind: "archive", spec } : null; }
  if (k === "command") { const spec = str(v["command"]); return spec ? { kind: "command", spec } : null; }
  return null;
}

export function parseMarketplace(text: string): { ok: true; marketplace: Marketplace } | { ok: false; problem: string } {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, problem: "marketplace.json is not valid JSON." }; }
  if (!isObj(j)) return { ok: false, problem: "marketplace.json must be an object." };
  const name = str(j["name"]);
  if (!name || !NAME.test(name)) return { ok: false, problem: "The marketplace needs a name (letters, digits, dash, underscore)." };
  const owner = isObj(j["owner"]) ? str(j["owner"]["name"]) : undefined;
  if (!owner) return { ok: false, problem: "The marketplace needs an owner with a name." };
  if (!Array.isArray(j["plugins"])) return { ok: false, problem: "The marketplace needs a plugins list." };
  const warnings: string[] = [];
  const entries: MarketplaceEntry[] = [];
  for (const raw of j["plugins"]) {
    if (!isObj(raw)) { warnings.push("A plugin entry is not an object and was skipped."); continue; }
    const pn = str(raw["name"]);
    const source = sourceOf(raw["source"]);
    if (!pn || !NAME.test(pn)) { warnings.push("A plugin entry has no usable name and was skipped."); continue; }
    if (!source) { warnings.push(`Plugin ${pn} has a source Vyre cannot use (a ./path inside the marketplace, or github, url, git-subdir, npm, archive, command).`); continue; }
    const inline: Obj = {};
    for (const k of ["commands", "agents", "skills", "hooks", "mcpServers"]) if (raw[k] !== undefined) inline[k] = raw[k];
    entries.push({
      name: pn, source, keywords: arr(raw["keywords"]).filter((x): x is string => typeof x === "string"), strict: raw["strict"] !== false, inline,
      ...(str(raw["description"]) ? { description: str(raw["description"])! } : {}), ...(str(raw["version"]) ? { version: str(raw["version"])! } : {}), ...(str(raw["category"]) ? { category: str(raw["category"])! } : {}),
    });
  }
  return { ok: true, marketplace: { name, owner, entries, warnings, ...(str(j["description"]) ? { description: str(j["description"])! } : {}) } };
}

// ---------------------------------------------------------------- plugin

export interface PluginSkill { name: string; description: string; text: string; /** supporting files, path relative to the skill folder */ files: Record<string, string> }
export interface PluginCommand { name: string; description: string; argumentHint?: string; model?: string; allowedTools: string[]; body: string }
export interface PluginAgent { name: string; description: string; tools: string[]; model?: string; body: string }
export type HookEvent = string;
export interface PluginHook { event: HookEvent; matcher: string; command: string; args: string[]; timeoutSec?: number }
export interface PluginMcp {
  name: string;
  transport: "stdio" | "http" | "sse" | "ws";
  command?: string; args: string[]; env: Record<string, string>;
  url?: string; headers: Record<string, string>;
}
export interface UserConfigField { key: string; type: string; title: string; description: string; required: boolean; sensitive: boolean; default?: unknown }
export interface PluginContents {
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  userConfig: UserConfigField[];
  skills: PluginSkill[];
  commands: PluginCommand[];
  agents: PluginAgent[];
  hooks: PluginHook[];
  mcpServers: PluginMcp[];
  warnings: string[];
}

function readSkillDir(files: Files, dir: string, fallback: string, warn: string[]): PluginSkill | null {
  const at = dir === "" ? "SKILL.md" : `${dir}/SKILL.md`;
  const text = files[at];
  if (text === undefined) return null;
  const r = parseSkill(text, fallback);
  if (!r.ok) { warn.push(`${at}: ${r.problem}`); return null; }
  const pre = dir === "" ? "" : `${dir}/`;
  const support: Record<string, string> = {};
  for (const p of under(files, dir)) if (p !== at && !p.startsWith(".claude-plugin/") && (dir !== "" || /^(references|scripts|assets|examples)\//.test(p))) support[p.slice(pre.length)] = files[p]!;
  return { name: r.skill.name, description: r.skill.description, text, files: support };
}

function skillsFrom(files: Files, key: string, warn: string[]): PluginSkill[] {
  const out: PluginSkill[] = [];
  const dir = key === "" ? "" : key;
  const direct = readSkillDir(files, dir, dir.split("/").pop() ?? "", warn);
  if (direct) { out.push(direct); return out; }
  const pre = dir === "" ? "" : `${dir}/`;
  const names = new Set(under(files, dir).filter((p) => p.endsWith("/SKILL.md")).map((p) => p.slice(pre.length).split("/")[0]!));
  for (const n of [...names].sort()) { const s = readSkillDir(files, `${pre}${n}`, n, warn); if (s) out.push(s); }
  return out;
}

function commandFrom(name: string, text: string): PluginCommand {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const meta = m ? parseFrontMatter(m[1]!) : {};
  const body = (m ? text.slice(m[0].length) : text).replace(/^\r?\n+/, "");
  const tools = meta["allowed-tools"] ?? meta["allowedTools"];
  const rawHint = meta["argument-hint"] ?? meta["argumentHint"];
  /** `[env]` is a YAML list to the parser and a hint to the person who wrote it. */
  const hint = Array.isArray(rawHint) ? `[${rawHint.join(", ")}]` : str(rawHint);
  const model = str(meta["model"]);
  return {
    name, body, allowedTools: toolList(tools), ...(hint ? { argumentHint: hint } : {}), ...(model ? { model } : {}),
    description: str(meta["description"]) ?? body.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "")?.replace(/^#+\s*/, "").slice(0, 200) ?? name,
  };
}
const toolList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/[,\s]+(?![^(]*\))/).map((x) => x.trim()).filter(Boolean) : []);

function commandsFrom(files: Files, spec: unknown, warn: string[]): PluginCommand[] {
  const out: PluginCommand[] = [];
  const addFile = (p: string, base: string): void => {
    const t = files[p];
    if (t === undefined) { warn.push(`Command file ${p} was not found.`); return; }
    const rel = p.slice(base.length).replace(/\.md$/, "");
    out.push(commandFrom(rel.split("/").join(":"), t));
  };
  const addPath = (raw: string): void => {
    const p = inside(raw);
    if (p === null) { warn.push(`Command path ${raw} must start with ./ and stay inside the plugin.`); return; }
    if (p.endsWith(".md")) { addFile(p, p.includes("/") ? `${p.slice(0, p.lastIndexOf("/"))}/` : ""); return; }
    for (const f of under(files, p).filter((x) => x.endsWith(".md"))) addFile(f, `${p}/`);
  };
  if (spec === undefined) { for (const f of under(files, "commands").filter((x) => x.endsWith(".md"))) addFile(f, "commands/"); return out; }
  for (const item of Array.isArray(spec) ? spec : [spec]) {
    if (typeof item === "string") addPath(item);
    else if (isObj(item)) {
      for (const [name, v] of Object.entries(item)) {
        if (!isObj(v)) continue;
        const src = str(v["source"]), content = str(v["content"]);
        if ((src ? 1 : 0) + (content ? 1 : 0) !== 1) { warn.push(`Command ${name} must set exactly one of source or content.`); continue; }
        let c: PluginCommand | null = null;
        if (src) { const p = inside(src); const t = p === null ? undefined : files[p]; if (t === undefined) { warn.push(`Command ${name}: ${src} was not found.`); continue; } c = commandFrom(name, t); }
        else c = { name, body: content!, description: content!.split(/\r?\n/)[0]!.slice(0, 200), allowedTools: [] };
        const d = str(v["description"]), h = str(v["argumentHint"]), model = str(v["model"]);
        out.push({ ...c, ...(d ? { description: d } : {}), ...(h ? { argumentHint: h } : {}), ...(model ? { model } : {}), ...(Array.isArray(v["allowedTools"]) ? { allowedTools: toolList(v["allowedTools"]) } : {}) });
      }
    }
  }
  return out;
}

function agentsFrom(files: Files, spec: unknown, warn: string[]): PluginAgent[] {
  const paths = spec === undefined ? under(files, "agents").filter((x) => x.endsWith(".md")) : arr(spec).flatMap((s) => {
    const p = typeof s === "string" ? inside(s) : null;
    if (p === null || !p.endsWith(".md")) { warn.push(`Agent path ${String(s)} must be a ./ path to a .md file.`); return []; }
    return [p];
  });
  const out: PluginAgent[] = [];
  for (const p of paths) {
    const t = files[p];
    if (t === undefined) { warn.push(`Agent file ${p} was not found.`); continue; }
    const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t);
    const meta = m ? parseFrontMatter(m[1]!) : {};
    const body = (m ? t.slice(m[0].length) : t).replace(/^\r?\n+/, "");
    const base = p.replace(/\.md$/, "").split("/").slice(spec === undefined ? 1 : -1).join(":");
    const name = str(meta["name"]) ?? base;
    const model = str(meta["model"]);
    out.push({ name, description: str(meta["description"]) ?? name, tools: toolList(meta["tools"]), body, ...(model ? { model } : {}) });
  }
  return out;
}

function hooksFrom(files: Files, spec: unknown, warn: string[]): PluginHook[] {
  const out: PluginHook[] = [];
  const addMap = (events: unknown): void => {
    if (!isObj(events)) return;
    for (const [event, groups] of Object.entries(events)) {
      for (const g of arr(groups)) {
        if (!isObj(g)) continue;
        const matcher = str(g["matcher"]) ?? "";
        for (const h of arr(g["hooks"])) {
          if (!isObj(h)) continue;
          if (h["type"] !== undefined && h["type"] !== "command") { warn.push(`A ${event} hook of type ${String(h["type"])} is not a command and is not run.`); continue; }
          const command = str(h["command"]);
          if (!command) continue;
          const t = typeof h["timeout"] === "number" ? h["timeout"] : undefined;
          out.push({ event, matcher, command, args: arr(h["args"]).filter((x): x is string => typeof x === "string"), ...(t !== undefined ? { timeoutSec: t } : {}) });
        }
      }
    }
  };
  const addFile = (p: string, required: boolean): void => {
    const j = jsonAt(files, p, warn);
    if (j === undefined) { if (required && files[p] === undefined) warn.push(`Hooks file ${p} was not found.`); return; }
    if (isObj(j) && isObj(j["hooks"])) addMap(j["hooks"]);
    else warn.push(`${p} must wrap its events in a "hooks" key.`);
  };
  addFile("hooks/hooks.json", false);
  for (const item of arr(spec)) {
    if (typeof item === "string") { const p = inside(item); if (p) addFile(p, true); else warn.push(`Hooks path ${item} must start with ./`); }
    else addMap(item);
  }
  return out;
}

function mcpFrom(files: Files, spec: unknown, warn: string[]): PluginMcp[] {
  const map = new Map<string, PluginMcp>();
  const addServers = (servers: unknown): void => {
    if (!isObj(servers)) return;
    for (const [name, v] of Object.entries(servers)) {
      if (!isObj(v)) continue;
      const url = str(v["url"]);
      const type = str(v["type"]);
      const transport: PluginMcp["transport"] = type === "http" || type === "sse" || type === "ws" ? type : url ? "http" : "stdio";
      const command = str(v["command"]);
      if (transport === "stdio" && !command) { warn.push(`MCP server ${name} has no command.`); continue; }
      if (transport !== "stdio" && !url) { warn.push(`MCP server ${name} has no url.`); continue; }
      const strMap = (x: unknown): Record<string, string> => (isObj(x) ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === "string")) : {});
      map.set(name, { name, transport, args: arr(v["args"]).filter((x): x is string => typeof x === "string"), env: strMap(v["env"]), headers: strMap(v["headers"]), ...(command ? { command } : {}), ...(url ? { url } : {}) });
    }
  };
  const addFile = (p: string, required: boolean): void => {
    const j = jsonAt(files, p, warn);
    if (j === undefined) { if (required && files[p] === undefined) warn.push(`MCP file ${p} was not found.`); return; }
    addServers(isObj(j) && isObj(j["mcpServers"]) ? j["mcpServers"] : j);
  };
  addFile(".mcp.json", false);
  for (const item of arr(spec)) {
    if (typeof item === "string") { const p = inside(item); if (p && p.endsWith(".json")) addFile(p, true); else warn.push(`MCP path ${item} must be a ./ path to a .json file.`); }
    else addServers(item);
  }
  return [...map.values()];
}

/**
 * What a plugin holds. `files` are the plugin's files with paths relative to its root. `entry` is the marketplace entry, whose inline fields add to plugin.json (strict, the default) or stand
 * in for it. Nothing is run.
 */
export function readPlugin(files: Files, entry?: MarketplaceEntry): PluginContents {
  const warnings: string[] = [];
  const j = jsonAt(files, ".claude-plugin/plugin.json", warnings);
  const man: Obj = isObj(j) ? { ...j } : {};
  if (entry) {
    if (isObj(j) && entry.strict) {
      for (const k of ["commands", "agents", "skills"]) if (entry.inline[k] !== undefined) man[k] = [...arr(man[k]), ...arr(entry.inline[k])];
      if (entry.inline["hooks"] !== undefined) man["hooks"] = [...arr(man["hooks"]), ...arr(entry.inline["hooks"])];
      if (entry.inline["mcpServers"] !== undefined) man["mcpServers"] = [...arr(man["mcpServers"]), ...arr(entry.inline["mcpServers"])];
    } else if (!isObj(j)) Object.assign(man, entry.inline);
    if (man["name"] === undefined) man["name"] = entry.name;
  }
  const name = str(man["name"]) ?? "";
  if (!NAME.test(name)) warnings.push("The plugin has no usable name.");

  let skills: PluginSkill[] = [];
  const hasSkillsDir = under(files, "skills").length > 0;
  if (hasSkillsDir) skills = skillsFrom(files, "skills", warnings);
  else if (files["SKILL.md"] !== undefined && man["skills"] === undefined) { const s = readSkillDir(files, "", name, warnings); if (s) skills = [s]; }
  for (const raw of arr(man["skills"])) {
    if (typeof raw !== "string") continue;
    const p = inside(raw);
    if (p === null) { warnings.push(`Skills path ${raw} must start with ./ and stay inside the plugin.`); continue; }
    for (const s of skillsFrom(files, p, warnings)) if (!skills.some((x) => x.name === s.name)) skills.push(s);
  }

  const fields: UserConfigField[] = [];
  if (isObj(man["userConfig"])) {
    for (const [key, v] of Object.entries(man["userConfig"])) {
      if (!isObj(v) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      fields.push({ key, type: str(v["type"]) ?? "string", title: str(v["title"]) ?? key, description: str(v["description"]) ?? "", required: v["required"] === true, sensitive: v["sensitive"] === true, ...(v["default"] !== undefined ? { default: v["default"] } : {}) });
    }
  }
  const out: PluginContents = {
    name, userConfig: fields, skills, warnings,
    commands: commandsFrom(files, man["commands"], warnings),
    agents: agentsFrom(files, man["agents"], warnings),
    hooks: hooksFrom(files, man["hooks"], warnings),
    mcpServers: mcpFrom(files, man["mcpServers"], warnings),
  };
  const dn = str(man["displayName"]), v = str(man["version"]) ?? entry?.version, d = str(man["description"]) ?? entry?.description;
  return { ...out, ...(dn ? { displayName: dn } : {}), ...(v ? { version: v } : {}), ...(d ? { description: d } : {}) };
}

// ---------------------------------------------------------------- using a command and a variable

/** `$ARGUMENTS`, `$ARGUMENTS[N]` and `$N` in a command body. With no placeholder and some arguments the open format appends `ARGUMENTS: <value>`. */
export function renderCommand(body: string, args: string): string {
  const words = args.trim() === "" ? [] : args.trim().split(/\s+/);
  let used = false;
  const out = body
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, n: string) => { used = true; return words[Number(n)] ?? ""; })
    .replace(/\$ARGUMENTS\b/g, () => { used = true; return args.trim(); })
    .replace(/\$(\d)\b/g, (_m, n: string) => { used = true; return words[Number(n) - 1] ?? ""; });
  return !used && args.trim() !== "" ? `${out.replace(/\s+$/, "")}\n\nARGUMENTS: ${args.trim()}\n` : out;
}

/** Replaces `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}` and `${KEY}` from `vars`. An unknown variable is left as written. */
export function expandVars(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (m, k: string) => vars[k] ?? m);
}
