// The membership check issueSession asks of the host (P-GF_01, ruling 70): ok only for an active person the snapshot knows, with one exception for the call that creates the person, and
// "unavailable" while the access snapshot is stale.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { createPeopleExtras } from "../src/seams/people.ts";

type Check = (id: string, o?: { joining?: boolean }) => "ok" | "refused" | "unavailable";

function checkWith(stale: (id: string) => boolean): Check {
  const snap = new AccessSnapshot();
  snap.putPrincipal({ id: "usr_active", kind: "person", status: "active", name: "Active" });
  snap.putPrincipal({ id: "usr_suspended", kind: "person", status: "suspended", name: "Suspended" });
  snap.putPrincipal({ id: "usr_removed", kind: "person", status: "removed", name: "Removed" });
  const extras = createPeopleExtras({ access: () => snap, db: { all: () => [] }, call: async () => null, stale });
  return (extras("identity", {}) as { membership: { check: Check } }).membership.check;
}

test("an active person is ok; suspended, removed and unknown people are refused; an unknown person is ok only for the call that creates them", () => {
  const check = checkWith(() => false);
  assert.equal(check("usr_active"), "ok");
  assert.equal(check("usr_suspended"), "refused");
  assert.equal(check("usr_removed"), "refused");
  assert.equal(check("usr_erased"), "refused", "a person the Space does not have is not a member");
  assert.equal(check("usr_new", { joining: true }), "ok", "the join creates the principal in the same call");
  assert.equal(check("usr_removed", { joining: true }), "refused", "joining does not excuse a known, removed person");
});

test("while the snapshot is stale everyone but the owner is unavailable, never ok", () => {
  const check = checkWith((id) => id !== "usr_active");   // the host's staleFor lets the owner through: here usr_active stands for the owner
  assert.equal(check("usr_active"), "ok", "the owner is still answered");
  for (const id of ["usr_suspended", "usr_removed", "usr_erased"]) assert.equal(check(id), "unavailable", id);
  assert.equal(check("usr_new", { joining: true }), "unavailable", "and a join waits");
});
