// Skills from outside (owner ruling 3 Nov, lane l-skills2): what a link, a dropped folder, a zip or a Codex folder holds, and what each skill in it can touch. Pure: the module that installs
// fetches the bytes, this reads them. Formats found:
//   a SKILL.md folder        any folder with a SKILL.md (Anthropic Agent Skills, Claude Code skills), at the root or under skills/, .claude/skills/, .codex/skills/ or .agents/skills/
//   a Claude Code plugin     .claude-plugin/plugin.json beside skills/: each skill also gets the plugin's .mcp.json
//   a Codex folder           .codex/skills/<name>/SKILL.md, .agents/skills/<name>/SKILL.md (with agents/openai.yaml metadata), or a lone AGENTS.md, which becomes one skill
// What a skill can touch is read from its files: scripts it ships, the MCP servers in its .mcp.json (and the keys those want), whether it reaches the network, and the Vault keys it names. A share
// is approved for that set; an update whose set grew waits for approval again.
import { inflateRawSync } from "node:zlib";
import { parseFrontMatter, parseSkill, skillText } from "./skill-md.ts";
import { readPlugin } from "./plugin-format.ts";

export type Files = Record<string, string>;

/** One skill found in a tree: its SKILL.md, the files beside it (paths relative to its folder), and where in the tree it sat. */
export interface FoundSkill { name: string; description: string; text: string; files: Files; path: string; kind: "skill" | "plugin" | "codex"; version?: string }

export interface McpNeed { name: string; transport: "stdio" | "http" | "sse" | "ws"; target: string; keys: string[] }
/** What a skill can touch. Every list is sorted, so two reads of one skill are equal. */
export interface SkillPerms { scripts: string[]; mcpServers: McpNeed[]; network: string[]; vaultKeys: string[] }

// ---------------------------------------------------------------- zip

/** The text files of a zip (stored or deflated entries; folders and binary files are left out and named in `skipped`). */
export function unzipText(bytes: Uint8Array, maxBytes = 3_000_000): { files: Files; skipped: string[] } {
  const files: Files = {};
  const skipped: string[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("This is not a zip file.");
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The zip file is damaged.");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name)) continue;
    if (name.startsWith("/") || name.split("/").includes("..")) { skipped.push(name); continue; }
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else { skipped.push(name); continue; }
    total += size;
    if (total > maxBytes) throw new Error(`The zip holds more than ${Math.round(maxBytes / 1_000_000)} MB.`);
    const text = asText(data);
    if (text === null) skipped.push(name); else files[name] = text;
  }
  return { files, skipped };
}

/** The bytes as UTF-8 text, or null when they are not text (a NUL byte, or invalid UTF-8). */
export function asText(data: Uint8Array): string | null {
  if (data.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return null; }
}

// ---------------------------------------------------------------- the skills in a tree

/** A zip of a GitHub repo, or a dropped folder, puts everything under one top folder (repo-main/): it is taken off so the paths read as the repo's. */
export function stripTop(files: Files): Files {
  const keys = Object.keys(files);
  if (keys.length === 0) return files;
  const top = keys[0]!.split("/")[0]!;
  // a hidden top folder (.codex, .agents, .claude) is part of the layout, never a wrapper
  if (top.startsWith(".")) return files;
  if (!keys.every((k) => k.startsWith(`${top}/`))) return files;
  if (keys.some((k) => k === `${top}/SKILL.md`) && keys.length === 1) return files;
  return Object.fromEntries(keys.map((k) => [k.slice(top.length + 1), files[k]!]));
}

const slugOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";

/**
 * Every skill in a tree of text files. `hint` names the skill made from a lone AGENTS.md (the folder or repo name). Nothing is run. Problems (a SKILL.md that does not parse) come back in
 * `problems`, and the other skills still come back.
 */
export function skillsInTree(input: Files, hint = "agents"): { skills: FoundSkill[]; problems: string[] } {
  const files = stripTop(input);
  const problems: string[] = [];
  const out: FoundSkill[] = [];
  const isPlugin = files[".claude-plugin/plugin.json"] !== undefined;
  const plugin = isPlugin ? readPlugin(files) : null;
  const dirs = Object.keys(files).filter((p) => p === "SKILL.md" || p.endsWith("/SKILL.md")).map((p) => (p === "SKILL.md" ? "" : p.slice(0, -"/SKILL.md".length))).sort();
  for (const dir of dirs) {
    const pre = dir === "" ? "" : `${dir}/`;
    const text = files[`${pre}SKILL.md`]!;
    const r = parseSkill(text, dir.split("/").pop() || hint);
    if (!r.ok) { problems.push(`${pre}SKILL.md: ${r.problem}`); continue; }
    const nested = dirs.filter((d) => d !== dir && (dir === "" || d.startsWith(pre)));
    const support: Files = {};
    for (const [p, t] of Object.entries(files)) {
      if (!p.startsWith(pre) || p === `${pre}SKILL.md`) continue;
      if (nested.some((d) => p.startsWith(`${d}/`))) continue;
      if (dir === "" && (p.startsWith(".claude-plugin/") || p.startsWith(".git/"))) continue;
      support[p.slice(pre.length)] = t;
    }
    // a plugin's servers are the plugin's, beside its skills: each skill brings them along
    if (plugin && files[".mcp.json"] !== undefined && support[".mcp.json"] === undefined) support[".mcp.json"] = files[".mcp.json"]!;
    const codex = /(^|\/)\.(codex|agents)\/skills\//.test(`${pre}`) || support["agents/openai.yaml"] !== undefined;
    const version = typeof r.skill.meta["version"] === "string" || typeof r.skill.meta["version"] === "number" ? String(r.skill.meta["version"]) : plugin?.version;
    out.push({ name: r.skill.name, description: r.skill.description, text, files: support, path: dir, kind: plugin ? "plugin" : codex ? "codex" : "skill", ...(version ? { version } : {}) });
  }
  if (out.length === 0 && dirs.length === 0) {
    // a Codex project folder: AGENTS.md is its standing instructions, kept as one skill named for the folder
    const agents = files["AGENTS.md"] ?? files["agents.md"];
    if (agents !== undefined) {
      const name = slugOf(hint);
      const first = agents.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l !== "") ?? name;
      const text = skillText(name, `${first.replace(/[.:]$/, "")}. Codex AGENTS.md instructions.`, agents);
      out.push({ name, description: parseSkill(text, name).ok ? (parseSkill(text, name) as { skill: { description: string } }).skill.description : first, text, files: {}, path: "", kind: "codex" });
    }
  }
  if (out.length === 0 && problems.length === 0) problems.push("There is no SKILL.md or AGENTS.md in it.");
  return { skills: out, problems };
}

// ---------------------------------------------------------------- what a skill can touch

const SCRIPT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd)$/i;
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)S?$/i;
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const NETWORK_TOOLS = ["WebFetch", "WebSearch"];

/** What a skill can touch: its scripts, its MCP servers and their keys, network reach, and Vault keys it names. Read from the text and files; nothing is run. */
export function skillPerms(text: string, files: Readonly<Files>): SkillPerms {
  const scripts = Object.keys(files).filter((p) => SCRIPT.test(p)).sort();
  const servers = readPlugin({ ...(files[".mcp.json"] !== undefined ? { ".mcp.json": files[".mcp.json"] } : {}) }).mcpServers;
  const network = new Set<string>();
  const vault = new Set<string>();
  const mcpServers: McpNeed[] = servers.map((m) => {
    const keys = new Set<string>();
    for (const [k, v] of Object.entries(m.env)) {
      for (const x of v.matchAll(PLACEHOLDER)) keys.add(x[1]!);
      if (v.trim() === "" && SECRETISH.test(k)) keys.add(k);
      const h = /^#([A-Za-z0-9_]+)/.exec(v.trim());
      if (h) vault.add(h[1]!);
    }
    for (const v of [...Object.values(m.headers), ...m.args, m.url ?? ""]) for (const x of v.matchAll(PLACEHOLDER)) keys.add(x[1]!);
    if (m.url) { try { network.add(new URL(m.url.replace(PLACEHOLDER, "x")).host); } catch { network.add(m.url); } }
    if (m.command && /^(npx|uvx|bunx|pipx|npm|pnpm|yarn)$/.test(m.command.split("/").pop() ?? "")) network.add(`${m.command.split("/").pop()} downloads`);
    return { name: m.name, transport: m.transport, target: m.url ?? [m.command ?? "", ...m.args].join(" ").trim(), keys: [...keys].sort() };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const fm = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta = fm ? parseFrontMatter(fm[1]!) : {};
  const tools = meta["allowed-tools"];
  const toolList = Array.isArray(tools) ? tools.map(String) : typeof tools === "string" ? tools.split(/[\s,]+/) : [];
  for (const t of toolList) if (NETWORK_TOOLS.some((n) => t.startsWith(n))) network.add(t.replace(/\(.*$/, ""));
  const net = meta["network"];
  if (net === true) network.add("the internet");
  else if (Array.isArray(net)) for (const h of net) network.add(String(h));
  for (const k of Array.isArray(meta["vault"]) ? meta["vault"] : []) vault.add(String(k).replace(/^#/, ""));
  for (const x of text.matchAll(/(?:^|[\s(`])#([A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+)(?:\.[A-Za-z0-9_]+)?/g)) vault.add(x[1]!);
  return { scripts, mcpServers, network: [...network].sort(), vaultKeys: [...vault].sort() };
}

/** What `next` can touch that `was` could not, in words; empty when it did not grow. A server whose target or keys changed counts as new. */
export function permsGrowth(was: SkillPerms, next: SkillPerms): string[] {
  const out: string[] = [];
  const newScripts = next.scripts.filter((s) => !was.scripts.includes(s));
  if (newScripts.length > 0) out.push(`runs ${newScripts.length === 1 ? "a new script" : `${newScripts.length} new scripts`}: ${newScripts.join(", ")}`);
  for (const m of next.mcpServers) {
    const old = was.mcpServers.find((o) => o.name === m.name);
    if (!old) out.push(`starts a new tool server: ${m.name}`);
    else if (old.target !== m.target) out.push(`${m.name} now runs ${m.target}`);
    const keys = m.keys.filter((k) => !(old?.keys ?? []).includes(k));
    if (old && keys.length > 0) out.push(`${m.name} wants ${keys.join(", ")}`);
  }
  const net = next.network.filter((h) => !was.network.includes(h));
  if (net.length > 0) out.push(`reaches ${net.join(", ")}`);
  const vault = next.vaultKeys.filter((k) => !was.vaultKeys.includes(k));
  if (vault.length > 0) out.push(`uses Vault keys ${vault.join(", ")}`);
  return out;
}

export const NO_PERMS: SkillPerms = { scripts: [], mcpServers: [], network: [], vaultKeys: [] };
export const runsCode = (p: SkillPerms): boolean => p.scripts.length > 0 || p.mcpServers.some((m) => m.transport === "stdio");

// ---------------------------------------------------------------- links

export type LinkKind =
  | { kind: "github"; owner: string; repo: string; ref?: string; path?: string }
  | { kind: "raw"; url: string };

/** What a pasted link points at: a GitHub repo or a folder in one (fetched as a tree), or a file (a SKILL.md, a zip) read as it is. A blob link to a file on GitHub becomes its raw address. */
export function classifyLink(raw: string): LinkKind | null {
  const s = raw.trim();
  const short = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(s);
  if (short && !s.includes(":/") && !s.startsWith(".")) return { kind: "github", owner: short[1]!, repo: short[2]! };
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "github.com") {
    const [owner, repo, mode, ref, ...rest] = u.pathname.replace(/^\/|\/$/g, "").split("/");
    if (!owner || !repo) return null;
    const repoName = repo.replace(/\.git$/, "");
    if (mode === "blob" && ref && rest.length > 0) return { kind: "raw", url: `https://raw.githubusercontent.com/${owner}/${repoName}/${ref}/${rest.join("/")}` };
    if (mode === "tree" && ref) return { kind: "github", owner, repo: repoName, ref, ...(rest.length > 0 ? { path: rest.join("/") } : {}) };
    if (mode === undefined) return { kind: "github", owner, repo: repoName };
    return null;
  }
  return { kind: "raw", url: u.href };
}

/** The source a skill keeps, so Update can fetch it again: link:<url> or github:<owner>/<repo>[@ref][/path]. */
export function sourceOfLink(l: LinkKind): string {
  return l.kind === "raw" ? `link:${l.url}` : `github:${l.owner}/${l.repo}${l.ref ? `@${l.ref}` : ""}${l.path ? `/${l.path}` : ""}`;
}

// ---------------------------------------------------------------- names: two skills with one name (owner decision D27)

/** Where a skill came from, in a few words: "acme/skills", "this Space", "Vyre", "Dana", "your skills". */
export function originOf(source: string, extra: { sharer?: string; tier?: string } = {}): string {
  if (extra.tier === "builtin" || source === "vyre") return "Vyre";
  if (source.startsWith("github:")) return source.slice(7).replace(/@[^/]*/, "").split("/").slice(0, 2).join("/");
  if (source.startsWith("link:")) { try { return new URL(source.slice(5)).host; } catch { return "a link"; } }
  if (source.startsWith("plugin:")) return source.slice(7);
  if (source.startsWith("kit:")) return `Kit ${source.slice(4)}`;
  if (source.startsWith("marketplace:")) return source.slice(12);
  if (extra.sharer) return extra.sharer;
  if (extra.tier === "space") return "this Space";
  if (extra.tier === "agent") return "the agent";
  return "your skills";
}

/** The name a newcomer takes when its name is taken: the source in front (acme-skills:pdf, as plugin skills are named), and the words a person reads: "pdf (from acme/skills)". */
export function renamed(name: string, origin: string, taken: ReadonlySet<string>): { name: string; label: string } {
  const base = slugOf(origin);
  let n = `${base}:${name}`.slice(0, 64);
  for (let i = 2; taken.has(n); i++) n = `${base}${i}:${name}`.slice(0, 64);
  return { name: n, label: `${name} (from ${origin})` };
}
