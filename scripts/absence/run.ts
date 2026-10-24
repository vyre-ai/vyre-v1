#!/usr/bin/env node
// CLI for the not-in-v1 absence check, the ADR index check and the generated docs drift check.
//   node scripts/absence/run.ts            all three; exit 1 on any finding
// The drift check runs `node tools/gen/src/cli.ts --check`, the same command CI runs for generated/ (which holds generated/docs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAbsence, checkAdrIndex, formatFindings, inScope } from "./absence.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const errors: string[] = [];

const tracked = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const files = tracked.filter(inScope).map((path) => ({ path, text: readFileSync(join(repo, path), "utf8") }));
errors.push(...formatFindings(checkAbsence(files)));

const adrDir = join(repo, "docs/adr");
if (!existsSync(join(adrDir, "README.md"))) errors.push("adr: docs/adr/README.md is missing");
else errors.push(...checkAdrIndex({ files: readdirSync(adrDir), index: readFileSync(join(adrDir, "README.md"), "utf8") }));

const gen = join(repo, "tools/gen/src/cli.ts");
if (existsSync(gen)) {
  const run = spawnSync(process.execPath, [gen, "--check"], { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) errors.push(`generated docs: gen --check failed\n${(run.stdout + run.stderr).trim()}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`absence: ${files.length} source files clean, ADR index ok, gen --check ok`);
