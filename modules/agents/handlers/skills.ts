// agents: skills (CHAT-DESIGN ruling 4). A skill is a SKILL.md in the open format (lib/skill-md.ts). Three tiers, nearest first:
//   agent   the agent's own skills/<name>/SKILL.md in its Files folder (it writes these itself, computers.skill_from_step writes there) and what a plugin installed into that one agent brings
//   space   the Space library an admin keeps in Settings (skills.add / skills.remove)
//   builtin the files shipped in agent/skills, read from disk; `system: true` ones cannot be hidden or replaced
// A turn shows the index (name and one line) and load_skill returns the full text. Reads run as the asker, so the agent folder is only read when the asker may see it.
// Two skills with one name are both listed: the nearer one is used and says what it wins over, the other says what it loses to. A row that cannot be read is listed as broken and left out of
// every turn; the rest of the list still answers. A Kit never replaces a skill it did not install, and undoing a Kit removes only its own.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { parseSkill, SKILL_MAX_BYTES } from "../../../lib/skill-md.ts";
import { agentBy, askerOf, canSee, ensure, mintId, raise, tolerant } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export type Tier = "builtin" | "space" | "agent";
export interface SkillOut {
  name: string; description: string; tier: Tier; source: string; agentId?: string; system: boolean; enabled: boolean; bytes: number; updatedAt?: number;
  /** A fingerprint of the text and supporting files: a CLI engine's copy is written again only when it changes. */
  hash: string;
  /** Another skill of this name is used instead (the nearer tier, or a Vyre system skill). */
  shadowedBy?: Tier;
  /** Why it is used or not, when another skill has the same name. */
  note?: string;
  /** Why this row cannot be used. It stays listed so it can be fixed or removed, and is never in a turn. */
  broken?: string;
}
interface Found extends SkillOut { text: string; body: string; files: Array<{ path: string; text: string }> }

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const by = (ctx: AgentsCtx): string => askerOf(ctx);
export const MAX_FILES_BYTES = 400_000;
const BUILTIN = new URL("../../../agent/skills/", import.meta.url);
const fingerprint = (text: string, files: ReadonlyArray<{ path: string; text: string }>): string => sha256Hex(text, "\0", JSON.stringify(files)).slice(0, 16);

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
/** The shipped skills change only with an update, and every turn reads them: kept for a short while so a turn does not read the folder four times. */
const BUILTIN_MS = 30_000;
const builtinCache = new Map<string, { at: number; skills: Found[] }>();
export function builtinSkills(root: URL = BUILTIN): Found[] {
  const hit = builtinCache.get(root.href);
  if (hit && Date.now() - hit.at < BUILTIN_MS) return hit.skills;
  const skills = readBuiltins(root);
  builtinCache.set(root.href, { at: Date.now(), skills });
  return skills;
}
function readBuiltins(root: URL): Found[] {
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
    const files = supporting(dir);
    out.push({
      name: r.skill.name, description: r.skill.description, tier: "builtin", source: "vyre", system: r.skill.meta["system"] === true, enabled: true, bytes: Buffer.byteLength(text, "utf8"),
      text, body: r.skill.body, files, hash: fingerprint(text, files), ...(at !== undefined ? { updatedAt: at } : {}),
    });
  }
  return out;
}

// ---- the library ------------------------------------------------------------------------------------------------------------------------------------------

/** One library row. A row that cannot be read (its files are not valid JSON, its text does not parse, it has no name) is still answered, marked broken, so one bad row never breaks the list. */
function fromRow(r: Row): Found {
  const agentId = str(r["agent_id"]);
  const name = str(r["name"]);
  const text = str(r["text"]);
  let broken: string | undefined;
  let files: Array<{ path: string; text: string }> = [];
  try {
    const raw = r["files_json"] === null || r["files_json"] === undefined || str(r["files_json"]) === "" ? {} : JSON.parse(str(r["files_json"])) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.values(raw).some((v) => typeof v !== "string")) throw new Error("not a map of path to text");
    files = Object.entries(raw as Record<string, string>).map(([path, t]) => ({ path, text: t }));
  } catch { broken = "Its supporting files cannot be read. Remove it and add it again."; }
  const parsed = parseSkill(text, name || undefined);
  if (!parsed.ok) broken ??= `Its SKILL.md cannot be read: ${parsed.problem}`;
  if (name.trim() === "") broken ??= "It has no name.";
  const updated = Number(r["updated_at"]);
  return {
    name, description: str(r["description"]), tier: agentId === "" ? "space" : "agent", source: str(r["source"]), system: false, enabled: Number(r["enabled"]) === 1,
    bytes: Buffer.byteLength(text, "utf8"), ...(Number.isFinite(updated) ? { updatedAt: updated } : {}), text, body: parsed.ok ? parsed.skill.body : text,
    files, hash: fingerprint(text, files), ...(agentId === "" ? {} : { agentId }), ...(broken ? { broken } : {}),
  };
}
const library = (ctx: AgentsCtx, agentId: string): Found[] => (ctx.db.all("SELECT * FROM agents_skills WHERE agent_id = ? ORDER BY name", agentId) as Row[]).flatMap((r) => {
  try { return [fromRow(r)]; } catch (e) {
    ctx.log.warn("agents: a skill row could not be read", { name: str(r["name"]), error: e instanceof Error ? e.message : String(e) });
    return [];
  }
});

// ---- the agent's own folder -------------------------------------------------------------------------------------------------------------------------------

interface FolderRow { folderId: string; name: string }
interface FileRow { fileId: string; name: string; version?: number }
const CACHE_MS = 8_000;
const folderCache = new Map<string, { at: number; skills: Found[] }>();
/** The text of a file at one version, for the one reading it: the index reads the folder every turn, and a file is read again only when it changed. Bounded; the oldest goes first. */
const textCache = new Map<string, string>();
const TEXT_CACHE_MAX = 500;
async function fileText(ctx: AgentsCtx, f: FileRow): Promise<string | undefined> {
  const key = `${ctx.space}:${askerOf(ctx)}:${f.fileId}:${f.version ?? "?"}`;
  const hit = f.version !== undefined ? textCache.get(key) : undefined;
  if (hit !== undefined) return hit;
  const text = (await tolerant<{ text?: string }>(ctx, "files.read", { fileId: f.fileId, as: "text" }, {})).text;
  if (typeof text === "string" && f.version !== undefined) {
    textCache.set(key, text);
    if (textCache.size > TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value as string);
  }
  return typeof text === "string" ? text : undefined;
}
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
        const text = await fileText(ctx, md);
        if (typeof text !== "string") continue;
        const r = parseSkill(text, sub.name);
        if (!r.ok) {
          // a SKILL.md the agent wrote that does not parse is listed as broken, so it can be seen and fixed; it is never in a turn
          out.push({ name: sub.name, description: "", tier: "agent", source: "agent", agentId, system: false, enabled: true, bytes: Buffer.byteLength(text, "utf8"), text, body: text, files: [], hash: fingerprint(text, []), broken: `Its SKILL.md cannot be read: ${r.problem}` });
          continue;
        }
        const files: Array<{ path: string; text: string }> = [];
        for (const f of (inner.files ?? []).filter((x) => x.name !== "SKILL.md" && TEXT.test(x.name)).slice(0, 10)) {
          const t = await fileText(ctx, f);
          if (typeof t === "string") files.push({ path: f.name, text: t });
        }
        out.push({ name: r.skill.name, description: r.skill.description, tier: "agent", source: "agent", agentId, system: false, enabled: true, bytes: Buffer.byteLength(text, "utf8"), text, body: r.skill.body, files, hash: fingerprint(text, files) });
      }
    }
  }
  folderCache.set(key, { at: ctx.now(), skills: out });
  return out;
}
export const forgetFolderSkills = (): void => { folderCache.clear(); textCache.clear(); builtinCache.clear(); };

// ---- what a chat with an agent sees ---------------------------------------------------------------------------------------------------------------------

const TIER_WORDS: Readonly<Record<Tier, string>> = { agent: "the agent's own", space: "the Space's", builtin: "Vyre's built-in" };

/**
 * Every skill a chat with this agent can see, nearest tier first (the agent's folder, the agent's library, the Space library, built-in), with the ones that lose a name to a nearer one still listed and
 * marked. A system built-in cannot be shadowed: a library skill with its name loses to it. Off ones are left out unless `includeOff`; broken ones are listed, marked, and never used.
 */
async function allSkills(ctx: AgentsCtx, agentId: string | undefined, includeOff: boolean): Promise<Found[]> {
  ensure(ctx.db);
  const built = builtinSkills();
  const system = new Set(built.filter((b) => b.system).map((b) => b.name));
  const tiers: Found[][] = [];
  if (agentId) {
    const a = agentBy(ctx.db, agentId);
    if (a && canSee(ctx, a)) { tiers.push(await folderSkills(ctx, agentId)); tiers.push(library(ctx, agentId)); }
  }
  tiers.push(library(ctx, ""), built);
  const listed = tiers.flat().filter((s) => s.enabled || includeOff);
  const used = new Map<string, Found>();
  for (const s of listed) {
    if (s.broken || !s.enabled) continue;
    if (s.tier !== "builtin" && system.has(s.name)) continue;
    if (!used.has(s.name)) used.set(s.name, s);
  }
  return listed.map((s) => {
    const winner = used.get(s.name);
    if (winner === s) {
      const others = listed.filter((o) => o !== s && o.name === s.name && !o.broken && o.enabled);
      if (others.length === 0) return s;
      const losers = others.map((o) => TIER_WORDS[o.tier]).filter((w, i, all) => all.indexOf(w) === i).join(" and ");
      return { ...s, note: `Used here. ${losers.charAt(0).toUpperCase()}${losers.slice(1)} ${others.length === 1 ? "skill" : "skills"} of this name ${others.length === 1 ? "is" : "are"} not.` };
    }
    if (!winner || s.broken || !s.enabled) return s;
    return { ...s, shadowedBy: winner.tier, note: `Not used here: ${TIER_WORDS[winner.tier]} skill of this name is used instead${winner.system ? " (a Vyre system skill cannot be replaced)" : ""}.` };
  });
}

/** The skills a chat with an agent uses: one per name, the nearest tier, never a broken or switched-off one. */
export async function visibleSkills(ctx: AgentsCtx, agentId: string | undefined): Promise<Found[]> {
  return (await allSkills(ctx, agentId, false)).filter((s) => !s.broken && !s.shadowedBy && s.enabled);
}
const outOf = (f: Found): SkillOut => ({
  name: f.name, description: f.description, tier: f.tier, source: f.source, system: f.system, enabled: f.enabled, bytes: f.bytes, hash: f.hash, ...(f.agentId ? { agentId: f.agentId } : {}),
  ...(f.updatedAt !== undefined ? { updatedAt: f.updatedAt } : {}), ...(f.shadowedBy ? { shadowedBy: f.shadowedBy } : {}), ...(f.note ? { note: f.note } : {}), ...(f.broken ? { broken: f.broken } : {}),
});

/** An agent that asks without naming an agent means itself: its own skills are in its list and load without it repeating its id. */
const agentOf = (ctx: AgentsCtx, agentId: string | undefined): string | undefined => agentId ?? (ctx.principal.kind === "agent" ? ctx.principal.id : undefined);

export async function skillsList(ctx: AgentsCtx, input: { agentId?: string; includeOff?: boolean }) {
  return { skills: (await allSkills(ctx, agentOf(ctx, input.agentId), input.includeOff === true)).map(outOf) };
}

export async function skillsLoad(ctx: AgentsCtx, input: { name: string; agentId?: string }) {
  const found = (await visibleSkills(ctx, agentOf(ctx, input.agentId))).find((s) => s.name === input.name.trim());
  if (!found) raise(ctx, "validation.not_found", `There is no skill called ${input.name.trim()}. Use skills_list to see the names.`, { name: input.name });
  return { skill: { name: found.name, description: found.description, tier: found.tier, source: found.source, body: found.body, files: found.files, text: found.text, hash: found.hash } };
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
  const old = (ctx.db.all("SELECT id, at, source FROM agents_skills WHERE agent_id = ? AND name = ?", agentId, skill.name) as Row[])[0];
  // a Kit adds its skills and replaces its own, never one that someone added or another Kit brought: theirs stays, and the Kit's undo (which names its source) leaves it alone
  if (old && source.startsWith("kit:") && str(old["source"]) !== source) {
    const kept = library(ctx, agentId).find((s) => s.name === skill.name);
    if (kept) return { skill: outOf(kept), kept: true, note: `A skill called ${skill.name} is already here (${str(old["source"]) || "added by hand"}). It was kept, and the Kit's copy was not added.` };
  }
  if (old) {
    ctx.db.run("UPDATE agents_skills SET description = ?, text = ?, files_json = ?, source = ?, enabled = 1, author = ?, updated_at = ? WHERE id = ?", skill.description, input.text, JSON.stringify(files), source, by(ctx), now, str(old["id"]));
  } else {
    ctx.db.run("INSERT INTO agents_skills (id, name, agent_id, description, text, files_json, source, enabled, author, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)", mintId("skl", now), skill.name, agentId, skill.description, input.text, JSON.stringify(files), source, by(ctx), now, now);
  }
  ctx.emit("skill.added", skill.name, { name: skill.name, tier: agentId === "" ? "space" : "agent", ...(agentId !== "" ? { agentId } : {}), source, by: by(ctx) });
  return { skill: outOf(library(ctx, agentId).find((s) => s.name === skill.name)!) };
}

/** `source` limits the removal to the copy that source added: a Kit's undo names its own, so a skill of the same name someone else added is never removed with it. */
export async function skillsRemove(ctx: AgentsCtx, input: { name: string; agentId?: string; source?: string }) {
  ensure(ctx.db);
  const agentId = input.agentId ?? "";
  const r = input.source !== undefined
    ? ctx.db.run("DELETE FROM agents_skills WHERE agent_id = ? AND name = ? AND source = ?", agentId, input.name.trim(), input.source)
    : ctx.db.run("DELETE FROM agents_skills WHERE agent_id = ? AND name = ?", agentId, input.name.trim());
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
