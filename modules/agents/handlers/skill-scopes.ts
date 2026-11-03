// @reads /modules/agents/migrations/0008_skill_scopes.sql
// agents: skills for a person and the skills they share (owner ruling 3 Nov; decisions D26 and D27). The Space library and an agent's own skills are in skills.ts; this file adds:
//   Mine     a person's own skills, for them and the agents they pick, or only in one project
//   shared   a skill someone shared with you (or with everyone here); it applies to you only after you press Add on its card, and again after an update that can touch more
//   Console  the admin's view: members' skill names (contents only of shared ones), Make Space-wide, install and update Space skills, and the scripts rule (off by default)
// Two skills with one name are both kept (D27): the one that came later is renamed with its source. What a skill can touch is read from its files by lib/skill-import.ts.
import { readPlugin } from "../../../lib/plugin-format.ts";
import { parseSkill, withSkillName } from "../../../lib/skill-md.ts";
import { NO_PERMS, classifyLink, originOf, permsGrowth, renamed, runsCode, skillPerms, skillsInTree, sourceOfLink, unzipText } from "../../../lib/skill-import.ts";
import type { FoundSkill, SkillPerms } from "../../../lib/skill-import.ts";
import { agentBy, allAgents, askerOf, ensure, meta, mintId, raise, setMeta, tolerant } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";
import { MAX_FILES_BYTES, builtinSkills, skillsAdd } from "./skills.ts";
import { pluginTree, treeOf } from "./plugins.ts";

type Row = Record<string, unknown>;
type Files = Record<string, string>;
const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const parse = <T>(v: unknown, d: T): T => { try { return v === null || v === undefined || str(v) === "" ? d : JSON.parse(str(v)) as T; } catch { return d; } };
const me = (ctx: AgentsCtx): string => askerOf(ctx);
const isAdmin = (ctx: AgentsCtx): boolean => ctx.authorize?.({ perm: "agents.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";

// ---- rows -------------------------------------------------------------------------------------------------------------------------------------------------

export interface Own {
  id: string; owner: string; projectId: string; name: string; description: string; text: string; files: Files; source: string; version: string; perms: SkillPerms;
  setup: Record<string, string>; agents: string[]; enabled: boolean; at: number; updatedAt: number;
}
const ownOf = (r: Row): Own => ({
  id: str(r["id"]), owner: str(r["owner"]), projectId: str(r["project_id"]), name: str(r["name"]), description: str(r["description"]), text: str(r["text"]), files: parse<Files>(r["files_json"], {}),
  source: str(r["source"]), version: str(r["version"]), perms: parse<SkillPerms>(r["perms_json"], NO_PERMS), setup: parse<Record<string, string>>(r["setup_json"], {}), agents: parse<string[]>(r["agents_json"], ["*"]),
  enabled: Number(r["enabled"]) === 1, at: Number(r["at"]), updatedAt: Number(r["updated_at"]),
});
const ownById = (ctx: AgentsCtx, id: string): Own | null => { const r = (ctx.db.all("SELECT * FROM agents_skill_own WHERE id = ?", id) as Row[])[0]; return r ? ownOf(r) : null; };
const ownsOf = (ctx: AgentsCtx, owner: string): Own[] => (ctx.db.all("SELECT * FROM agents_skill_own WHERE owner = ? ORDER BY name", owner) as Row[]).map(ownOf);
const sharesOf = (ctx: AgentsCtx, skillId: string): string[] => (ctx.db.all("SELECT recipient FROM agents_skill_shares WHERE skill_id = ? ORDER BY recipient", skillId) as Row[]).map((r) => str(r["recipient"]));

interface Receipt { state: "added" | "not_now"; perms: SkillPerms; agents: string[]; enabled: boolean }
const receiptOf = (ctx: AgentsCtx, skillId: string, person: string): Receipt | null => {
  const r = (ctx.db.all("SELECT * FROM agents_skill_receipts WHERE skill_id = ? AND person = ?", skillId, person) as Row[])[0];
  return r ? { state: str(r["state"]) === "added" ? "added" : "not_now", perms: parse<SkillPerms>(r["perms_json"], NO_PERMS), agents: parse<string[]>(r["agents_json"], ["*"]), enabled: Number(r["enabled"]) === 1 } : null;
};
/** Skills shared with this person, one each: with them by name or with everyone here, never their own. */
const offeredTo = (ctx: AgentsCtx, person: string): Own[] =>
  (ctx.db.all("SELECT DISTINCT o.* FROM agents_skill_own o JOIN agents_skill_shares s ON s.skill_id = o.id WHERE (s.recipient = ? OR s.recipient = '*') AND o.owner <> ? ORDER BY o.name", person, person) as Row[]).map(ownOf);
const offered = (ctx: AgentsCtx, skillId: string, person: string): boolean =>
  (ctx.db.all("SELECT 1 AS x FROM agents_skill_shares WHERE skill_id = ? AND (recipient = ? OR recipient = '*')", skillId, person) as Row[]).length > 0;

/** Where a person's card stands: waiting (never decided, or an update can touch more than they approved), added, or not now. */
function cardState(ctx: AgentsCtx, o: Own, person: string): { state: "waiting" | "added" | "not_now"; growth: string[]; receipt: Receipt | null } {
  const r = receiptOf(ctx, o.id, person);
  if (!r) return { state: "waiting", growth: [], receipt: null };
  if (r.state === "not_now") return { state: "not_now", growth: [], receipt: r };
  const growth = permsGrowth(r.perms, o.perms);
  return growth.length > 0 ? { state: "waiting", growth, receipt: r } : { state: "added", growth: [], receipt: r };
}

// ---- the Space's skill extras: version, source, setup ---------------------------------------------------------------------------------------------------

interface SpaceExtra { version?: string; source?: string; setup?: Record<string, string>; from?: string }
const spaceExtra = (ctx: AgentsCtx, name: string): SpaceExtra => parse<SpaceExtra>(meta(ctx.db, `skill.space.${name}`), {});
const setSpaceExtra = (ctx: AgentsCtx, name: string, x: SpaceExtra): void => setMeta(ctx.db, `skill.space.${name}`, JSON.stringify(x));

export interface Policy { scriptsAdminOnly: boolean }
export const policyOf = (ctx: AgentsCtx): Policy => ({ scriptsAdminOnly: meta(ctx.db, "skills.policy.scripts_admin_only") === "1" });

/** D26: with the admin's rule on, a skill that runs scripts or starts a server on this server is added only by an admin. */
function checkPolicy(ctx: AgentsCtx, perms: SkillPerms, name: string): void {
  if (!policyOf(ctx).scriptsAdminOnly || !runsCode(perms) || isAdmin(ctx)) return;
  raise(ctx, "permission.role_lacks_permission", `${name} runs scripts or starts a tool server, and an admin set that only admins add those here. Ask an admin to add it for the Space.`, { name });
}

// ---- setup: the keys a skill's servers want ------------------------------------------------------------------------------------------------------------

const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
/** server.KEY for every key a skill's servers want that has no Vault handle yet. */
export const needsOf = (perms: SkillPerms, setup: Readonly<Record<string, string>>): string[] => perms.mcpServers.flatMap((m) => m.keys.map((k) => `${m.name}.${k}`)).filter((k) => !setup[k]);

function checkSetup(ctx: AgentsCtx, setup: Record<string, string>): void {
  for (const [k, v] of Object.entries(setup)) {
    if (!/^[A-Za-z0-9_.-]+\.[A-Za-z_][A-Za-z0-9_]*$/.test(k)) raise(ctx, "validation.bad_input", `${k} is not a server and key, such as notion.NOTION_TOKEN.`);
    if (!HANDLE.test(v.trim())) raise(ctx, "validation.bad_input", `Give ${k} as a Vault handle such as #Notion_key.api_key, never the key itself.`);
  }
}

// ---- names: two skills with one name (D27) ------------------------------------------------------------------------------------------------------------

/** One skill as a turn and the Skills page list it. `tier` mine and shared are this file's; the rest come from skills.ts. */
export interface Listed {
  name: string; description: string; tier: "builtin" | "space" | "agent" | "mine" | "shared"; source: string; system: boolean; enabled: boolean; bytes: number; updatedAt?: number; at?: number;
  agentId?: string; label?: string; sharer?: string; text: string; body: string; files: Array<{ path: string; text: string }>; skillId?: string;
}

/**
 * D27: when a person's own or shared skill and another skill have one name, the one that came first keeps it (Vyre's built-in ones always came first) and each later one is renamed with
 * its source: "acme-skills:pdf", read as "pdf (from acme/skills)". Clashes without a person's skill (the Space library against an agent's folder) are left to the tiers in skills.ts.
 */
export function renameClashes<T extends Listed>(list: readonly T[], names: Readonly<Record<string, string>> = {}): T[] {
  const groups = new Map<string, T[]>();
  for (const s of list) groups.set(s.name, [...(groups.get(s.name) ?? []), s]);
  const taken = new Set(list.map((s) => s.name));
  const out = new Map<T, T>();
  for (const [, same] of groups) {
    if (same.length < 2 || !same.some((s) => s.tier === "mine" || s.tier === "shared")) continue;
    const order = [...same].sort((a, b) => (a.tier === "builtin" ? -1 : b.tier === "builtin" ? 1 : (a.at ?? a.updatedAt ?? 0) - (b.at ?? b.updatedAt ?? 0)));
    for (const s of order.slice(1)) {
      const origin = originOf(s.source, { tier: s.tier, ...(s.sharer ? { sharer: names[s.sharer] ?? s.sharer } : {}) });
      const r = renamed(s.name, origin, taken);
      taken.add(r.name);
      out.set(s, { ...s, name: r.name, label: r.label });
    }
  }
  return list.map((s) => out.get(s) ?? s);
}

const bodyOf = (text: string, name: string): string => { const r = parseSkill(text, name); return r.ok ? r.skill.body : text; };
const fileList = (f: Files): Array<{ path: string; text: string }> => Object.entries(f).map(([path, text]) => ({ path, text }));
const usedBy = (agents: readonly string[], agentId: string | undefined): boolean => agentId === undefined || agents.includes("*") || agents.includes(agentId);

/**
 * The asker's own skills and the shared ones they added, for a chat with this agent (or all of them with no agent): switched on, picked for this agent, and in the agent's project when the skill
 * is for one project. A shared skill whose update can touch more than they approved is left out until they add it again.
 */
export function personalSkills(ctx: AgentsCtx, agentId: string | undefined, projectId?: string): Listed[] {
  ensure(ctx.db);
  const person = me(ctx);
  const agent = agentId ? agentBy(ctx.db, agentId) : null;
  const project = projectId ?? agent?.projectId ?? "";
  const inProject = (o: Own): boolean => o.projectId === "" || o.projectId === project;
  const out: Listed[] = [];
  for (const o of ownsOf(ctx, person)) {
    if (!o.enabled || !usedBy(o.agents, agentId) || !inProject(o)) continue;
    out.push({ name: o.name, description: o.description, tier: "mine", source: o.source, system: false, enabled: true, bytes: Buffer.byteLength(o.text, "utf8"), updatedAt: o.updatedAt, at: o.at, text: o.text, body: bodyOf(o.text, o.name), files: fileList(o.files), skillId: o.id });
  }
  for (const o of offeredTo(ctx, person)) {
    const c = cardState(ctx, o, person);
    if (c.state !== "added" || !c.receipt?.enabled || !usedBy(c.receipt.agents, agentId) || !inProject(o)) continue;
    const at = Number((ctx.db.all("SELECT at FROM agents_skill_receipts WHERE skill_id = ? AND person = ?", o.id, person) as Row[])[0]?.["at"] ?? o.at);
    out.push({ name: o.name, description: o.description, tier: "shared", source: o.source, system: false, enabled: true, bytes: Buffer.byteLength(o.text, "utf8"), updatedAt: o.updatedAt, at, sharer: o.owner, text: o.text, body: bodyOf(o.text, o.name), files: fileList(o.files), skillId: o.id });
  }
  return out;
}

/** Names of people, for the cards and for a renamed shared skill. One call per person; a person the Space cannot name is shown by id. */
async function namesOf(ctx: AgentsCtx, ids: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of [...new Set(ids)]) {
    const p = await tolerant<{ principal?: { name?: string } }>(ctx, "access.principals.get", { principal: { kind: "person", id } }, {});
    out[id] = p.principal?.name ?? id;
  }
  return out;
}

// ---- reads ------------------------------------------------------------------------------------------------------------------------------------------------

const spaceRows = (ctx: AgentsCtx): Row[] => ctx.db.all("SELECT * FROM agents_skills WHERE agent_id = '' ORDER BY name") as Row[];

function spaceOut(ctx: AgentsCtx, r: Row, label?: string) {
  const name = str(r["name"]);
  const files = parse<Files>(r["files_json"], {});
  const perms = skillPerms(str(r["text"]), files);
  const x = spaceExtra(ctx, name);
  const setup = x.setup ?? {};
  return {
    skillId: str(r["id"]), name, ...(label ? { label } : {}), description: str(r["description"]), source: x.source ?? str(r["source"]), origin: originOf(x.source ?? str(r["source"]), { tier: "space" }),
    ...(x.version ? { version: x.version } : {}), enabled: Number(r["enabled"]) === 1, perms, setup, needs: needsOf(perms, setup), ...(x.from ? { from: x.from } : {}),
    ...(Number.isFinite(Number(r["updated_at"])) ? { updatedAt: Number(r["updated_at"]) } : {}),
  };
}

function ownOut(ctx: AgentsCtx, o: Own, label?: string, name?: string) {
  return {
    skillId: o.id, name: name ?? o.name, ...(label ? { label } : {}), description: o.description, source: o.source, origin: originOf(o.source), ...(o.version ? { version: o.version } : {}),
    ...(o.projectId ? { projectId: o.projectId } : {}), agents: o.agents, enabled: o.enabled, perms: o.perms, setup: o.setup, needs: needsOf(o.perms, o.setup), sharedWith: sharesOf(ctx, o.id), updatedAt: o.updatedAt,
  };
}

function cardOut(ctx: AgentsCtx, o: Own, person: string, names: Record<string, string>, label?: string, name?: string) {
  const c = cardState(ctx, o, person);
  return {
    skillId: o.id, name: name ?? o.name, ...(label ? { label } : {}), description: o.description, sharer: o.owner, sharerName: names[o.owner] ?? o.owner, toSpace: sharesOf(ctx, o.id).includes("*"),
    source: o.source, origin: originOf(o.source, { sharer: names[o.owner] ?? o.owner }), ...(o.version ? { version: o.version } : {}), perms: o.perms, state: c.state, growth: c.growth,
    agents: c.receipt?.agents ?? ["*"], enabled: c.receipt?.enabled ?? true, setup: o.setup, needs: needsOf(o.perms, o.setup), updatedAt: o.updatedAt,
  };
}

export async function skillsPage(ctx: AgentsCtx, input: { projectId?: string }) {
  ensure(ctx.db);
  const person = me(ctx);
  const offers = offeredTo(ctx, person);
  const names = await namesOf(ctx, offers.map((o) => o.owner));
  // the names this person reads are the names their agents see: a later skill with a taken name carries its source
  const built = builtinSkills();
  const listed: Listed[] = [
    ...built.map((b) => ({ ...b, tier: "builtin" as const })),
    ...spaceRows(ctx).map((r) => ({ name: str(r["name"]), description: "", tier: "space" as const, source: str(r["source"]), system: false, enabled: true, bytes: 0, at: Number(r["at"]), text: "", body: "", files: [], skillId: str(r["id"]) })),
    ...ownsOf(ctx, person).filter((o) => input.projectId === undefined || o.projectId === "" || o.projectId === input.projectId).map((o) => ({ name: o.name, description: "", tier: "mine" as const, source: o.source, system: false, enabled: true, bytes: 0, at: o.at, text: "", body: "", files: [], skillId: o.id })),
    ...offers.filter((o) => cardState(ctx, o, person).state === "added").map((o) => ({ name: o.name, description: "", tier: "shared" as const, source: o.source, system: false, enabled: true, bytes: 0, at: o.at, sharer: o.owner, text: "", body: "", files: [], skillId: o.id })),
  ];
  const shown = new Map(renameClashes(listed, names).filter((s) => s.skillId).map((s) => [`${s.tier}:${s.skillId}`, s]));
  const nameFor = (tier: string, id: string): { name?: string; label?: string } => { const s = shown.get(`${tier}:${id}`); return s?.label ? { name: s.name, label: s.label } : {}; };
  const cards = offers.map((o) => { const n = nameFor("shared", o.id); return cardOut(ctx, o, person, names, n.label, n.name); });
  const agents = allAgents(ctx.db).filter((a) => a.ownerId === person && a.runtime !== "outside").map((a) => ({ agentId: a.id, name: a.name }));
  return {
    waiting: cards.filter((c) => c.state === "waiting"), shared: cards.filter((c) => c.state !== "waiting"),
    mine: ownsOf(ctx, person).filter((o) => input.projectId === undefined || o.projectId === "" || o.projectId === input.projectId).map((o) => { const n = nameFor("mine", o.id); return ownOut(ctx, o, n.label, n.name); }),
    space: spaceRows(ctx).map((r) => spaceOut(ctx, r, nameFor("space", str(r["id"])).label)),
    builtin: built.map((b) => ({ name: b.name, description: b.description })), agents, policy: policyOf(ctx), admin: isAdmin(ctx), me: person,
  };
}

export async function skillsView(ctx: AgentsCtx, input: { skillId?: string; name?: string }) {
  ensure(ctx.db);
  const person = me(ctx);
  const files = (f: Files) => Object.entries(f).sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text, "utf8"), text }));
  if (input.skillId?.startsWith("sko_")) {
    const o = ownById(ctx, input.skillId);
    // yours, one offered to you (a card is read before it is added), or one a member shared that an admin looks at before making it Space-wide
    if (!o || !(o.owner === person || offered(ctx, o.id, person) || (isAdmin(ctx) && sharesOf(ctx, o.id).length > 0))) raise(ctx, "validation.not_found", "There is no such skill, or it is not shared with you.");
    return { skill: { name: o.name, description: o.description, text: o.text, files: files(o.files), perms: o.perms, source: o.source, ...(o.version ? { version: o.version } : {}) } };
  }
  const r = input.skillId ? spaceRows(ctx).find((x) => str(x["id"]) === input.skillId) : input.name ? spaceRows(ctx).find((x) => str(x["name"]) === input.name) : undefined;
  if (r) {
    const f = parse<Files>(r["files_json"], {});
    const x = spaceExtra(ctx, str(r["name"]));
    return { skill: { name: str(r["name"]), description: str(r["description"]), text: str(r["text"]), files: files(f), perms: skillPerms(str(r["text"]), f), source: x.source ?? str(r["source"]), ...(x.version ? { version: x.version } : {}) } };
  }
  const b = input.name ? builtinSkills().find((s) => s.name === input.name) : undefined;
  if (!b) raise(ctx, "validation.not_found", "There is no such skill.");
  const bf = Object.fromEntries(b.files.map((f) => [f.path, f.text]));
  return { skill: { name: b.name, description: b.description, text: b.text, files: files(bf), perms: skillPerms(b.text, bf), source: "vyre" } };
}

// ---- reading outside skills ---------------------------------------------------------------------------------------------------------------------------

const MAX_ZIP_B64 = 6_000_000;

/** The files behind a link: a GitHub repo or folder through the host's git reader, a file by its address through read_link. A zip link is read as a zip. */
async function filesOfLink(ctx: AgentsCtx, link: string): Promise<{ files: Files; skipped: string[]; source: string; hint: string }> {
  const l = classifyLink(link);
  if (!l) raise(ctx, "validation.bad_input", "Paste an https link to a SKILL.md, a zip, or a GitHub repo or folder.");
  if (l.kind === "github") {
    const tree = await treeOf(ctx, { kind: "git", url: `https://github.com/${l.owner}/${l.repo}`, ...(l.ref ? { ref: l.ref } : {}) });
    const pre = l.path ? `${l.path.replace(/\/$/, "")}/` : "";
    const files = pre ? Object.fromEntries(Object.entries(tree.files).filter(([p]) => p.startsWith(pre)).map(([p, t]) => [p.slice(pre.length), t])) : tree.files;
    if (pre && Object.keys(files).length === 0) raise(ctx, "validation.bad_input", `There is no folder ${l.path} in ${l.owner}/${l.repo}.`);
    return { files, skipped: tree.skipped, source: sourceOfLink(l), hint: (l.path ?? l.repo).split("/").pop() ?? l.repo };
  }
  const name = decodeURIComponent(new URL(l.url).pathname.split("/").pop() ?? "skill");
  if (/\.zip$/i.test(name)) raise(ctx, "validation.bad_input", "Download the zip and drop it here; a zip is not read from a link.");
  const got = await tolerant<{ ok?: boolean; text?: string; reason?: string; truncated?: boolean }>(ctx, "automations.read_link", { url: l.url }, {});
  if (got.ok === false || typeof got.text !== "string") raise(ctx, "provider.unavailable", `That link could not be read${got.reason ? `: ${got.reason}` : ""}. Check that it is public.`);
  if (got.truncated) raise(ctx, "validation.too_large", "That file is too long to be a skill.");
  const folder = name.replace(/\.md$/i, "") === "SKILL" ? decodeURIComponent(new URL(l.url).pathname.split("/").slice(-2, -1)[0] ?? "skill") : name.replace(/\.md$/i, "");
  return { files: { [/^agents\.md$/i.test(name) ? "AGENTS.md" : "SKILL.md"]: got.text }, skipped: [], source: sourceOfLink(l), hint: folder };
}

export async function readOutside(ctx: AgentsCtx, input: { link?: string; zip?: string; files?: Files; hint?: string; marketplace?: { marketplaceId: string; plugin: string } }): Promise<{ found: FoundSkill[]; problems: string[]; skipped: string[]; source: string }> {
  let files: Files, skipped: string[] = [], source: string, hint = input.hint ?? "skill";
  if (input.link) ({ files, skipped, source, hint } = { ...(await filesOfLink(ctx, input.link)), ...(input.hint ? { hint: input.hint } : {}) });
  else if (input.marketplace) {
    const t = await pluginTree(ctx, input.marketplace.marketplaceId, input.marketplace.plugin);
    files = t.files; source = t.source; hint = input.marketplace.plugin;
  } else if (input.zip) {
    if (input.zip.length > MAX_ZIP_B64) raise(ctx, "validation.too_large", "The zip is over 4 MB.");
    try { ({ files, skipped } = unzipText(Buffer.from(input.zip, "base64"))); } catch (e) { raise(ctx, "validation.bad_input", e instanceof Error ? e.message : "That is not a zip file."); }
    source = "zip";
  } else if (input.files) {
    files = {};
    for (const [p, t] of Object.entries(input.files)) { if (p.startsWith("/") || p.split("/").includes("..")) { skipped.push(p); continue; } files[p] = t; }
    source = "folder";
  } else raise(ctx, "validation.bad_input", "Give a link, a zip or the files of a folder.");
  const r = skillsInTree(files, hint);
  return { found: r.skills, problems: r.problems, skipped, source };
}

export async function skillsPreview(ctx: AgentsCtx, input: { link?: string; zip?: string; files?: Files; hint?: string; marketplace?: { marketplaceId: string; plugin: string } }) {
  ensure(ctx.db);
  const r = await readOutside(ctx, input);
  const taken = new Set([...builtinSkills().map((b) => b.name), ...spaceRows(ctx).map((x) => str(x["name"])), ...ownsOf(ctx, me(ctx)).map((o) => o.name)]);
  return {
    skills: r.found.map((s) => {
      const t = taken.has(s.name) ? renamed(s.name, originOf(r.source), taken).label : undefined;
      return { name: s.name, description: s.description, text: s.text, files: s.files, path: s.path, source: r.source.startsWith("github:") && s.path ? `${r.source}/${s.path}` : r.source, kind: s.kind, ...(s.version ? { version: s.version } : {}), perms: skillPerms(s.text, s.files), ...(t ? { taken: t } : {}) };
    }),
    problems: r.problems, skipped: r.skipped, source: r.source,
  };
}

// ---- Mine, written ----------------------------------------------------------------------------------------------------------------------------------------

function checkFiles(ctx: AgentsCtx, files: Files): void {
  let total = 0;
  for (const [p, t] of Object.entries(files)) {
    if (p.startsWith("/") || p.split("/").includes("..") || p.length > 200) raise(ctx, "validation.bad_input", `${p} is not a path inside the skill.`);
    total += Buffer.byteLength(t, "utf8");
  }
  if (total > MAX_FILES_BYTES) raise(ctx, "validation.too_large", `The supporting files are over ${MAX_FILES_BYTES / 1000} KB.`);
}
const checkAgents = (ctx: AgentsCtx, agents: readonly string[]): void => {
  for (const a of agents) if (a !== "*" && agentBy(ctx.db, a)?.ownerId !== me(ctx)) raise(ctx, "validation.bad_input", "Pick agents of your own.");
};

export async function mineAdd(ctx: AgentsCtx, input: { text: string; files?: Files; source?: string; version?: string; projectId?: string; agents?: string[]; replaces?: string }) {
  ensure(ctx.db);
  const parsed = parseSkill(input.text);
  if (!parsed.ok) raise(ctx, "validation.bad_input", parsed.problem);
  const files = input.files ?? {};
  checkFiles(ctx, files);
  const perms = skillPerms(input.text, files);
  checkPolicy(ctx, perms, parsed.skill.name);
  const person = me(ctx);
  const projectId = input.projectId ?? "";
  if (input.agents) checkAgents(ctx, input.agents);
  const now = ctx.now();
  const was = input.replaces ? ownById(ctx, input.replaces) : (ctx.db.all("SELECT * FROM agents_skill_own WHERE owner = ? AND project_id = ? AND name = ?", person, projectId, parsed.skill.name) as Row[]).map(ownOf)[0] ?? null;
  if (input.replaces && (!was || was.owner !== person)) raise(ctx, "validation.not_found", "There is no such skill of yours.");
  const source = (input.source ?? was?.source ?? "upload").trim() || "upload";
  const version = input.version ?? "";
  if (was) {
    ctx.db.run("UPDATE agents_skill_own SET name = ?, description = ?, text = ?, files_json = ?, source = ?, version = ?, perms_json = ?, agents_json = ?, updated_at = ? WHERE id = ?",
      parsed.skill.name, parsed.skill.description, input.text, JSON.stringify(files), source, version, JSON.stringify(perms), JSON.stringify(input.agents ?? was.agents), now, was.id);
    ctx.emit("skill.mine_changed", was.id, { skillId: was.id, name: parsed.skill.name, op: "updated", by: person });
    return { skill: ownOut(ctx, ownById(ctx, was.id)!) };
  }
  const id = mintId("sko", now);
  ctx.db.run("INSERT INTO agents_skill_own (id, owner, project_id, name, description, text, files_json, source, version, perms_json, setup_json, agents_json, enabled, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1, ?, ?)",
    id, person, projectId, parsed.skill.name, parsed.skill.description, input.text, JSON.stringify(files), source, version, JSON.stringify(perms), JSON.stringify(input.agents ?? ["*"]), now, now);
  ctx.emit("skill.mine_changed", id, { skillId: id, name: parsed.skill.name, op: "added", by: person });
  // D27: a name already in this person's list stays with the first; this one is shown and indexed with its source in front
  const page = await skillsPage(ctx, projectId ? { projectId } : {});
  const row = page.mine.find((m) => m.skillId === id)!;
  return { skill: row };
}

export async function mineSet(ctx: AgentsCtx, input: { skillId: string; enabled?: boolean; agents?: string[]; setup?: Record<string, string> }) {
  ensure(ctx.db);
  const person = me(ctx);
  const o = ownById(ctx, input.skillId);
  if (!o) raise(ctx, "validation.not_found", "There is no such skill.");
  if (input.agents) checkAgents(ctx, input.agents);
  if (input.setup) checkSetup(ctx, input.setup);
  const now = ctx.now();
  if (o.owner === person) {
    const setup = input.setup ? { ...o.setup, ...input.setup } : o.setup;
    ctx.db.run("UPDATE agents_skill_own SET enabled = ?, agents_json = ?, setup_json = ?, updated_at = ? WHERE id = ?", (input.enabled ?? o.enabled) ? 1 : 0, JSON.stringify(input.agents ?? o.agents), JSON.stringify(setup), now, o.id);
    ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "changed", by: person });
    const n = ownById(ctx, o.id)!;
    return { skillId: o.id, enabled: n.enabled, agents: n.agents, setup: n.setup, needs: needsOf(n.perms, n.setup) };
  }
  // a skill shared with you: your switch and your agents; its keys are the sharer's to set
  const c = cardState(ctx, o, person);
  if (!offered(ctx, o.id, person) || c.state !== "added" || !c.receipt) raise(ctx, "validation.not_found", "Add the skill from its card first.");
  if (input.setup) raise(ctx, "validation.bad_input", "The keys of a shared skill are set by the person who shared it.");
  ctx.db.run("UPDATE agents_skill_receipts SET enabled = ?, agents_json = ? WHERE skill_id = ? AND person = ?", (input.enabled ?? c.receipt.enabled) ? 1 : 0, JSON.stringify(input.agents ?? c.receipt.agents), o.id, person);
  ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "changed", by: person });
  const r = receiptOf(ctx, o.id, person)!;
  return { skillId: o.id, enabled: r.enabled, agents: r.agents, setup: o.setup, needs: needsOf(o.perms, o.setup) };
}

export async function mineRemove(ctx: AgentsCtx, input: { skillId: string }) {
  ensure(ctx.db);
  const person = me(ctx);
  const o = ownById(ctx, input.skillId);
  if (!o) return { removed: false };
  if (o.owner === person) {
    ctx.db.run("DELETE FROM agents_skill_own WHERE id = ?", o.id);
    ctx.db.run("DELETE FROM agents_skill_shares WHERE skill_id = ?", o.id);
    ctx.db.run("DELETE FROM agents_skill_receipts WHERE skill_id = ?", o.id);
    ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "removed", by: person });
    return { removed: true };
  }
  if (!offered(ctx, o.id, person)) return { removed: false };
  // taking a shared skill off your list is Not now: the card stays, and Add brings it back
  decide(ctx, o, person, "not_now");
  return { removed: true };
}

export async function mineUpdate(ctx: AgentsCtx, input: { skillId: string }) {
  ensure(ctx.db);
  const o = ownById(ctx, input.skillId);
  if (!o || o.owner !== me(ctx)) raise(ctx, "validation.not_found", "There is no such skill of yours.");
  const link = linkOfSource(o.source);
  if (!link) raise(ctx, "validation.bad_input", "This skill was not added from a link, so there is nothing to fetch. Add the new copy instead.");
  const r = await readOutside(ctx, { link, hint: o.name });
  const s = r.found.find((f) => f.name === o.name) ?? (r.found.length === 1 ? r.found[0] : undefined);
  if (!s) raise(ctx, "validation.not_found", `${o.name} is not at ${link} any more.`);
  const text = s.name === o.name ? s.text : withSkillName(s.text, o.name);
  const perms = skillPerms(text, s.files);
  const changed = text !== o.text || JSON.stringify(s.files) !== JSON.stringify(o.files);
  if (changed) {
    checkPolicy(ctx, perms, o.name);
    ctx.db.run("UPDATE agents_skill_own SET description = ?, text = ?, files_json = ?, version = ?, perms_json = ?, updated_at = ? WHERE id = ?", s.description, text, JSON.stringify(s.files), s.version ?? o.version, JSON.stringify(perms), ctx.now(), o.id);
    ctx.emit("skill.mine_changed", o.id, { skillId: o.id, name: o.name, op: "updated", by: me(ctx) });
  }
  return { skill: ownOut(ctx, ownById(ctx, o.id)!), changed, growth: permsGrowth(o.perms, perms) };
}

/** The link Update fetches from, for a skill that came from one. */
export function linkOfSource(source: string): string | null {
  if (source.startsWith("link:")) return source.slice(5);
  const g = /^github:([^/@]+)\/([^/@]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(source);
  if (!g) return null;
  return g[3] || g[4] ? `https://github.com/${g[1]}/${g[2]}/tree/${g[3] ?? "HEAD"}${g[4] ? `/${g[4]}` : ""}` : `https://github.com/${g[1]}/${g[2]}`;
}

// ---- sharing ---------------------------------------------------------------------------------------------------------------------------------------------

export async function share(ctx: AgentsCtx, input: { skillId: string; to?: string[]; space?: boolean; stop?: boolean }) {
  ensure(ctx.db);
  const person = me(ctx);
  const o = ownById(ctx, input.skillId);
  if (!o || o.owner !== person) raise(ctx, "validation.not_found", "There is no such skill of yours.");
  const to = [...(input.to ?? []).filter((p) => p !== person), ...(input.space ? ["*"] : [])];
  if (to.length === 0) raise(ctx, "validation.bad_input", "Pick people to share it with, or the whole Space.");
  const now = ctx.now();
  for (const r of to) {
    if (input.stop) {
      ctx.db.run("DELETE FROM agents_skill_shares WHERE skill_id = ? AND recipient = ?", o.id, r);
      if (r !== "*") ctx.db.run("DELETE FROM agents_skill_receipts WHERE skill_id = ? AND person = ?", o.id, r);
    } else ctx.db.run("INSERT INTO agents_skill_shares (id, skill_id, sharer, recipient, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(skill_id, recipient) DO NOTHING", mintId("sks", now), o.id, person, r, now);
  }
  // with no share left, what the recipients added stops applying to them
  if (input.stop && sharesOf(ctx, o.id).length === 0) ctx.db.run("DELETE FROM agents_skill_receipts WHERE skill_id = ?", o.id);
  ctx.emit("skill.shared", o.id, { skillId: o.id, name: o.name, to, stop: input.stop === true, by: person });
  return { sharedWith: sharesOf(ctx, o.id) };
}

function decide(ctx: AgentsCtx, o: Own, person: string, decision: "add" | "not_now"): void {
  const now = ctx.now();
  const was = receiptOf(ctx, o.id, person);
  const state = decision === "add" ? "added" : "not_now";
  if (was) ctx.db.run("UPDATE agents_skill_receipts SET state = ?, perms_json = ?, at = ? WHERE skill_id = ? AND person = ?", state, JSON.stringify(decision === "add" ? o.perms : was.perms), now, o.id, person);
  else ctx.db.run("INSERT INTO agents_skill_receipts (id, skill_id, person, state, perms_json, agents_json, enabled, at) VALUES (?, ?, ?, ?, ?, '[\"*\"]', 1, ?)", mintId("skr", now), o.id, person, state, JSON.stringify(decision === "add" ? o.perms : NO_PERMS), now);
  ctx.emit("skill.share_decided", o.id, { skillId: o.id, name: o.name, decision, by: person });
}

export async function sharedDecide(ctx: AgentsCtx, input: { skillId: string; decision: "add" | "not_now" }) {
  ensure(ctx.db);
  const person = me(ctx);
  const o = ownById(ctx, input.skillId);
  if (!o || o.owner === person || !offered(ctx, o.id, person)) raise(ctx, "validation.not_found", "That skill is not shared with you.");
  if (input.decision === "add") checkPolicy(ctx, o.perms, o.name);
  decide(ctx, o, person, input.decision);
  const names = await namesOf(ctx, [o.owner]);
  const page = await skillsPage(ctx, {});
  const shown = [...page.waiting, ...page.shared].find((c) => c.skillId === o.id);
  return { card: shown ?? cardOut(ctx, o, person, names) };
}

// ---- Console ---------------------------------------------------------------------------------------------------------------------------------------------

export async function skillsMembers(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const rows = (ctx.db.all("SELECT * FROM agents_skill_own ORDER BY owner, name") as Row[]).map(ownOf);
  const names = await namesOf(ctx, rows.map((o) => o.owner));
  return {
    skills: rows.map((o) => {
      const to = sharesOf(ctx, o.id);
      // names only: the contents and the id that opens them are given only for a skill its owner shared
      return { owner: o.owner, ownerName: names[o.owner] ?? o.owner, name: o.name, shared: to.length > 0, ...(to.length > 0 ? { skillId: o.id } : {}), toSpace: to.includes("*") };
    }),
  };
}

async function putSpace(ctx: AgentsCtx, text: string, files: Files, source: string, version: string | undefined, from?: string) {
  const out = await skillsAdd(ctx, { text, files, source: source.startsWith("kit:") || source.startsWith("plugin:") ? source : "upload", idempotencyKey: `space-${ctx.now()}` });
  const name = (out as { skill: { name: string } }).skill.name;
  const was = spaceExtra(ctx, name);
  setSpaceExtra(ctx, name, { ...(version ? { version } : {}), source, ...(was.setup ? { setup: was.setup } : {}), ...(from ? { from } : {}) });
  const r = spaceRows(ctx).find((x) => str(x["name"]) === name)!;
  return { skill: spaceOut(ctx, r) };
}

export async function spaceInstall(ctx: AgentsCtx, input: { text: string; files?: Files; source?: string; version?: string }) {
  ensure(ctx.db);
  checkFiles(ctx, input.files ?? {});
  return putSpace(ctx, input.text, input.files ?? {}, (input.source ?? "upload").trim() || "upload", input.version);
}

export async function spaceUpdate(ctx: AgentsCtx, input: { name: string }) {
  ensure(ctx.db);
  const r = spaceRows(ctx).find((x) => str(x["name"]) === input.name);
  if (!r) raise(ctx, "validation.not_found", `There is no Space skill called ${input.name}.`);
  const x = spaceExtra(ctx, input.name);
  const link = linkOfSource(x.source ?? "");
  if (!link) raise(ctx, "validation.bad_input", "This skill was not added from a link, so there is nothing to fetch.");
  const got = await readOutside(ctx, { link, hint: input.name });
  const s = got.found.find((f) => f.name === input.name) ?? (got.found.length === 1 ? got.found[0] : undefined);
  if (!s) raise(ctx, "validation.not_found", `${input.name} is not at ${link} any more.`);
  const text = s.name === input.name ? s.text : withSkillName(s.text, input.name);
  const changed = text !== str(r["text"]) || JSON.stringify(s.files) !== str(r["files_json"]);
  const out = changed ? await putSpace(ctx, text, s.files, x.source!, s.version ?? x.version) : { skill: spaceOut(ctx, r) };
  return { ...out, changed };
}

export async function spaceAdopt(ctx: AgentsCtx, input: { skillId: string }) {
  ensure(ctx.db);
  const o = ownById(ctx, input.skillId);
  // only a skill its owner shared: the admin reads names of the rest, never takes them
  if (!o || sharesOf(ctx, o.id).length === 0) raise(ctx, "validation.not_found", "Only a skill its owner shared can be made Space-wide.");
  return putSpace(ctx, o.text, o.files, o.source, o.version || undefined, o.owner);
}

export async function spaceSetup(ctx: AgentsCtx, input: { name: string; setup: Record<string, string> }) {
  ensure(ctx.db);
  const r = spaceRows(ctx).find((x) => str(x["name"]) === input.name);
  if (!r) raise(ctx, "validation.not_found", `There is no Space skill called ${input.name}.`);
  checkSetup(ctx, input.setup);
  const x = spaceExtra(ctx, input.name);
  setSpaceExtra(ctx, input.name, { ...x, setup: { ...(x.setup ?? {}), ...input.setup } });
  ctx.emit("skill.changed", input.name, { name: input.name, enabled: Number(r["enabled"]) === 1, by: me(ctx) });
  return { skill: spaceOut(ctx, r) };
}

export async function policySet(ctx: AgentsCtx, input: { scriptsAdminOnly: boolean }) {
  ensure(ctx.db);
  setMeta(ctx.db, "skills.policy.scripts_admin_only", input.scriptsAdminOnly ? "1" : "0");
  ctx.emit("skill.policy_changed", "skills", { scriptsAdminOnly: input.scriptsAdminOnly, by: me(ctx) });
  return { policy: policyOf(ctx) };
}

// ---- bundled tool servers, for the engine ------------------------------------------------------------------------------------------------------------

export interface SkillServer {
  key: string; name: string; from: "plugin"; pluginId: string; transport: "stdio" | "http" | "sse" | "ws"; command?: string; args: string[]; env: Record<string, string>; url?: string; headers: Record<string, string>; files: string; needs: string[];
}
/**
 * The MCP servers a skill brings (its .mcp.json), for a chat with this agent: from the asker's own and added shared skills, and from the Space's. Each ${KEY} the server wants is filled with the
 * Vault handle set for it at setup; a key with none is listed in `needs` and the server is not started. The server runs from the skill's files, given to the sandbox like a plugin's. Its key is skill:<skill id>/<server>, so a renamed skill keeps its servers.
 */
export function skillServers(ctx: AgentsCtx, agentId: string | undefined): SkillServer[] {
  ensure(ctx.db);
  const out: SkillServer[] = [];
  const add = (id: string, files: Files, setup: Record<string, string>): void => {
    if (files[".mcp.json"] === undefined) return;
    for (const m of readPlugin({ ".mcp.json": files[".mcp.json"] }).mcpServers) {
      const needs = new Set<string>();
      const fill = (v: string): string => v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, k: string) => { const h = setup[`${m.name}.${k}`]; if (h) return h; needs.add(k); return all; });
      const env = Object.fromEntries(Object.entries(m.env).map(([k, v]) => {
        if (v.trim() === "" && setup[`${m.name}.${k}`]) return [k, setup[`${m.name}.${k}`]!];
        if (v.trim() === "" && /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)S?$/i.test(k)) needs.add(k);
        return [k, fill(v)];
      }));
      out.push({
        key: `skill:${id}/${m.name}`, name: m.name, from: "plugin", pluginId: id, files: id, transport: m.transport, args: m.args.map(fill), env, headers: Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k, fill(v)])),
        needs: [...needs], ...(m.command ? { command: fill(m.command) } : {}), ...(m.url ? { url: fill(m.url) } : {}),
      });
    }
  };
  for (const s of personalSkills(ctx, agentId)) {
    const o = ownById(ctx, s.skillId!);
    if (o) add(o.id, o.files, o.setup);
  }
  for (const r of spaceRows(ctx)) if (Number(r["enabled"]) === 1) add(str(r["id"]), parse<Files>(r["files_json"], {}), spaceExtra(ctx, str(r["name"])).setup ?? {});
  return out;
}

/** The files a skill's server runs from, for the sandbox: the asker's own skill, one they added, or a Space skill. */
export function skillFiles(ctx: AgentsCtx, id: string): Files | null {
  ensure(ctx.db);
  if (id.startsWith("skl_")) { const r = spaceRows(ctx).find((x) => str(x["id"]) === id); return r ? { "SKILL.md": str(r["text"]), ...parse<Files>(r["files_json"], {}) } : null; }
  const o = ownById(ctx, id);
  if (!o) return null;
  const person = me(ctx);
  if (o.owner !== person && cardState(ctx, o, person).state !== "added") return null;
  return { "SKILL.md": o.text, ...o.files };
}

