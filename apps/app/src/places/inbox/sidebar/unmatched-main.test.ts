// The Unmatched list is a view of the Inbox's own state, like Replies: a link moves the state to it once, and any row the person taps afterwards leaves it.
import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_STATE, reduce } from "./model.ts";

test("the unmatched view is left by a view, a scope, the calendar or Show all; the link's words in the address do not bring it back", () => {
  const at = reduce(INITIAL_STATE, { type: "unmatched" });
  assert.equal(at.main, "unmatched");
  assert.equal(reduce(at, { type: "view", view: "contact" }).main, "list");
  assert.equal(reduce(at, { type: "scope", scope: { kind: "all" } }).main, "list");
  assert.equal(reduce(at, { type: "calendar" }).main, "calendar");
  assert.equal(reduce(at, { type: "showAll" }).main, "list");
  // Show all on the list, or on the calendar, keeps the view it was on
  assert.equal(reduce(reduce(INITIAL_STATE, { type: "calendar" }), { type: "showAll" }).main, "calendar");
});
