import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WHATS_NEW_FILE, assemble, splitFragment, whatsNewProblems } from "./assemble.ts";

test("fragments move to the top of changelog.md in order and are deleted; README stays", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(root, "changelog.d"));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n- Older entry.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "README.md"), "# Changelog fragments\n- not an entry\n");
  fs.writeFileSync(path.join(root, "changelog.d", "b.md"), "- Second.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "a.md"), "- First.\nnot a list line\n- First, part two.\n");
  const rank: Record<string, number> = { "a.md": 1, "b.md": 2 };
  assert.deepEqual(assemble(root, (f) => rank[path.basename(f)] ?? 0), { added: 3, whatsNew: 0 });
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n- First.\n- First, part two.\n- Second.\n- Older entry.\n");
  assert.deepEqual(fs.readdirSync(path.join(root, "changelog.d")), ["README.md"]);
});

test("no fragments leaves changelog.md untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n- Only.\n");
  assert.deepEqual(assemble(root), { added: 0, whatsNew: 0 });
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n- Only.\n");
});

test("a fragment's What's new lines become the release's whats-new.json, not changelog lines; a release without any writes an empty one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(root, "changelog.d"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.0-rc.17" }));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n- Older entry.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "a.md"), "- The updater checks the feed with a timeout.\n\n## What's new\n\n- Vyre now updates itself when it opens.\n- See what got better right after an update.\n");
  fs.writeFileSync(path.join(root, "changelog.d", "b.md"), "## What\u2019s new\n- Files open faster.\n## Notes\n- An engineer line after the section.\n");
  const rank: Record<string, number> = { "a.md": 1, "b.md": 2 };
  assert.deepEqual(assemble(root, (f) => rank[path.basename(f)] ?? 0), { added: 2, whatsNew: 3 });
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n- The updater checks the feed with a timeout.\n- An engineer line after the section.\n- Older entry.\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, WHATS_NEW_FILE), "utf8")), { version: "1.0.0-rc.17", lines: ["Vyre now updates itself when it opens.", "See what got better right after an update.", "Files open faster."] });
  fs.writeFileSync(path.join(root, "changelog.d", "c.md"), "- Only an engineer line.\n");
  assemble(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, WHATS_NEW_FILE), "utf8")).lines, [], "last release's lines never show again");
});

test("What's new is refused with more than six lines, an em dash or a very long line, and nothing moves", () => {
  assert.deepEqual(whatsNewProblems(["Short and plain."]), []);
  assert.match(whatsNewProblems(["One", "Two", "Three", "Four", "Five", "Six", "Seven"]).join(), /7 lines/);
  assert.match(whatsNewProblems(["Faster \u2014 and calmer."]).join(), /em dash/);
  assert.match(whatsNewProblems(["x".repeat(141)]).join(), /longer than 140/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(root, "changelog.d"));
  fs.writeFileSync(path.join(root, "changelog.md"), "# Changelog\n\n");
  fs.writeFileSync(path.join(root, "changelog.d", "a.md"), "- Entry.\n## What's new\n- Faster \u2014 and calmer.\n");
  assert.throws(() => assemble(root), /em dash/);
  assert.ok(fs.existsSync(path.join(root, "changelog.d", "a.md")), "the fragment stays");
  assert.equal(fs.readFileSync(path.join(root, "changelog.md"), "utf8"), "# Changelog\n\n");
});

test("splitFragment reads only - lines, and only the What's new heading opens its part", () => {
  assert.deepEqual(splitFragment("# Title\n- a\n### What's New\n- b\nprose\n- c\n## Other\n- d\n"), { entries: ["- a", "- d"], whatsNew: ["b", "c"] });
});

test("this repo's whats-new.json is a valid What's new for the version in package.json", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const wn = JSON.parse(fs.readFileSync(path.join(root, WHATS_NEW_FILE), "utf8")) as { version: unknown; lines: unknown };
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  assert.equal(wn.version, pkg.version);
  assert.ok(Array.isArray(wn.lines) && wn.lines.every((l) => typeof l === "string"));
  assert.deepEqual(whatsNewProblems(wn.lines as string[]), []);
});
