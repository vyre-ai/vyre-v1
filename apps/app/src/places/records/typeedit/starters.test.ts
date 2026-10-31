import assert from "node:assert/strict";
import { test } from "node:test";
import { moreStarters, shownStarters, STARTER_FIELDS, suggestStarters } from "./model.ts";

test("Deals pre-pick Amount, Stage, Owner, Close date and Contact", () => {
  const g = suggestStarters("Deals");
  assert.deepEqual(g.starters, ["amount", "stage", "owner", "close_date"]);
  assert.deepEqual(g.connect, ["contact"]);
});

test("a name with no known purpose picks nothing", () => {
  assert.deepEqual(suggestStarters("Zebras"), { starters: [], connect: [] });
});

test("the set covers the asked field types", () => {
  for (const t of ["email", "phone", "datetime", "money", "number", "choice", "multichoice", "checkbox", "person", "files", "url", "longtext", "rating", "status"]) {
    assert.ok(STARTER_FIELDS.some((f) => f.type === t), t);
  }
});

test("a picked field behind More is drawn as a chip, and More finds the rest by typing", () => {
  assert.ok(!shownStarters([]).some((f) => f.key === "close_date"));
  assert.ok(shownStarters(["close_date"]).some((f) => f.key === "close_date"));
  assert.deepEqual(moreStarters([], "rat").map((f) => f.key), ["rating"]);
  assert.ok(!moreStarters(["close_date"], "").some((f) => f.key === "close_date"));
});
