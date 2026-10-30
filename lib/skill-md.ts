// SKILL.md, the open skill format (Claude Code skills, agentskills.io): a Markdown file that opens with YAML front matter between two `---` lines, then the instructions.
// Front matter keys Vyre reads: name and description. `system: true` marks one that ships with Vyre. Every other key (allowed-tools, license, metadata ...) is kept and ignored, as the
// open format says. The YAML subset here is what skill files use: scalars, quoted strings, `|` and `>` blocks, inline lists and `- item` lists, one level of nested keys.

export interface SkillFile {
  name: string;
  description: string;
  /** The front matter as parsed, for the keys Vyre does not read. */
  meta: Record<string, unknown>;
  /** The instructions, without the front matter. */
  body: string;
}

const FRONT = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** A skill name: what becomes `load_skill("name")` and a `/name` command. Letters, digits, dash, underscore, dot and colon (a plugin prefix), 1 to 64 characters. */
export const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const SKILL_MAX_BYTES = 100_000;
/** Longest description the index keeps (the open format truncates a listing at 1,536 characters). */
export const DESCRIPTION_MAX = 1536;

function scalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "") return "";
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2)) {
    try { return JSON.parse(s) as unknown; } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s === "true" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "no" || s === "off") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith("[") && s.endsWith("]")) return s.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== "");
  return s;
}

/** Parses the YAML subset of a front matter block. Lines it cannot read are skipped, so a skill with one odd line still loads (the open format does the same). */
export function parseFrontMatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_.-]*):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const rest = m[2]!.trim();
    const indented: string[] = [];
    while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "" || /^-\s/.test(lines[i + 1]!))) {
      if (lines[i + 1]!.trim() === "" && !(lines[i + 2] !== undefined && (/^[ \t]/.test(lines[i + 2]!) || /^-\s/.test(lines[i + 2]!)))) break;
      indented.push(lines[++i]!);
    }
    if (/^[|>][+-]?$/.test(rest)) {
      const pad = Math.min(...indented.filter((l) => l.trim() !== "").map((l) => /^[ \t]*/.exec(l)![0].length), Infinity);
      const body = indented.map((l) => (pad === Infinity ? l : l.slice(pad)));
      out[key] = rest.startsWith("|") ? body.join("\n").replace(/\n+$/, "") : body.join(" ").replace(/\s+/g, " ").trim();
    } else if (rest === "" && indented.length > 0) {
      const items = indented.filter((l) => /^\s*-\s/.test(l));
      if (items.length > 0) out[key] = items.map((l) => scalar(l.replace(/^\s*-\s+/, "")));
      else out[key] = parseFrontMatter(indented.map((l) => l.replace(/^[ \t]{1,4}/, "")).join("\n"));
    } else if (rest === "" && indented.length === 0) {
      out[key] = "";
    } else {
      out[key] = indented.length > 0 && !rest.startsWith("[") && !rest.startsWith('"') && !rest.startsWith("'") ? [rest, ...indented.map((l) => l.trim())].join(" ") : scalar(rest);
    }
  }
  return out;
}

export interface SkillProblem { message: string }

/**
 * Reads a SKILL.md. `fallbackName` is the folder name, used when the front matter has no `name` (the open format defaults to the directory name). Returns the problem when the text is not a skill.
 */
export function parseSkill(text: string, fallbackName?: string): { ok: true; skill: SkillFile } | { ok: false; problem: string } {
  if (Buffer.byteLength(text, "utf8") > SKILL_MAX_BYTES) return { ok: false, problem: `A skill is at most ${SKILL_MAX_BYTES / 1000} KB of text.` };
  const m = FRONT.exec(text);
  const meta = m ? parseFrontMatter(m[1]!) : {};
  const body = m ? text.slice(m[0].length) : text;
  const name = typeof meta["name"] === "string" && meta["name"].trim() !== "" ? meta["name"].trim() : (fallbackName ?? "");
  if (name === "") return { ok: false, problem: "The skill has no name. Start the file with a --- front matter block that has name: and description:." };
  if (!SKILL_NAME.test(name)) return { ok: false, problem: `"${name}" is not a skill name. Use letters, digits, dash and underscore, up to 64 characters.` };
  let description = typeof meta["description"] === "string" ? meta["description"].trim() : "";
  if (description === "") description = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l !== "") ?? "";
  if (description === "") return { ok: false, problem: "The skill has no description. Say what it does and when to use it." };
  const when = typeof meta["when_to_use"] === "string" ? meta["when_to_use"].trim() : "";
  if (when !== "") description = `${description} ${when}`;
  if (description.length > DESCRIPTION_MAX) description = `${description.slice(0, DESCRIPTION_MAX - 1)}…`;
  return { ok: true, skill: { name, description, meta, body: body.replace(/^\r?\n+/, "") } };
}

/** The text of a SKILL.md for a name, a description and instructions (used when a skill is made from a plugin command or an agent definition). */
export function skillText(name: string, description: string, body: string, extra: Record<string, string> = {}): string {
  const q = (s: string): string => JSON.stringify(s.replace(/\s+/g, " ").trim());
  const lines = ["---", `name: ${name}`, `description: ${q(description)}`, ...Object.entries(extra).map(([k, v]) => `${k}: ${q(v)}`), "---", "", body.replace(/^\n+/, "")];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** The same SKILL.md under another name: the front matter `name:` line is replaced, or added when there is none. Everything else is kept as written. */
export function withSkillName(text: string, name: string): string {
  const m = FRONT.exec(text);
  if (!m) {
    const r = parseSkill(text, name);
    return skillText(name, r.ok ? r.skill.description : name, text);
  }
  const block = m[1]!;
  const next = /^name:.*$/m.test(block) ? block.replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${block}`;
  return `---\n${next}\n---\n${text.slice(m[0].length)}`;
}
