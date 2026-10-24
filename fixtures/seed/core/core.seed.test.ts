import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Req } from "../../../kernel/src/authorize/index.ts";
import { canonical } from "../../../lib/canonical.ts";
import { AGENTS, CORE_SOURCES, CORE_SPACE, FOLDERS, GROUPS, PEOPLE, bootCore, coreEvents, ensureTemplate, registryHash, templateKey } from "./index.ts";
import { discoverSeeds } from "../small/recipe.ts";
import { smallRecipe, SMALL_TARGET } from "../small/recipe.ts";
import { perfRecipe, PERF_TARGET } from "../perf/recipe.ts";

/** The frozen shape: sha-256 of the recipe's events (type, entity, id, payload). Only the lead changes it, together with the recipe. */
const CORE_SHAPE_HASH = "bb3e660c5d92ab9ec2221b5612938df4b27659ceb0d7170291c45e22df073152";
const shapeHash = (): string => crypto.createHash("sha256").update(canonical(coreEvents().map((e) => [e.type, e.entity, e.entity_id, e.payload]))).digest("hex");

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "core-seed-"));
const can = (snap: ReturnType<typeof bootCore>["snapshot"], principal: string, perm: string | null, level: Req["action"]["level"], resource: Req["resource"]): string =>
  authorize(snap, { principal, action: { perm, level }, resource, now: 1_790_000_000_000 }).effect;

test("the frozen shape: 6 people with every role, 3 groups, 2 agents, one record type, one channel, one folder tree", () => {
  assert.equal(shapeHash(), CORE_SHAPE_HASH, "the core recipe changed: the lead re-freezes it");
  const roles = new Set(PEOPLE.map((p) => p.role));
  assert.deepEqual([...roles].sort(), ["admin", "manager", "member", "owner", "temp"], "every role is held");
  assert.equal(PEOPLE.length, 6);
  assert.equal(GROUPS.length, 3);
  assert.equal(AGENTS.length, 2);
  assert.equal(FOLDERS.length, 3);
  const ev = coreEvents();
  const count = (type: string, f?: (p: Record<string, unknown>) => boolean): number => ev.filter((e) => e.type === type && (!f || f(e.payload as Record<string, unknown>))).length;
  assert.equal(count("principal.created", (p) => p["kind"] === "person"), 6);
  assert.equal(count("principal.created", (p) => p["kind"] === "agent"), 2);
  assert.equal(count("group.created"), 3);
  assert.equal(count("resource.created", (p) => p["type"] === "record_type"), 1);
  assert.equal(count("resource.created", (p) => p["type"] === "channel"), 1);
  assert.equal(count("resource.created", (p) => p["type"] === "folder"), 3);
  assert.deepEqual(coreEvents(), ev, "the recipe is the same list every call");
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length, "event ids are unique and fixed");
});

test("core boots into a Space whose log verifies and whose access projection answers authorize", () => {
  const c = bootCore({ cache: scratch(), scratch: scratch() });
  try {
    assert.equal(c.space, CORE_SPACE);
    assert.equal(c.store.verify().ok, true);
    assert.equal(c.store.count(), coreEvents().length);
    assert.equal(can(c.snapshot, "usr_olivia", "records.read", "view", { type: "space", id: CORE_SPACE }), "allow", "the owner reads the Space");
    assert.equal(can(c.snapshot, "usr_tess", "grants.create", "manage", { type: "space", id: CORE_SPACE }), "deny", "a temp person cannot create grants");
    assert.equal(can(c.snapshot, "usr_tess", null, "view", { type: "folder", id: "fld_acme" }), "allow", "the one folder shared with her");
    assert.equal(can(c.snapshot, "usr_tess", null, "view", { type: "folder", id: "fld_clients" }), "deny", "and not the folder above it");
    assert.equal(can(c.snapshot, "usr_noah", null, "edit", { type: "folder", id: "fld_acme" }), "allow", "Staff edit the whole Shared tree, down to Acme");
  } finally { c.close(); }
});

test("template cache: the first boot builds, the next ones hit; the key follows the recipe and the registry hash", () => {
  const cache = scratch();
  const first = bootCore({ cache, scratch: scratch() }); first.close();
  const second = bootCore({ cache, scratch: scratch() }); second.close();
  assert.deepEqual([first.hit, second.hit], [false, true]);
  assert.equal(first.key, second.key);
  assert.equal(fs.readdirSync(cache).filter((f) => f.endsWith(".db")).length, 1, "one template for one key");
  assert.deepEqual(fs.readdirSync(cache).filter((f) => !f.endsWith(".db")), [], "no temp files left");
  const other = bootCore({ cache, scratch: scratch(), registry: "another-registry-hash" }); other.close();
  assert.equal(other.hit, false, "a new registry hash is a new template");
  assert.notEqual(other.key, first.key);
  const dir = scratch();
  const f = path.join(dir, "recipe.ts");
  fs.writeFileSync(f, "a"); const k1 = templateKey([f], "r");
  fs.writeFileSync(f, "b"); const k2 = templateKey([f], "r");
  assert.notEqual(k1, k2, "editing a recipe file changes the key");
  assert.equal(templateKey([f], "r"), k2);
  assert.equal(templateKey([f], "r\n"), k2, "a trailing newline in the hash file is not a change");
  assert.equal(registryHash().length, 64);
  assert.equal(CORE_SOURCES.every((s) => fs.existsSync(s)), true);
});

test("template cache: a build that fails leaves nothing behind, and the next try builds", () => {
  const cache = scratch();
  assert.throws(() => ensureTemplate(cache, "x", "k", () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(fs.readdirSync(cache), []);
  const t = ensureTemplate(cache, "x", "k", (file) => fs.writeFileSync(file, "ok"));
  assert.equal(t.hit, false);
  assert.equal(ensureTemplate(cache, "x", "k", () => { throw new Error("must not build"); }).hit, true);
});

test("PERF: core boots in under 100 ms on a template cache hit", () => {
  const cache = scratch(), sc = scratch();
  bootCore({ cache, scratch: sc }).close();             // build the template
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const c = bootCore({ cache, scratch: sc });
    times.push(performance.now() - t0);
    assert.equal(c.hit, true);
    c.close();
  }
  times.sort((a, b) => a - b);
  const median = times[3]!;
  console.log(`core boot on a cache hit: median ${median.toFixed(1)} ms, min ${times[0]!.toFixed(1)} ms, max ${times[6]!.toFixed(1)} ms (budget 100 ms)`);
  assert.ok(median < 100, `median ${median.toFixed(1)} ms is over the 100 ms budget`);
  assert.ok(times[6]! < 100 * 3, "even the slowest boot stays near the budget");
});

test("small and perf recipes: skeletons that find every module's fixtures/seed.ts by glob", () => {
  const root = scratch();
  for (const m of ["records", "chat", "mail"]) { fs.mkdirSync(path.join(root, "modules", m, "fixtures"), { recursive: true }); fs.writeFileSync(path.join(root, "modules", m, "fixtures/seed.ts"), "export const seed = {};\n"); }
  fs.mkdirSync(path.join(root, "modules/nothing"), { recursive: true });
  assert.deepEqual(discoverSeeds(root).map((s) => s.module), ["chat", "mail", "records"], "sorted, and a module without a seed is skipped");
  assert.deepEqual(discoverSeeds(path.join(root, "absent")), []);
  assert.deepEqual(smallRecipe(root).target, { records: 500, channels: 40, agents: 12, people: 6 });
  assert.equal(smallRecipe(root).seeds.length, 3);
  assert.equal(perfRecipe(root).target.records, 100_000);
  assert.equal(perfRecipe(root).name, "perf");
  assert.ok(Object.isFrozen(SMALL_TARGET) && Object.isFrozen(PERF_TARGET));
});

// ---- types ----
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
test("the seed code and this test typecheck under tsconfig.base.json, with the checker left on", { timeout: 120_000 }, () => {
  const files = ["recipe.ts", "access.ts", "cache.ts", "index.ts", "core.seed.test.ts"].map((f) => `fixtures/seed/core/${f}`).concat(["fixtures/seed/small/recipe.ts", "fixtures/seed/perf/recipe.ts"]);
  for (const f of files) assert.ok(!new RegExp("@ts-" + "(nocheck|ignore|expect-error)").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} must not switch the type checker off`);
  let cache = "";
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); cache = d; break; } catch { /* next */ } }
  assert.ok(cache, "a writable cache directory");
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), '{"private":true}');
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(r.status, 0, `npm install failed: ${r.stderr}`);
  }
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify({ extends: path.join(REPO, "tsconfig.base.json"), compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true }, files: files.map((f) => path.join(REPO, f)) }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: REPO, encoding: "utf8" });
  const mine = r.stdout.split("\n").filter((l) => /^fixtures\/seed\/.*\(\d+,\d+\): error/.test(l));
  assert.deepEqual(mine.slice(0, 200), [], `${mine.length} type errors`);
});
