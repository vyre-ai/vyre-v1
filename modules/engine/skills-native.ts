// Skills on a Claude Code or Codex chat, natively (CHAT-DESIGN ruling 4; skills audit change 6): the skills this agent uses for the person asking are written into the chat's work folder where the CLI
// looks for its own, so it lists them, picks one by its description and runs its scripts from beside it. Claude Code reads `.claude/skills/<name>/SKILL.md` in its folder; Codex reads
// `.agents/skills/<name>/SKILL.md`. Each skill comes with its supporting files.
//   - What is written: the Space's skills, the agent's library and the agent's own skills/ folder (and a person's own skills once that tier exists): every skill skills.list says this chat uses,
//     except Vyre's built-ins (the turn index and load_skill carry those; they are Vyre's manual, not the engine's) and plugin skills (plugin-native.ts writes the plugin itself).
//   - When: as the engine starts (before its first turn) and again before every turn, so a skill added or changed mid-chat reaches a long-running Claude Code. A fingerprint of the set is kept beside
//     the skills: a turn whose skills did not change reads one list and writes nothing.
//   - What is never touched: a folder Vyre did not write (a repository's own .claude/skills/<name> in a crew copy stays as it is, and a Vyre skill of that name is left out). In a git work folder the
//     written folders are kept out of what the teammate commits.
// The work folder is one person's one chat, so nothing here reaches another person. Reads run as the asker.
// CHECKED on a build box, 3 Nov 2026, with the real binaries and the argv the drivers build (Ask first, a granted work folder, a fake model API): Claude Code 2.1.316 lists .claude/skills/<name> of its
// folder and a --plugin-dir's skills under "The following skills are available for use with the Skill tool", offers Skill, opens one headless without a prompt ("Launching skill: ..."), and lists
// a skill written between two turns of the same process on the next turn. Codex 0.166 lists .agents/skills/<name> of its folder in its skills instructions, with no git repository there.
import fs from "node:fs";
import path from "node:path";
import { sha256Hex } from "../../kernel/src/log/hash.ts";
import type { EngineSession, OpenSession, SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

export type NativeSkillDriver = "claude_code" | "codex";
export interface NativeSkillsDeps { call(cap: string, input: unknown, as?: string): Promise<unknown>; log?(msg: string, attrs?: Record<string, unknown>): void }

/** Where each CLI looks for skills inside its work folder. */
export const SKILL_BASES: Readonly<Record<NativeSkillDriver, string>> = { claude_code: ".claude/skills", codex: ".agents/skills" };
/** The file beside the written skills that says which folders Vyre wrote and for which set. */
export const NATIVE_MANIFEST = ".vyre-skills.json";

interface Row { name?: unknown; tier?: unknown; source?: unknown; hash?: unknown; shadowedBy?: unknown; broken?: unknown; enabled?: unknown }
interface Manifest { fingerprint: string; dirs: string[] }

/** Windows' reserved device names: a file or folder named one of them (with any extension) opens the device, not a file. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i;

/**
 * A skill name as a folder name a CLI accepts: lowercase letters, digits and hyphens, at most 64 (40 on Windows, to keep paths short: the CLIs name a skill by its front matter, not its folder),
 * never a name Windows keeps for a device (con, nul, com1: "con-skill").
 */
export function skillDir(name: string, platform: NodeJS.Platform = process.platform): string {
  const max = platform === "win32" ? 40 : 64;
  let d = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "skill";
  if (platform === "win32") d = d.replace(/-+$/, "") || "skill";
  return RESERVED.test(d) ? `${d.slice(0, max - 6)}-skill` : d;
}

/**
 * A skill's supporting file as it is written under the skill's folder, or null when it may not be: outside the folder, the folder itself, or SKILL.md in any case (the skill's own text is written from
 * the skill; a "skill.md" beside it would replace it on a Mac's or a Windows disk, where case does not count). On Windows each part of the path is made a name Windows can hold: the characters it
 * refuses (: * ? " < > |, control characters) become "_", trailing dots and spaces go, and a device name (con, nul, com1, lpt1 with any extension) gets "_" in front.
 */
export function skillFile(rel: string, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === "win32";
  const parts = rel.split(win ? /[\\/]+/ : /\/+/).filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === "..")) return null;
  const clean = win ? parts.map((p) => {
    const q = p.replace(/[\u0000-\u001f:*?"<>|]/g, "_").replace(/[. ]+$/, "") || "_";
    return RESERVED.test(q) ? `_${q}` : q;
  }) : parts;
  const out = clean.join(win ? "\\" : "/");
  if (out.toLowerCase() === "skill.md") return null;
  return out;
}

/**
 * Windows: whether a file can be written where every engine and tool reads it. Vyre does not count on long-path support in programs it does not own (a skill's scripts run under whatever
 * tools the person has), so a file at 260 characters or more, or in a folder at 248 or more, is left out and logged. The short work layout (sandbox.ts) keeps Vyre's own part of the
 * path near 100 characters, which leaves a skill's own file paths room. Elsewhere every path fits.
 */
export const WIN_MAX_FILE = 259;
export function fitsPath(file: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32" || (file.length <= WIN_MAX_FILE && path.win32.dirname(file).length < 248);
}

function readManifest(base: string): Manifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(base, NATIVE_MANIFEST), "utf8")) as Partial<Manifest>;
    return typeof m.fingerprint === "string" && Array.isArray(m.dirs) ? { fingerprint: m.fingerprint, dirs: m.dirs.filter((d): d is string => typeof d === "string" && skillDir(d) === d) } : null;
  } catch { return null; }
}

/** Keeps the written folders out of a git work folder's changes (a crew teammate's copy of a repository). Idempotent. */
function excludeFromGit(work: string, rel: string[]): void {
  const git = path.join(work, ".git");
  if (!fs.existsSync(git) || !fs.statSync(git).isDirectory()) return;
  const file = path.join(git, "info", "exclude");
  let have = "";
  try { have = fs.readFileSync(file, "utf8"); } catch { /* none yet */ }
  const lines = new Set(have.split("\n"));
  const add = rel.map((r) => `/${r}`).filter((l) => !lines.has(l));
  if (add.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${have === "" || have.endsWith("\n") ? "" : "\n"}${add.join("\n")}\n`);
}

/**
 * Writes the skills this agent uses for this person into `work` for `driver`. Returns what it did: "same" when the set had not changed (nothing written), or the folder names written.
 * Throws only when the list cannot be read; the caller logs it and the turn goes on with the index and load_skill.
 */
export async function syncNativeSkills(d: NativeSkillsDeps, driver: NativeSkillDriver, agentId: string, asker: string, work: string): Promise<{ written: string[] } | "same"> {
  const rows = (((await d.call("skills.list", { agentId }, asker)) as { skills?: Row[] } | null)?.skills ?? [])
    .filter((r) => typeof r.name === "string" && r.name !== "" && r.tier !== "builtin" && !String(r.source ?? "").startsWith("plugin:") && r.shadowedBy === undefined && r.broken === undefined && r.enabled !== false);
  const fingerprint = sha256Hex(JSON.stringify(rows.map((r) => [r.name, r.hash ?? ""]).sort())).slice(0, 24);
  const base = path.join(work, SKILL_BASES[driver]);
  const before = readManifest(base);
  if (before?.fingerprint === fingerprint) return "same";
  if (rows.length === 0 && before === null) return "same";   // no skills and none written before: the folder is left as it is, with nothing added
  fs.mkdirSync(base, { recursive: true });
  // the folders Vyre wrote last time go; anything else in the folder is the repository's or the person's, and stays
  for (const dir of before?.dirs ?? []) fs.rmSync(path.join(base, dir), { recursive: true, force: true });
  const written: string[] = [];
  for (const r of rows) {
    const dir = skillDir(String(r.name));
    if (written.includes(dir) || fs.existsSync(path.join(base, dir))) continue;   // a folder of that name that Vyre did not write is not replaced
    let skill: { text?: string; body?: string; description?: string; name?: string; files?: Array<{ path: string; text: string }> } | undefined;
    try { skill = ((await d.call("skills.load", { name: r.name, agentId }, asker)) as { skill?: typeof skill }).skill; } catch { continue; }
    if (!skill) continue;
    const root = path.join(base, dir);
    const text = typeof skill.text === "string" && skill.text !== "" ? skill.text : `---\nname: ${dir}\ndescription: ${JSON.stringify(skill.description ?? "")}\n---\n\n${skill.body ?? ""}`;
    // each write on its own: a file the disk refuses (a name, a path too long, a full disk) loses that file, or that one skill when it is SKILL.md, and never the others
    try {
      if (!fitsPath(path.join(root, "SKILL.md"))) throw new Error("the path is too long for Windows");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "SKILL.md"), text, { mode: 0o644 });
    } catch (e) { d.log?.("a skill could not be written for the engine", { skill: dir, error: e instanceof Error ? e.message : String(e) }); fs.rmSync(root, { recursive: true, force: true }); continue; }
    for (const f of skill.files ?? []) {
      const rel = typeof f.path === "string" ? skillFile(f.path) : null;
      if (rel === null || typeof f.text !== "string") continue;
      const abs = path.join(root, rel);
      try {
        if (!fitsPath(abs)) throw new Error("the path is too long for Windows");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.text, { mode: /\.(sh|py)$/.test(f.path) || f.path.startsWith("scripts/") ? 0o755 : 0o644 });
      } catch (e) { d.log?.("a skill's file could not be written for the engine", { skill: dir, file: rel, error: e instanceof Error ? e.message : String(e) }); }
    }
    written.push(dir);
  }
  fs.writeFileSync(path.join(base, NATIVE_MANIFEST), JSON.stringify({ fingerprint, dirs: written } satisfies Manifest), { mode: 0o644 });
  excludeFromGit(work, [...written.map((w) => `${SKILL_BASES[driver]}/${w}/`), `${SKILL_BASES[driver]}/${NATIVE_MANIFEST}`]);
  return { written };
}

const nativeDriver = (spec: SessionSpec): NativeSkillDriver | null => {
  const id = spec.account?.driver;
  return (id === "claude_code" || id === "codex") && spec.tools !== "none" ? id : null;
};

/**
 * An OpenSession whose Claude Code and Codex sessions get the agent's skills written into their work folder before every turn (the opener writes them once as the engine starts). Only a change writes:
 * the fingerprint is read first. A failure never holds the turn.
 */
export function withNativeSkills(open: OpenSession, d: NativeSkillsDeps & { workOf(spec: SessionSpec): string | null }): OpenSession {
  return async (spec) => {
    const session = await open(spec);
    const driver = nativeDriver(spec);
    if (!driver) return session;
    return Object.create(session, {
      send: {
        value: (input: TurnInput) => (async function* () {
          try {
            const work = d.workOf(spec);
            if (work) await syncNativeSkills(d, driver, input.agent.id, input.asker, work);
          } catch (e) { d.log?.("the skills could not be written for the engine", { threadId: input.threadId, error: e instanceof Error ? e.message : String(e) }); }
          yield* session.send(input);
        })(),
        // a wrapper around this one (a Proxy) may replace send in turn
        writable: true, configurable: true,
      },
    }) as EngineSession;
  };
}
