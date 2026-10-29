// Fold changelog.d/*.md fragments into the top of changelog.md (oldest commit first) and delete them. Run on the release bump branch.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function assemble(root: string, order: (file: string) => number = () => 0): { added: number } {
  const dir = path.join(root, "changelog.d");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md") : [];
  if (files.length === 0) return { added: 0 };
  const sorted = files.map((f) => path.join(dir, f)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const lines = sorted.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("- ")));
  const file = path.join(root, "changelog.md");
  const text = fs.readFileSync(file, "utf8");
  const head = "# Changelog\n\n";
  if (!text.startsWith(head)) throw new Error("changelog.md must start with '# Changelog' and a blank line");
  fs.writeFileSync(file, head + lines.join("\n") + "\n" + text.slice(head.length));
  for (const f of sorted) fs.unlinkSync(f);
  return { added: lines.length };
}

function firstCommitTime(root: string, file: string): number {
  try { return Number(execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", file], { cwd: root, encoding: "utf8" }).trim()) || 0; } catch { return 0; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const { added } = assemble(root, (f) => firstCommitTime(root, f));
  console.log(`changelog: ${added} entr${added === 1 ? "y" : "ies"} added from changelog.d`);
}
