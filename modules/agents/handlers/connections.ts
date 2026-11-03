// agents: Vault > Connections (owner rulings D28 and D29, 3 Nov 2026). The one list the Vault page draws (every MCP connection the caller can use or manage, and the servers plugins bring),
// a person's own (Mine) connections, sharing a Space connection with groups, what each connection last did (health, tools, last use and by which agents), the Space's rules for who may add
// what, and the server catalog: the official MCP registry first, Smithery later, read through the host seam and kept in agents_mcp_catalog so the Add sheet still answers offline.
// Built-in integrations (Google, Microsoft, Slack, Zoom: the connectors module's connections.*) are not stored here; the page reads them beside this list.
import { CATALOG_SOURCES, allowedBy, sourceById } from "../../../lib/mcp-registry.ts";
import type { CatalogEntry } from "../../../lib/mcp-registry.ts";
import { isHostService } from "../../../lib/trust.ts";
import { agentBy, allows, askerOf, canSee, ensure, raise } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";
import { addConnection, mcpServers, registryFetch } from "./plugins.ts";
import type { ConnectionIn } from "./plugins.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const parse = <T>(v: unknown, d: T): T => { try { return JSON.parse(str(v)) as T; } catch { return d; } };
const HANDLE_IN = /#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?/g;

// ---- who may do what ----------------------------------------------------------------------------------------------------------------------------------

/** An owner or admin of the Space (they set policy). */
export const isAdmin = (ctx: AgentsCtx): boolean => allows(ctx, "policy.manage", "manage", "space", ctx.space);
/** Whoever manages agents (owner, admin, developer): they look after the Space's and agents' connections. */
export const managesAgents = (ctx: AgentsCtx): boolean => allows(ctx, "agents.manage", "manage", "space", ctx.space);

export interface ConnectionPolicy { spaceAdders: "admins" | "managers"; allowListOn: boolean; allowList: string[] }
const DEFAULT_POLICY: ConnectionPolicy = { spaceAdders: "managers", allowListOn: false, allowList: [] };

export function policyOf(ctx: AgentsCtx): ConnectionPolicy {
  ensure(ctx.db);
  const r = (ctx.db.all("SELECT value_json FROM agents_connection_policy WHERE key = 'policy'") as Row[])[0];
  const p = r ? parse<Partial<ConnectionPolicy>>(r["value_json"], {}) : {};
  return {
    spaceAdders: p.spaceAdders === "admins" ? "admins" : "managers", allowListOn: p.allowListOn === true,
    allowList: Array.isArray(p.allowList) ? p.allowList.filter((x): x is string => typeof x === "string") : [],
  };
}

/** The Space's rules, before anything is written: who may add a Space connection, and the allow-list for anyone who is not an admin. */
export function checkPolicy(ctx: AgentsCtx, input: Pick<ConnectionIn, "scope" | "url" | "command" | "args" | "source" | "sourceRef" | "hub">): void {
  const p = policyOf(ctx);
  if (input.scope === "space" && p.spaceAdders === "admins" && !isAdmin(ctx)) raise(ctx, "permission.role_lacks_permission", "Only an admin adds connections for the whole Space here. Add it as yours, or ask an admin.");
  // a hub, a skill's own server and a Kit's are allowed by what brought them (the admin allowed the skill, plugin or Kit)
  if (!p.allowListOn || isAdmin(ctx) || input.hub !== undefined || input.source === "skill" || input.source === "kit") return;
  if (!allowedBy(p.allowList, { url: input.url, command: input.command, args: input.args, ...(input.source === "registry" && input.sourceRef ? { registryName: input.sourceRef } : {}) })) {
    raise(ctx, "validation.precondition_failed", "Your Space only allows connections from its list. Ask an admin to add this server to it.");
  }
}

// ---- shares -------------------------------------------------------------------------------------------------------------------------------------------

export const shareOf = (r: Row): string[] => {
  const s = parse<unknown>(r["share_json"], ["everyone"]);
  const list = Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : [];
  return list.length ? list : ["everyone"];
};
export function cleanShare(share: readonly string[] | undefined): string[] {
  if (!share || share.length === 0 || share.includes("everyone")) return ["everyone"];
  return [...new Set(share.filter((g) => /^grp_[a-z0-9]+$/.test(g)))].slice(0, 20);
}
export const sharedWith = (share: readonly string[], groups: ReadonlySet<string> | null): boolean => share.includes("everyone") || (groups !== null && share.some((g) => groups.has(g)));

/** The asker's groups, asked only when some Space connection is shared with groups. A caller who cannot say is in none. */
export async function groupsOfAsker(ctx: AgentsCtx, rows: readonly Row[]): Promise<ReadonlySet<string> | null> {
  if (!rows.some((r) => str(r["scope"]) === "space" && !shareOf(r).includes("everyone"))) return null;
  // the host's own directory first (the access projection); a ctx without it (a bare harness) asks whoami
  if (ctx.directory) { try { return new Set(ctx.directory.of(askerOf(ctx)).groups); } catch { return new Set(); } }
  if (!ctx.call) return new Set();
  try {
    const me = (await ctx.call("identity.whoami", {})) as { groups?: string[] };
    return new Set(Array.isArray(me.groups) ? me.groups : []);
  } catch { return new Set(); }
}

// ---- the Vault list -----------------------------------------------------------------------------------------------------------------------------------

type Health = "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
const HEALTH = new Set<Health>(["ok", "needs_signin", "key_refused", "not_answering", "needs_setup", "off", "unknown"]);
const commandLine = (command: string, args: readonly string[]): string => [command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
const handlesOf = (texts: readonly string[]): string[] => [...new Set(texts.flatMap((t) => t.match(HANDLE_IN) ?? []))];

function rowOf(r: Row, canManage: boolean) {
  const scope = str(r["scope"]) as "mine" | "space" | "agent";
  const args = parse<string[]>(r["args_json"], []), env = parse<Record<string, string>>(r["env_json"], {}), headers = parse<Record<string, string>>(r["headers_json"], {});
  const url = str(r["url"]), command = str(r["command"]);
  const enabled = Number(r["enabled"]) === 1;
  const stored = str(r["health"] ?? "") as Health;
  const health: Health = !enabled ? "off" : HEALTH.has(stored) && stored !== ("" as Health) ? stored : "unknown";
  const tools = Number(r["tools"] ?? -1), checked = Number(r["checked_at"] ?? 0), used = Number(r["used_at"] ?? 0);
  const hub = str(r["hub"] ?? "");
  return {
    key: str(r["name"]), kind: hub !== "" ? "hub" as const : "mcp" as const, name: str(r["name"]), title: str(r["title"] ?? "") || str(r["name"]), scope, connectionId: str(r["id"]),
    ...(str(r["owner"] ?? "") !== "" ? { owner: str(r["owner"]) } : {}), ...(str(r["agent_id"]) !== "" ? { agentId: str(r["agent_id"]) } : {}),
    share: scope === "space" ? shareOf(r) : [], transport: str(r["transport"]) as "stdio" | "http", address: url !== "" ? url : commandLine(command, args),
    source: (str(r["source"] ?? "") || (hub !== "" ? "hub" : "hand")) as "registry", ...(str(r["source_ref"] ?? "") !== "" ? { sourceRef: str(r["source_ref"]) } : {}),
    ...(str(r["auth"] ?? "") === "oauth" ? { auth: "oauth" as const } : {}), ...(hub !== "" ? { hub: hub as "composio" | "pipedream" } : {}), enabled,
    health, ...(str(r["health_note"] ?? "") !== "" ? { healthNote: str(r["health_note"]) } : {}), ...(tools >= 0 ? { tools } : {}), ...(checked > 0 ? { checkedAt: checked } : {}),
    ...(used > 0 ? { usedAt: used } : {}), usedBy: parse<string[]>(r["used_by_json"], []).filter((a) => /^agt_[a-z0-9]+$/.test(a)),
    keys: handlesOf([...Object.values(env), ...Object.values(headers), url]), needs: [], canManage,
  };
}

export async function connectionsHome(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const asker = askerOf(ctx);
  const manager = managesAgents(ctx);
  const admin = isAdmin(ctx);
  const rows = ctx.db.all("SELECT * FROM agents_mcp_connections ORDER BY title, name") as Row[];
  const groups = await groupsOfAsker(ctx, rows);
  const mine: ReturnType<typeof rowOf>[] = [], space: ReturnType<typeof rowOf>[] = [], agents: ReturnType<typeof rowOf>[] = [];
  for (const r of rows) {
    const scope = str(r["scope"]);
    if (scope === "mine") { if (str(r["owner"] ?? "") === asker) mine.push(rowOf(r, true)); continue; }
    if (scope === "space") { if (manager || sharedWith(shareOf(r), groups)) space.push(rowOf(r, manager)); continue; }
    const a = agentBy(ctx.db, str(r["agent_id"]));
    if (a && canSee(ctx, a)) agents.push(rowOf(r, manager));
  }
  // the servers plugins bring: listed where the plugin is (the Space or one agent), managed on the plugin
  for (const p of ctx.db.all("SELECT id, name, scope, agent_id, contents_json, config_json, enabled FROM agents_plugins ORDER BY name") as Row[]) {
    const contents = parse<{ mcpServers?: Array<{ name: string; transport: "stdio" | "http" | "sse" | "ws"; command?: string; args?: string[]; url?: string }>; userConfig?: Array<{ key: string; required?: boolean; default?: unknown }> }>(p["contents_json"], {});
    const config = parse<Record<string, string>>(p["config_json"], {});
    const missing = (contents.userConfig ?? []).filter((u) => u.required && u.default === undefined && (config[u.key] ?? "") === "").map((u) => u.key);
    const scope = str(p["scope"]) === "agent" ? "agent" as const : "space" as const;
    if (scope === "agent") { const a = agentBy(ctx.db, str(p["agent_id"])); if (!a || !canSee(ctx, a)) continue; }
    const enabled = Number(p["enabled"]) === 1;
    for (const m of contents.mcpServers ?? []) {
      const row = {
        key: `${str(p["name"])}/${m.name}`, kind: "plugin" as const, name: m.name, title: m.name, scope, pluginId: str(p["id"]), ...(scope === "agent" ? { agentId: str(p["agent_id"]) } : {}),
        share: scope === "space" ? ["everyone"] : [], transport: m.transport, address: m.url ?? commandLine(m.command ?? "", m.args ?? []), source: "plugin" as const, sourceRef: str(p["name"]), enabled,
        health: (!enabled ? "off" : missing.length > 0 ? "needs_setup" : "unknown") as Health, usedBy: [], keys: Object.values(config).filter((v) => /^#/.test(v)), needs: missing, canManage: manager,
      };
      (scope === "space" ? space : agents).push(row as never);
    }
  }
  // the servers skills bring (l-skills2: plugins.mcp.servers lists them as skill:<skill id>/<server>): listed with the skill they came from, managed on the skill
  for (const sv of (await mcpServers(ctx, {})).servers) {
    const m = /^skill:((sko|skl)_[a-z0-9]+)\/(.+)$/.exec(sv.key);
    if (!m) continue;
    const skill = skillName(ctx, m[1]!);
    const row = {
      key: sv.key, kind: "skill" as const, name: sv.name, title: sv.name, scope: m[2] === "sko" ? "mine" as const : "space" as const, share: m[2] === "skl" ? ["everyone"] : [],
      transport: sv.transport, address: sv.url ?? commandLine(sv.command ?? "", sv.args), source: "skill" as const, ...(skill ? { sourceRef: skill } : {}), enabled: true,
      health: (sv.needs.length > 0 ? "needs_setup" : "unknown") as Health, usedBy: [], keys: handlesOf([...Object.values(sv.env), ...Object.values(sv.headers)]), needs: sv.needs, canManage: false,
    };
    (row.scope === "mine" ? mine : space).push(row as never);
  }
  const policy = policyOf(ctx);
  return { mine, space, agents, policy, canAddSpace: manager && (policy.spaceAdders === "managers" || admin), admin };
}

/** A skill's name by its id, for "From skill X": a person's own skill or a Space one. Nothing when the skill tables are not there (before l-skills2). */
function skillName(ctx: AgentsCtx, id: string): string | undefined {
  try {
    const r = (ctx.db.all(id.startsWith("sko_") ? "SELECT name FROM agents_skill_own WHERE id = ?" : "SELECT name FROM agents_skills WHERE id = ?", id) as Row[])[0];
    return r ? str(r["name"]) : undefined;
  } catch { return undefined; }
}

// ---- Mine, update, forget -----------------------------------------------------------------------------------------------------------------------------

export async function connectionAddMine(ctx: AgentsCtx, input: Omit<ConnectionIn, "scope" | "agentId" | "share" | "hub">) {
  const out = await addConnection(ctx, { ...input, scope: "mine" });
  return { connection: { connectionId: out.connection.connectionId, name: out.connection.name, scope: "mine" as const, owner: askerOf(ctx) } };
}

function rowBy(ctx: AgentsCtx, id: string): Row {
  const r = (ctx.db.all("SELECT * FROM agents_mcp_connections WHERE id = ?", id) as Row[])[0];
  // someone else's Mine connection answers as if it were not there
  if (!r || (str(r["scope"]) === "mine" && str(r["owner"] ?? "") !== askerOf(ctx))) return raise(ctx, "validation.not_found", "There is no such connection.");
  return r;
}
const mayManage = (ctx: AgentsCtx, r: Row): boolean => (str(r["scope"]) === "mine" ? str(r["owner"] ?? "") === askerOf(ctx) : managesAgents(ctx));

export async function connectionUpdate(ctx: AgentsCtx, input: { connectionId: string; title?: string; enabled?: boolean; auth?: "oauth" | "none"; share?: string[]; idempotencyKey: string }) {
  ensure(ctx.db);
  const r = rowBy(ctx, input.connectionId);
  if (!mayManage(ctx, r)) raise(ctx, "permission.role_lacks_permission", "Only someone who manages agents changes a Space connection.");
  if (input.share !== undefined && str(r["scope"]) !== "space") raise(ctx, "validation.bad_input", "Only a Space connection is shared. A Mine connection is yours and your agents'.");
  if (input.auth === "oauth" && (str(r["url"]) === "" || Object.keys(parse<Record<string, string>>(r["headers_json"], {})).length > 0)) raise(ctx, "validation.bad_input", "A connection that signs in with OAuth is a remote address and holds no key of its own.");
  if (input.title !== undefined && input.title.trim().length > 80) raise(ctx, "validation.bad_input", "Keep the name under 80 characters.");
  const id = str(r["id"]);
  if (input.title !== undefined) ctx.db.run("UPDATE agents_mcp_connections SET title = ? WHERE id = ?", input.title.trim(), id);
  if (input.enabled !== undefined) ctx.db.run("UPDATE agents_mcp_connections SET enabled = ? WHERE id = ?", input.enabled ? 1 : 0, id);
  if (input.auth !== undefined) ctx.db.run("UPDATE agents_mcp_connections SET auth = ?, health = '', health_note = '' WHERE id = ?", input.auth === "oauth" ? "oauth" : "", id);
  if (input.share !== undefined) ctx.db.run("UPDATE agents_mcp_connections SET share_json = ? WHERE id = ?", JSON.stringify(cleanShare(input.share)), id);
  ctx.emit("plugin.connection_changed", id, { connectionId: id, name: str(r["name"]), by: askerOf(ctx) });
  return { connectionId: id };
}

export async function connectionForget(ctx: AgentsCtx, input: { connectionId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const r = (ctx.db.all("SELECT * FROM agents_mcp_connections WHERE id = ?", input.connectionId) as Row[])[0];
  if (!r || (str(r["scope"]) === "mine" && str(r["owner"] ?? "") !== askerOf(ctx))) return { removed: false };
  if (!mayManage(ctx, r)) raise(ctx, "permission.role_lacks_permission", "Only someone who manages agents removes a Space connection.");
  ctx.db.run("DELETE FROM agents_mcp_connections WHERE id = ?", str(r["id"]));
  ctx.emit("plugin.connection_removed", str(r["id"]), { connectionId: str(r["id"]), name: str(r["name"]), by: askerOf(ctx) });
  return { removed: true };
}

// ---- what a connection last did (the engine's connection watcher, as the host) ----------------------------------------------------------------------------

export async function connectionChecked(ctx: AgentsCtx, input: { connectionId: string; health?: Health; note?: string; tools?: number; usedBy?: string }) {
  ensure(ctx.db);
  if (!isHostService(ctx.principal)) raise(ctx, "permission.no_grant", "Only the server records what a connection did.");
  const r = (ctx.db.all("SELECT id, name, health, used_by_json FROM agents_mcp_connections WHERE id = ?", input.connectionId) as Row[])[0];
  if (!r) return { ok: false };
  const now = ctx.now();
  if (input.health !== undefined) {
    const changed = str(r["health"]) !== input.health;
    ctx.db.run("UPDATE agents_mcp_connections SET health = ?, health_note = ?, tools = ?, checked_at = ? WHERE id = ?", input.health, (input.note ?? "").slice(0, 300), input.tools ?? -1, now, input.connectionId);
    if (changed) ctx.emit("plugin.connection_checked", input.connectionId, { connectionId: input.connectionId, name: str(r["name"]), health: input.health });
  }
  if (input.usedBy !== undefined) {
    const used = [input.usedBy, ...parse<string[]>(r["used_by_json"], []).filter((a) => a !== input.usedBy)].slice(0, 8);
    ctx.db.run("UPDATE agents_mcp_connections SET used_at = ?, used_by_json = ? WHERE id = ?", now, JSON.stringify(used), input.connectionId);
  }
  return { ok: true };
}

// ---- policy -------------------------------------------------------------------------------------------------------------------------------------------

export async function policyGet(ctx: AgentsCtx, _input: Record<string, never>) {
  return { policy: policyOf(ctx) };
}

export async function policySet(ctx: AgentsCtx, input: { spaceAdders?: "admins" | "managers"; allowListOn?: boolean; allowList?: string[]; idempotencyKey: string }) {
  ensure(ctx.db);
  const cur = policyOf(ctx);
  const list = input.allowList === undefined ? cur.allowList : [...new Set(input.allowList.map((x) => x.trim()).filter((x) => x !== "" && x.length <= 200))].slice(0, 500);
  const next: ConnectionPolicy = { spaceAdders: input.spaceAdders ?? cur.spaceAdders, allowListOn: input.allowListOn ?? cur.allowListOn, allowList: list };
  ctx.db.run("INSERT INTO agents_connection_policy (key, value_json, author, at) VALUES ('policy', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, author = excluded.author, at = excluded.at", JSON.stringify(next), askerOf(ctx), ctx.now());
  ctx.emit("plugin.connections_policy_changed", "policy", { spaceAdders: next.spaceAdders, allowListOn: next.allowListOn, by: askerOf(ctx) });
  return { policy: next };
}

// ---- the catalog ------------------------------------------------------------------------------------------------------------------------------------------

/** One page of the catalog: fetched through the host and kept, or, when the registry cannot be reached, found in what was kept (offline: true). */
export async function registrySearch(ctx: AgentsCtx, input: { q?: string; cursor?: string; source?: "official" | "smithery"; limit?: number }) {
  ensure(ctx.db);
  const src = sourceById(input.source) ?? CATALOG_SOURCES[0]!;
  const q = (input.q ?? "").trim().slice(0, 100);
  const limit = input.limit ?? 30;
  const policy = policyOf(ctx);
  const admin = isAdmin(ctx);
  const mark = (e: CatalogEntry) => ({ ...e, allowed: !policy.allowListOn || admin || allowedBy(policy.allowList, { registryName: e.name, url: e.remote?.url, command: e.package?.runner, args: e.package ? [e.package.identifier] : [] }) });
  let page: { entries: CatalogEntry[]; next?: string } | null = null;
  try {
    const json = await registryFetch(src.searchUrl(q, input.cursor, limit));
    page = src.parse(json);
  } catch { page = null; }
  if (page) {
    const now = ctx.now();
    for (const e of page.entries) ctx.db.run("INSERT INTO agents_mcp_catalog (id, source, name, entry_json, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_json = excluded.entry_json, at = excluded.at", e.id, src.id, e.name, JSON.stringify(e), now);
    return { entries: page.entries.map(mark), ...(page.next ? { next: page.next } : {}), offline: false, fetchedAt: now, source: src.id };
  }
  // offline: the kept entries that match, newest first; the words of the search must all appear in the name, title or description
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = (ctx.db.all("SELECT entry_json, at FROM agents_mcp_catalog WHERE source = ? ORDER BY name", src.id) as Row[])
    .map((r) => ({ e: parse<CatalogEntry | null>(r["entry_json"], null), at: Number(r["at"]) }))
    .filter((x): x is { e: CatalogEntry; at: number } => x.e !== null)
    .filter((x) => words.every((w) => `${x.e.name} ${x.e.title} ${x.e.description}`.toLowerCase().includes(w)));
  const offset = Number(input.cursor ?? "0") || 0;
  const slice = kept.slice(offset, offset + limit);
  const newest = kept.reduce((m, x) => Math.max(m, x.at), 0);
  return { entries: slice.map((x) => mark(x.e)), ...(offset + limit < kept.length ? { next: String(offset + limit) } : {}), offline: true, ...(newest > 0 ? { fetchedAt: newest } : {}), source: src.id };
}

