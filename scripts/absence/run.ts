#!/usr/bin/env node
// CLI: node scripts/absence/run.ts   (exit 1 on any finding). Logic and tests: repo.ts, absence.ts.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepo } from "./repo.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const result = checkRepo(repo, { runGen: true });
if (result.errors.length > 0) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}
console.log(`absence: ${result.scanned} source files clean, ADR index ok, gen --check ok`);
