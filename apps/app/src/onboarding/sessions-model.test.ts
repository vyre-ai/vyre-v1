import test from "node:test";
import assert from "node:assert/strict";
import { folderChoices, folderName, importedNote, modifiedAt, rememberImported, rememberedImported, newestFirst, relativeDate, selectState, sessionName } from "./sessions-model.ts";

const NOW = new Date(2026, 9, 31, 15, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m, d, h, min, 0).getTime();

test("a modified time reads from ISO text, epoch seconds or epoch milliseconds, and is 0 when missing", () => {
  assert.equal(modifiedAt("2026-10-31T10:00:00Z"), Date.parse("2026-10-31T10:00:00Z"));
  assert.equal(modifiedAt("1761900000"), 1761900000 * 1000);
  assert.equal(modifiedAt("1761900000123"), 1761900000123);
  assert.equal(modifiedAt(null), 0);
  assert.equal(modifiedAt("nonsense"), 0);
});

test("relative dates: minutes, hours, Yesterday, days, then 12 Oct style with the year only when it differs", () => {
  assert.equal(relativeDate(NOW - 30_000, NOW), "Just now");
  assert.equal(relativeDate(NOW - 5 * 60_000, NOW), "5 minutes ago");
  assert.equal(relativeDate(NOW - 2 * 3_600_000, NOW), "2 hours ago");
  assert.equal(relativeDate(at(2026, 9, 30, 9), NOW), "Yesterday");
  assert.equal(relativeDate(at(2026, 9, 28, 9), NOW), "3 days ago");
  assert.equal(relativeDate(at(2026, 9, 12, 9), NOW), "12 Oct");
  assert.equal(relativeDate(at(2025, 9, 12, 9), NOW), "12 Oct 2025");
  assert.equal(relativeDate(0, NOW), "");
});

test("the name is the title on one line, else a short id; the folder is the last path segment", () => {
  assert.equal(sessionName({ provider: "claude", sessionId: "abcdef12-3456", sessionKey: "k", title: "  Fix the\nlogin   bug " }), "Fix the login bug");
  assert.equal(sessionName({ provider: "codex", sessionId: "abcdef12-3456", sessionKey: "k" }), "Untitled session abcdef12");
  assert.equal(folderName("/Users/maya/code/site/"), "site");
  assert.equal(folderName("C:\\work\\app"), "app");
  assert.equal(folderName(null), "");
});

test("sessions sort newest first, undated last, and the folder choices count each folder", () => {
  const rows = [
    { provider: "claude", sessionId: "a", sessionKey: "claude:a", cwd: "/x/site", updatedAt: "1000000000000" },
    { provider: "codex", sessionId: "b", sessionKey: "codex:b", cwd: "/x/site", updatedAt: "2000000000000" },
    { provider: "claude", sessionId: "c", sessionKey: "claude:c", cwd: "/y/app" },
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.sessionId), ["b", "a", "c"]);
  assert.deepEqual(folderChoices(rows), [{ name: "site", count: 2 }, { name: "app", count: 1 }]);
});

test("Select all is none, some (indeterminate) or all for the rows in view", () => {
  assert.equal(selectState(["a", "b"], new Set()), "none");
  assert.equal(selectState(["a", "b"], new Set(["a"])), "some");
  assert.equal(selectState(["a", "b"], new Set(["a", "b", "z"])), "all");
});

test("after an import the card says how many and where they are", () => {
  assert.equal(importedNote(3), "Imported 3. They are in Chats.");
  assert.equal(importedNote(1), "Imported 1. It is in Chats.");
  rememberImported(3);
  assert.equal(rememberedImported(), 3);
});
