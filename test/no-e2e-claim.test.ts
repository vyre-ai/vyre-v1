// Decision 2 Nov (hole 14): agents cannot read what is sealed, and no app seals a chat today, so nothing a person reads may claim a chat is end to end. Sealed means sealed; private means not indexed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLAIM = /end[- ]to[- ]end|e2e encrypted|e2ee/i;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === "node_modules" || e.name === "tests" || e.name === "fixtures" ? [] : walk(p);
  return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
});

test("no string a person can read says a chat is end to end", () => {
  const sources = [...walk(path.join(ROOT, "apps/app/src")), ...walk(path.join(ROOT, "ui/src")), ...walk(path.join(ROOT, "modules/chat")), ...walk(path.join(ROOT, "modules/search"))];
  const found: string[] = [];
  for (const file of sources) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!CLAIM.test(line)) return;
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "").replace(/\/\/.*$/, "");
      if (CLAIM.test(code)) found.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
