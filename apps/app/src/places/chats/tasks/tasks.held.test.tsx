// A held request in the task page: expired, refused, and a path that is one person.
import test from "node:test";
import assert from "node:assert/strict";
import { endedWords, expiredOf, soloPath } from "./TaskDetail.tsx";
test("an open request past its time is expired, a closed or live one is not; a refused approval reads Not approved", () => {
  assert.equal(expiredOf({ state: "awaiting_approval", expiresAt: 100 }, 200), 100);
  assert.equal(expiredOf({ state: "awaiting_approval", expiresAt: 300 }, 200), null);
  assert.equal(expiredOf({ state: "awaiting_approval" }, 200), null);
  assert.equal(expiredOf({ state: "done", expiresAt: 100 }, 200), null, "a decided request is not expired");
  assert.equal(endedWords({ kind: "approve", state: "canceled" }), "Not approved");
  assert.equal(endedWords({ kind: "work", state: "canceled" }), "Canceled");
});
test("one person at every seat is no path: You to You says nothing", () => {
  assert.equal(soloPath([{ who: { id: "usr_a" } }, { who: { id: "usr_a" } }, {}]), true);
  assert.equal(soloPath([{ who: { id: "usr_a" } }, { who: { id: "usr_b" } }, {}]), false);
});
