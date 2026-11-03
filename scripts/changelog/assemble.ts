// Fold changelog.d/*.md fragments into the top of changelog.md (oldest commit first) and delete them. Run on the release bump branch.
//
// A fragment may also carry a "## What's new" part: short, plain lines for the people who use Vyre, not for engineers. Those lines do not go into changelog.md; they become the release's
// What's new, apps/app/public/whats-new.json ({ version, lines }). The app shows them once after it updates (apps/app/src/startup/update), the web export carries the file, and the release's
// desktop feed publishes them as its notes (scripts/release/updater.ts). Three to six lines, no em dashes, no jargon.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Where the release's What's new is kept, relative to the repo root. `cli.ts bump` stamps its version with the rest. */
export const WHATS_NEW_FILE = "apps/app/public/whats-new.json";
export const WHATS_NEW_MAX = 6;
export const WHATS_NEW_LINE_MAX = 140;
const EM_DASH = String.fromCharCode(0x2014);

export interface WhatsNew { version: string; lines: string[] }

const isWhatsNewHeading = (l: string): boolean => /^#{1,6}\s+what['’]s new\s*$/i.test(l.trim());

/** A fragment's lines, split into changelog entries and What's new lines (without their "- "). */
export function splitFragment(text: string): { entries: string[]; whatsNew: string[] } {
  const entries: string[] = [];
  const whatsNew: string[] = [];
  let inWhatsNew = false;
  for (const l of text.split("\n")) {
    if (/^#{1,6}\s/.test(l)) { inWhatsNew = isWhatsNewHeading(l); continue; }
    if (!l.startsWith("- ")) continue;
    if (inWhatsNew) whatsNew.push(l.slice(2).trim());
    else entries.push(l);
  }
  return { entries, whatsNew };
}

/** What a What's new line must be: words for a person, short, with no em dash. Returns the problems. */
export function whatsNewProblems(lines: readonly string[]): string[] {
  const out: string[] = [];
  if (lines.length > WHATS_NEW_MAX) out.push(`What's new has ${lines.length} lines; keep it to ${WHATS_NEW_MAX} at most`);
  for (const l of lines) {
    if (l.includes(EM_DASH)) out.push(`"${l}" has an em dash`);
    if (l.length > WHATS_NEW_LINE_MAX) out.push(`"${l.slice(0, 40)}..." is longer than ${WHATS_NEW_LINE_MAX} characters`);
    if (l === "") out.push("a What's new line is empty");
  }
  return out;
}

function rootVersion(root: string): string {
  try { const v = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown }).version; return typeof v === "string" ? v : "0.0.0"; } catch { return "0.0.0"; }
}

export function assemble(root: string, order: (file: string) => number = () => 0): { added: number; whatsNew: number } {
  const dir = path.join(root, "changelog.d");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md") : [];
  if (files.length === 0) return { added: 0, whatsNew: 0 };
  const sorted = files.map((f) => path.join(dir, f)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const parts = sorted.map((f) => ({ f, ...splitFragment(fs.readFileSync(f, "utf8")) }));
  for (const p of parts) if (p.entries.length === 0 && p.whatsNew.length === 0) throw new Error(`${p.f} has no "- " line: its entry would be lost`);
  const lines = parts.flatMap((p) => p.entries);
  const whatsNew = parts.flatMap((p) => p.whatsNew);
  const problems = whatsNewProblems(whatsNew);
  if (problems.length > 0) throw new Error(`changelog.d What's new: ${problems.join("; ")}`);
  const file = path.join(root, "changelog.md");
  const text = fs.readFileSync(file, "utf8");
  const head = "# Changelog\n\n";
  if (!text.startsWith(head)) throw new Error("changelog.md must start with '# Changelog' and a blank line");
  if (lines.length > 0) fs.writeFileSync(file, head + lines.join("\n") + "\n" + text.slice(head.length));
  // Every release has its own What's new, empty when no fragment wrote one: last release's lines never show again.
  const wn = path.join(root, WHATS_NEW_FILE);
  fs.mkdirSync(path.dirname(wn), { recursive: true });
  fs.writeFileSync(wn, `${JSON.stringify({ version: rootVersion(root), lines: whatsNew } satisfies WhatsNew, null, 2)}\n`);
  for (const f of sorted) fs.unlinkSync(f);
  return { added: lines.length, whatsNew: whatsNew.length };
}

function firstCommitTime(root: string, file: string): number {
  try { return Number(execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", file], { cwd: root, encoding: "utf8" }).trim()) || 0; } catch { return 0; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const { added, whatsNew } = assemble(root, (f) => firstCommitTime(root, f));
  console.log(`changelog: ${added} entr${added === 1 ? "y" : "ies"} added from changelog.d; What's new has ${whatsNew} line${whatsNew === 1 ? "" : "s"} (${WHATS_NEW_FILE})`);
  if (whatsNew > 0 && whatsNew < 3) console.log("changelog: What's new reads best with 3 to 6 lines");
}
