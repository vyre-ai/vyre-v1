#!/usr/bin/env node
// Runs one `node --test` process per test file, in parallel, each under a hard cap (20 s, or capSec from test/slow.json, max 120).
// Files listed in test/slow.json run only with --slow. A pass is cached on the runner by import-closure hash; failures never are.
//   node scripts/test-run.mjs --all | --affected [base] | --files a b c   [--shard i/n] [--slow] [--no-cache] [--jobs N]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST, imports, cacheKey } from "./lib/graph.mjs";
import { ensureDeps } from "./shots/ensure-deps.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_VERSION = "2";
const MAX_SLOW = 15;
const arg = (n) => process.argv.includes(n);
const val = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const tracked = new Set(spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).stdout.split("\n").filter(Boolean));
const slow = JSON.parse(read("test/slow.json"));
const counted = slow.filter((s) => s.perf !== true).length;
if (counted > MAX_SLOW) { console.error(`test/slow.json has ${counted} entries, cap is ${MAX_SLOW}`); process.exit(1); }
const slowBy = new Map(slow.map((s) => [s.file, s]));
for (const s of slow) if (!(s.capSec <= 120) || !s.owner || !s.reason) { console.error(`slow entry ${s.file} needs capSec<=120, owner, reason`); process.exit(1); }

let files;
if (arg("--files")) files = process.argv.slice(process.argv.indexOf("--files") + 1).filter((a) => !a.startsWith("--"));
else if (arg("--affected")) {
  const sel = spawnSync("node", [path.join(REPO, "scripts/ci-select.mjs"), val("--affected") || "origin/main"], { cwd: REPO, encoding: "utf8" });
  if (sel.status !== 0) { process.stderr.write(sel.stderr); process.exit(1); }
  const r = JSON.parse(sel.stdout);
  console.log(`select: ${r.all ? "all" : r.files.length + " files"} ${r.why.join("; ")}`);
  files = r.all ? [...tracked].filter((f) => TEST.test(f)) : r.files;
} else files = [...tracked].filter((f) => TEST.test(f));
files = files.filter((f) => TEST.test(f) && tracked.has(f)).sort();
files = files.filter((f) => (arg("--slow") ? slowBy.has(f) : !slowBy.has(f)));

const shard = (val("--shard") || "1/1").split("/").map(Number);
files = files.filter((_, i) => i % shard[1] === shard[0] - 1);

const cacheDir = (() => {
  for (const d of [process.env.VYRE_PASS_CACHE, "/var/lib/ci-run/pass-cache-v1", path.join(os.tmpdir(), "pass-cache-v1")]) {
    if (!d) continue;
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { /* next */ }
  }
  return null;
})();
const useCache = !arg("--no-cache") && cacheDir;
const fwd = imports(tracked, read);
const env = { node: process.version, runner: RUNNER_VERSION, tag: process.env.VYRE_ENV_TAG || "ci" };
// Ruling 21: .tsx tests (and .ts tests that opt in with `// @tsx`) run through the tsx loader, with react-native mapped to react-native-web.
const needsTsx = (f) => f.endsWith(".tsx") || /^\s*\/\/\s*@tsx\b/m.test(read(f));
const tsxArgs = ["--import", "tsx", "--import", path.join(REPO, "scripts/shots/rn-alias.mjs")];
if (files.some(needsTsx)) await ensureDeps(REPO);
const nocache = (f) => /^\s*\/\/\s*@nocache/m.test(read(f));

const run = (f) => new Promise((resolve) => {
  const cap = (slowBy.get(f)?.capSec ?? 20) * 1000, t0 = Date.now();
  const key = useCache && !nocache(f) ? cacheKey(f, fwd, read, env) : null;
  const marker = key && path.join(cacheDir, key);
  if (marker && fs.existsSync(marker)) return resolve({ f, ok: true, cached: true, ms: 0 });
  const p = spawn(process.execPath, [...(needsTsx(f) ? tsxArgs : []), "--test", `--test-timeout=${cap}`, f], { cwd: REPO, env: needsTsx(f) ? { ...process.env, TSX_TSCONFIG_PATH: path.join(REPO, "tsconfig.base.json") } : process.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const dog = setTimeout(() => { out += `\nwatchdog: ${f} exceeded ${cap / 1000} s\n`; p.kill("SIGKILL"); }, cap + 2000);
  p.on("close", (code) => {
    clearTimeout(dog);
    const ms = Date.now() - t0, ok = code === 0;
    if (ok && marker) { try { fs.writeFileSync(marker, JSON.stringify({ key, durationMs: ms, file: f })); } catch { /* cache is best effort */ } }
    resolve({ f, ok, cached: false, ms, out });
  });
});

const jobs = Number(val("--jobs")) || Math.max(2, Math.floor(os.cpus().length / 2));
const results = [], queue = [...files];
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) results.push(await run(queue.shift())); }));
for (const r of results.sort((a, b) => a.f.localeCompare(b.f))) {
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.f} ${r.cached ? "(cached)" : r.ms + " ms"}`);
  if (!r.ok) console.log(r.out);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length} files, ${results.filter((r) => r.cached).length} cached, ${failed.length} failed, ${Date.now() - t0} ms, shard ${shard.join("/")}`);
process.exit(failed.length ? 1 : 0);
