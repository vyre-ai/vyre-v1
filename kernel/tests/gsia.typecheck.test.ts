// Typechecks this packet's code under tsconfig.base.json (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess). The runners have no global tsc, so the compiler is installed once into a shared cache.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// Imported so the affected-test selector reruns this gate whenever any of these changes.
import "../src/identity/index.ts";
import "../src/identity/errors.ts";
import "../src/seal/index.ts";
import "../src/audit/index.ts";
import "../src/audit/key.ts";
import "../src/audit/verify.ts";
import "../src/grants/index.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MINE = /^kernel\/(src\/(identity|seal|audit|grants)\/|tests\/gsia\.)/;

function cacheDir(): string {
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) {
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { /* next */ }
  }
  throw new Error("no writable cache directory");
}

test("every file of the grants, seal, identity and audit packet typechecks, with the checker left on", { timeout: 120_000 }, () => {
  const cache = cacheDir();
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), '{"private":true}');
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(r.status, 0, `npm install failed: ${r.stderr}`);
  }
  const files: string[] = [];
  const walk = (d: string): void => { for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && MINE.test(p)) files.push(p); } };
  walk("kernel/src"); walk("kernel/tests");
  for (const f of files) assert.ok(!new RegExp("@ts-" + "(nocheck|ignore|expect-error)").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} must not switch the type checker off`);
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify({ extends: path.join(REPO, "tsconfig.base.json"), compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true }, files: files.map((f) => path.join(REPO, f)) }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: REPO, encoding: "utf8" });
  const mine = r.stdout.split("\n").filter((l) => /^[^\s].*\(\d+,\d+\): error/.test(l) && MINE.test(path.relative(REPO, path.resolve(REPO, l.split("(")[0] ?? ""))));
  assert.deepEqual(mine.slice(0, 400), [], `${mine.length} type errors in this packet`);
});
