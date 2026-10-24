// Per-file runner (ARCH 10.2): one `node --test` process per file with --test-timeout and a watchdog at the file cap.
// A file over its cap fails with the slowest-test breakdown. The cap is 20 s unless test/slow.json lists the file (capSec <= 120).
// Selection (ci-select) and the pass cache live in scripts/test-run.mjs; this module is the watchdog, breakdown and timings.
//   node scripts/test-run.ts --files a.test.ts b.test.ts [--slow] [--jobs N] [--timings]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SlowEntry } from "./slow-check.ts";

export const DEFAULT_CAP_MS = 20_000;

export type RunResult = { file: string; ok: boolean; ms: number; capMs: number; overCap: boolean; breakdown: { name: string; ms: number }[]; out: string };

/** Cap in ms for a file: its slow-list capSec, else the default. */
export function capFor(file: string, slow: SlowEntry[], defaultMs = DEFAULT_CAP_MS): number {
  const hit = slow.find((s) => s.file === file);
  return hit ? hit.capSec * 1000 : defaultMs;
}

/** Slowest tests from spec-reporter output lines like "✔ name (123.4ms)". Suites and the file line are skipped by taking leaf lines only. */
export function breakdown(out: string, top = 5): { name: string; ms: number }[] {
  const rows: { name: string; ms: number }[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*[✔✖]\s+(.*?)\s+\(([\d.]+)ms\)\s*$/u);
    if (m) rows.push({ name: m[1], ms: Math.round(Number(m[2])) });
  }
  return rows.sort((a, b) => b.ms - a.ms).slice(0, top);
}

/** Runs one test file in its own node process. Fails (overCap) if it runs past capMs, even when every test passed. */
export function runFile(file: string, opts: { cwd?: string; capMs?: number } = {}): Promise<RunResult> {
  // A runner started from inside `node --test` must not inherit its test context, or the child file runs as a subtest.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const capMs = opts.capMs ?? DEFAULT_CAP_MS, cwd = opts.cwd ?? process.cwd(), t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--test", "--test-reporter=spec", `--test-timeout=${capMs}`, file], { cwd, stdio: ["ignore", "pipe", "pipe"], env });
    let out = "", overCap = false;
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    const dog = setTimeout(() => { overCap = true; p.kill("SIGKILL"); }, capMs);
    p.on("close", (code) => {
      clearTimeout(dog);
      const ms = Date.now() - t0;
      overCap = overCap || ms > capMs;
      const rows = breakdown(out);
      if (overCap) out += `\nwatchdog: ${file} exceeded its ${capMs / 1000} s cap after ${ms} ms\nslowest tests:\n${rows.map((r) => `  ${r.ms} ms  ${r.name}`).join("\n") || "  (none finished)"}\n`;
      resolve({ file, ok: code === 0 && !overCap, ms, capMs, overCap, breakdown: rows, out });
    });
  });
}

/** Merges this run's durations into a timings table: { file: { ms, at } }. */
export function mergeTimings(prev: Record<string, { ms: number; at: string }>, results: RunResult[], at = new Date().toISOString()) {
  const next = { ...prev };
  for (const r of results) if (r.ok) next[r.file] = { ms: r.ms, at };
  return next;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const repo = path.resolve(path.dirname(self), "..");
  const arg = (n: string) => process.argv.includes(n), val = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const slow: SlowEntry[] = JSON.parse(fs.readFileSync(path.join(repo, "test/slow.json"), "utf8"));
  const files = process.argv.slice(process.argv.indexOf("--files") + 1).filter((a) => !a.startsWith("--") && a !== val("--jobs"));
  const picked = files.filter((f) => (arg("--slow") ? slow.some((s) => s.file === f) : !slow.some((s) => s.file === f)));
  const jobs = Number(val("--jobs")) || Math.max(2, Math.floor(os.cpus().length / 2));
  const queue = [...picked], results: RunResult[] = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) { const f = queue.shift()!; results.push(await runFile(f, { cwd: repo, capMs: capFor(f, slow) })); } }));
  for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) { console.log(`${r.ok ? "ok  " : "FAIL"} ${r.file} ${r.ms} ms`); if (!r.ok) console.log(r.out); }
  if (arg("--timings")) {
    const tf = path.join(repo, "test/timings.json");
    fs.writeFileSync(tf, JSON.stringify(mergeTimings(JSON.parse(fs.readFileSync(tf, "utf8")), results), null, 2) + "\n");
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
