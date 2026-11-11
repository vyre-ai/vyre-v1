// Hidden skips (issue 908). A test file that is not named *.heavy.test.ts and gates a test on an environment flag (process.env.NAME === "1") only runs where something sets that flag.
// The slow shards run these files without it, so the gated tests are skipped and the shard still passes. Every such file must be named, by its path, in a workflow job that sets the flag.
// A flag that only switches a mode (it rewrites a baseline, it makes a missing browser fail) gates nothing and is listed in MODES below, with the reason, when its message happens to quote NAME=1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wfDir = path.join(root, ".github/workflows");

/** Flags that gate no test: they switch a mode. */
const MODES: Record<string, string> = { UPDATE_SHARED_TIME: "rewrites scripts/lint/shared-time.baseline.json; the test runs either way" };

type Job = { file: string; name: string; text: string };

/** The jobs of every workflow: two-space job keys under jobs:, as scripts/workflows.test.ts reads them. */
export function jobsOf(files: Array<{ file: string; text: string }>): Job[] {
  const out: Job[] = [];
  for (const f of files) {
    const lines = f.text.split("\n");
    const start = lines.findIndex((l) => l === "jobs:");
    let cur: { name: string; body: string[] } | null = null;
    const flush = (): void => { if (cur) out.push({ file: f.file, name: cur.name, text: cur.body.join("\n") }); };
    for (const l of start < 0 ? [] : lines.slice(start + 1)) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
      if (m) { flush(); cur = { name: m[1]!, body: [] }; } else cur?.body.push(l);
    }
    flush();
  }
  return out;
}

/**
 * The flags a test file skips on: it compares the flag with "1" (process.env["NAME"] === "1" or process.env.NAME === "1") and says so in a skip reason, a quoted string holding NAME=1 ("needs NAME=1 ...").
 * A flag that only switches a mode (VYRE_REQUIRE_CHROME makes a missing browser fail, VYRE_GOLDEN_WRITE rewrites a file) has no such string and is not a skip gate.
 */
export function flagsOf(source: string): string[] {
  const code = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const names = new Set<string>();
  for (const m of code.matchAll(/process\.env(?:\["([A-Z][A-Z0-9_]*)"\]|\.([A-Z][A-Z0-9_]*))\s*===\s*["']1["']/g)) {
    const name = (m[1] ?? m[2])!;
    if (new RegExp(`["'\`][^"'\`\\n]*\\b${name}=1`).test(code)) names.add(name);
  }
  return [...names].sort();
}

/** Files (and flags) that no job covers: a job covers a file when its text names the file's path and sets the flag (NAME: "1" or NAME=1). */
export function uncovered(files: Array<{ path: string; source: string }>, jobs: Job[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (/\.heavy\.test\.[cm]?[jt]sx?$/.test(f.path) || f.path === "scripts/hidden-skips.test.ts") continue;
    if (!/^\s*(?:test|it)(?:\.\w+)?\(/m.test(f.source)) continue;   // a kit other tests import (modules/sites/tests/deploy-kit.test.ts) holds no test of its own
    for (const flag of flagsOf(f.source)) {
      if (flag in MODES) continue;
      const sets = new RegExp(`(?:^|\\s)${flag}(?::\\s*["']?1["']?\\s*$|=1\\b)`, "m");
      if (!jobs.some((j) => j.text.includes(f.path) && sets.test(j.text))) out.push(`${f.path} gates a test on ${flag}=1, and no workflow job names it and sets the flag`);
    }
  }
  return out;
}

test("a job that names a file and sets its flag covers it; a file no job names, or a job that does not set the flag, does not", () => {
  const job = (text: string): Job => ({ file: "x.yml", name: "j", text });
  const src = 'const ON = process.env["VYRE_HEAVY_DOCKER"] === "1"; const skip = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (Docker)";\ntest("x", { skip }, () => {});';
  const f = [{ path: "test/a.live.test.ts", source: src }];
  assert.deepEqual(uncovered(f, []), ["test/a.live.test.ts gates a test on VYRE_HEAVY_DOCKER=1, and no workflow job names it and sets the flag"]);
  assert.equal(uncovered(f, [job('        env:\n          VYRE_HEAVY_DOCKER: "1"\n        run: node --files test/a.live.test.ts')]).length, 0);
  assert.equal(uncovered(f, [job("        run: VYRE_HEAVY_DOCKER=1 node scripts/test-run.ts --files test/a.live.test.ts")]).length, 0);
  assert.equal(uncovered(f, [job("        run: node --files test/a.live.test.ts")]).length, 1, "named but the flag is not set");
  assert.equal(uncovered(f, [job('        env:\n          VYRE_HEAVY_DOCKER: "1"\n        run: node --files test/other.test.ts')]).length, 1, "the flag is set but the file is not named");
  assert.equal(uncovered([{ path: "test/b.heavy.test.ts", source: src }], []).length, 0, "a .heavy. file is the heavy job's own");
  assert.deepEqual(flagsOf('process.env.FOO_1 === "1"; const s = "needs FOO_1=1"; process.env["BAR"] === "1"; process.env["BAR"] !== "1"'), ["FOO_1"], "BAR has no skip reason: it is a mode, not a gate");
  assert.deepEqual(flagsOf('// needs `FOO_1=1`\nprocess.env.FOO_1 === "1";'), [], "a comment is not a skip reason");
});

test("every test file outside *.heavy.test.ts that gates a test on an environment flag is run, with the flag set, by a workflow job", () => {
  const tracked = execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx", "*.test.mjs"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const files = tracked.filter((p) => fs.existsSync(path.join(root, p))).map((p) => ({ path: p, source: fs.readFileSync(path.join(root, p), "utf8") }));
  const jobs = jobsOf(fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => ({ file: f, text: fs.readFileSync(path.join(wfDir, f), "utf8") })));
  assert.deepEqual(uncovered(files, jobs), []);
});
