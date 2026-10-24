import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerModule, scaffoldFiles, writeScaffold } from "../gen/scaffold/index.ts";
import type { ModulesFile } from "../gen/scaffold/index.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A scratch repo root: the real lane table and module list, the real contracts package (linked), nothing else. */
function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-"));
  fs.writeFileSync(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  fs.mkdirSync(path.join(root, "scripts")); fs.mkdirSync(path.join(root, "host"));
  fs.copyFileSync(path.join(REPO, "scripts/lanes.json"), path.join(root, "scripts/lanes.json"));
  fs.copyFileSync(path.join(REPO, "host/modules.json"), path.join(root, "host/modules.json"));
  fs.symlinkSync(path.join(REPO, "packages"), path.join(root, "packages"));
  return root;
}
const modulesOf = (root: string): ModulesFile => JSON.parse(fs.readFileSync(path.join(root, "host/modules.json"), "utf8")) as ModulesFile;

test("the anatomy of a new module is the one in ARCH 2.3, and the README is ten lines at most", () => {
  const files = scaffoldFiles("widgets", "L1");
  assert.deepEqual(files.map((f) => f.path).sort(), [
    "manifests/widgets.ts",
    "modules/widgets/README.md",
    "modules/widgets/fixtures/seed.ts",
    "modules/widgets/impl.ts",
    "modules/widgets/migrations/0001_init.sql",
    "modules/widgets/package.json",
    "modules/widgets/projections.ts",
    "modules/widgets/tests/widgets.contract.test.ts",
    "modules/widgets/tests/widgets.space.test.ts",
  ]);
  const by = new Map(files.map((f) => [f.path, f.content]));
  assert.ok(by.get("modules/widgets/README.md")!.trim().split("\n").length <= 10);
  assert.deepEqual(JSON.parse(by.get("modules/widgets/package.json")!), { name: "@vyre/mod-widgets", version: "0.0.0", private: true, type: "module", vyre: { manifest: "../../manifests/widgets.ts" } });
  assert.match(by.get("modules/widgets/migrations/0001_init.sql")!, /CREATE TABLE IF NOT EXISTS widgets_item/, "the module's tables carry its prefix");
  assert.match(by.get("manifests/widgets.ts")!, /owner: "L1"/);
  assert.deepEqual(scaffoldFiles("widgets", "L1"), files, "pure: the same input gives the same files");
});

test("names: kebab case only; a hyphen becomes an underscore in capability, event and table names", () => {
  for (const bad of ["Widgets", "wid_gets", "1widgets", "", "wid gets", "-w"]) assert.throws(() => scaffoldFiles(bad, "L1"), /kebab case/, bad);
  const files = scaffoldFiles("my-module", "L3");
  assert.match(files.find((f) => f.path === "modules/my-module/impl.ts")!.content, /"my_module\.create"/);
  assert.match(files.find((f) => f.path === "modules/my-module/migrations/0001_init.sql")!.content, /my_module_item/);
});

test("registering: a row joins host/modules.json in id order with status stub; a repeat is refused", () => {
  const text = fs.readFileSync(path.join(REPO, "host/modules.json"), "utf8");
  const next = registerModule(text, { id: "widgets", owner: "L1", status: "stub" });
  const rows = (JSON.parse(next) as ModulesFile).modules;
  assert.equal(rows.length, 73);
  assert.deepEqual(rows.map((r) => r.id), [...rows.map((r) => r.id)].sort());
  assert.deepEqual(rows.find((r) => r.id === "widgets"), { id: "widgets", owner: "L1", status: "stub" });
  assert.throws(() => registerModule(next, { id: "widgets", owner: "L1", status: "stub" }), /already in host\/modules\.json/);
  assert.throws(() => registerModule(text, { id: "records", owner: "L3", status: "stub" }), /already/);
});

test("writeScaffold: refuses an unknown lane, a taken name and an existing file before it writes anything", () => {
  const root = scratch();
  const before = fs.readFileSync(path.join(root, "host/modules.json"), "utf8");
  assert.throws(() => writeScaffold(root, "widgets", "L99"), /unknown lane L99/);
  assert.throws(() => writeScaffold(root, "records", "L3"), /already in host\/modules\.json/);
  fs.mkdirSync(path.join(root, "modules/widgets"), { recursive: true });
  fs.writeFileSync(path.join(root, "modules/widgets/README.md"), "mine\n");
  assert.throws(() => writeScaffold(root, "widgets", "L1"), /never overwrites/);
  assert.equal(fs.readFileSync(path.join(root, "modules/widgets/README.md"), "utf8"), "mine\n");
  assert.equal(fs.readFileSync(path.join(root, "host/modules.json"), "utf8"), before, "nothing was registered");
  assert.equal(fs.existsSync(path.join(root, "manifests")), false);
});

test("a scaffolded module builds: it is written, registered, and its generated tests pass (the seeded-Space one skips until the testkit exists)", () => {
  const root = scratch();
  const r = writeScaffold(root, "widgets", "L1");
  assert.equal(r.written.length, 9);
  for (const p of r.written) assert.ok(fs.existsSync(path.join(root, p)), p);
  assert.deepEqual(modulesOf(root).modules.find((m) => m.id === "widgets"), { id: "widgets", owner: "L1", status: "stub" });
  assert.equal(modulesOf(root).modules.length, 73);
  const run = spawnSync(process.execPath, ["--test", "modules/widgets/tests/widgets.contract.test.ts", "modules/widgets/tests/widgets.space.test.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /pass 1/);
  assert.match(run.stdout, /skipped 1/, "no testkit yet");
  // the manifest it wrote loads and is the one the registry would read
  const again = spawnSync(process.execPath, ["-e", "import('./manifests/widgets.ts').then((m) => console.log(m.default.id, m.default.owner, m.default.status, m.default.capabilities.length))"], { cwd: root, encoding: "utf8" });
  assert.equal(again.stdout.trim(), "widgets L1 stub 2", again.stderr);
});

test("the contract test the scaffold writes has teeth: a handler missing from impl.ts fails it", () => {
  const root = scratch();
  writeScaffold(root, "gadgets", "L2");
  const impl = path.join(root, "modules/gadgets/impl.ts");
  fs.writeFileSync(impl, fs.readFileSync(impl, "utf8").replace(/\n  "gadgets\.get":.*\n/, "\n"));
  const run = spawnSync(process.execPath, ["--test", "modules/gadgets/tests/gadgets.contract.test.ts"], { cwd: root, encoding: "utf8" });
  assert.notEqual(run.status, 0, "the contract test must notice");
});

// ---- types ----
test("the scaffold and the module it writes typecheck under tsconfig.base.json, with the checker left on", { timeout: 120_000 }, () => {
  const own = ["manifest/gen/scaffold/index.ts", "manifest/tests/scaffold.module.test.ts"];
  for (const f of own) assert.ok(!new RegExp("@ts-" + "(nocheck|ignore|expect-error)").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} must not switch the type checker off`);
  let cache = "";
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); cache = d; break; } catch { /* next */ } }
  assert.ok(cache, "a writable cache directory");
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), '{"private":true}');
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(r.status, 0, `npm install failed: ${r.stderr}`);
  }
  const root = scratch();
  const w = writeScaffold(root, "widgets", "L1");
  const cfg = path.join(root, "tsconfig.json");
  const generated = w.written.filter((p) => p.endsWith(".ts")).map((p) => path.join(root, p));
  fs.writeFileSync(cfg, JSON.stringify({ extends: path.join(REPO, "tsconfig.base.json"), compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true }, files: [...generated, ...own.map((f) => path.join(REPO, f))] }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: root, encoding: "utf8" });
  const mine = r.stdout.split("\n").filter((l) => /error TS/.test(l) && (/^manifest\/(gen\/scaffold|tests\/scaffold)/.test(l) || /(manifests\/widgets|modules\/widgets)/.test(l)));
  assert.deepEqual(mine.slice(0, 100), [], `${mine.length} type errors`);
});
