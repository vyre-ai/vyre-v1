// The rules of ARCH 4.5 and the 4.5.1 mapping, one at a time.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, viewAs, authorizeAsync, AccessSnapshot, OUTSIDE_PROVIDER } from "../src/authorize/index.ts";
import type { Req } from "../src/authorize/index.ts";

function base() {
  const s = new AccessSnapshot();
  s.putRole({ id: "owner", clearance: 3, perms: ["records.read", "records.write", "access.view_as"], name: "Owner" });
  s.putRole({ id: "member", clearance: 1, perms: ["records.read", "records.write", "email.send"], name: "Member" });
  s.putRole({ id: "none", clearance: 1, perms: [], name: "None" });
  s.putPrincipal({ id: "dana", kind: "person", status: "active", name: "Dana" });
  s.putPrincipal({ id: "sam", kind: "person", status: "active", name: "Sam" });
  s.putPrincipal({ id: "boss", kind: "person", status: "active", name: "Boss" });
  s.addPrincipalRole({ holder: "dana", role: "member" });
  s.addPrincipalRole({ holder: "sam", role: "member" });
  s.addPrincipalRole({ holder: "boss", role: "owner" });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fold", type: "folder", parent_id: "root", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec1", type: "deal", parent_id: "fold", label: 0, owner_id: "sam", holds: 0 });
  s.putResource({ id: "sec1", type: "deal", parent_id: "fold", label: 2, owner_id: "sam", holds: 0 });
  s.putResource({ id: "held", type: "deal", parent_id: "fold", label: 0, owner_id: "sam", holds: 1 });
  return s;
}
const req = (o: Partial<Req> & { principal: string }): Req => ({
  action: { perm: "records.read", level: "view" },
  resource: { type: "deal", id: "rec1" },
  now: 100,
  ...o,
});
const grant = (s: AccessSnapshot, id: string, over: Record<string, unknown> = {}) =>
  s.putGrant({
    id,
    subject_kind: "actor",
    subject_id: "dana",
    resource_type: "folder",
    resource_id: "fold",
    level: "edit",
    ...over,
  } as never);

// "*" in a request's fields means every field of the resource, retired ones included (the search fast path asks it). A grant that hides any field is a hit; a grant that hides none, an owner and an admin are not.
test('fields "*": a grant that hides a field denies it, a grant that hides nothing allows it, and the owner and a role holder are not turned into "all hidden"', () => {
  const s = base();
  grant(s, "hides", { conditions: { hiddenFields: ["salary"] } });
  assert.equal(
    authorize(s, req({ principal: "dana", fields: ["name"] })).effect,
    "allow",
    "control: a visible field is allowed",
  );
  assert.equal(
    authorize(s, req({ principal: "dana", fields: ["name", "*"] })).reason,
    "no_grant",
    "any hidden field: denied",
  );
  const t = base();
  grant(t, "plain", { level: "edit" });
  assert.equal(
    authorize(t, req({ principal: "dana", fields: ["name", "*"] })).effect,
    "allow",
    "a grant that hides nothing: allowed",
  );
  assert.equal(authorize(t, req({ principal: "dana", fields: ["*"] })).effect, "allow");
  // the owner of the record (sam) and the Space owner role (boss) hold more than a grant: "*" does not narrow them
  assert.equal(authorize(s, req({ principal: "sam", fields: ["name", "*"] })).effect, "allow", "the record's owner");
  // an owner or admin holds an all-fields grant (no hidden fields): "*" does not narrow it, and a second grant of theirs that hides a field does not take it away
  grant(s, "boss-all", { subject_id: "boss", level: "manage" });
  assert.equal(authorize(s, req({ principal: "boss", fields: ["name", "*"] })).effect, "allow", "an all-fields grant");
  grant(s, "boss-hides", { subject_id: "boss", conditions: { hiddenFields: ["salary"] } });
  assert.equal(
    authorize(s, req({ principal: "boss", fields: ["salary", "*"] })).effect,
    "allow",
    "an all-fields grant next to a hiding one",
  );
});
