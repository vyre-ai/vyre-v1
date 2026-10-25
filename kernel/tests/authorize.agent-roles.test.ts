// P-SEC_01: an agent never holds Owner or Admin under the access module's real role ids (rol_owner, rol_admin), directly, through a group, or through nested groups.
// The kernel used to strip only the plain names "owner" and "admin", so a group holding rol_admin elevated every agent in it.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize, ELEVATED_ROLES } from "../src/authorize/index.ts";
import { isElevatedRole } from "../src/authorize/snapshot.ts";

const NOW = 1_000;
const MANAGE = ["access.manage", "access.view_as", "records.read"];

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "rol_owner", clearance: 3, perms: MANAGE, name: "Owner" });
  s.putRole({ id: "rol_admin", clearance: 3, perms: MANAGE, name: "Admin" });
  s.putRole({ id: "rol_member", clearance: 1, perms: ["records.read"], name: "Member" });
  s.putPrincipal({ id: "usr_boss", kind: "person", status: "active", name: "Boss" });
  s.putPrincipal({ id: "usr_peer", kind: "person", status: "active", name: "Peer" });
  for (const a of ["agt_owner_grp", "agt_nested_admin", "agt_direct_admin"]) s.putPrincipal({ id: a, kind: "agent", owner: "usr_boss", status: "active", name: a });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  // a group holding Owner; a group nested inside a group holding Admin
  s.addPrincipalRole({ holder: "grp_owners", role: "rol_owner" });
  s.addPrincipalRole({ holder: "grp_admins", role: "rol_admin" });
  s.addMember({ group: "grp_owners", member: "agt_owner_grp" });
  s.addMember({ group: "grp_owners", member: "usr_peer" });
  s.addMember({ group: "grp_inner", member: "agt_nested_admin" });
  s.addMember({ group: "grp_admins", member: "grp_inner" });
  s.addPrincipalRole({ holder: "agt_direct_admin", role: "rol_admin" });
  s.addPrincipalRole({ holder: "usr_boss", role: "rol_owner" });
  for (const subject_id of ["agt_owner_grp", "agt_nested_admin", "agt_direct_admin", "usr_peer", "usr_boss"]) {
    s.putGrant({ id: `g_${subject_id}`, subject_kind: "actor", subject_id, resource_type: "folder", resource_id: "root", level: "manage" });
  }
  return s;
}

const manage = (s: AccessSnapshot, principal: string, actingFor?: string) =>
  authorize(s, { principal, ...(actingFor ? { actingFor } : {}), action: { perm: "access.manage", level: "manage" }, resource: { type: "folder", id: "root" }, now: NOW });

test("one source of role ids covers the plain names and the module ids", () => {
  for (const id of ["owner", "admin", "rol_owner", "rol_admin"]) assert.ok(ELEVATED_ROLES.has(id), id);
  assert.ok(isElevatedRole("rol_custom", "Admin"));
  assert.ok(!isElevatedRole("rol_member", "Member"));
});

test("an agent in an Owner group is refused access.manage", () => {
  const s = world();
  const info = s.info("agt_owner_grp")!;
  assert.ok(!info.perms.has("access.manage") && !info.keys.has("role:rol_owner"));
  assert.equal(manage(s, "agt_owner_grp", "usr_boss").effect, "deny");
});

test("an agent in a nested Admin group is refused access.manage", () => {
  const s = world();
  assert.deepEqual(s.groupsOf("agt_nested_admin").sort(), ["grp_admins", "grp_inner"]);
  const info = s.info("agt_nested_admin")!;
  assert.ok(!info.perms.has("access.manage") && !info.keys.has("role:rol_admin"));
  assert.equal(manage(s, "agt_nested_admin", "usr_boss").effect, "deny");
});

test("an agent with a direct Admin role is refused access.manage", () => {
  const s = world();
  assert.ok(!s.info("agt_direct_admin")!.perms.has("access.manage"));
  assert.equal(manage(s, "agt_direct_admin", "usr_boss").effect, "deny");
});

test("a person in the same Owner group is allowed access.manage", () => {
  const s = world();
  assert.ok(s.info("usr_peer")!.perms.has("access.manage"));
  assert.equal(manage(s, "usr_peer").effect, "allow");
});
