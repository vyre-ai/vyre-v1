// A side pane opens on Details; the tab a person chose is kept for that thing only.
import test from "node:test";
import assert from "node:assert/strict";
import { FIRST_TAB, forgetTabs, keepTab, openingTab } from "./tab.ts";

test("a pane opens on Details when it has it, else on its first tab", () => {
  forgetTabs();
  assert.equal(FIRST_TAB, "details");
  assert.equal(openingTab("goal", "g1", ["details", "activity", "files"]), "details");
  assert.equal(openingTab("task", "t1", ["details", "activity"]), "details");
  assert.equal(openingTab("record", "r1", ["details", "activity", "everything", "comments"]), "details");
  assert.equal(openingTab("other", "x", ["chat", "plan"]), "chat");
});

test("the tab a person chose is kept for that thing, not for another, and a tab that is gone is forgotten", () => {
  forgetTabs();
  keepTab("goal", "g1", "activity");
  assert.equal(openingTab("goal", "g1", ["details", "activity", "files"]), "activity");
  assert.equal(openingTab("goal", "g2", ["details", "activity", "files"]), "details");
  assert.equal(openingTab("goal", "g1", ["details", "files"]), "details");
});
