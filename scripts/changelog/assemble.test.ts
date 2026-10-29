import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assemble } from "./assemble.ts";

test("fragments move to the top of changelog.md in order and are deleted; README stays", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(root, "changelog.d"));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n- Older entry.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "README.md"), "# Changelog fragments\n- not an entry\n");
  fs.writeFileSync(path.join(root, "changelog.d", "b.md"), "- Second.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "a.md"), "- First.\nnot a list line\n- First, part two.\n");
  const rank: Record<string, number> = { "a.md": 1, "b.md": 2 };
  assert.deepEqual(assemble(root, (f) => rank[path.basename(f)] ?? 0), { added: 3 });
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n- First.\n- First, part two.\n- Second.\n- Older entry.\n");
  assert.deepEqual(fs.readdirSync(path.join(root, "changelog.d")), ["README.md"]);
});

test("no fragments leaves changelog.md untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n- Only.\n");
  assert.deepEqual(assemble(root), { added: 0 });
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n- Only.\n");
});
