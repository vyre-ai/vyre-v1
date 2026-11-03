// The class behind "no such column: audience": a module adds a column from code (ALTER TABLE ... ADD COLUMN in an ensure function) and its probe checks only an earlier column, so a store made before
// the new one never gets it. Every column a module adds from code must be probed by name in the same file (a SELECT of it, or a PRAGMA table_info read), or be one of the lists memory probes in a loop.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "tests" || e.name === "fixtures" || e.name === "node_modules" ? [] : e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));
const files = walk(root).filter((f) => /ADD COLUMN/.test(readFileSync(f, "utf8")));

test("every column added from code is probed by name", () => {
  assert.ok(files.length >= 3, `found ${files.join(", ")}`);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const looped = /ADD COLUMN \$\{/.test(src);   // memory: FACT_COLUMNS and LATER_COLUMNS, probed one by one in ensure (upgrade.test.ts runs each)
    if (looped) {
      assert.match(src, /for \(const col of FACT_COLUMNS\) db\.all\(`SELECT \$\{col\.split/, `${f}: the loop-added columns are each probed`);
      assert.match(src, /for \(const \[table, col\] of LATER_COLUMNS\) db\.all\(/, `${f}: the later columns are each probed`);
    }
    for (const line of src.split("\n")) {
      const m = /ADD COLUMN "?(\w+)"?/.exec(line);
      if (!m || line.trimStart().startsWith("//") || /catch/.test(line)) continue;   // a comment, or an attempt made on every start that a duplicate column only skips
      const col = m[1]!;
      assert.ok(new RegExp(`SELECT "?${col}"? FROM|table_info|c\\.name === "${col}"`).test(src), `${f}: ${col} is added but never probed by name`);
    }
  }
});
