// agents: plugins and outside tools (CHAT-DESIGN rulings 4 and 6). The Claude Code plugin and marketplace formats are read by lib/plugin-format.ts. This file keeps what an admin added and what
// was installed, maps the parts (skills to skills.add, commands to / commands, sub-agents to agent templates, MCP servers and hooks to the specs the engine runs in the sandbox), and keeps the
// allowlist. Nothing here runs plugin code: the only things done with a plugin are reading its files and handing the engine a description of what to start.
// A marketplace or plugin is fetched through the host seam (git over https, or a folder on this server); that code is the host's, so this module never touches the network or the disk.
import { expandVars, inside, parseMarketplace, readPlugin } from "../../../lib/plugin-format.ts";
import type { MarketplaceEntry, PluginContents } from "../../../lib/plugin-format.ts";
import { parseSkill, withSkillName } from "../../../lib/skill-md.ts";
import { hubById } from "../../../lib/mcp-hubs.ts";
import { agentBy, askerOf, canSee, ensure, mintId, raise } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";
import { create as createAgent } from "./crud.ts";
import { saveFile } from "../projections.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const parse = <T>(v: unknown, d: T): T => { try { return JSON.parse(str(v)) as T; } catch { return d; } };
const by = (ctx: AgentsCtx): string => askerOf(ctx);
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

// ---- the host seam: fetching trees of text ---------------------------------------------------------------------------------------------------------------

export interface TreeSource { kind: "git" | "local"; url?: string; path?: string; ref?: string; subdir?: string }
export interface TreeResult { files: Record<string, string>; revision: string; skipped: string[] }
/** The host half: reads a git repository (https) or a folder into a map of text files. Never follows a symlink, skips binary files, bounds the size. */
export interface PluginsHost { fetchTree(src: TreeSource): Promise<TreeResult> }
let pluginsHost: PluginsHost | null = null;
export function setPluginsHost(h: PluginsHost | null): void { pluginsHost = h; }

export const MAX_PLUGIN_BYTES = 3_000_000;
const need = (ctx: AgentsCtx): PluginsHost => {
  const h = pluginsHost ?? raise(ctx, "provider.unavailable", "This server cannot fetch plugins right now.");
  return { fetchTree: (src) => h.fetchTree(src).catch((e: unknown) => raise(ctx, "provider.unavailable", `Could not read it: ${e instanceof Error ? e.message.replace(/^ENOENT: no such file or directory, \w+ /, "no such folder ") : "unknown error"}.`)) };
};
const sum = (files: Record<string, string>): number => Object.values(files).reduce((n, t) => n + Buffer.byteLength(t, "utf8"), 0);

/** A source the admin typed: an https git URL, owner/repo on GitHub, or a folder on this server. */
export function classifySource(raw: string): { kind: "git" | "local"; url?: string; path?: string } | null {
  const s = raw.trim();
  if (/^https:\/\/[^\s]+$/.test(s)) return { kind: "git", url: s.replace(/\/$/, "") };
  const gh = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(s);
  if (gh && !s.startsWith(".") && !s.startsWith("/")) return { kind: "git", url: `https://github.com/${gh[1]}/${gh[2]}` };
  if (/^(\/|~\/|\.\.?\/)/.test(s)) return { kind: "local", path: s };
  return null;
}

// ---- rows -------------------------------------------------------------------------------------------------------------------------------------------------

interface Mkt { id: string; name: string; kind: "git" | "local"; source: string; ref: string; owner: string; description: string; entries: MarketplaceEntry[]; files: Record<string, string>; warnings: string[]; revision: string; updatedAt: number }
const mktOf = (r: Row): Mkt => ({
  id: str(r["id"]), name: str(r["name"]), kind: str(r["kind"]) as Mkt["kind"], source: str(r["source"]), ref: str(r["ref"]), owner: str(r["owner_name"]), description: str(r["description"]),
  entries: parse<MarketplaceEntry[]>(r["catalog_json"], []), files: parse<Record<string, string>>(r["files_json"], {}), warnings: parse<string[]>(r["warnings_json"], []), revision: str(r["revision"]), updatedAt: Number(r["updated_at"]),
});
const mkts = (ctx: AgentsCtx): Mkt[] => (ctx.db.all("SELECT * FROM agents_marketplaces ORDER BY name") as Row[]).map(mktOf);
const mktBy = (ctx: AgentsCtx, id: string): Mkt => {
  const r = (ctx.db.all("SELECT * FROM agents_marketplaces WHERE id = ?", id) as Row[])[0];
  return r ? mktOf(r) : raise(ctx, "validation.not_found", "There is no such marketplace.");
};

interface Plug { id: string; name: string; marketplaceId: string; marketplace: string; scope: "space" | "agent"; agentId: string; version: string; description: string; contents: PluginContents; files: Record<string, string>; config: Record<string, string>; enabled: boolean; at: number }
const plugOf = (r: Row): Plug => ({
  id: str(r["id"]), name: str(r["name"]), marketplaceId: str(r["marketplace_id"]), marketplace: str(r["marketplace"]), scope: str(r["scope"]) as Plug["scope"], agentId: str(r["agent_id"]), version: str(r["version"]), description: str(r["description"]),
  contents: parse<PluginContents>(r["contents_json"], { name: str(r["name"]), userConfig: [], skills: [], commands: [], agents: [], hooks: [], mcpServers: [], warnings: [] }), files: parse<Record<string, string>>(r["files_json"], {}),
  config: parse<Record<string, string>>(r["config_json"], {}), enabled: Number(r["enabled"]) === 1, at: Number(r["at"]),
});
const plugs = (ctx: AgentsCtx): Plug[] => (ctx.db.all("SELECT * FROM agents_plugins ORDER BY name, scope, agent_id") as Row[]).map(plugOf);
const plugBy = (ctx: AgentsCtx, id: string): Plug => {
  const r = (ctx.db.all("SELECT * FROM agents_plugins WHERE id = ?", id) as Row[])[0];
  return r ? plugOf(r) : raise(ctx, "validation.not_found", "There is no such plugin.");
};

const allowRows = (ctx: AgentsCtx): Array<{ kind: "marketplace" | "plugin"; marketplace: string; plugin?: string; by: string; at: number }> =>
  (ctx.db.all("SELECT * FROM agents_plugin_allow ORDER BY kind, marketplace, plugin") as Row[]).map((r) => ({ kind: str(r["kind"]) as "marketplace" | "plugin", marketplace: str(r["marketplace"]), ...(str(r["plugin"]) !== "" ? { plugin: str(r["plugin"]) } : {}), by: str(r["author"]), at: Number(r["at"]) }));
const isAllowed = (ctx: AgentsCtx, marketplace: string, plugin: string): boolean =>
  (ctx.db.all("SELECT 1 AS x FROM agents_plugin_allow WHERE marketplace = ? AND ((kind = 'marketplace' AND plugin = '') OR (kind = 'plugin' AND plugin = ?))", marketplace, plugin) as Row[]).length > 0;

const sensitiveKeys = (c: PluginContents): Set<string> => new Set(c.userConfig.filter((u) => u.sensitive).map((u) => u.key));
/** Options still missing: required, no default, no value. */
const missingConfig = (p: Plug): string[] => p.contents.userConfig.filter((u) => u.required && u.default === undefined && (p.config[u.key] ?? "") === "").map((u) => u.key);

function plugOut(p: Plug) {
  return {
    pluginId: p.id, name: p.name, marketplace: p.marketplace, marketplaceId: p.marketplaceId, scope: p.scope, ...(p.agentId !== "" ? { agentId: p.agentId } : {}), ...(p.version !== "" ? { version: p.version } : {}),
    ...(p.description !== "" ? { description: p.description } : {}), enabled: p.enabled,
    parts: { skills: p.contents.skills.map((s) => s.name), commands: p.contents.commands.map((c) => c.name), agents: p.contents.agents.map((a) => a.name), hooks: p.contents.hooks.length, mcpServers: p.contents.mcpServers.map((m) => m.name) },
    userConfig: p.contents.userConfig.map((u) => ({ key: u.key, type: u.type, title: u.title, description: u.description, required: u.required, sensitive: u.sensitive })),
    config: p.config, configured: missingConfig(p).length === 0, warnings: p.contents.warnings, installedAt: p.at,
  };
}
function mktOut(ctx: AgentsCtx, m: Mkt) {
  return {
    marketplaceId: m.id, name: m.name, kind: m.kind, source: m.source, ...(m.ref !== "" ? { ref: m.ref } : {}), owner: m.owner, ...(m.description !== "" ? { description: m.description } : {}),
    plugins: m.entries.length, allowed: (ctx.db.all("SELECT 1 AS x FROM agents_plugin_allow WHERE kind = 'marketplace' AND marketplace = ? AND plugin = ''", m.name) as Row[]).length > 0, warnings: m.warnings,
    ...(m.revision !== "" ? { revision: m.revision } : {}), updatedAt: m.updatedAt,
  };
}

/** Plugins that apply to a chat with this agent: those in the whole Space, and those put in this agent. */
const applicable = (ctx: AgentsCtx, agentId: string | undefined): Plug[] => plugs(ctx).filter((p) => p.enabled && (p.scope === "space" || (agentId !== undefined && p.agentId === agentId)));

// ---- marketplaces -----------------------------------------------------------------------------------------------------------------------------------------

async function loadMarketplace(ctx: AgentsCtx, src: { kind: "git" | "local"; url?: string; path?: string }, ref: string): Promise<{ parsed: ReturnType<typeof parseMarketplace> & { ok: true }; files: Record<string, string>; revision: string }> {
  const tree = await need(ctx).fetchTree({ kind: src.kind, ...(src.url ? { url: src.url } : {}), ...(src.path ? { path: src.path } : {}), ...(ref !== "" ? { ref } : {}) });
  const text = tree.files[".claude-plugin/marketplace.json"];
  if (text === undefined) raise(ctx, "validation.bad_input", "There is no .claude-plugin/marketplace.json there, so it is not a plugin marketplace.");
  const parsed = parseMarketplace(text);
  if (!parsed.ok) raise(ctx, "validation.bad_input", parsed.problem);
  const needsFiles = parsed.marketplace.entries.some((e) => e.source.kind === "path");
  const files = needsFiles ? tree.files : { ".claude-plugin/marketplace.json": text };
  if (sum(files) > MAX_PLUGIN_BYTES * 2) raise(ctx, "validation.too_large", "That marketplace is too large to keep.");
  return { parsed, files, revision: tree.revision };
}

export async function marketplacesList(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  return { marketplaces: mkts(ctx).map((m) => mktOut(ctx, m)) };
}

export async function marketplaceAdd(ctx: AgentsCtx, input: { source: string; ref?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const src = classifySource(input.source);
  if (!src) raise(ctx, "validation.bad_input", "Give an https git address, owner/repo on GitHub, or a folder path on this server.");
  const ref = input.ref?.trim() ?? "";
  const { parsed, files, revision } = await loadMarketplace(ctx, src, ref);
  const m = parsed.marketplace;
  if ((ctx.db.all("SELECT id FROM agents_marketplaces WHERE name = ?", m.name) as Row[]).length > 0) raise(ctx, "validation.duplicate", `A marketplace called ${m.name} is already added.`);
  const now = ctx.now();
  const id = mintId("mkt", now);
  ctx.db.run(
    "INSERT INTO agents_marketplaces (id, name, kind, source, ref, owner_name, description, catalog_json, files_json, warnings_json, revision, author, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, m.name, src.kind, src.url ?? src.path ?? "", ref, m.owner, m.description ?? "", JSON.stringify(m.entries), JSON.stringify(files), JSON.stringify(m.warnings), revision, by(ctx), now, now,
  );
  // the admin who adds a marketplace is the one who allows it; a plugin of it can still be switched off by name
  ctx.db.run("INSERT OR IGNORE INTO agents_plugin_allow (kind, marketplace, plugin, author, at) VALUES ('marketplace', ?, '', ?, ?)", m.name, by(ctx), now);
  ctx.emit("plugin.marketplace_added", id, { marketplaceId: id, name: m.name, source: src.url ?? src.path ?? "", by: by(ctx) });
  return { marketplace: mktOut(ctx, mktBy(ctx, id)) };
}

export async function marketplaceRefresh(ctx: AgentsCtx, input: { marketplaceId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const old = mktBy(ctx, input.marketplaceId);
  const { parsed, files, revision } = await loadMarketplace(ctx, old.kind === "git" ? { kind: "git", url: old.source } : { kind: "local", path: old.source }, old.ref);
  if (parsed.marketplace.name !== old.name) raise(ctx, "validation.bad_input", `That address now holds a marketplace called ${parsed.marketplace.name}, not ${old.name}.`);
  const now = ctx.now();
  ctx.db.run("UPDATE agents_marketplaces SET owner_name = ?, description = ?, catalog_json = ?, files_json = ?, warnings_json = ?, revision = ?, updated_at = ? WHERE id = ?",
    parsed.marketplace.owner, parsed.marketplace.description ?? "", JSON.stringify(parsed.marketplace.entries), JSON.stringify(files), JSON.stringify(parsed.marketplace.warnings), revision, now, old.id);
  ctx.emit("plugin.marketplace_refreshed", old.id, { marketplaceId: old.id, name: old.name, plugins: parsed.marketplace.entries.length, by: by(ctx) });
  return { marketplace: mktOut(ctx, mktBy(ctx, old.id)) };
}

export async function marketplaceRemove(ctx: AgentsCtx, input: { marketplaceId?: string; name?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  if (input.marketplaceId === undefined && input.name === undefined) raise(ctx, "validation.bad_input", "Name the marketplace.");
  const m = (ctx.db.all(input.marketplaceId !== undefined ? "SELECT * FROM agents_marketplaces WHERE id = ?" : "SELECT * FROM agents_marketplaces WHERE name = ?", input.marketplaceId ?? input.name) as Row[])[0];
  if (!m) return { removed: false };
  ctx.db.run("DELETE FROM agents_marketplaces WHERE id = ?", str(m["id"]));
  ctx.db.run("DELETE FROM agents_plugin_allow WHERE marketplace = ?", str(m["name"]));
  ctx.emit("plugin.marketplace_removed", str(m["id"]), { marketplaceId: str(m["id"]), name: str(m["name"]), by: by(ctx) });
  return { removed: true };
}

export async function browse(ctx: AgentsCtx, input: { marketplaceId?: string; q?: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const installed = plugs(ctx);
  const q = (input.q ?? "").trim().toLowerCase();
  const all = mkts(ctx).filter((m) => input.marketplaceId === undefined || m.id === input.marketplaceId).flatMap((m) => m.entries.map((e) => ({ m, e })))
    .filter(({ e }) => q === "" || `${e.name} ${e.description ?? ""} ${e.category ?? ""} ${e.keywords.join(" ")}`.toLowerCase().includes(q));
  const start = input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const rows = all.slice(start, start + limit).map(({ m, e }) => ({
    marketplaceId: m.id, marketplace: m.name, name: e.name, ...(e.description ? { description: e.description } : {}), ...(e.version ? { version: e.version } : {}), ...(e.category ? { category: e.category } : {}),
    source: e.source.kind, allowed: isAllowed(ctx, m.name, e.name),
    installed: installed.filter((p) => p.marketplaceId === m.id && p.name === e.name).map((p) => ({ pluginId: p.id, scope: p.scope, ...(p.agentId !== "" ? { agentId: p.agentId } : {}) })),
  }));
  return { plugins: rows, total: all.length, ...(start + rows.length < all.length ? { next: String(start + rows.length) } : {}) };
}

export async function allowList(ctx: AgentsCtx, _input: Record<string, never>) { ensure(ctx.db); return { allowed: allowRows(ctx) }; }

export async function allowSet(ctx: AgentsCtx, input: { kind: "marketplace" | "plugin"; marketplace: string; plugin?: string; allowed: boolean; idempotencyKey: string }) {
  ensure(ctx.db);
  if (input.kind === "plugin" && (input.plugin ?? "") === "") raise(ctx, "validation.bad_input", "Name the plugin.");
  const plugin = input.kind === "plugin" ? input.plugin! : "";
  if (!mkts(ctx).some((m) => m.name === input.marketplace)) raise(ctx, "validation.bad_input", `There is no marketplace called ${input.marketplace}.`);
  if (input.allowed) ctx.db.run("INSERT OR IGNORE INTO agents_plugin_allow (kind, marketplace, plugin, author, at) VALUES (?, ?, ?, ?, ?)", input.kind, input.marketplace, plugin, by(ctx), ctx.now());
  else ctx.db.run("DELETE FROM agents_plugin_allow WHERE kind = ? AND marketplace = ? AND plugin = ?", input.kind, input.marketplace, plugin);
  ctx.emit("plugin.allowlist_changed", input.marketplace, { kind: input.kind, marketplace: input.marketplace, ...(plugin !== "" ? { plugin } : {}), allowed: input.allowed, by: by(ctx) });
  return { allowed: allowRows(ctx) };
}

// ---- install ----------------------------------------------------------------------------------------------------------------------------------------------

/** The part of a marketplace's files that lies under a plugin's folder, with paths relative to it. */
function subtree(files: Record<string, string>, dir: string): Record<string, string> {
  if (dir === "") return files;
  const out: Record<string, string> = {};
  for (const [p, t] of Object.entries(files)) if (p.startsWith(`${dir}/`)) out[p.slice(dir.length + 1)] = t;
  return out;
}

function checkConfig(ctx: AgentsCtx, c: PluginContents, given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Map(c.userConfig.map((u) => [u.key, u]));
  for (const [k, v] of Object.entries(given)) {
    const u = known.get(k);
    if (!u) raise(ctx, "validation.bad_input", `${c.name} has no option called ${k}.`);
    if (u.sensitive && !HANDLE.test(v)) raise(ctx, "validation.bad_input", `${u.title} is a secret. Put it in the Vault and give its handle, such as #Name.field. Vyre never keeps the value.`);
    out[k] = v;
  }
  return out;
}

/** The SKILL.md of a plugin skill under its Vyre name `<plugin>:<skill>`. Non-secret options are filled in; the plugin folder is named by its plugin. */
const skillName = (plugin: string, skill: string): string => `${plugin}:${skill}`;

export async function install(ctx: AgentsCtx, input: { marketplaceId?: string; marketplace?: string; plugin: string; scope: "space" | "agent"; agentId?: string; config?: Record<string, string>; idempotencyKey: string }) {
  ensure(ctx.db);
  if (input.marketplaceId === undefined && input.marketplace === undefined) raise(ctx, "validation.bad_input", "Name the marketplace.");
  const m = input.marketplaceId !== undefined ? mktBy(ctx, input.marketplaceId) : mkts(ctx).find((x) => x.name === input.marketplace) ?? raise(ctx, "validation.not_found", `There is no marketplace called ${input.marketplace}.`);
  const entry = m.entries.find((e) => e.name === input.plugin);
  if (!entry) raise(ctx, "validation.not_found", `${m.name} has no plugin called ${input.plugin}.`);
  if (!isAllowed(ctx, m.name, entry.name)) raise(ctx, "validation.precondition_failed", `${entry.name} is not on the allowlist. An admin allows a marketplace or a plugin first.`);
  const agentId = input.scope === "agent" ? input.agentId ?? "" : "";
  if (input.scope === "agent") {
    const a = agentId === "" ? null : agentBy(ctx.db, agentId);
    if (!a || !canSee(ctx, a)) raise(ctx, "validation.bad_input", "Pick the agent to put the plugin in.");
  } else if (ctx.authorize?.({ perm: "kits.install", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow") {
    raise(ctx, "permission.role_lacks_permission", "Only an admin can install a plugin for the whole Space. Put it in one agent instead.");
  }
  const again = (ctx.db.all("SELECT id FROM agents_plugins WHERE name = ? AND scope = ? AND agent_id = ?", entry.name, input.scope, agentId) as Row[])[0];
  if (again) raise(ctx, "validation.duplicate", `${entry.name} is already installed here.`);

  let files: Record<string, string>;
  if (entry.source.kind === "path") files = subtree(m.files, entry.source.path);
  else if (entry.source.kind === "github" || entry.source.kind === "git") {
    const url = entry.source.kind === "github" ? `https://github.com/${entry.source.repo}` : entry.source.url;
    const tree = await need(ctx).fetchTree({ kind: "git", url, ...(entry.source.ref ? { ref: entry.source.ref } : {}), ...(entry.source.kind === "git" && entry.source.subdir ? { subdir: entry.source.subdir } : {}) });
    files = tree.files;
  } else raise(ctx, "validation.precondition_failed", `${entry.name} comes from ${entry.source.kind}, which Vyre does not fetch yet. Use a git or marketplace-path plugin.`);
  if (Object.keys(files).length === 0) raise(ctx, "validation.not_found", `${entry.name}: the plugin folder is empty or missing.`);
  if (sum(files) > MAX_PLUGIN_BYTES) raise(ctx, "validation.too_large", `${entry.name} is over ${MAX_PLUGIN_BYTES / 1_000_000} MB of text.`);

  const contents = readPlugin(files, entry);
  if (contents.name === "" || contents.name !== entry.name) contents.name = entry.name;
  const config = checkConfig(ctx, contents, input.config ?? {});
  const now = ctx.now();
  const id = mintId("plg", now);

  // Skills first: they are the part that talks to another capability, so a refusal there leaves nothing half installed.
  const added: string[] = [];
  try {
    for (const s of contents.skills) {
      const name = skillName(entry.name, s.name);
      await (ctx.call?.("skills.add", { text: withSkillName(s.text, name), name, ...(agentId !== "" ? { agentId } : {}), source: `plugin:${entry.name}`, files: s.files, idempotencyKey: `${input.idempotencyKey}:skill:${s.name}` }, { idempotencyKey: `${input.idempotencyKey}:skill:${s.name}` }) ?? raise(ctx, "internal.unexpected", "Skills are not available."));
      added.push(name);
    }
  } catch (e) {
    for (const name of added) { try { await ctx.call?.("skills.remove", { name, ...(agentId !== "" ? { agentId } : {}), idempotencyKey: `${input.idempotencyKey}:undo:${name}` }, { idempotencyKey: `${input.idempotencyKey}:undo:${name}` }); } catch { /* best effort */ } }
    throw e;
  }
  ctx.db.run(
    "INSERT INTO agents_plugins (id, name, marketplace_id, marketplace, scope, agent_id, version, description, contents_json, files_json, config_json, enabled, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    id, entry.name, m.id, m.name, input.scope, agentId, contents.version ?? entry.version ?? "", contents.description ?? entry.description ?? "", JSON.stringify(contents), JSON.stringify(files), JSON.stringify(config), by(ctx), now,
  );
  ctx.emit("plugin.installed", id, { pluginId: id, name: entry.name, marketplace: m.name, scope: input.scope, ...(agentId !== "" ? { agentId } : {}), by: by(ctx) });
  return { plugin: plugOut(plugBy(ctx, id)) };
}

async function dropSkills(ctx: AgentsCtx, p: Plug, key: string): Promise<void> {
  for (const s of p.contents.skills) {
    const name = skillName(p.name, s.name);
    try { await ctx.call?.("skills.remove", { name, ...(p.agentId !== "" ? { agentId: p.agentId } : {}), idempotencyKey: `${key}:rm:${name}` }, { idempotencyKey: `${key}:rm:${name}` }); } catch (e) { ctx.log.warn("plugin skill could not be removed", { name, error: e instanceof Error ? e.message : String(e) }); }
  }
}

export async function uninstall(ctx: AgentsCtx, input: { pluginId?: string; name?: string; scope?: "space" | "agent"; agentId?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  if (input.pluginId === undefined && input.name === undefined) raise(ctx, "validation.bad_input", "Name the plugin.");
  const r = (input.pluginId !== undefined
    ? ctx.db.all("SELECT * FROM agents_plugins WHERE id = ?", input.pluginId)
    : ctx.db.all("SELECT * FROM agents_plugins WHERE name = ? AND scope = ? AND agent_id = ?", input.name, input.scope ?? "space", input.scope === "agent" ? input.agentId ?? "" : "") as Row[])[0];
  if (!r) return { removed: false };
  const p = plugOf(r);
  await dropSkills(ctx, p, input.idempotencyKey);
  ctx.db.run("DELETE FROM agents_plugins WHERE id = ?", p.id);
  ctx.emit("plugin.uninstalled", p.id, { pluginId: p.id, name: p.name, by: by(ctx) });
  return { removed: true };
}

export async function setEnabled(ctx: AgentsCtx, input: { pluginId: string; enabled: boolean; idempotencyKey: string }) {
  ensure(ctx.db);
  const p = plugBy(ctx, input.pluginId);
  for (const s of p.contents.skills) {
    const name = skillName(p.name, s.name);
    try { await ctx.call?.("skills.set_enabled", { name, ...(p.agentId !== "" ? { agentId: p.agentId } : {}), enabled: input.enabled, idempotencyKey: `${input.idempotencyKey}:${name}` }, { idempotencyKey: `${input.idempotencyKey}:${name}` }); } catch { /* the skill was removed by hand */ }
  }
  ctx.db.run("UPDATE agents_plugins SET enabled = ? WHERE id = ?", input.enabled ? 1 : 0, p.id);
  ctx.emit("plugin.changed", p.id, { pluginId: p.id, name: p.name, by: by(ctx) });
  return { plugin: plugOut(plugBy(ctx, p.id)) };
}

export async function configSet(ctx: AgentsCtx, input: { pluginId: string; config: Record<string, string>; idempotencyKey: string }) {
  ensure(ctx.db);
  const p = plugBy(ctx, input.pluginId);
  const next = { ...p.config, ...checkConfig(ctx, p.contents, input.config) };
  for (const k of Object.keys(next)) if (next[k] === "") delete next[k];
  ctx.db.run("UPDATE agents_plugins SET config_json = ? WHERE id = ?", JSON.stringify(next), p.id);
  ctx.emit("plugin.changed", p.id, { pluginId: p.id, name: p.name, by: by(ctx) });
  return { plugin: plugOut(plugBy(ctx, p.id)) };
}

export async function pluginsList(ctx: AgentsCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  return { plugins: plugs(ctx).filter((p) => input.agentId === undefined || p.scope === "space" || p.agentId === input.agentId).map(plugOut) };
}
export async function pluginGet(ctx: AgentsCtx, input: { pluginId: string }) { ensure(ctx.db); return { plugin: plugOut(plugBy(ctx, input.pluginId)) }; }

// ---- commands ---------------------------------------------------------------------------------------------------------------------------------------------

/** `${user_config.KEY}` becomes the option's value, or its default; a secret option stays a handle. Returns the keys that had nothing. */
function fill(text: string, p: Plug): { text: string; missing: string[] } {
  const missing: string[] = [];
  const vars: Record<string, string> = {};
  for (const u of p.contents.userConfig) {
    const v = p.config[u.key] ?? (u.default !== undefined ? String(u.default) : "");
    if (v !== "") vars[`user_config.${u.key}`] = v;
  }
  const out = expandVars(text, vars);
  for (const m of out.matchAll(/\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g)) missing.push(m[1]!);
  return { text: out, missing: [...new Set(missing)] };
}

export async function commandsList(ctx: AgentsCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  return { commands: applicable(ctx, input.agentId).flatMap((p) => p.contents.commands.map((c) => ({ name: `${p.name}:${c.name}`, description: c.description, ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}), plugin: p.name, pluginId: p.id }))) };
}

export async function commandRender(ctx: AgentsCtx, input: { name: string; args?: string; agentId?: string }) {
  ensure(ctx.db);
  const { renderCommand } = await import("../../../lib/plugin-format.ts");
  for (const p of applicable(ctx, input.agentId)) {
    const c = p.contents.commands.find((x) => `${p.name}:${x.name}` === input.name || (x.name === input.name && p.contents.commands.filter((y) => y.name === x.name).length === 1 && applicable(ctx, input.agentId).filter((q) => q.contents.commands.some((y) => y.name === x.name)).length === 1));
    if (!c) continue;
    const body = fill(c.body, p).text.replaceAll("${CLAUDE_PLUGIN_ROOT}", `the ${p.name} plugin folder`);
    return { prompt: renderCommand(body, input.args ?? ""), description: c.description, allowedTools: c.allowedTools, ...(c.model ? { model: c.model } : {}), pluginId: p.id };
  }
  raise(ctx, "validation.not_found", `There is no command called ${input.name}.`);
}

// ---- sub-agents as templates ----------------------------------------------------------------------------------------------------------------------------

export async function agentTemplates(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  return { templates: plugs(ctx).filter((p) => p.enabled).flatMap((p) => p.contents.agents.map((a) => ({ pluginId: p.id, plugin: p.name, name: a.name, description: a.description, tools: a.tools, ...(a.model ? { model: a.model } : {}) }))) };
}

export async function agentTemplateUse(ctx: AgentsCtx, input: { pluginId: string; name: string; agentName?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const p = plugBy(ctx, input.pluginId);
  const a = p.contents.agents.find((x) => x.name === input.name);
  if (!a) raise(ctx, "validation.not_found", `${p.name} has no sub-agent called ${input.name}.`);
  const role = a.description.replace(/\s+/g, " ").trim().slice(0, 200);
  const made = await createAgent(ctx, { name: input.agentName?.trim() || a.name, role, ...(a.model ? {} : {}), idempotencyKey: input.idempotencyKey });
  const agent = (made as { agent: { agentId: string } }).agent;
  const rec = agentBy(ctx.db, agent.agentId);
  if (rec?.agentMdFileId) {
    await saveFile(ctx, rec.agentMdFileId, `# ${input.agentName?.trim() || a.name}\n\nInherits: VYRE.md\n\n## Use me when\n${role}\n\n## How I work\n${a.body.trim()}\n\nFrom the ${p.name} plugin${a.tools.length > 0 ? `. It was written to use: ${a.tools.join(", ")}` : ""}.\n`, `From the ${p.name} plugin`);
  }
  ctx.emit("plugin.changed", p.id, { pluginId: p.id, name: p.name, by: by(ctx) });
  return { agentId: agent.agentId };
}

// ---- MCP servers and hooks the engine runs in the sandbox ---------------------------------------------------------------------------------------------

export interface McpSpecOut {
  key: string; name: string; from: "plugin" | "connection"; pluginId?: string; transport: "stdio" | "http" | "sse" | "ws"; command?: string; args: string[]; env: Record<string, string>; url?: string; headers: Record<string, string>;
  files?: string; needs: string[];
  /** The app hub this connection is (composio, pipedream) and whether it signs in with OAuth; the id of the connection, for the token the engine holds. */
  hub?: string; oauth?: boolean; connectionId?: string;
}

export async function mcpServers(ctx: AgentsCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  const out: McpSpecOut[] = [];
  for (const p of applicable(ctx, input.agentId)) {
    for (const m of p.contents.mcpServers) {
      const needs = new Set<string>();
      const f = (s: string): string => { const r = fill(s, p); r.missing.forEach((k) => needs.add(k)); return r.text; };
      const mapv = (o: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
      out.push({
        key: `${p.name}/${m.name}`, name: m.name, from: "plugin", pluginId: p.id, transport: m.transport, args: m.args.map(f), env: mapv(m.env), headers: mapv(m.headers), needs: [], files: p.id,
        ...(m.command ? { command: f(m.command) } : {}), ...(m.url ? { url: f(m.url) } : {}),
      });
      out[out.length - 1]!.needs = [...needs];
    }
  }
  for (const r of ctx.db.all("SELECT * FROM agents_mcp_connections WHERE enabled = 1 ORDER BY name") as Row[]) {
    const scope = str(r["scope"]), aid = str(r["agent_id"]);
    if (scope === "agent" && aid !== input.agentId) continue;
    out.push({
      key: str(r["name"]), name: str(r["name"]), from: "connection", transport: str(r["transport"]) as McpSpecOut["transport"], args: parse<string[]>(r["args_json"], []), env: parse<Record<string, string>>(r["env_json"], {}), headers: parse<Record<string, string>>(r["headers_json"], {}), needs: [],
      ...(str(r["command"]) !== "" ? { command: str(r["command"]) } : {}), ...(str(r["url"]) !== "" ? { url: str(r["url"]) } : {}),
      connectionId: str(r["id"]), ...(str(r["hub"] ?? "") !== "" ? { hub: str(r["hub"]) } : {}), ...(str(r["auth"] ?? "") === "oauth" ? { oauth: true } : {}),
    });
  }
  return { servers: out };
}

export async function hooksList(ctx: AgentsCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  return { hooks: applicable(ctx, input.agentId).flatMap((p) => p.contents.hooks.map((h) => ({ pluginId: p.id, plugin: p.name, event: h.event, matcher: h.matcher, command: fill(h.command, p).text, args: h.args.map((a) => fill(a, p).text), ...(h.timeoutSec ? { timeoutSec: h.timeoutSec } : {}) }))) };
}

/** The files of a plugin, for the sandbox to be given. Plugin text, no secret: an option that is a secret is only ever a Vault handle. */
export async function pluginFiles(ctx: AgentsCtx, input: { pluginId: string }) {
  ensure(ctx.db);
  return { files: plugBy(ctx, input.pluginId).files };
}

// ---- connections made by hand -------------------------------------------------------------------------------------------------------------------------

function connectionOut(r: Row) {
  return {
    connectionId: str(r["id"]), name: str(r["name"]), scope: str(r["scope"]) as "space" | "agent", ...(str(r["agent_id"]) !== "" ? { agentId: str(r["agent_id"]) } : {}), transport: str(r["transport"]) as "stdio" | "http",
    ...(str(r["url"]) !== "" ? { url: str(r["url"]) } : {}), ...(str(r["command"]) !== "" ? { command: str(r["command"]) } : {}), args: parse<string[]>(r["args_json"], []),
    env: parse<Record<string, string>>(r["env_json"], {}), headers: parse<Record<string, string>>(r["headers_json"], {}), enabled: Number(r["enabled"]) === 1, createdAt: Number(r["at"]),
    ...(str(r["hub"] ?? "") !== "" ? { hub: str(r["hub"]) as "composio" | "pipedream" } : {}), ...(str(r["auth"] ?? "") === "oauth" ? { auth: "oauth" as const } : {}),
  };
}
export async function connectionsList(ctx: AgentsCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  return { connections: (ctx.db.all("SELECT * FROM agents_mcp_connections ORDER BY name") as Row[]).filter((r) => str(r["scope"]) === "space" || input.agentId === undefined || str(r["agent_id"]) === input.agentId).map(connectionOut) };
}
export async function connectionAdd(ctx: AgentsCtx, input: { name: string; scope: "space" | "agent"; agentId?: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; hub?: "composio" | "pipedream"; auth?: "oauth"; idempotencyKey: string }) {
  ensure(ctx.db);
  const name = input.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/.test(name)) raise(ctx, "validation.bad_input", "Name the connection with letters, digits, dash and underscore.");
  if ((input.url ? 1 : 0) + (input.command ? 1 : 0) !== 1) raise(ctx, "validation.bad_input", "Give either a URL (a remote MCP server) or a command (a server that runs in the sandbox).");
  if (input.url) {
    let u: URL;
    try { u = new URL(input.url); } catch { return raise(ctx, "validation.bad_input", "That is not a URL."); }
    if (u.protocol !== "https:" && u.protocol !== "http:") raise(ctx, "validation.bad_input", "A remote MCP server is reached over https.");
  }
  // an app hub is a remote server at the hub's own address, with its key in the header the hub names, as a Vault handle
  const hub = input.hub === undefined ? undefined : hubById(input.hub);
  if (input.hub !== undefined) {
    if (!hub) raise(ctx, "validation.bad_input", `${input.hub} is not an app hub this server knows.`);
    if (!input.url || !hub.urlPattern.test(input.url)) raise(ctx, "validation.bad_input", `A ${hub.name} connection uses ${hub.name}'s own address, such as ${hub.urlExample}.`);
    const key = Object.entries(input.headers ?? {}).find(([k]) => k.toLowerCase() === hub.header.toLowerCase())?.[1] ?? "";
    if (!HANDLE.test(key.replace(/^Bearer\s+/, ""))) raise(ctx, "validation.bad_input", `Put the ${hub.name} key in the Vault and give its handle in the ${hub.header} header, such as #${hub.name}.api_key.`);
  }
  if (input.auth === "oauth" && (!input.url || Object.keys(input.headers ?? {}).length > 0)) raise(ctx, "validation.bad_input", "A connection that signs in with OAuth is a remote address and holds no key of its own.");
  const agentId = input.scope === "agent" ? input.agentId ?? "" : "";
  if (input.scope === "agent") { const a = agentId === "" ? null : agentBy(ctx.db, agentId); if (!a || !canSee(ctx, a)) raise(ctx, "validation.bad_input", "Pick the agent to connect it to."); }
  // a secret is a handle: a value that is not one goes in as a plain value only for env and headers that are not credentials; a header named like a credential must be a handle
  for (const [k, v] of Object.entries({ ...(input.headers ?? {}), ...(input.env ?? {}) })) {
    if (/(authorization|api[-_]?key|token|secret|password|cookie)/i.test(k) && !HANDLE.test(v) && !/^Bearer\s+#/.test(v)) raise(ctx, "validation.bad_input", `${k} looks like a credential. Put it in the Vault and give its handle, such as #Name.field.`);
  }
  if ((ctx.db.all("SELECT id FROM agents_mcp_connections WHERE name = ? AND scope = ? AND agent_id = ?", name, input.scope, agentId) as Row[]).length > 0) raise(ctx, "validation.duplicate", `A connection called ${name} already exists here.`);
  const now = ctx.now();
  const id = mintId("mcs", now);
  ctx.db.run("INSERT INTO agents_mcp_connections (id, name, scope, agent_id, transport, url, command, args_json, env_json, headers_json, enabled, author, at, hub, auth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
    id, name, input.scope, agentId, input.url ? "http" : "stdio", input.url ?? "", input.command ?? "", JSON.stringify(input.args ?? []), JSON.stringify(input.env ?? {}), JSON.stringify(input.headers ?? {}), by(ctx), now, hub?.id ?? "", input.auth === "oauth" ? "oauth" : "");
  ctx.emit("plugin.connection_added", id, { connectionId: id, name, scope: input.scope, ...(agentId !== "" ? { agentId } : {}), by: by(ctx) });
  return { connection: connectionOut((ctx.db.all("SELECT * FROM agents_mcp_connections WHERE id = ?", id) as Row[])[0]!) };
}
export async function connectionRemove(ctx: AgentsCtx, input: { connectionId?: string; name?: string; scope?: "space" | "agent"; agentId?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  if (input.connectionId === undefined && input.name === undefined) raise(ctx, "validation.bad_input", "Name the connection.");
  const r = (input.connectionId !== undefined
    ? ctx.db.all("SELECT * FROM agents_mcp_connections WHERE id = ?", input.connectionId)
    : ctx.db.all("SELECT * FROM agents_mcp_connections WHERE name = ? AND scope = ? AND agent_id = ?", input.name, input.scope ?? "space", input.scope === "agent" ? input.agentId ?? "" : "") as Row[])[0];
  if (!r) return { removed: false };
  ctx.db.run("DELETE FROM agents_mcp_connections WHERE id = ?", str(r["id"]));
  ctx.emit("plugin.connection_removed", str(r["id"]), { connectionId: str(r["id"]), name: str(r["name"]), by: by(ctx) });
  return { removed: true };
}

export { inside, parseSkill };
