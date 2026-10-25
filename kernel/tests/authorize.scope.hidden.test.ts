// Regression: scopeFor hiddenFields come only from type-wide grants that reach the caller, with authorize's rule (hidden only if every matching grant hides it).
import test from "node:test";
import assert from "node:assert/strict";
import { scopeFor, AccessSnapshot } from "../src/authorize/index.ts";

function world() {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 1, perms: ["records.read"], name: "Member" });
  for (const id of ["dana", "sam"]) { s.putPrincipal({ id, kind: "person", status: "active", name: id }); s.addPrincipalRole({ holder: id, role: "member" }); }
  return s;
}
const grant = (s: AccessSnapshot, id: string, who: string, level: string, hiddenFields: string[]) =>
  s.putGrant({ id, subject_kind: "actor", subject_id: who, resource_type: "deal", resource_id: null, level, conditions: { hiddenFields }, expires_at: null } as never);
const ask = (s: AccessSnapshot, principal: string, level: "view" | "edit" = "view") =>
  scopeFor(s, { principal, entityType: "deal", level, perm: "records.read", now: 100 });

test("a grant held by someone else hides nothing from the caller", () => {
  const s = world(); grant(s, "g1", "dana", "view", ["salary"]); grant(s, "g2", "sam", "view", []);
  assert.deepEqual(ask(s, "dana").hiddenFields, ["salary"]);
  assert.deepEqual(ask(s, "sam").hiddenFields, []);
});

test("several grants for the caller: a field is hidden only when every one hides it", () => {
  const s = world(); grant(s, "g1", "dana", "view", ["salary", "ssn"]); grant(s, "g2", "dana", "view", ["ssn"]);
  assert.deepEqual(ask(s, "dana").hiddenFields, ["ssn"]);
});

test("a grant below the asked level does not count", () => {
  const s = world(); grant(s, "g1", "dana", "edit", ["salary"]); grant(s, "g2", "dana", "view", ["ssn"]);
  assert.deepEqual(ask(s, "dana", "edit").hiddenFields, ["salary"]);
});
