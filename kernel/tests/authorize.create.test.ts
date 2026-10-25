// A create has no id yet, so ownership is read from the container it is made in: whoever owns that container, or any container above it, may create there. The Space owner owns the Space,
// so they can create anywhere in it (including inside a member's record); a member can create in a record they own; nobody gains anything else. An agent is never wider than the person it acts for.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../src/authorize/index.ts";
import type { Level } from "../src/authorize/index.ts";

const NOW = 1_760_000_000_000;
const SPACE = "spc_t";

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "owner", clearance: 3, perms: [], name: "owner" });
  s.putRole({ id: "member", clearance: 1, perms: [], name: "member" });
  const person = (id: string, role: string) => { s.putPrincipal({ id, kind: "person", status: "active", name: id }); s.addPrincipalRole({ holder: id, role }); };
  person("usr_owner", "owner"); person("usr_member", "member"); person("usr_other", "member");
  s.putPrincipal({ id: "agt_a", kind: "agent", owner: "usr_member", status: "active", name: "agt_a" });
  s.addPrincipalRole({ holder: "agt_a", role: "member" });
  const res = (id: string, type: string, parent: string | null, owner: string) => s.putResource({ id, type, parent_id: parent, label: 0, owner_id: owner, holds: 0 });
  res(SPACE, "space", null, "usr_owner");
  res("rec_mine", "record", SPACE, "usr_member");       // a member's record
  res("rec_theirs", "record", SPACE, "usr_other");      // someone else's record
  return s;
}
const create = (s: AccessSnapshot, principal: string, parent: string, actingFor?: string, level: Level = "edit") =>
  authorize(s, { principal, ...(actingFor ? { actingFor } : {}), action: { perm: null, level }, resource: { type: "task", id: null, parent }, now: NOW });

test("create: the Space owner creates in the Space and inside a member's record, with no grant", () => {
  const s = world();
  assert.equal(create(s, "usr_owner", SPACE).effect, "allow");
  assert.equal(create(s, "usr_owner", "rec_mine").effect, "allow");
  assert.equal(create(s, "usr_owner", "rec_theirs").effect, "allow");
  assert.equal(create(s, "usr_owner", "rec_mine").scope!.level, "manage");
});

test("create: a member creates in a record they own, and not in someone else's with no grant", () => {
  const s = world();
  assert.equal(create(s, "usr_member", "rec_mine").effect, "allow");
  const d = create(s, "usr_member", "rec_theirs");
  assert.deepEqual([d.effect, d.reason], ["deny", "no_grant"]);
  const inSpace = create(s, "usr_member", SPACE);
  assert.deepEqual([inSpace.effect, inSpace.reason], ["deny", "no_grant"], "owning one record does not own the Space above it");
});

test("create: a grant still gives a member what it says, and owning a record does not reach its siblings", () => {
  const s = world();
  s.putGrant({ id: "gr1", subject_kind: "actor", subject_id: "usr_member", resource_type: "record", resource_id: "rec_theirs", level: "edit" });
  assert.equal(create(s, "usr_member", "rec_theirs").effect, "allow");
  assert.equal(create(s, "usr_other", "rec_mine").reason, "no_grant");
});

test("create: an agent acting for a member gets no more than the member", () => {
  const s = world();
  // the agent has no grant of its own: the member's ownership does not make it the owner
  assert.equal(create(s, "agt_a", "rec_mine", "usr_member").reason, "no_grant");
  s.putGrant({ id: "ga1", subject_kind: "actor", subject_id: "agt_a", resource_type: "record", resource_id: "rec_mine", level: "edit" });
  assert.equal(create(s, "agt_a", "rec_mine", "usr_member").effect, "allow", "its grant and the member's ownership both hold");
  // a grant on a record the member cannot create in does not widen the member
  s.putGrant({ id: "ga2", subject_kind: "actor", subject_id: "agt_a", resource_type: "record", resource_id: "rec_theirs", level: "edit" });
  assert.equal(create(s, "agt_a", "rec_theirs", "usr_member").reason, "no_grant");
  // acting for the Space owner is the owner's reach, still capped by the agent's own grants
  assert.equal(create(s, "agt_a", "rec_theirs", "usr_owner").effect, "allow");
  assert.equal(create(s, "agt_a", SPACE, "usr_owner").reason, "no_grant");
});
