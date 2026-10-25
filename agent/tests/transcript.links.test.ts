// from vyre 0.6.9 core/transcripts/links.test.js@dbd2dfbab (the pure link tests; the file-reading ones became the Claude Code session tests in transcript.turns.test.ts)
// A turn's links: the files, commits and urls it touched, found from its tool calls and its own words.
import test from "node:test";
import assert from "node:assert/strict";
import { LINKS_PER_TURN, cleanLinks, commitLinks, pathRef, textLinks, toolLinks } from "../src/transcript/links.ts";

const CWD = "/work/app";

test("a tool call's file, a read, and a url become links; other tools make none", () => {
  assert.deepEqual(toolLinks("Edit", { file_path: "/work/app/src/auth.ts" }, CWD), [{ kind: "file", ref: "src/auth.ts" }]);
  assert.deepEqual(toolLinks("Write", { file_path: "/elsewhere/x.md" }, CWD), [{ kind: "file", ref: "/elsewhere/x.md" }]);
  assert.deepEqual(toolLinks("NotebookEdit", { notebook_path: "/work/app/n.ipynb" }, CWD), [{ kind: "file", ref: "n.ipynb" }]);
  assert.deepEqual(toolLinks("Read", { file_path: "/work/app/README.md" }, CWD), [{ kind: "read", ref: "README.md" }]);
  assert.deepEqual(toolLinks("WebFetch", { url: "https://example.com/docs" }, CWD), [{ kind: "url", ref: "https://example.com/docs" }]);
  assert.deepEqual(toolLinks("Bash", { command: "ls" }, CWD), []);
  assert.deepEqual(toolLinks("Edit", {}, CWD), []);
  assert.deepEqual(toolLinks("Edit", null, CWD), []);
  assert.equal(pathRef("/work/app", CWD), "/work/app", "the folder itself is not made empty");
  assert.equal(pathRef("/work/app/a.ts", null), "/work/app/a.ts");
});

test("commits are named by the word commit or a git bracket, and a number or a word is not a hash", () => {
  assert.deepEqual(textLinks("I made commit a1b2c3d and pushed.").map((l) => l.ref), ["a1b2c3d"]);
  assert.deepEqual(textLinks("[main 9f8e7d6] fix the thing").map((l) => l.ref), ["9f8e7d6"]);
  assert.deepEqual(textLinks("committed `1A2B3C4D5E`").map((l) => l.ref), ["1a2b3c4d5e"], "case folds, backticks drop");
  assert.deepEqual(textLinks("commit 1234567 and commit deadbeef and the facade decade"), [], "all digits, all letters, and prose are not commits");
  assert.deepEqual(textLinks("see https://example.com/a?b=1, and (https://x.org/y).").map((l) => l.ref), ["https://example.com/a?b=1", "https://x.org/y"]);
  assert.deepEqual(commitLinks("[feature/x (root-commit) 0a1b2c3] first\n 1 file changed").map((l) => l.ref), ["0a1b2c3"]);
});

test("a ref that a redaction rule would change is dropped whole, duplicates go, and the count is capped", () => {
  const key = ["sk-", "ant-", "api03-", "A".repeat(40)].join("");
  assert.deepEqual(cleanLinks([{ kind: "url", ref: `https://x.org/?key=${key}` }, { kind: "file", ref: "a.ts" }, { kind: "file", ref: "a.ts" }]), [{ kind: "file", ref: "a.ts" }]);
  const many = Array.from({ length: LINKS_PER_TURN + 20 }, (_, i) => ({ kind: "file" as const, ref: `f${i}.ts` }));
  assert.equal(cleanLinks(many).length, LINKS_PER_TURN);
});
