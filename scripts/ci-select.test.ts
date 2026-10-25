import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dropUnaffectedPerf, bootedTests, manifestEdges, selectAffected, unitOf, unitTests, dynamicDirs } from "./ci-select.ts";
import { shardFiles, toMatrix } from "./shard.ts";
import { imports } from "./lib/graph.mjs";
import { localCache, mirroredCache, splitByCache, recordResult, isNoCache, type CacheEnv, type Marker } from "./cache/pass-cache.ts";

const files: Record<string, string> = {
  "manifests/vault.ts": "export const vault = {};",
  "manifests/_common.ts": "export const c = 1;",
  "generated/registry.ts": "export const registry = {};",
  "generated/modules/vault/stub-impl.ts": "export const handlers = {};",
  "generated/modules/files/stub-impl.ts": "export const handlers = {};",
  "generated/tests/vault.contract.test.ts": "import '../registry.ts'; import '../modules/vault/stub-impl.ts';",
  "generated/tests/files.contract.test.ts": "import '../registry.ts'; import '../modules/files/stub-impl.ts';",
  "host/gateway.ts": "import '../generated/modules/vault/stub-impl.ts';",
  "host/gateway.test.ts": "import './gateway.ts';",
  "lib/x.ts": "export const x = 1;",
  "lib/x.test.ts": "import './x.ts';",
  "lib/y.ts": "export const y = 1;",
  "lib/y.test.ts": "import './y.ts';",
  "lib/z.ts": "export const z = 1;",
  "lib/z.test.ts": "import './z.ts';",
  "lib/orphan.ts": "export const o = 1;",
  "lib/new.test.ts": "import './z.ts';",
};
const tracked = new Set(Object.keys(files));
const read = (f: string) => { const s = files[f]; if (s === undefined) throw new Error(f); return s; };

test("a manifest edit selects its generated contract test and the consumers of its generated outputs", () => {
  const r = selectAffected({ changed: ["manifests/vault.ts"], tracked, read });
  assert.equal(r.all, false);
  assert.deepEqual(r.edges, ["generated/modules/vault/stub-impl.ts", "generated/tests/vault.contract.test.ts"]);
  assert.deepEqual(r.files, ["generated/tests/vault.contract.test.ts", "host/gateway.test.ts"]);
  assert.deepEqual(r.uncovered, []);
});

test("a manifest edit does not select another module's contract test", () => {
  const r = selectAffected({ changed: ["manifests/vault.ts"], tracked, read });
  assert.ok(!r.files.includes("generated/tests/files.contract.test.ts"));
});

test("a shared manifest maps to all generated code", () => {
  const e = manifestEdges(["manifests/_common.ts"], tracked);
  assert.ok(e.includes("generated/modules/vault/stub-impl.ts") && e.includes("generated/modules/files/stub-impl.ts") && e.includes("generated/registry.ts"));
});

test("a non-manifest change adds no edges", () => {
  assert.deepEqual(manifestEdges(["lib/x.ts"], tracked), []);
});

test("every test file added or changed in the diff runs, plus tests that import changed code", () => {
  const r = selectAffected({ changed: ["lib/new.test.ts", "lib/x.ts"], tracked, read });
  assert.deepEqual(r.files, ["lib/new.test.ts", "lib/x.test.ts"]);
  const only = selectAffected({ changed: ["lib/new.test.ts"], tracked, read });
  assert.deepEqual(only.files, ["lib/new.test.ts"]);
});

test("six new test files in one diff all run (P-PR_14 regression: only 2 of 6 ran)", () => {
  const f = { ...files }; const names: string[] = [];
  for (let i = 1; i <= 6; i++) { const n = `lib/n${i}.test.ts`; f[n] = i % 2 ? "import './z.ts';" : "import './nothing.ts';"; names.push(n); }
  const r = selectAffected({ changed: names, tracked: new Set(Object.keys(f)), read: (p) => f[p]! });
  assert.deepEqual(r.files, [...names].sort());
});

test("an uncovered code file still fails; edge-only files never do", () => {
  assert.deepEqual(selectAffected({ changed: ["lib/orphan.ts"], tracked, read }).uncovered, ["lib/orphan.ts"]);
  assert.deepEqual(selectAffected({ changed: ["manifests/vault.ts"], tracked, read }).uncovered, []);
});

test("a change to the selector or the lockfile runs everything", () => {
  assert.equal(selectAffected({ changed: ["scripts/ci-select.ts"], tracked: new Set([...tracked, "scripts/ci-select.ts"]), read }).all, true);
  assert.equal(selectAffected({ changed: ["package-lock.json"], tracked, read }).all, true);
});

const env: CacheEnv = { node: "v24", runner: "1", tag: "t" };
const memCache = () => { const m = new Map<string, Marker>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (x: Marker) => void m.set(x.key, x) }; };

test("unchanged files hit the cache; a change in the import closure misses", async () => {
  const cache = memCache();
  const fwd = imports(tracked, read);
  const first = await splitByCache(["lib/x.test.ts", "lib/y.test.ts"], fwd, read, env, cache);
  assert.deepEqual(first.run, ["lib/x.test.ts", "lib/y.test.ts"]);
  for (const f of first.run) assert.equal(await recordResult(cache, first.keys.get(f), { ok: true, ms: 50, tests: 2 }), true);
  const same = await splitByCache(["lib/x.test.ts", "lib/y.test.ts"], fwd, read, env, cache);
  assert.deepEqual(same.hit, ["lib/x.test.ts", "lib/y.test.ts"]);
  assert.deepEqual(same.run, []);
  const edited = (f: string) => read(f) + (f === "lib/x.ts" ? "\n// edit" : "");
  const after = await splitByCache(["lib/x.test.ts", "lib/y.test.ts"], imports(tracked, edited), edited, env, cache);
  assert.deepEqual(after.run, ["lib/x.test.ts"]);
  assert.deepEqual(after.hit, ["lib/y.test.ts"]);
});

test("failures and @nocache files are never cached; env change misses", async () => {
  const cache = memCache(), fwd = imports(tracked, read);
  const s = await splitByCache(["lib/x.test.ts"], fwd, read, env, cache);
  assert.equal(await recordResult(cache, s.keys.get("lib/x.test.ts"), { ok: false, ms: 5, tests: 1 }), false);
  assert.equal(cache.m.size, 0);
  assert.equal(isNoCache("// @nocache\nimport x"), true);
  assert.equal(isNoCache("const a = '// @nocache';"), false);
  await recordResult(cache, s.keys.get("lib/x.test.ts"), { ok: true, ms: 5, tests: 1 });
  const other = await splitByCache(["lib/x.test.ts"], fwd, read, { ...env, node: "v25" }, cache);
  assert.deepEqual(other.run, ["lib/x.test.ts"]);
});

test("local cache round trip, corrupt marker reads as a miss", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passcache-"));
  const c = localCache(dir), key = "a".repeat(64);
  assert.equal(await c.get(key), null);
  await c.put({ key, durationMs: 9, tests: 3 });
  assert.deepEqual(await c.get(key), { key, durationMs: 9, tests: 3 });
  fs.writeFileSync(path.join(dir, key), "not json");
  assert.equal(await c.get(key), null);
  assert.equal(await c.get("../etc/passwd"), null);
  fs.rmSync(dir, { recursive: true });
});

test("fleet mirror: hit fills the local cache, errors are misses, puts are mirrored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passcache-")), key = "b".repeat(64);
  const store = new Map<string, string>([[key, JSON.stringify({ key, durationMs: 4, tests: 1 })]]);
  const calls: string[] = [];
  const fake = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const k = url.split("/").pop()!;
    if (init?.method === "PUT") { store.set(k, init.body!); return { ok: true, status: 200, text: async () => "" }; }
    const v = store.get(k);
    return { ok: v !== undefined, status: v ? 200 : 404, text: async () => v ?? "" };
  };
  const local = localCache(dir), c = mirroredCache(local, { url: "http://cache/", fetch: fake });
  assert.equal((await c.get(key))?.durationMs, 4);
  assert.equal((await local.get(key))?.durationMs, 4);
  const k2 = "c".repeat(64);
  await c.put({ key: k2, durationMs: 1, tests: 1 });
  assert.ok(store.has(k2));
  const down = mirroredCache(localCache(fs.mkdtempSync(path.join(os.tmpdir(), "passcache-"))), { url: "http://x", fetch: async () => { throw new Error("down"); } });
  assert.equal(await down.get(key), null);
  await down.put({ key, durationMs: 1, tests: 1 });
  fs.rmSync(dir, { recursive: true });
});

test("perf: select on a 2,000-file graph stays inside the 8 s worst-case row (ci_push_5m)", (t) => {
  const f: Record<string, string> = {};
  for (let i = 0; i < 1500; i++) f[`lib/m${i}.ts`] = i ? `import './m${i - 1 - (i % 7)}.ts'; export const v${i} = ${i};` : "export const v0 = 0;";
  for (let i = 0; i < 500; i++) f[`lib/t${i}.test.ts`] = `import './m${(i * 3) % 1500}.ts';`;
  const tr = new Set(Object.keys(f));
  const t0 = performance.now();
  const r = selectAffected({ changed: ["lib/m1400.ts"], tracked: tr, read: (p) => f[p]! });
  const ms = performance.now() - t0;
  t.diagnostic(`PERF select 2000 files: ${ms.toFixed(0)} ms (budget 8000 ms), selected ${r.files.length}`);
  assert.ok(ms < 8000);
});

test("the CLI runs on the real repo and prints a selection", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const r = spawnSync(process.execPath, ["scripts/ci-select.ts", "HEAD", "--matrix"], { cwd: root, encoding: "utf8" });
  assert.ok([0, 1].includes(r.status ?? -1), r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.files) && out.matrix && Array.isArray(out.matrix.include));
});

test("a frozen trigger path always selects every frozen-* test", () => {
  const tracked = new Set([...Object.keys(files), "packages/contracts/tests/frozen-kinds.test.ts", "docs/frozen/kinds.md"]);
  const read = (f: string) => (f in files ? files[f]! : "");
  const r = selectAffected({ changed: ["docs/frozen/kinds.md"], tracked, read });
  assert.ok(r.all || r.files.includes("packages/contracts/tests/frozen-kinds.test.ts"));
});

test("--matrix with no base still lists every tracked test (never an empty matrix)", () => {
  const r = spawnSync("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "ci-select.ts"), "", "--matrix", "--max", "8"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const fast = j.matrix.include.filter((m: { slow: boolean }) => !m.slow);
  // --max caps the fast shards; each test/slow.json entry adds its own slow job.
  assert.ok(fast.length > 0 && fast.length <= 8);
});

const unitFiles: Record<string, string> = {
  "modules/files/handlers/changesets.ts": "export const c = 1;",
  "modules/files/handlers/other.ts": "export const o = 1;",
  "modules/files/tests/changesets.test.ts": "import '../handlers/changesets.ts';",
  "modules/files/tests/lint.test.ts": "import '../handlers/other.ts';",
  "modules/mail/tests/mail.test.ts": "export const m = 1;",
  "modules/mail/impl.ts": "export const i = 1;",
  "host/a.ts": "export const a = 1;",
  "host/tests/a.test.ts": "import '../a.ts';",
  "host/tests/b.test.ts": "export const b = 1;",
  "lib/gone-user.ts": "import './gone.ts';",
  "lib/gone-user.test.ts": "import './gone-user.ts';",
  "lib/loader.ts": "export const load = (n: string) => import(`./plugins/${n}.ts`);",
  "lib/loader.test.ts": "import './loader.ts';",
  "lib/plugins/one.ts": "export const one = 1;",
};
const uTracked = new Set(Object.keys(unitFiles));
const uRead = (f: string) => { const s = unitFiles[f]; if (s === undefined) throw new Error(f); return s; };

test("editing modules/files/handlers/changesets.ts selects every test in modules/files", () => {
  const r = selectAffected({ changed: ["modules/files/handlers/changesets.ts"], tracked: uTracked, read: uRead });
  assert.equal(r.all, false);
  assert.deepEqual(r.files, ["modules/files/tests/changesets.test.ts", "modules/files/tests/lint.test.ts"]);
});

test("the unit rule covers host/ and does not leak into other modules", () => {
  const r = selectAffected({ changed: ["host/a.ts"], tracked: uTracked, read: uRead });
  assert.deepEqual(r.files, ["host/tests/a.test.ts", "host/tests/b.test.ts"]);
  assert.ok(!r.files.some((f) => f.startsWith("modules/")));
  assert.deepEqual(unitTests(["modules/mail/impl.ts"], uTracked), ["modules/mail/tests/mail.test.ts"]);
  assert.equal(unitOf("lib/x.ts"), null);
});

test("a deleted file selects the tests of the files that still import it, and never selects itself", () => {
  const t = new Set(uTracked);
  const r = selectAffected({ changed: ["lib/gone.ts"], tracked: t, read: uRead });
  assert.deepEqual(r.files, ["lib/gone-user.test.ts"]);
  assert.deepEqual(r.uncovered, []);
});

test("a deleted test file is not selected", () => {
  const r = selectAffected({ changed: ["modules/files/tests/old.test.ts"], tracked: uTracked, read: uRead });
  assert.ok(!r.files.includes("modules/files/tests/old.test.ts"));
});

test("a non-literal dynamic import makes the loader depend on every file in the loaded directory", () => {
  assert.deepEqual(dynamicDirs("lib/loader.ts", unitFiles["lib/loader.ts"]!), ["lib/plugins"]);
  const r = selectAffected({ changed: ["lib/plugins/one.ts"], tracked: uTracked, read: uRead });
  assert.deepEqual(r.files, ["lib/loader.test.ts"]);
});

const bootFiles: Record<string, string> = {
  "modules/kits/handlers/install.ts": "export const x = 1;",
  "modules/kits/impl.ts": "export const y = 1;",
  "modules/records/handlers/write.ts": "export const w = 1;",
  "modules/records/README.md": "docs",
  "modules/tasks/handlers/state.ts": "export const t = 1;",
  "modules/mail/handlers/send.ts": "export const m = 1;",
  "host/tests/kits.live.test.ts": 'import { startDaemon } from "../src/daemon/daemon.ts";\nconst kits = list.find((m) => m.id === "kits");',
  "host/tests/live.l3.test.ts": 'import { startDaemon } from "../src/daemon/daemon.ts";\nconst L3 = ["records", "schema", "sources"];',
  "host/tests/store.live.test.ts": '// @reads /modules/records/\nimport { startDaemon } from "../src/daemon/daemon.ts";',
  "host/tests/live.l6.test.ts": 'import { startDaemon } from "../src/daemon/daemon.ts";\nconst L6 = ["tasks", "events"];',
  "host/tests/loader.stub.test.ts": 'import { loadHost } from "../src/loader.ts";\nconst kits = "kits";',
};
const bootTracked = new Set(Object.keys(bootFiles));
const bootRead = (f: string): string => { const s = bootFiles[f]; if (s === undefined) throw new Error(f); return s; };

test("changing modules/kits/handlers/install.ts selects the booted-daemon test that boots kits, and not the others", () => {
  assert.deepEqual(bootedTests(["modules/kits/handlers/install.ts"], bootTracked, bootRead), ["host/tests/kits.live.test.ts"]);
  const r = selectAffected({ changed: ["modules/kits/handlers/install.ts"], tracked: bootTracked, read: bootRead });
  assert.ok(r.files.includes("host/tests/kits.live.test.ts"));
  assert.ok(!r.files.includes("host/tests/live.l6.test.ts") && !r.files.includes("host/tests/live.l3.test.ts"));
  assert.ok(r.why.some((w) => /booted-daemon rule: 1 tests/.test(w)));
});

test("changing modules/records selects every booted-daemon test that boots records, by id list or by @reads, and not a test that never starts the daemon", () => {
  assert.deepEqual(bootedTests(["modules/records/handlers/write.ts"], bootTracked, bootRead), ["host/tests/live.l3.test.ts", "host/tests/store.live.test.ts"]);
  assert.deepEqual(bootedTests(["modules/kits/impl.ts"], bootTracked, bootRead), ["host/tests/kits.live.test.ts"], "loader.stub names kits but boots nothing");
});

test("a module id list selects the daemon tests of each module on it; a change that is not code, or outside modules/, selects none", () => {
  assert.deepEqual(bootedTests(["modules/tasks/handlers/state.ts"], bootTracked, bootRead), ["host/tests/live.l6.test.ts"]);
  assert.deepEqual(bootedTests(["modules/records/README.md"], bootTracked, bootRead), []);
  assert.deepEqual(bootedTests(["modules/mail/handlers/send.ts"], bootTracked, bootRead), [], "no booted test names mail");
  assert.deepEqual(bootedTests(["lib/x.ts"], bootTracked, bootRead), []);
});

test("a perf file lands in its own v1-perf matrix entry; every other entry runs on v1", () => {
  const perf = "modules/access/tests/check.perf.test.ts";
  const m = toMatrix(shardFiles([perf, "lib/x.test.ts", "lib/y.test.ts"], {}, [{ file: perf, capSec: 120, owner: "t", reason: "t", perf: true }])).include;
  const hit = m.filter((j) => j.files.split(" ").includes(perf));
  assert.equal(hit.length, 1);
  assert.deepEqual({ files: hit[0]!.files, slow: hit[0]!.slow, runner: hit[0]!.runner }, { files: perf, slow: true, runner: "v1-perf" });
  assert.ok(m.filter((j) => j !== hit[0]).every((j) => j.runner === "v1"), "fast and slow entries run on the self-hosted v1 runners");
});

test("a perf file runs only when its own import closure changed, or always on main", () => {
  const f: Record<string, string> = {
    "kernel/log.ts": "export const l = 1;", "kernel/bench.test.ts": "import './log.ts';",
    "ui/Row.ts": "export const r = 1;", "ui/row.test.ts": "import './Row.ts';",
  };
  const tr = new Set(Object.keys(f)), rd = (p: string) => f[p]!;
  const perf = new Set(["kernel/bench.test.ts"]);
  const all = ["kernel/bench.test.ts", "ui/row.test.ts"];
  assert.deepEqual(dropUnaffectedPerf(all, ["ui/Row.ts"], perf, tr, rd, false), ["ui/row.test.ts"]);
  assert.deepEqual(dropUnaffectedPerf(all, ["kernel/log.ts"], perf, tr, rd, false), all);
  assert.deepEqual(dropUnaffectedPerf(all, ["kernel/bench.test.ts"], perf, tr, rd, false), all);
  assert.deepEqual(dropUnaffectedPerf(all, ["ui/Row.ts"], perf, tr, rd, true), all);
});

test("--perf-only lists every perf file as a v1-perf job, --no-perf lists none (ruling 55)", () => {
  const run = (flag: string) => {
    const r = spawnSync("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "ci-select.ts"), "", "--matrix", flag], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).matrix.include as { files: string; runner: string }[];
  };
  const only = run("--perf-only");
  assert.ok(only.length > 0 && only.every((m) => m.runner === "v1-perf"));
  const none = run("--no-perf");
  const perfFiles = new Set(only.map((m) => m.files));
  assert.ok(none.every((m) => m.files.split(" ").every((f) => !perfFiles.has(f))));
});
