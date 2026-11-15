// An agent's reach over the whole Space is its own Space grant, never its role's Space-wide grant. Found by host/tests/agent.files.live.test.ts (15 Nov 2026): once access.check
// decided with the role grants every Member holds, an agent whose own Space grant was taken away still reached another agent's home folder through Member.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../src/authorize/index.ts";

const NOW = 1_000;

function world(ownSpaceGrant: boolean): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "rol_owner", clearance: 3, perms: ["records.read"], name: "Owner" });
  s.putRole({ id: "rol_member", clearance: 1, perms: ["records.read"], name: "Member" });
  s.putPrincipal({ id: "usr_boss", kind: "person", status: "active", name: "Boss" });
  s.addPrincipalRole({ holder: "usr_boss", role: "rol_owner" });
  for (const a of ["agt_scout", "agt_other"]) {
    s.putPrincipal({ id: a, kind: "agent", owner: "usr_boss", status: "active", name: a });
    s.addPrincipalRole({ holder: a, role: "rol_member" });
  }
  s.putResource({ id: "spc", type: "space", parent_id: null, label: 0, owner_id: "usr_boss", holds: 0 });
  s.putResource({ id: "fld_agents", type: "folder", parent_id: "spc", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fld_scout", type: "folder", parent_id: "fld_agents", label: 0, owner_id: "usr_boss", holds: 0 });
  s.putResource({ id: "fld_other", type: "folder", parent_id: "fld_agents", label: 0, owner_id: "usr_boss", holds: 0 });
  // the Member role's Space-wide grant, and each agent's grant on its own home
  s.putGrant({
    id: "g_role",
    subject_kind: "role",
    subject_id: "rol_member",
    resource_type: "space",
    resource_id: "spc",
    level: "edit",
  });
  s.putGrant({
    id: "g_scout",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "folder",
    resource_id: "fld_scout",
    level: "edit",
  });
  s.putGrant({
    id: "g_other",
    subject_kind: "actor",
    subject_id: "agt_other",
    resource_type: "folder",
    resource_id: "fld_other",
    level: "edit",
  });
  if (ownSpaceGrant)
    s.putGrant({
      id: "g_sp",
      subject_kind: "actor",
      subject_id: "agt_other",
      resource_type: "space",
      resource_id: "spc",
      level: "edit",
    });
  return s;
}

const view = (s: AccessSnapshot, agent: string, folder: string) =>
  authorize(s, {
    principal: agent,
    actingFor: "usr_boss",
    action: { perm: "records.read", level: "view" },
    resource: { type: "folder", id: folder },
    now: NOW,
  });

test("an agent's home grant, with its own Space grant gone, gives nothing on another agent's folder", () => {
  const s = world(false);
  assert.equal(view(s, "agt_other", "fld_other").effect, "allow", "its own home");
  assert.equal(view(s, "agt_other", "fld_scout").effect, "deny", "another agent's home");
  assert.equal(view(s, "agt_other", "fld_agents").effect, "deny", "the parent");
});

test("an agent keeps the whole Space through its own Space grant", () => {
  const s = world(true);
  assert.equal(view(s, "agt_other", "fld_scout").effect, "allow");
});

test("a person in the Member role still holds the role's Space grant", () => {
  const s = world(false);
  s.putPrincipal({ id: "usr_m", kind: "person", status: "active", name: "M" });
  s.addPrincipalRole({ holder: "usr_m", role: "rol_member" });
  assert.equal(
    authorize(s, {
      principal: "usr_m",
      action: { perm: "records.read", level: "view" },
      resource: { type: "folder", id: "fld_scout" },
      now: NOW,
    }).effect,
    "allow",
  );
});

test("an agent without its own Space grant still reaches a folder shared with the Member role, and nothing wider", () => {
  const s = world(false);
  s.putResource({
    id: "fld_shared",
    type: "folder",
    parent_id: "fld_agents",
    label: 0,
    owner_id: "usr_boss",
    holds: 0,
  });
  s.putGrant({
    id: "g_role_folder",
    subject_kind: "role",
    subject_id: "rol_member",
    resource_type: "folder",
    resource_id: "fld_shared",
    level: "edit",
  });
  assert.equal(view(s, "agt_other", "fld_shared").effect, "allow", "the folder shared with the role");
  assert.equal(view(s, "agt_other", "fld_scout").effect, "deny", "another agent's folder");
  assert.equal(
    authorize(s, {
      principal: "agt_other",
      actingFor: "usr_boss",
      action: { perm: "records.read", level: "view" },
      resource: { type: "space", id: "spc" },
      now: NOW,
    }).effect,
    "deny",
    "the Space",
  );
});
