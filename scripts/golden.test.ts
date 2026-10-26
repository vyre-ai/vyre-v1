// P-L11_22: `npm run golden` (scripts/golden.ts) exits non-zero when a ready flow fails and zero when only todo flows fail, and never passes by running nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "golden.ts");

function steps(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-golden-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}
const run = (dir: string) => spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--no-ready"], { encoding: "utf8" });

const PASS = `import test from "node:test"; test("flow a", () => {});`;
const READY_FAIL = `import test from "node:test"; import assert from "node:assert/strict"; test("flow b is ready", () => { assert.equal(1, 2); });`;
const TODO_FAIL = `import test from "node:test"; import assert from "node:assert/strict"; test("flow c has gaps", { todo: true }, () => { assert.equal(1, 2); });`;

test("golden: a ready flow that fails turns the check red", () => {
  const r = run(steps({ "01-a.test.ts": PASS, "02-b.test.ts": READY_FAIL }));
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /golden: FAILED/);
});

test("golden: a flow that fails only as todo (open gaps) leaves the check green", () => {
  const r = run(steps({ "01-a.test.ts": PASS, "03-c.test.ts": TODO_FAIL }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /golden: ok/);
});

test("golden: no step test means failure, and a heavy test is not run here", () => {
  assert.notEqual(run(steps({})).status, 0, "nothing to run is a failure");
  const heavyOnly = run(steps({ "07-x.heavy.test.ts": READY_FAIL }));
  assert.notEqual(heavyOnly.status, 0, "heavy tests belong to their own job, so there is still nothing to run");
  assert.match(heavyOnly.stderr, /no step test found/);
});
