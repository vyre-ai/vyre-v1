// no-noop-opt-out: the no-dead-buttons gate (scripts/click/dead-buttons.mjs) has no opt-out. A control that does nothing is a bug to fix, so a data-noop-ok attribute (or any such escape hatch) fails the build.
//   node scripts/lint/no-noop-opt-out.ts
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const BANNED = /data-noop-ok|dataNoopOk|noop-ok/;

export function findOptOuts(file: string, source: string): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  source.split("\n").forEach((l, i) => { if (BANNED.test(l)) out.push({ file, line: i + 1 }); });
  return out;
}

function main(): void {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files = spawnSync("git", ["ls-files", "apps", "ui"], { cwd: repo, encoding: "utf8" }).stdout.split("\n")
    .filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const hits = files.flatMap((f) => findOptOuts(f, fs.readFileSync(path.join(repo, f), "utf8")));
  for (const h of hits) console.log(`no-noop-opt-out ${h.file}:${h.line}: data-noop-ok is not allowed; make the control do something or remove it`);
  console.log(`no-noop-opt-out: ${hits.length} use(s) in ${files.length} files`);
  if (hits.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && !process.argv.includes("--test")) main();
