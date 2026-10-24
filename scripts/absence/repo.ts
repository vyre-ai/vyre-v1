// The repo-level run of the absence check: tracked source against the rules, the ADR index, and generated docs drift.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkAbsence, checkAdrIndex, formatFindings, inScope } from "./absence.ts";

export interface RepoCheck {
  errors: string[];
  scanned: number;
}

export function trackedFiles(repo: string): string[] {
  return spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
}

/** `runGen` runs `tools/gen --check` (the drift check for generated/, which holds generated/docs); tests leave it off. */
export function checkRepo(repo: string, options: { runGen: boolean }): RepoCheck {
  const errors: string[] = [];
  const files = trackedFiles(repo)
    .filter(inScope)
    .filter((path) => existsSync(join(repo, path)))
    .map((path) => ({ path, text: readFileSync(join(repo, path), "utf8") }));
  errors.push(...formatFindings(checkAbsence(files)));

  const adrDir = join(repo, "docs/adr");
  if (!existsSync(join(adrDir, "README.md"))) errors.push("adr: docs/adr/README.md is missing");
  else errors.push(...checkAdrIndex({ files: readdirSync(adrDir), index: readFileSync(join(adrDir, "README.md"), "utf8") }));

  const gen = join(repo, "tools/gen/src/cli.ts");
  if (options.runGen && existsSync(gen)) {
    const run = spawnSync(process.execPath, [gen, "--check"], { cwd: repo, encoding: "utf8" });
    if (run.status !== 0) errors.push(`generated docs: gen --check failed\n${(run.stdout + run.stderr).trim()}`);
  }
  return { errors, scanned: files.length };
}
