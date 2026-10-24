import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, destPaths, laneOf, parseRows, plan, run, sourcePaths, splitCells } from "./import-0.6.ts";

const TABLE = `## 11. Reuse plan (per 0.6 path)

| 0.6 path | Verdict | v1 destination | Cleaning notes |
|---|---|---|---|
| \`kernel/seal\` | KEEP | \`kernel/src/seal/*\` | Already reviewed |
| \`scripts/release.sh\`, \`bump-version.mjs\` | KEEP | \`scripts/release/*\` | key in GH |
| \`core/google\` | CLEAN | \`modules/google|microsoft\` | per section 8 |
| \`core/memory\` (12k) | REWRITE | \`modules/memory\` | evals seed |
| \`core/planner\` | DROP (fold ideas) | | memory covers recall |
| \`kernel/golden\` mechanism | KEEP idea | \`golden/\` | local |

---
## 12. Build order
| \`never/parsed\` | KEEP | \`x\` | after the section |
`;

const LANES = [{ id: "L1", owns: ["kernel/"] }, { id: "L11", owns: ["scripts/release/", "golden/"] }, { id: "L5", owns: ["modules/google/"] }];

function fixture() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "imp-src-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "imp-out-"));
  const w = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true }); fs.writeFileSync(path.join(src, f), t); };
  w("kernel/seal/index.js", "export const a = 1;\n");
  w("kernel/seal/deep/x.ts", "export const b = 2;\n");
  w("kernel/seal/notes.md", "# notes\n");
  w("kernel/seal/node_modules/skip.js", "no\n");
  w("scripts/release.sh", "#!/bin/sh\necho hi\n");
  w("scripts/bump-version.mjs", "console.log(1);\n");
  w("core/google/api.js", "export {};\n");
  w("core/memory/m.js", "x\n");
  w("core/planner/p.js", "x\n");
  w("kernel/golden/g.js", "x\n");
  return { src, out };
}

test("table parsing keeps pipes inside backticks and stops at the next heading", () => {
  const rows = parseRows(TABLE);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].dest, "`modules/google|microsoft`");
  assert.deepEqual(splitCells("| a | `b|c` | d |"), ["a", "`b|c`", "d"]);
  assert.deepEqual(rows.map((r) => r.verdict), ["copy", "copy", "copy", "rewrite", "drop", "idea"]);
  assert.equal(classify("CLEAN, mostly rewritten"), "copy");
});

test("source and destination cells resolve to paths", () => {
  assert.deepEqual(sourcePaths("`scripts/release.sh`, `bump-version.mjs`, `Gate`, `.d.ts`"), ["scripts/release.sh", "scripts/bump-version.mjs"]);
  assert.deepEqual(sourcePaths("`kernel/store` (sqlite.js, x)"), ["kernel/store"]);
  assert.deepEqual(destPaths("`modules/google|microsoft|mail` and `kernel/src/*`"), ["modules/google", "modules/microsoft", "modules/mail", "kernel/src"]);
  assert.equal(laneOf("scripts/release", LANES), "L11");
  assert.equal(laneOf("zzz", LANES), "unowned");
});

test("dry run on 5 rows writes nothing, logs every row", () => {
  const { src, out } = fixture();
  const r = run(plan(parseRows(TABLE)), { src, out, sha: "abc123def", apply: false, lanes: LANES });
  assert.deepEqual(fs.readdirSync(out), []);
  assert.equal(r.log.filter((l) => l.kind === "imported" || l.kind === "headerless").length, 6);
  assert.deepEqual(r.log.filter((l) => ["rewrite", "drop", "idea"].includes(l.kind)).map((l) => l.kind), ["rewrite", "drop", "idea"]);
});

test("apply copies with origin headers; REWRITE and DROP rows are logged, not copied", () => {
  const { src, out } = fixture();
  const r = run(plan(parseRows(TABLE)), { src, out, sha: "abc123def", apply: true, lanes: LANES });
  const read = (f: string) => fs.readFileSync(path.join(out, f), "utf8");
  assert.equal(read("kernel/src/seal/index.js"), "// from vyre 0.6.9 kernel/seal/index.js@abc123def\nexport const a = 1;\n");
  assert.match(read("kernel/src/seal/deep/x.ts"), /^\/\/ from vyre 0.6.9 kernel\/seal\/deep\/x\.ts@abc123def\n/);
  assert.match(read("scripts/release/release.sh"), /^#!\/bin\/sh\n# from vyre 0.6.9 scripts\/release\.sh@abc123def\necho hi/);
  assert.equal(read("kernel/src/seal/notes.md"), "# notes\n");
  assert.ok(r.log.some((l) => l.kind === "headerless" && /notes\.md/.test(l.text)));
  assert.ok(!fs.existsSync(path.join(out, "kernel/src/seal/node_modules")));
  assert.ok(fs.existsSync(path.join(out, "modules/google/api.js")));
  assert.ok(!fs.existsSync(path.join(out, "modules/memory")));
  assert.ok(!fs.existsSync(path.join(out, "core")));
  assert.ok(!fs.existsSync(path.join(out, "golden")));
  assert.deepEqual([...r.byLane.keys()].sort(), ["L1", "L11", "L5"]);
});

test("an existing destination file is never overwritten, and a missing source is logged", () => {
  const { src, out } = fixture();
  fs.mkdirSync(path.join(out, "kernel/src/seal"), { recursive: true });
  fs.writeFileSync(path.join(out, "kernel/src/seal/index.js"), "mine\n");
  fs.rmSync(path.join(src, "core/google"), { recursive: true });
  const r = run(plan(parseRows(TABLE)), { src, out, sha: "s", apply: true, lanes: LANES });
  assert.equal(fs.readFileSync(path.join(out, "kernel/src/seal/index.js"), "utf8"), "mine\n");
  assert.ok(r.log.some((l) => l.kind === "exists"));
  assert.ok(r.log.some((l) => l.kind === "missing" && /core\/google/.test(l.text)));
});
