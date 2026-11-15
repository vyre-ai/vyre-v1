// A role's Space-wide grant below Manage does not reach an agent, nor anything inside one (the rule, 15 Nov 2026). Found by test/team-day-one.live.test.ts: once access.check decided with the role grants
// every Member holds, a member "used" an agent nobody shared with them. An agent is reached by its owner, by a grant that names it (a person, a group, Everyone, a role), and by the Space's managers.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../src/authorize/index.ts";

const NOW = 1_000;
type Lvl = "view" | "use" | "edit" | "manage";

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "rol_owner", clearance: 3, perms: ["agents.use", "records.read"], name: "Owner" });
  s.putRole({ id: "rol_admin", clearance: 3, perms: ["agents.use", "records.read"], name: "Admin" });
  s.putRole({ id: "rol_member", clearance: 1, perms: ["agents.use", "records.read"], name: "Member" });
  s.putRole({ id: "rol_guest", clearance: 0, perms: [], name: "Guest" });
  const person = (id: string, role: string) => {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
    s.addMember({ group: "grp_everyone", member: id });
  };
  person("usr_boss", "rol_owner");
  for (const m of ["usr_ada", "usr_bea", "usr_cy", "usr_dee"]) person(m, "rol_member");
  person("usr_adm", "rol_admin");
  person("usr_gst", "rol_guest");
  s.putResource({ id: "spc", type: "space", parent_id: null, label: 0, owner_id: "usr_boss", holds: 0 });
  for (const a of ["agt_priv", "agt_all", "agt_cy", "agt_role"])
    s.putResource({ id: a, type: "agent", parent_id: "spc", label: 0, owner_id: "usr_ada", holds: 0 });
  // something inside an agent, and a folder beside it
  s.putResource({ id: "fld_in", type: "folder", parent_id: "agt_priv", label: 0, owner_id: "usr_ada", holds: 0 });
  s.putResource({ id: "fld_out", type: "folder", parent_id: "spc", label: 0, owner_id: "usr_ada", holds: 0 });
  const g = (
    id: string,
    kind: "role" | "group" | "actor",
    subject: string,
    type: string,
    rid: string,
    level: Lvl,
  ): void => s.putGrant({ id, subject_kind: kind, subject_id: subject, resource_type: type, resource_id: rid, level });
  g("g_member", "role", "rol_member", "space", "spc", "edit");
  g("g_admin", "role", "rol_admin", "space", "spc", "manage");
  g("g_all", "group", "grp_everyone", "agent", "agt_all", "use");
  g("g_cy", "actor", "usr_cy", "agent", "agt_cy", "use");
  g("g_rolegrant", "role", "rol_member", "agent", "agt_role", "use");
  return s;
}

const ask = (s: AccessSnapshot, who: string, type: string, id: string, level: Lvl = "use", perm = "agents.use") =>
  authorize(s, { principal: who, action: { perm, level }, resource: { type, id }, now: NOW }).effect;

test("a member does not reach an agent nobody shared with them, through the Member role's Space grant", () => {
  const s = world();
  assert.equal(ask(s, "usr_bea", "agent", "agt_priv"), "deny");
  assert.equal(ask(s, "usr_bea", "agent", "agt_priv", "view"), "deny");
});

test("a member does not reach a thing inside an unshared agent through the role; a folder outside an agent still does", () => {
  const s = world();
  assert.equal(ask(s, "usr_bea", "folder", "fld_in", "view", "records.read"), "deny");
  assert.equal(ask(s, "usr_bea", "folder", "fld_out", "view", "records.read"), "allow");
});

test("a member reaches an agent shared with Everyone", () => {
  assert.equal(ask(world(), "usr_bea", "agent", "agt_all"), "allow");
});

test("a person named in an explicit grant reaches the agent, and another member does not", () => {
  const s = world();
  assert.equal(ask(s, "usr_cy", "agent", "agt_cy"), "allow");
  assert.equal(ask(s, "usr_dee", "agent", "agt_cy"), "deny");
});

test("a role named in a grant on the agent itself still reaches it", () => {
  assert.equal(ask(world(), "usr_dee", "agent", "agt_role"), "allow");
});

test("the agent's owner reaches it and what is inside it", () => {
  const s = world();
  assert.equal(ask(s, "usr_ada", "agent", "agt_priv", "manage"), "allow");
  assert.equal(ask(s, "usr_ada", "folder", "fld_in", "view", "records.read"), "allow");
});

test("an admin reaches every agent through the role's Manage grant on the Space", () => {
  const s = world();
  assert.equal(ask(s, "usr_adm", "agent", "agt_priv", "manage"), "allow");
  assert.equal(ask(s, "usr_adm", "folder", "fld_in", "view", "records.read"), "allow");
});

test("the Space's owner reaches every agent through their own Manage grant on the Space", () => {
  const s = world();
  s.putGrant({
    id: "g_boss",
    subject_kind: "actor",
    subject_id: "usr_boss",
    resource_type: "space",
    resource_id: "spc",
    level: "manage",
  });
  assert.equal(ask(s, "usr_boss", "agent", "agt_priv", "manage"), "allow");
});

test("a guest reaches nothing of an agent", () => {
  const s = world();
  assert.equal(ask(s, "usr_gst", "agent", "agt_priv", "view"), "deny");
  assert.equal(ask(s, "usr_gst", "agent", "agt_all", "view"), "deny");
});
