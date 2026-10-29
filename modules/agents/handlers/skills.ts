// agents: skills (CHAT-DESIGN ruling 4). A skill is a SKILL.md in the open format (lib/skill-md.ts). Three tiers, nearest first:
//   agent   the agent's own skills/<name>/SKILL.md in its Files folder (it writes these itself, computers.skill_from_step writes there) and what a plugin installed into that one agent brings
//   space   the Space library an admin keeps in Settings (skills.add / skills.remove)
//   builtin the files shipped in agent/skills, read from disk; `system: true` ones cannot be hidden or replaced
// A turn shows the index (name and one line) and load_skill returns the full text. Reads run as the asker, so the agent folder is only read when the asker may see it.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { parseSkill, SKILL_MAX_BYTES } from "../../../lib/skill-md.ts";
import { agentBy, askerOf, canSee, ensure, mintId, raise, tolerant } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export type Tier = "builtin" | "space" | "agent";
export interface SkillOut { name: string; description: string; tier: Tier; source: string; agentId?: string; system: boolean; enabled: boolean; bytes: number; updatedAt?: number }
interface Found extends SkillOut { text: string; body: string; files: Array<{ path: string; text: string }> }

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const by = (ctx: AgentsCtx): string => askerOf(ctx);
export const MAX_FILES_BYTES = 400_000;
const BUILTIN = new URL("../../../agent/skills/", import.meta.url);

// ---- built-in -------------------------------------------------------------------------------------------------------------------------------------------

const TEXT = /\.(md|txt|json|ya?ml|toml|sh|py|js|mjs|ts|csv)$/i;
/** Text files beside a SKILL.md, up to two folders deep, without the eval files that test the skill. */
function supporting(dir: URL): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (u: URL, rel: string, depth: number): void => {
    for (const e of readdirSync(u, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) { if (depth < 2) walk(new URL(`${e.name}/`, u), `${rel}${e.name}/`, depth + 1); continue; }
      if (rel === "" && (e.name === "SKILL.md" || /eval\.json$/.test(e.name))) continue;
      if (!TEXT.test(e.name) || out.length >= 20) continue;
      try { out.push({ path: `${rel}${e.name}`, text: readFileSync(new URL(e.name, u), "utf8") }); } catch { /* unreadable: skipped */ }
    }
  };
  walk(dir, "", 0);
  return out;
}
export function builtinSkills(root: URL = BUILTIN): Found[] {
  if (!existsSync(root)) return [];
  const out: Found[] = [];
  for (const d of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = new URL(`${d.name}/`, root);
    let text: string;
    try { text = readFileSync(new URL("SKILL.md", dir), "utf8"); } catch { continue; }
    const r = parseSkill(text, d.name);
    if (!r.ok) continue;
    let at: number | undefined;
    try { at = Math.round(statSync(new URL("SKILL.md", dir)).mtimeMs); } catch { /* no time */ }
    out.push({
      name: r.skill.name, description: r.skill.description, tier: "builtin", source: "vyre", system: r.skill.meta["system"] === true, enabled: true, bytes: Buffer.byteLength(text, "utf8"),
      text, body: r.skill.body, files: supporting(dir), ...(at !== undefined ? { updatedAt: at } : {}),
    });
  }
  return out;
}

// ---- the library ------------------------------------------------------------------------------------------------------------------------------------------

function fromRow(r: Row): Found {
  const agentId = str(r["agent_id"]);
  const files = JSON.parse(str(r["files_json"])) as Record<string, string>;
  const parsed = parseSkill(str(r["text"]), str(r["name"]));
  return {
    name: str(r["name"]), description: str(r["description"]), tier: agentId === "" ? "space" : "agent", source: str(r["source"]), system: false, enabled: Number(r["enabled"]) === 1,
    bytes: Buffer.byteLength(str(r["text"]), "utf8"), updatedAt: Number(r["updated_at"]), text: str(r["text"]), body: parsed.ok ? parsed.skill.body : str(r["text"]),
    files: Object.entries(files).map(([path, text]) => ({ path, text })), ...(agentId === "" ? {} : { agentId }),
  };
}
const library = (ctx: AgentsCtx, agentId: string): Found[] => (ctx.db.all("SELECT * FROM agents_skills WHERE agent_id = ? ORDER BY name", agentId) as Row[]).map(fromRow);

// ---- the agent's own folder -------------------------------------------------------------------------------------------------------------------------------

interface FolderRow { folderId: string; name: string }
interface FileRow { fileId: string; name: string }
const CACHE_MS = 8_000;
const folderCache = new Map<string, { at: number; skills: Found[] }>();
/** skills/<name>/SKILL.md in the agent's Files folder, read as the caller. A folder the caller cannot open, or any failure, gives nothing: the other tiers still answer. */
async function folderSkills(ctx: AgentsCtx, agentId: string): Promise<Found[]> {
  const key = `${ctx.space}:${agentId}:${askerOf(ctx)}`;
  const hit = folderCache.get(key);
  if (hit && ctx.now() - hit.at < CACHE_MS) return hit.skills;
  const out: Found[] = [];
  const home = agentBy(ctx.db, agentId)?.folderId;
  if (home) {
    const top = await tolerant<{ folders?: FolderRow[] }>(ctx, "files.list", { section: "space", folder: home, limit: 100 }, {});
    const skillsDir = (top.folders ?? []).find((f) => f.name === "skills");
    if (skillsDir) {
      const subs = await tolerant<{ folders?: FolderRow[] }>(ctx, "files.list", { section: "space", folder: skillsDir.folderId, limit: 100 }, {});
      for (const sub of (subs.folders ?? []).slice(0, 40)) {
        const inner = await tolerant<{ files?: FileRow[] }>(ctx, "files.list", { section: "space", folder: sub.folderId, limit: 100 }, {});
        const md = (inner.files ?? []).find((f) => f.name === "SKILL.md");
        if (!md) continue;
        const text = (await tolerant<{ text?: string }>(ctx, "files.read", { fileId: md.fileId, as: "text" }, {})).text;
        if (typeof text !== "string") continue;
        const r = parseSkill(text, sub.name);
        if (!r.ok) continue;
        const files: Array<{ path: string; text: string }> = [];
        for (const f of (inner.files ?? []).filter((x) => x.name !== "SKILL.md" && TEXT.test(x.name)).slice(0, 10)) {
          const t = (await tolerant<{ text?: string }>(ctx, "files.read", { fileId: f.fileId, as: "text" }, {})).text;
          if (typeof t === "string") files.push({ path: f.name, text: t });
        }
        out.push({ name: r.skill.name, description: r.skill.description, tier: "agent", source: "agent", agentId, system: false, enabled: true, bytes: Buffer.byteLength(text, "utf8"), text, body: r.skill.body, files });
      }
    }
  }
  folderCache.set(key, { at: ctx.now(), skills: out });
  return out;
}
export const forgetFolderSkills = (): void => { folderCache.clear(); };

// ---- what a chat with an agent sees ---------------------------------------------------------------------------------------------------------------------

/** All skills for a chat, nearest tier first, one per name. A system built-in cannot be shadowed. Off ones are left out unless `includeOff`. */
export async function visibleSkills(ctx: AgentsCtx, agentId: string | undefined, includeOff = false): Promise<Found[]> {
  ensure(ctx.db);
  const built = builtinSkills();
  const system = new Set(built.filter((b) => b.system).map((b) => b.name));
  const tiers: Found[][] = [];
  if (agentId) {
    const a = agentBy(ctx.db, agentId);
    if (a && canSee(ctx, a)) { tiers.push(await folderSkills(ctx, agentId)); tiers.push(library(ctx, agentId)); }
  }
  tiers.push(library(ctx, ""), built);
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const tier of tiers) {
    for (const s of tier) {
      if (seen.has(s.name) || (s.tier !== "builtin" && system.has(s.name))) continue;
      if (!s.enabled && !includeOff) continue;
      seen.add(s.name);
      out.push(s);
    }
  }
  return out;
}
const outOf = (f: Found): SkillOut => ({ name: f.name, description: f.description, tier: f.tier, source: f.source, system: f.system, enabled: f.enabled, bytes: f.bytes, ...(f.agentId ? { agentId: f.agentId } : {}), ...(f.updatedAt !== undefined ? { updatedAt: f.updatedAt } : {}) });

export async function skillsList(ctx: AgentsCtx, input: { agentId?: string; includeOff?: boolean }) {
  return { skills: (await visibleSkills(ctx, input.agentId, input.includeOff === true)).map(outOf) };
}

export async function skillsLoad(ctx: AgentsCtx, input: { name: string; agentId?: string }) {
  const found = (await visibleSkills(ctx, input.agentId)).find((s) => s.name === input.name.trim());
  if (!found) raise(ctx, "validation.not_found", `There is no skill called ${input.name.trim()}. Use skills_list to see the names.`, { name: input.name });
  return { skill: { name: found.name, description: found.description, tier: found.tier, source: found.source, body: found.body, files: found.files } };
}

// ---- the library, written ---------------------------------------------------------------------------------------------------------------------------------

export async function skillsAdd(ctx: AgentsCtx, input: { text: string; name?: string; agentId?: string; source?: string; files?: Record<string, string>; idempotencyKey: string }) {
  ensure(ctx.db);
  const parsed = parseSkill(input.text, input.name?.trim() || undefined);
  if (!parsed.ok) raise(ctx, "validation.bad_input", parsed.problem);
  const skill = parsed.skill;
  const agentId = input.agentId ?? "";
  if (agentId !== "") { const a = agentBy(ctx.db, agentId); if (!a || !canSee(ctx, a)) raise(ctx, "validation.not_found", "That agent does not exist."); }
  if (builtinSkills().some((b) => b.system && b.name === skill.name)) raise(ctx, "validation.duplicate", `${skill.name} is a Vyre skill and cannot be replaced. Pick another name.`);
  const files = input.files ?? {};
  let total = 0;
  for (const [p, t] of Object.entries(files)) {
    if (p.startsWith("/") || p.split("/").includes("..") || p.length > 200) raise(ctx, "validation.bad_input", `${p} is not a path inside the skill.`);
    total += Buffer.byteLength(t, "utf8");
  }
  if (total > MAX_FILES_BYTES) raise(ctx, "validation.too_large", `The supporting files are over ${MAX_FILES_BYTES / 1000} KB.`);
  const source = (input.source ?? "upload").trim() || "upload";
  const now = ctx.now();
  const old = (ctx.db.all("SELECT id, at FROM agents_skills WHERE agent_id = ? AND name = ?", agentId, skill.name) as Row[])[0];
  if (old) {
    ctx.db.run("UPDATE agents_skills SET description = ?, text = ?, files_json = ?, source = ?, enabled = 1, author = ?, updated_at = ? WHERE id = ?", skill.description, input.text, JSON.stringify(files), source, by(ctx), now, str(old["id"]));
  } else {
    ctx.db.run("INSERT INTO agents_skills (id, name, agent_id, description, text, files_json, source, enabled, author, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)", mintId("skl", now), skill.name, agentId, skill.description, input.text, JSON.stringify(files), source, by(ctx), now, now);
  }
  ctx.emit("skill.added", skill.name, { name: skill.name, tier: agentId === "" ? "space" : "agent", ...(agentId !== "" ? { agentId } : {}), source, by: by(ctx) });
  return { skill: outOf(library(ctx, agentId).find((s) => s.name === skill.name)!) };
}

export async function skillsRemove(ctx: AgentsCtx, input: { name: string; agentId?: string }) {
  ensure(ctx.db);
  const agentId = input.agentId ?? "";
  const r = ctx.db.run("DELETE FROM agents_skills WHERE agent_id = ? AND name = ?", agentId, input.name.trim());
  if (r.changes > 0) ctx.emit("skill.removed", input.name.trim(), { name: input.name.trim(), ...(agentId !== "" ? { agentId } : {}), by: by(ctx) });
  return { removed: r.changes > 0 };
}

export async function skillsSetEnabled(ctx: AgentsCtx, input: { name: string; agentId?: string; enabled: boolean }) {
  ensure(ctx.db);
  const agentId = input.agentId ?? "";
  if ((ctx.db.all("SELECT id FROM agents_skills WHERE agent_id = ? AND name = ?", agentId, input.name.trim()) as Row[]).length === 0) raise(ctx, "validation.not_found", `There is no skill called ${input.name.trim()} in the library.`);
  ctx.db.run("UPDATE agents_skills SET enabled = ?, updated_at = ? WHERE agent_id = ? AND name = ?", input.enabled ? 1 : 0, ctx.now(), agentId, input.name.trim());
  ctx.emit("skill.changed", input.name.trim(), { name: input.name.trim(), ...(agentId !== "" ? { agentId } : {}), enabled: input.enabled, by: by(ctx) });
  return { skill: outOf(library(ctx, agentId).find((s) => s.name === input.name.trim())!) };
}

export { SKILL_MAX_BYTES };
