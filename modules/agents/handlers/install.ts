// agents: install from a link, and skills that agents own and share (owner, 4 Nov 2026).
//   install.from_link   read a GitHub link (pinned to a commit) or an MCP address into a plan: what it is, what it does, what it needs, who can get it. Nothing is installed.
//   install.apply       put it where the person chose. Held at the Gate for an agent's call (act `install`), so the person sees the plan as a card and presses Install. Only an admin installs for the Space.
//   install.check_update  read the same repo again; a newer commit gives an update plan with the diff, applied the same held way. Nothing updates by itself.
//   skills.save / history / undo / grant: a skill is owned by a person or an agent; an agent can be given use, edit or manage of one; every save is a version and can be undone.
// Third-party code never runs here: a skill is text; a plugin or a local MCP server is stored with its files and run by the plugin runtime in the sandbox; "Run it on the Space" deploys it on Sites.
import { readPlugin } from "../../../lib/plugin-format.ts";
import type { PluginContents } from "../../../lib/plugin-format.ts";
import { parseSkill } from "../../../lib/skill-md.ts";
import { classifyLink, skillPerms, skillsInTree } from "../../../lib/skill-import.ts";
import type { FoundSkill } from "../../../lib/skill-import.ts";
import { agentBy, askerOf, canSee, ensure, mintId, raise } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";
import { checkFiles, checkPolicy, isAdmin, ownById, ownOf } from "./skill-scopes.ts";
import type { Own } from "./skill-scopes.ts";
import { mineAdd, spaceInstall } from "./skill-scopes.ts";
import { treeOf } from "./plugins.ts";

type Row = Record<string, unknown>;
type Files = Record<string, string>;
type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const parse = <T>(v: unknown, d: T): T => { try { return v === null || v === undefined || str(v) === "" ? d : JSON.parse(str(v)) as T; } catch { return d; } };
const me = (ctx: AgentsCtx): string => askerOf(ctx);

// ---- skills that agents own and share ---------------------------------------------------------------------------------------------------------------------

export type Level = "use" | "edit" | "manage";
const RANK: Record<Level, number> = { use: 1, edit: 2, manage: 3 };
const kindOf = (id: string): "agent" | "person" => (id.startsWith("agt_") ? "agent" : "person");

/** What the caller may do with a skill: its owner (a person, or the owner of the agent that owns it) and the agent that owns it manage it; an agent holds what it was granted. */
export function levelOn(ctx: AgentsCtx, o: Own): Level | null {
  const who = ctx.principal.id;
  if (o.owner === who || (ctx.principal.kind !== "agent" && o.owner === me(ctx))) return "manage";
  if (o.owner.startsWith("agt_") && ctx.principal.kind !== "agent" && agentBy(ctx.db, o.owner)?.ownerId === me(ctx)) return "manage";
  if (ctx.principal.kind === "agent") {
    const g = (ctx.db.all("SELECT level FROM agents_skill_grants WHERE skill_id = ? AND agent_id = ?", o.id, who) as Row[])[0];
    if (g) return str(g["level"]) as Level;
  }
  return null;
}
function need(ctx: AgentsCtx, skillId: string, at: Level): Own {
  ensure(ctx.db);
  const o = ownById(ctx, skillId);
  const l = o ? levelOn(ctx, o) : null;
  if (!o || l === null) raise(ctx, "validation.not_found", "There is no such skill, or it is not yours.");
  if (RANK[l!] < RANK[at]) raise(ctx, "permission.role_lacks_permission", `You can use this skill but not ${at === "edit" ? "change" : "share"} it.`, { level: l });
  return o!;
}
const revsOf = (ctx: AgentsCtx, skillId: string): Row[] => ctx.db.all("SELECT * FROM agents_skill_rev WHERE skill_id = ? ORDER BY rev DESC", skillId) as Row[];
const authorKind = (ctx: AgentsCtx): "person" | "agent" => (ctx.principal.kind === "agent" ? "agent" : "person");
const skillOut = (ctx: AgentsCtx, o: Own) => ({ skillId: o.id, name: o.name, description: o.description, owner: o.owner, ownerKind: kindOf(o.owner), rev: Number((revsOf(ctx, o.id)[0] ?? {})["rev"] ?? 1), version: o.version, updatedAt: o.updatedAt });

/** Write a skill under an owner, as a new skill or a new version of the owner's skill of that name. */
export function saveFor(ctx: AgentsCtx, o: { owner: string; text: string; files: Files; source: string; version?: string; summary?: string; skillId?: string; agents?: string[] }): Own {
  const parsed = parseSkill(o.text);
  if (!parsed.ok) raise(ctx, "validation.bad_input", parsed.problem);
  checkFiles(ctx, o.files);
  const perms = skillPerms(o.text, o.files);
  checkPolicy(ctx, perms, parsed.skill.name);
  const now = ctx.now();
  const was = o.skillId ? ownById(ctx, o.skillId) : (ctx.db.all("SELECT * FROM agents_skill_own WHERE owner = ? AND project_id = '' AND name = ?", o.owner, parsed.skill.name) as Row[]).map(ownOf)[0] ?? null;
  const id = was?.id ?? mintId("sko", now);
  if (was) {
    ctx.db.run("UPDATE agents_skill_own SET name = ?, description = ?, text = ?, files_json = ?, source = ?, version = ?, perms_json = ?, updated_at = ? WHERE id = ?",
      parsed.skill.name, parsed.skill.description, o.text, JSON.stringify(o.files), o.source, o.version ?? was.version, JSON.stringify(perms), now, id);
  } else {
    ctx.db.run("INSERT INTO agents_skill_own (id, owner, project_id, name, description, text, files_json, source, version, perms_json, setup_json, agents_json, enabled, at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1, ?, ?)",
      id, o.owner, parsed.skill.name, parsed.skill.description, o.text, JSON.stringify(o.files), o.source, o.version ?? "", JSON.stringify(perms), JSON.stringify(o.agents ?? ["*"]), now, now);
  }
  const rev = Number((revsOf(ctx, id)[0] ?? {})["rev"] ?? 0) + 1;
  ctx.db.run("INSERT INTO agents_skill_rev (skill_id, rev, text, files_json, by_who, author_kind, summary, undo_of, at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)", id, rev, o.text, JSON.stringify(o.files), me(ctx), authorKind(ctx), o.summary ?? (was ? "changed" : "created"), now);
  ctx.emit("skill.mine_changed", id, { skillId: id, name: parsed.skill.name, op: was ? "updated" : "added", by: me(ctx) });
  return ownById(ctx, id)!;
}

/** A skill is an access resource ("skill"): its owner holds manage on it, and the owner of an agent that owns it too, so the shared Share sheet has a row for them. A host without access leaves it as the owner column says. */
export async function registerSkill(ctx: AgentsCtx, o: Own): Promise<void> {
  if (!ctx.call) return;
  const subjects = [{ kind: o.owner.startsWith("agt_") ? "agent" : "person", id: o.owner }, ...(o.owner.startsWith("agt_") && agentBy(ctx.db, o.owner)?.ownerId ? [{ kind: "person", id: agentBy(ctx.db, o.owner)!.ownerId }] : [])];
  for (const subject of subjects) {
    try { await ctx.call("access.share", { resource: { type: "skill", id: o.id }, subject, level: "manage", source: "skill:owner", idempotencyKey: `skill-owner:${o.id}:${subject.id}` }, { idempotencyKey: `skill-owner:${o.id}:${subject.id}` }); }
    catch (e) { ctx.log.warn("agents: a skill could not be registered for sharing", { error: e instanceof Error ? e.message : String(e) }); }
  }
}

export async function skillsSave(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const files = (input.files ?? {}) as Files;
  if (typeof input.skillId === "string") {
    const o = need(ctx, input.skillId, "edit");
    return { skill: skillOut(ctx, saveFor(ctx, { owner: o.owner, text: input.text, files, source: o.source, skillId: o.id, ...(input.summary ? { summary: input.summary } : {}) })) };
  }
  let owner = ctx.principal.kind === "agent" ? ctx.principal.id : me(ctx);
  if (typeof input.ownerAgentId === "string") {
    const a = agentBy(ctx.db, input.ownerAgentId);
    if (!a) raise(ctx, "validation.not_found", "There is no such agent.");
    const mine = ctx.principal.kind === "agent" ? ctx.principal.id === a!.id : a!.ownerId === me(ctx);
    if (!mine) raise(ctx, "permission.role_lacks_permission", "An agent's skills are written by that agent or by the person who owns it.");
    owner = a!.id;
  }
  // a name the owner already has is a new version of it, so an agent can keep refining one skill
  const pre = parseSkill(input.text);
  if (!pre.ok) raise(ctx, "validation.bad_input", pre.problem);
  const same = (ctx.db.all("SELECT * FROM agents_skill_own WHERE owner = ? AND project_id = '' AND name = ?", owner, (pre as { ok: true; skill: { name: string } }).skill.name) as Row[])[0];
  if (same) need(ctx, str(same["id"]), "edit");
  const made = saveFor(ctx, { owner, text: input.text, files, source: input.source ?? (owner.startsWith("agt_") ? "agent" : "upload"), ...(input.summary ? { summary: input.summary } : {}) });
  if (!same) await registerSkill(ctx, made);
  return { skill: skillOut(ctx, made) };
}

/** skills.mine.add, and the new skill is registered for sharing. */
export async function mineAddShared(ctx: AgentsCtx, input: Parameters<typeof mineAdd>[1]) {
  const out = await mineAdd(ctx, input);
  const o = ownById(ctx, out.skill.skillId);
  if (o && revsOf(ctx, o.id).length === 0) {
    // the first version of a skill a person added by hand
    ctx.db.run("INSERT INTO agents_skill_rev (skill_id, rev, text, files_json, by_who, author_kind, summary, undo_of, at) VALUES (?, 1, ?, ?, ?, ?, 'created', NULL, ?)", o.id, o.text, JSON.stringify(o.files), me(ctx), authorKind(ctx), ctx.now());
    await registerSkill(ctx, o);
  }
  return out;
}

export async function skillsHistory(ctx: AgentsCtx, input: In) {
  const o = need(ctx, input.skillId, "use");
  return { revisions: revsOf(ctx, o.id).slice(0, 50).map((r) => ({ rev: Number(r["rev"]), by: str(r["by_who"]), authorKind: str(r["author_kind"]) as "person" | "agent", summary: str(r["summary"]), ...(r["undo_of"] !== null && r["undo_of"] !== undefined ? { undoOf: Number(r["undo_of"]) } : {}), at: Number(r["at"]) })) };
}

/** Undo the latest version: the text and files of the version before it come back as a new version; undoing an undo brings back what it undid. */
export async function skillsUndo(ctx: AgentsCtx, input: In) {
  const o = need(ctx, input.skillId, "edit");
  const revs = revsOf(ctx, o.id);
  const latest = revs[0];
  const target = latest ? (latest["undo_of"] !== null && latest["undo_of"] !== undefined ? Number(latest["undo_of"]) : Number(latest["rev"]) - 1) : 0;
  const back = revs.find((r) => Number(r["rev"]) === target);
  if (!latest || !back) raise(ctx, "validation.precondition_failed", "There is nothing to undo.", { reason: "nothing_to_undo" });
  const text = str(back!["text"]);
  const files = parse<Files>(back!["files_json"], {});
  const parsed = parseSkill(text);
  if (!parsed.ok) raise(ctx, "validation.bad_input", parsed.problem);
  const now = ctx.now();
  ctx.db.run("UPDATE agents_skill_own SET name = ?, description = ?, text = ?, files_json = ?, perms_json = ?, updated_at = ? WHERE id = ?", (parsed as { ok: true; skill: { name: string; description: string } }).skill.name, (parsed as { ok: true; skill: { description: string } }).skill.description, text, JSON.stringify(files), JSON.stringify(skillPerms(text, files)), now, o.id);
  const rev = Number(latest!["rev"]) + 1;
  ctx.db.run("INSERT INTO agents_skill_rev (skill_id, rev, text, files_json, by_who, author_kind, summary, undo_of, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", o.id, rev, text, JSON.stringify(files), me(ctx), authorKind(ctx), `undid version ${Number(latest!["rev"])}`, Number(latest!["rev"]), now);
  ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "updated", by: me(ctx) });
  return { skill: skillOut(ctx, ownById(ctx, o.id)!), undid: Number(latest!["rev"]) };
}

/**
 * Give an agent use, edit or manage of a skill, or take it back (level null). Only a manager of the skill shares it on. The grant is an access grant on the skill, the same one the shared Share sheet
 * writes; this table keeps the agents' side of it so a list of an agent's skills needs no access query (the consumer in impl.ts keeps it in step when the sheet changes a grant).
 */
export async function skillsGrant(ctx: AgentsCtx, input: In) {
  const o = need(ctx, input.skillId, "manage");
  const a = agentBy(ctx.db, input.agentId);
  if (!a || (!canSee(ctx, a) && ctx.principal.kind !== "agent")) raise(ctx, "validation.not_found", "There is no such agent.");
  if (a!.id === o.owner) raise(ctx, "validation.bad_input", "That agent already owns this skill.");
  const off = input.level === null || input.level === undefined;
  if (!off && !(input.level in RANK)) raise(ctx, "validation.bad_input", "A level is use, edit or manage.");
  const resource = { type: "skill", id: o.id };
  const subject = { kind: "agent", id: a!.id };
  if (ctx.call) {
    try {
      if (off) await ctx.call("access.unshare", { resource, subject, source: "skill:grant" });
      else await ctx.call("access.share", { resource, subject, level: input.level, source: "skill:grant", idempotencyKey: `skill-grant:${o.id}:${a!.id}:${input.level}` }, { idempotencyKey: `skill-grant:${o.id}:${a!.id}:${input.level}` });
    } catch (e) { ctx.log.warn("agents: the skill grant could not be written to access", { error: e instanceof Error ? e.message : String(e) }); }
  }
  setGrant(ctx, o.id, a!.id, off ? null : (input.level as Level), me(ctx));
  ctx.emit("skill.shared", o.id, { skillId: o.id, name: o.name, to: [a!.id], stop: off, by: me(ctx) });
  return { grants: grantsOf(ctx, o.id) };
}
/** The agents' side of a skill's grants: written by skills.grant and by the consumer that follows access. */
export function setGrant(ctx: AgentsCtx, skillId: string, agentId: string, level: Level | null, by: string): void {
  if (level === null) { ctx.db.run("DELETE FROM agents_skill_grants WHERE skill_id = ? AND agent_id = ?", skillId, agentId); return; }
  ctx.db.run("INSERT INTO agents_skill_grants (skill_id, agent_id, level, by_who, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(skill_id, agent_id) DO UPDATE SET level = excluded.level, by_who = excluded.by_who, at = excluded.at", skillId, agentId, level, by, ctx.now());
}
/** A grant on a skill changed in access (the Share sheet): an agent's goes to the table; a person's makes a card for them, as a share always has. */
export function followGrant(ctx: AgentsCtx, ev: { name: string; payload: Record<string, any> }): void {   // eslint-disable-line @typescript-eslint/no-explicit-any
  ensure(ctx.db);
  const p = ev.payload;
  if (p["resource"]?.type !== "skill" || p["source"] === "skill:owner") return;
  const id = String(p["resource"].id), who = p["subject"] as { kind: string; id: string };
  if (!ownById(ctx, id)) return;
  if (who.kind === "agent") {
    if (ev.name === "grant.revoked") setGrant(ctx, id, who.id, null, "access");
    else if (["use", "view", "edit", "manage"].includes(String(p["level"]))) setGrant(ctx, id, who.id, p["level"] === "view" ? "use" : (p["level"] as Level), "access");
  } else if (who.kind === "person") {
    const o = ownById(ctx, id)!;
    if (who.id === o.owner) return;
    if (ev.name === "grant.revoked") ctx.db.run("DELETE FROM agents_skill_shares WHERE skill_id = ? AND recipient = ?", id, who.id);
    else ctx.db.run("INSERT OR IGNORE INTO agents_skill_shares (id, skill_id, sharer, recipient, at) VALUES (?, ?, ?, ?, ?)", mintId("sks", ctx.now()), id, o.owner, who.id, ctx.now());
  }
}
const grantsOf = (ctx: AgentsCtx, skillId: string) => (ctx.db.all("SELECT * FROM agents_skill_grants WHERE skill_id = ? ORDER BY agent_id", skillId) as Row[]).map((r) => ({ agentId: str(r["agent_id"]), level: str(r["level"]) as Level, by: str(r["by_who"]), at: Number(r["at"]) }));
export async function skillsGrants(ctx: AgentsCtx, input: In) {
  const o = need(ctx, input.skillId, "use");
  return { owner: o.owner, ownerKind: kindOf(o.owner), grants: grantsOf(ctx, o.id) };
}

// ---- reading a link ----------------------------------------------------------------------------------------------------------------------------------------

type Kind = "skill" | "plugin" | "mcp_local" | "mcp_remote" | "site";
interface Needs { domains: string[]; vaultKeys: string[]; files: string[] }
interface Plan {
  kind: Kind; name: string; summary: string; repo: string; commit: string; url: string; path: string; flavor?: "claude" | "codex";
  needs: Needs; runs?: { command: string; args: string[] }; skills: string[]; problems: string[]; diff?: Diff;
}
interface Diff { from: string; to: string; added: string[]; removed: string[]; changed: Array<{ path: string; plus: string[]; minus: string[] }> }

const jsonAt = (files: Files, path: string): Record<string, any> | null => { try { const j = JSON.parse(files[path] ?? ""); return j && typeof j === "object" ? j : null; } catch { return null; } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const MCP_HINT = /modelcontextprotocol|\bmcp[-_ ]?server\b|\bFastMCP\b|\bmcp\b.{0,40}\b(stdio|server)\b/i;

/** A README's first real paragraph, in a sentence or two; else the manifest's description. */
function summaryOf(files: Files, fallback: string): string {
  const readme = Object.entries(files).find(([p]) => /^readme(\.md)?$/i.test(p))?.[1] ?? "";
  for (const para of readme.split(/\n\s*\n/)) {
    const t = para.replace(/!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "").trim();
    if (!t || /^(#|\||<|```|---|\[!\[)/.test(t) || t.length < 20) continue;
    return t.replace(/\s+/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 280);
  }
  return fallback.slice(0, 280);
}
function needsOf(files: Files, own: Needs): Needs {
  const text = Object.entries(files).filter(([p]) => /\.(md|json|ya?ml|toml|py|js|ts|mjs|env\.example)$|^\.env/i.test(p) && !p.includes("node_modules")).map(([, t]) => t).join("\n").slice(0, 300_000);
  const domains = new Set(own.domains);
  for (const m of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
    const h = m[1]!.toLowerCase();
    if (!/(^|\.)(github\.com|githubusercontent\.com|npmjs\.(com|org)|pypi\.org|shields\.io|example\.(com|org)|localhost|w3\.org|opensource\.org|creativecommons\.org)$/.test(h)) domains.add(h);
  }
  const keys = new Set(own.vaultKeys);
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]*_(?:API_KEY|TOKEN|SECRET|KEY|PASSWORD))\b/g)) keys.add(m[1]!);
  return { domains: [...domains].sort().slice(0, 8), vaultKeys: [...keys].sort().slice(0, 8), files: own.files };
}

/** What a tree is: a skill, a plugin, a local MCP server, a site; null when it is none of them. */
export function detect(files: Files, repo: string, path: string, commit: string, url: string): Plan | { problem: string } {
  const base = { repo, commit, url, path, skills: [] as string[], problems: [] as string[] };
  const found = skillsInTree(files, repo.split("/")[1] ?? "skill");
  const hasClaude = files[".claude-plugin/plugin.json"] !== undefined, hasCodex = files[".codex-plugin/plugin.json"] !== undefined;
  if (hasClaude || hasCodex) {
    const man = jsonAt(files, hasClaude ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json") ?? {};
    const c = hasClaude ? readPlugin(files) : null;
    const names = hasClaude ? c!.skills.map((s) => s.name) : found.skills.map((s) => s.name);
    const servers = c?.mcpServers ?? [];
    return {
      ...base, kind: "plugin", flavor: hasClaude ? "claude" : "codex", name: String(man["name"] ?? repo.split("/")[1] ?? "plugin"), summary: summaryOf(files, String(man["description"] ?? "")),
      needs: needsOf(files, { domains: servers.filter((s) => s.url).map((s) => new URL(s.url!).hostname), vaultKeys: [], files: names.length ? [`${names.length} skill${names.length === 1 ? "" : "s"}`] : [] }),
      skills: names, problems: [...(c?.warnings ?? []), ...found.problems],
    };
  }
  if (files["SKILL.md"] !== undefined || found.skills.length > 0) {
    const first = found.skills[0] as FoundSkill;
    const perms = first ? skillPerms(first.text, first.files) : { scripts: [], mcpServers: [], network: [], vaultKeys: [] };
    return {
      ...base, kind: "skill", name: first?.name ?? repo.split("/")[1] ?? "skill", summary: first?.description || summaryOf(files, ""),
      needs: needsOf(files, { domains: perms.network, vaultKeys: perms.vaultKeys, files: perms.scripts }), skills: found.skills.map((s) => s.name), problems: found.problems,
    };
  }
  const pkg = jsonAt(files, "package.json");
  const py = files["pyproject.toml"];
  const docker = files["Dockerfile"];
  const readme = Object.entries(files).find(([p]) => /^readme(\.md)?$/i.test(p))?.[1] ?? "";
  const hinted = MCP_HINT.test(`${readme}\n${JSON.stringify(pkg?.["dependencies"] ?? {})}${JSON.stringify(pkg?.["keywords"] ?? [])}${py ?? ""}${String(pkg?.["name"] ?? "")}`);
  if (hinted) {
    let runs: Plan["runs"] | undefined;
    if (pkg) {
      const bin = pkg["bin"];
      const binPath = typeof bin === "string" ? bin : bin && typeof bin === "object" ? String(Object.values(bin)[0] ?? "") : "";
      runs = binPath ? { command: "node", args: [binPath.replace(/^\.\//, "")] } : pkg["scripts"]?.start ? { command: "npm", args: ["start", "--silent"] } : pkg["main"] ? { command: "node", args: [String(pkg["main"])] } : undefined;
    } else if (py) {
      const sc = /\[project\.scripts\]\s*\n\s*([A-Za-z0-9_.-]+)\s*=/.exec(py)?.[1];
      runs = sc ? { command: sc, args: [] } : undefined;
    }
    if (!runs && docker) {
      const ep = /^\s*(?:ENTRYPOINT|CMD)\s+\[([^\]]+)\]/im.exec(docker)?.[1];
      const parts = ep ? ep.split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
      if (parts.length) runs = { command: parts[0]!, args: parts.slice(1) };
    }
    if (runs) {
      return {
        ...base, kind: "mcp_local", name: String(pkg?.["name"] ?? /^name\s*=\s*"([^"]+)"/m.exec(py ?? "")?.[1] ?? repo.split("/")[1] ?? "mcp-server").replace(/^@[^/]+\//, ""), summary: summaryOf(files, String(pkg?.["description"] ?? /^description\s*=\s*"([^"]+)"/m.exec(py ?? "")?.[1] ?? "")),
        needs: needsOf(files, { domains: [], vaultKeys: [], files: ["A copy of the repository, in the sandbox"] }), runs, problems: [],
      } as Plan;
    }
    return { problem: "It looks like an MCP server, but I could not find the command that starts it (a bin or start script, a pyproject script, or a Dockerfile entrypoint)." };
  }
  if (docker || pkg?.["scripts"]?.start || files["index.html"] !== undefined) {
    return { ...base, kind: "site", name: String(pkg?.["name"] ?? repo.split("/")[1] ?? "site").replace(/^@[^/]+\//, ""), summary: summaryOf(files, String(pkg?.["description"] ?? "")), needs: needsOf(files, { domains: [], vaultKeys: [], files: [] }), problems: [] };
  }
  return { problem: "I could not tell what this is. I look for a SKILL.md, a plugin manifest, an MCP server, or a site." };
}

const WHO = (admin: boolean) => [
  { key: "me" as const, label: "Just you", allowed: true },
  { key: "agent" as const, label: "This agent", allowed: true },
  { key: "space" as const, label: "Everyone in the Space", allowed: admin, adminOnly: true },
];

function planOut(ctx: AgentsCtx, id: string, p: Plan, state: string) {
  const admin = isAdmin(ctx);
  return {
    planId: id, state, kind: p.kind, ...(p.flavor ? { flavor: p.flavor } : {}), name: p.name, summary: p.summary, repo: p.repo, commit: p.commit, url: p.url, ...(p.path ? { path: p.path } : {}),
    needs: p.needs, ...(p.runs ? { runs: p.runs } : {}), skills: p.skills, problems: p.problems, who: WHO(admin),
    ...(p.kind === "mcp_local" ? { runOn: [{ key: "sandbox" as const, label: "On your computer, in the sandbox" }, { key: "space" as const, label: "Run it on the Space", needs: "A Vault key to protect it" }] } : {}),
    ...(p.diff ? { diff: p.diff } : {}),
    // what the held act carries, so its card draws without a second fetch: an agent copies this into install.apply, and apply refuses a card that does not match the plan
    card: { name: p.name, kind: p.kind, summary: p.summary, commit: p.commit, needs: p.needs },
  };
}

function save(ctx: AgentsCtx, o: { asker: string; agentId: string; url: string; p: Plan; files: Files; updateOf?: string }): string {
  const id = mintId("ins", ctx.now());
  ctx.db.run("INSERT INTO agents_install (id, asker, agent_id, url, repo, commit_sha, kind, plan_json, files_json, state, installed_json, update_of, at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', '{}', ?, ?, 0)",
    id, o.asker, o.agentId, o.url, o.p.repo, o.p.commit, o.p.kind, JSON.stringify(o.p), JSON.stringify(o.files), o.updateOf ?? "", ctx.now());
  return id;
}
const load = (ctx: AgentsCtx, id: string): Row => {
  const r = (ctx.db.all("SELECT * FROM agents_install WHERE id = ?", id) as Row[])[0];
  if (!r || (str(r["asker"]) !== me(ctx) && !isAdmin(ctx))) raise(ctx, "validation.not_found", "There is no such install.");
  return r!;
};

/** The card in the chat that asked: one block with the plan's id; the card reads the plan itself, so it is right after a reload. A chat that cannot be posted to just has no card. */
async function card(ctx: AgentsCtx, planId: string, p: Plan, update = false, installId?: string): Promise<void> {
  if (!ctx.thread || !ctx.call) return;
  try {
    await ctx.call("chat.post", { threadId: ctx.thread, body: "", blocks: [{ type: "install_plan", v: 1, data: { planId, name: p.name, kind: p.kind, ...(update ? { update: true } : {}), ...(installId ? { installId } : {}) } }], idempotencyKey: `ins-card:${planId}` }, { idempotencyKey: `ins-card:${planId}` });
  } catch (e) { ctx.log.warn("agents: the install card could not be posted", { error: e instanceof Error ? e.message : String(e) }); }
}

/**
 * A GitHub repository as text files. Public repositories are read as they are. One that cannot be read that way may be private: then the person's own GitHub is asked for a short-lived read token
 * (github.token, which follows what they let uses of their GitHub do), and the clone is made with it. A person with no GitHub connected is told so in words.
 */
async function readRepo(ctx: AgentsCtx, l: { owner: string; repo: string; ref?: string; path?: string }): Promise<{ files: Files; revision: string }> {
  const url = `https://github.com/${l.owner}/${l.repo}`;
  let tree;
  try { tree = await treeOf(ctx, { kind: "git", url, ...(l.ref ? { ref: l.ref } : {}) }); }
  catch (first) {
    let handle: string | undefined;
    try { handle = ((await ctx.call?.("github.token", { repo: `${l.owner}/${l.repo}`, action: "read", consumer: "install" })) as { handle?: string } | undefined)?.handle; }
    catch (e) {
      const code = (e as { error?: { code?: string }; code?: string })?.error?.code ?? (e as { code?: string })?.code;
      if (code === "validation.precondition_failed") raise(ctx, "validation.precondition_failed", "Connect your GitHub first, in Settings, so I can read private repositories.", { reason: "github_not_connected" });
      if (code === "permission.no_grant") raise(ctx, "permission.no_grant", "Your GitHub settings do not let me read this repository.", { reason: "github_policy" });
    }
    if (!handle) throw first;
    tree = await treeOf(ctx, { kind: "git", url, ...(l.ref ? { ref: l.ref } : {}), tokenHandle: handle });
  }
  const pre = l.path ? `${l.path.replace(/\/$/, "")}/` : "";
  const files = pre ? Object.fromEntries(Object.entries(tree.files).filter(([p]) => p.startsWith(pre)).map(([p, t]) => [p.slice(pre.length), t])) : tree.files;
  return { files, revision: tree.revision };
}

export async function fromLink(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const url = str(input.url).trim();
  const agentId = ctx.principal.kind === "agent" ? ctx.principal.id : "";
  // a remote MCP server is an address, not a repository
  const asLink = classifyLink(url);
  if (!asLink) raise(ctx, "validation.bad_input", "Give an https link to a GitHub repository or folder, or the address of an MCP server.");
  if (asLink!.kind === "raw") {
    if (!/\/(mcp|sse)(\/|\?|$)/i.test(asLink!.url)) raise(ctx, "validation.bad_input", "That link is not a GitHub repository or an MCP server address (one ending in /mcp or /sse).");
    const host = new URL(asLink!.url).hostname;
    const p: Plan = { kind: "mcp_remote", name: host.split(".")[0] ?? "mcp", summary: `A remote MCP server at ${host}. Vyre connects to it; nothing is installed here.`, repo: host, commit: "", url: asLink!.url, path: "", needs: { domains: [host], vaultKeys: [], files: [] }, skills: [], problems: [] };
    const rid = save(ctx, { asker: me(ctx), agentId, url, p, files: {} });
    await card(ctx, rid, p);
    return { plan: planOut(ctx, rid, p, "planned") };
  }
  const l = asLink as { kind: "github"; owner: string; repo: string; ref?: string; path?: string };
  const { files, revision } = await readRepo(ctx, l);
  if (Object.keys(files).length === 0) raise(ctx, "validation.not_found", `There is nothing at ${l.path ?? "that link"} in ${l.owner}/${l.repo}.`);
  const found = detect(files, `${l.owner}/${l.repo}`, l.path ?? "", revision, url);
  if ("problem" in found) raise(ctx, "validation.bad_input", found.problem);
  const pid = save(ctx, { asker: me(ctx), agentId, url, p: found, files });
  await card(ctx, pid, found);
  return { plan: planOut(ctx, pid, found, "planned") };
}

// ---- diff ---------------------------------------------------------------------------------------------------------------------------------------------------

function diffOf(from: string, to: string, before: Files, after: Files): Diff {
  const lines = (t: string): string[] => t.split("\n");
  const changed: Diff["changed"] = [];
  for (const [p, t] of Object.entries(after)) {
    if (before[p] === undefined || before[p] === t) continue;
    const old = lines(before[p]!), now = lines(t);
    const oldSet = new Map<string, number>(); old.forEach((x) => oldSet.set(x, (oldSet.get(x) ?? 0) + 1));
    const newSet = new Map<string, number>(); now.forEach((x) => newSet.set(x, (newSet.get(x) ?? 0) + 1));
    const plus = now.filter((x) => { const n = oldSet.get(x) ?? 0; if (n > 0) { oldSet.set(x, n - 1); return false; } return x.trim() !== ""; });
    const minus = old.filter((x) => { const n = newSet.get(x) ?? 0; if (n > 0) { newSet.set(x, n - 1); return false; } return x.trim() !== ""; });
    changed.push({ path: p, plus: plus.slice(0, 12), minus: minus.slice(0, 12) });
  }
  return { from, to, added: Object.keys(after).filter((p) => before[p] === undefined).sort(), removed: Object.keys(before).filter((p) => after[p] === undefined).sort(), changed: changed.slice(0, 30) };
}

export async function checkUpdate(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const r = load(ctx, input.installId);
  if (str(r["state"]) !== "installed") raise(ctx, "validation.precondition_failed", "That was not installed.");
  const was = parse<Plan>(r["plan_json"], {} as Plan);
  if (was.kind === "mcp_remote") return { changed: false };
  const l = classifyLink(str(r["url"])) as { kind: "github"; owner: string; repo: string; ref?: string; path?: string };
  const { files, revision } = await readRepo(ctx, l);
  if (revision === str(r["commit_sha"])) return { changed: false };
  const found = detect(files, was.repo, was.path, revision, str(r["url"]));
  if ("problem" in found) raise(ctx, "validation.bad_input", found.problem);
  found.diff = diffOf(str(r["commit_sha"]), revision, parse<Files>(r["files_json"], {}), files);
  const id = save(ctx, { asker: me(ctx), agentId: str(r["agent_id"]), url: str(r["url"]), p: found, files, updateOf: str(r["id"]) });
  await card(ctx, id, found, true, str(r["id"]));
  return { changed: true, plan: planOut(ctx, id, found, "planned") };
}

// ---- installing ---------------------------------------------------------------------------------------------------------------------------------------------

const sourceOf = (p: Plan): string => `github:${p.repo}@${p.commit}${p.path ? `/${p.path}` : ""}`;
const short = (c: string): string => c.slice(0, 7);

function insertPlugin(ctx: AgentsCtx, o: { name: string; scope: "space" | "agent"; agentId: string; label: string; contents: PluginContents; files: Files; version: string }): string {
  const id = mintId("plg", ctx.now());
  ctx.db.run("INSERT INTO agents_plugins (id, name, marketplace_id, marketplace, scope, agent_id, version, description, contents_json, files_json, config_json, enabled, author, at) VALUES (?, ?, 'mkt_link', ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)",
    id, o.name, o.label, o.scope, o.agentId, o.version, o.contents.description ?? "", JSON.stringify(o.contents), JSON.stringify(o.files), me(ctx), ctx.now());
  ctx.emit("plugin.installed", id, { pluginId: id, name: o.name, marketplace: o.label, scope: o.scope, ...(o.agentId !== "" ? { agentId: o.agentId } : {}), by: me(ctx) });
  return id;
}

function contentsOf(p: Plan, files: Files): PluginContents {
  if (p.kind === "mcp_local") {
    return { name: p.name, description: p.summary, version: short(p.commit), userConfig: [], skills: [], commands: [], agents: [], hooks: [], warnings: [],
      mcpServers: [{ name: p.name, transport: "stdio", command: p.runs!.command, args: p.runs!.args, env: {}, headers: {} }] };
  }
  if (p.flavor === "codex") {
    const found = skillsInTree(files, p.name).skills;
    return { name: p.name, description: p.summary, version: short(p.commit), userConfig: [], skills: found.map((s) => ({ name: s.name, description: s.description, text: s.text, files: s.files })), commands: [], agents: [], hooks: [], mcpServers: [], warnings: [] };
  }
  const c = readPlugin(files);
  if (c.name === "") c.name = p.name;
  return c;
}

export async function apply(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const r = load(ctx, input.planId);
  if (str(r["state"]) !== "planned") raise(ctx, "validation.precondition_failed", "That plan was already used.", { reason: "used" });
  const p = parse<Plan>(r["plan_json"], {} as Plan);
  const files = parse<Files>(r["files_json"], {});
  const forWho = input.for as "me" | "agent" | "space";
  if (input.card !== undefined) {
    const c = input.card as In;
    if (c.name !== p.name || c.kind !== p.kind || c.commit !== p.commit || c.summary !== p.summary || JSON.stringify(c.needs) !== JSON.stringify(p.needs)) raise(ctx, "validation.bad_input", "The card did not match the plan, so nothing was installed.", { reason: "card_mismatch" });
  }
  if (forWho === "space" && !isAdmin(ctx)) raise(ctx, "permission.role_lacks_permission", "Only an admin can install something for everyone in the Space.", { reason: "admin_only" });
  const agentId = forWho === "agent" ? str(input.agentId || (ctx.principal.kind === "agent" ? ctx.principal.id : "")) : "";
  if (forWho === "agent") {
    const a = agentId ? agentBy(ctx.db, agentId) : null;
    if (!a || !canSee(ctx, a)) raise(ctx, "validation.bad_input", "Pick the agent to put it in.");
  }
  const old = str(r["update_of"]) ? (ctx.db.all("SELECT * FROM agents_install WHERE id = ?", str(r["update_of"])) as Row[])[0] : undefined;
  const done: Record<string, unknown> = { kind: p.kind, for: forWho, ...(agentId ? { agentId } : {}) };
  const key = `${input.idempotencyKey ?? r["id"]}`;

  if (old) {
    // an update puts the new files where the old ones were
    const was = parse<Record<string, any>>(old["installed_json"], {});   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (p.kind === "skill" && was["skillId"]) {
      const s = skillsInTree(files, p.name).skills[0]!;
      const o = ownById(ctx, String(was["skillId"]));
      if (o) saveFor(ctx, { owner: o.owner, text: s.text, files: s.files, source: sourceOf(p), version: short(p.commit), skillId: o.id, summary: `updated to ${short(p.commit)}` });
    } else if (was["siteId"]) {
      // a site, or a server run on the Space: the same site is built again from the new commit
      await call(ctx, "sites.deploy", { siteId: String(was["siteId"]), source: { repo: `https://github.com/${p.repo}`, branch: p.commit, ...(p.path ? { root: p.path } : {}) }, wait: false });
    } else if (was["pluginId"]) {
      ctx.db.run("UPDATE agents_plugins SET version = ?, contents_json = ?, files_json = ? WHERE id = ?", short(p.commit), JSON.stringify(contentsOf(p, files)), JSON.stringify(files), String(was["pluginId"]));
      ctx.emit("plugin.changed", String(was["pluginId"]), { pluginId: String(was["pluginId"]), name: p.name, by: me(ctx) });
    } else raise(ctx, "validation.precondition_failed", "That kind of install is updated by deploying it again on Sites.");
    ctx.db.run("UPDATE agents_install SET commit_sha = ?, plan_json = ?, files_json = ?, done_at = ? WHERE id = ?", p.commit, JSON.stringify(p), JSON.stringify(files), ctx.now(), str(old["id"]));
    ctx.db.run("UPDATE agents_install SET state = 'installed', installed_json = ?, done_at = ? WHERE id = ?", str(old["installed_json"]), ctx.now(), str(r["id"]));
    return { installed: { ...parse<Record<string, unknown>>(old["installed_json"], {}), kind: p.kind, updated: true, commit: p.commit } };
  }

  switch (p.kind) {
    case "skill": {
      const s = skillsInTree(files, p.name).skills[0];
      if (!s) raise(ctx, "validation.bad_input", "The skill could not be read again.");
      if (forWho === "space") { await spaceInstall(ctx, { text: s!.text, files: s!.files, source: sourceOf(p), version: short(p.commit) }); }
      else if (forWho === "agent") { const o = saveFor(ctx, { owner: agentId, text: s!.text, files: s!.files, source: sourceOf(p), version: short(p.commit), summary: `installed from ${p.repo}` }); done["skillId"] = o.id; await registerSkill(ctx, o); }
      else { const out = await mineAdd(ctx, { text: s!.text, files: s!.files, source: sourceOf(p), version: short(p.commit) }); done["skillId"] = out.skill.skillId; const mine = ownById(ctx, out.skill.skillId); if (mine) await registerSkill(ctx, mine); }
      break;
    }
    case "plugin": case "mcp_local": {
      if (p.kind === "mcp_local" && input.runOn === "space") { Object.assign(done, await deployOnSites(ctx, p, input, key)); break; }
      const scope = forWho === "space" ? "space" : "agent";
      const owner = scope === "agent" ? agentId : "";
      if (scope === "agent" && !owner) raise(ctx, "validation.bad_input", "Pick the agent whose sandbox runs it.");
      const contents = contentsOf(p, files);
      // skills a plugin brings join the library the way a marketplace install adds them
      for (const sk of contents.skills) await (ctx.call?.("skills.add", { text: sk.text, name: `${p.name}:${sk.name}`, ...(owner ? { agentId: owner } : {}), source: `plugin:${p.name}`, files: sk.files, idempotencyKey: `${key}:skill:${sk.name}` }, { idempotencyKey: `${key}:skill:${sk.name}` }) ?? Promise.resolve()).catch(() => undefined);
      done["pluginId"] = insertPlugin(ctx, { name: p.name, scope, agentId: owner, label: `github:${p.repo}`, contents, files, version: short(p.commit) });
      break;
    }
    case "mcp_remote": {
      const scope = forWho === "space" ? "space" : "agent";
      const out = await call<{ connection?: { connectionId?: string } }>(ctx, "plugins.connection.add", { name: p.name, scope, ...(scope === "agent" ? { agentId } : {}), url: p.url, source: "hand", ...(input.authHandle ? { headers: { Authorization: input.authHandle } } : {}) }, `${key}:conn`);
      done["connectionId"] = out.connection?.connectionId;
      break;
    }
    case "site": {
      Object.assign(done, await deployOnSites(ctx, p, { ...input, runOn: "space" }, key, false));
      break;
    }
  }
  ctx.db.run("UPDATE agents_install SET state = 'installed', installed_json = ?, agent_id = ?, done_at = ? WHERE id = ?", JSON.stringify(done), agentId || str(r["agent_id"]), ctx.now(), str(r["id"]));
  return { installed: { ...done, commit: p.commit } };
}

async function call<T>(ctx: AgentsCtx, cap: string, input: Record<string, unknown>, key?: string): Promise<T> {
  if (!ctx.call) raise(ctx, "internal.unexpected", "That part of the app is not available right now.", { cap });
  return (await ctx.call!(cap, key ? { ...input, idempotencyKey: key } : input, key ? { idempotencyKey: key } : undefined)) as T;
}

/** "Run it on the Space": the repository is deployed on Sites at a route with its key from the Vault, then connected as a remote MCP server for the agents chosen. */
async function deployOnSites(ctx: AgentsCtx, p: Plan, input: In, key: string, mcp = true): Promise<Record<string, unknown>> {
  if (ctx.authorize?.({ perm: "sites.deploy", level: "use" }, { type: "space", id: ctx.space }).effect !== "allow") raise(ctx, "permission.role_lacks_permission", "You may not deploy on this Space's Sites.", { reason: "no_sites" });
  if (mcp && !input.authHandle) raise(ctx, "validation.bad_input", "Choose the Vault key that protects it, so only your agents can call it.", { reason: "needs_auth" });
  // the deploy builds the commit the plan was read at, not whatever the branch has become
  const src = { repo: `https://github.com/${p.repo}`, branch: p.commit, ...(p.path ? { root: p.path } : {}) };
  const created = await call<{ site: { siteId: string; url?: string } }>(ctx, "sites.create", { name: p.name, kind: mcp ? "api" : "site", repoUrl: `https://github.com/${p.repo}`, source: src, access: mcp ? "space" : "private" }, `${key}:site`);
  const siteId = created.site.siteId;
  if (mcp) await call(ctx, "sites.env_set", { siteId, entries: [{ name: "MCP_AUTH_TOKEN", vaultHandle: String(input.authHandle) }] });
  const dep = await call<{ deployment?: { deploymentId?: string; url?: string } }>(ctx, "sites.deploy", { siteId, source: src, wait: false });
  const out: Record<string, unknown> = { siteId, ...(dep.deployment?.url ? { url: dep.deployment.url } : created.site.url ? { url: created.site.url } : {}), runOn: "space" };
  if (mcp) {
    const base = String(out["url"] ?? "");
    const scope = input.for === "space" ? "space" : "agent";
    const agentId = scope === "agent" ? str(input.agentId || (ctx.principal.kind === "agent" ? ctx.principal.id : "")) : "";
    const conn = await call<{ connection?: { connectionId?: string } }>(ctx, "plugins.connection.add", { name: p.name, scope, ...(agentId ? { agentId } : {}), url: `${base.replace(/\/$/, "")}/mcp`, headers: { Authorization: String(input.authHandle) }, source: "hand" }, `${key}:conn`);
    out["connectionId"] = conn.connection?.connectionId;
  }
  return out;
}

/** One plan as the card draws it, for whoever asked for it (or an admin); it is read again so the card is right after a reload and on another device. */
export async function installGet(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const r = load(ctx, input.planId);
  return { plan: planOut(ctx, str(r["id"]), parse<Plan>(r["plan_json"], {} as Plan), str(r["state"])), ...(str(r["update_of"]) ? { updateOf: str(r["update_of"]) } : {}) };
}

/** Take back what an install put: the skill, the plugin or the connection it made. A site it deployed stays on Sites (it is removed there). */
export async function installRemove(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  const r = load(ctx, input.installId);
  if (str(r["state"]) !== "installed") return { removed: false };
  const done = parse<Record<string, any>>(r["installed_json"], {});   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (done["skillId"]) { const o = ownById(ctx, String(done["skillId"])); if (o) { ctx.db.run("DELETE FROM agents_skill_own WHERE id = ?", o.id); ctx.db.run("DELETE FROM agents_skill_grants WHERE skill_id = ?", o.id); ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "removed", by: me(ctx) }); } }
  if (done["pluginId"]) { ctx.db.run("DELETE FROM agents_plugins WHERE id = ?", String(done["pluginId"])); ctx.emit("plugin.uninstalled", String(done["pluginId"]), { pluginId: String(done["pluginId"]), name: parse<Plan>(r["plan_json"], {} as Plan).name, by: me(ctx) }); }
  if (done["connectionId"]) await call(ctx, "plugins.connection.remove", { connectionId: String(done["connectionId"]) }, `${r["id"]}:rm`).catch(() => undefined);
  ctx.db.run("DELETE FROM agents_install WHERE id = ? OR update_of = ?", str(r["id"]), str(r["id"]));
  return { removed: true };
}

/** The skills agents the person owns keep, one row each, for the Skills list in the Tools pane. */
export async function skillsOfAgents(ctx: AgentsCtx, _input: In) {
  ensure(ctx.db);
  const rows = ctx.db.all("SELECT o.* FROM agents_skill_own o WHERE o.owner LIKE 'agt_%' ORDER BY o.name") as Row[];
  const out = [];
  for (const r of rows) {
    const o = ownOf(r);
    const a = agentBy(ctx.db, o.owner);
    if (!a || a.ownerId !== me(ctx)) continue;
    out.push({ skillId: o.id, name: o.name, description: o.description, agentId: a.id, agentName: a.name, version: o.version, source: o.source, rev: Number((revsOf(ctx, o.id)[0] ?? {})["rev"] ?? 1), updatedAt: o.updatedAt });
  }
  return { skills: out };
}

export async function installList(ctx: AgentsCtx, input: In) {
  ensure(ctx.db);
  // an admin's Console lists every install in the Space; anyone else sees their own
  const all = input.all === true && isAdmin(ctx);
  const rows = (all ? ctx.db.all("SELECT * FROM agents_install WHERE state = 'installed' AND update_of = '' ORDER BY at DESC") : ctx.db.all("SELECT * FROM agents_install WHERE asker = ? AND state = 'installed' AND update_of = '' ORDER BY at DESC", me(ctx))) as Row[];
  return { installs: rows.map((r) => { const p = parse<Plan>(r["plan_json"], {} as Plan); return { installId: str(r["id"]), kind: p.kind, name: p.name, repo: p.repo, commit: str(r["commit_sha"]), url: str(r["url"]), by: str(r["asker"]), at: Number(r["at"]), installed: parse<Record<string, unknown>>(r["installed_json"], {}) }; }) };
}
