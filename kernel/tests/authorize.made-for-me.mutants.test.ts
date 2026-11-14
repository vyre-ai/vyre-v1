// "Made for me" in the kernel, one assertion per rule so that taking any of them out fails a test (review r-keyreach, 14 Nov): the owner and the person it was made for must be the asker; the agent's role permission is
// required except for the removal caps; Manage only for the named list; what only a person does stays a person's; publishing gets nothing from having made the thing. Small hand-built Space, no random worlds.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../src/authorize/index.ts";

const AGENT = "agt_h";
const build = (): AccessSnapshot => {
  const snap = new AccessSnapshot();
  // the member role has no removal and no publishing permission of its own; the admin role has them all
  snap.putRole({ id: "member", clearance: 2, perms: ["records.update"], name: "Member" });
  snap.putRole({
    id: "admin",
    clearance: 3,
    perms: ["records.update", "records.delete", "files.delete", "sites.publish", "forms.publish", "channels.manage", "sites.deploy"],
    name: "Admin",
  });
  for (const id of ["usr_dana", "usr_eve"]) {
    snap.putPrincipal({ id, kind: "person", status: "active", name: id });
    snap.addPrincipalRole({ holder: id, role: "admin" });
  }
  snap.putPrincipal({ id: AGENT, kind: "agent", status: "active", name: "Helper", owner_id: "usr_dana" } as never);
  snap.addPrincipalRole({ holder: AGENT, role: "member" });
  snap.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  return snap;
};
const thing = (snap: AccessSnapshot, id: string, type: string, o: Record<string, unknown> = {}): void =>
  snap.putResource({
    id,
    type,
    parent_id: null,
    label: 0,
    owner_id: "usr_dana",
    holds: 0,
    made_by: AGENT,
    made_for: "usr_dana",
    ...o,
  } as never);
const may = (snap: AccessSnapshot, type: string, id: string, level: "view" | "use" | "edit" | "manage", cap?: string, perm: string | null = null, acting = "usr_dana") =>
  authorize(snap, {
    principal: AGENT,
    actingFor: acting,
    action: { perm, level },
    resource: { type, id },
    ...(cap ? { cap } : {}),
    explain: true,
    now: 1,
  });

test("the removal caps follow the person's permission, not the agent role's; every other permission still needs the agent's own role", () => {
  const snap = build();
  thing(snap, "rec_1", "record");
  thing(snap, "fil_1", "file");
  thing(snap, "sit_1", "site");
  thing(snap, "frm_1", "form");
  thing(snap, "chn_1", "channel");
  assert.equal(may(snap, "record", "rec_1", "edit", "records.delete", "records.delete").effect, "allow", "records.delete");
  assert.equal(may(snap, "file", "fil_1", "edit", "files.delete", "files.delete").effect, "allow", "files.delete");
  assert.equal(may(snap, "site", "sit_1", "manage", "sites.delete", "sites.deploy").effect, "allow", "sites.delete");
  assert.equal(may(snap, "channel", "chn_1", "manage", "channels.update", "channels.manage").effect, "allow", "channels.update");
  // publishing stays as it was: Edit level with a role permission; having made the site adds nothing (lead 14 Nov)
  assert.equal(may(snap, "site", "sit_1", "edit", "sites.publish", "sites.publish").effect, "deny", "sites.publish");
  assert.equal(may(snap, "form", "frm_1", "edit", "forms.publish", "forms.publish").effect, "deny", "forms.publish");
  // a permission outside the list is the role's too, at any level
  assert.equal(may(snap, "record", "rec_1", "edit", "records.import", "records.import").effect, "deny");
});

test("Manage is only for the named list; a capability off the list holds Edit at most", () => {
  const snap = build();
  thing(snap, "sit_1", "site");
  for (const cap of ["sites.delete", "forms.delete", "automations.delete", "channels.archive", "channels.update", "projects.archive"])
    assert.equal(may(snap, "site", "sit_1", "manage", cap).effect, "allow", cap);
  for (const cap of ["files.share", "portal.file_link", "sites.publish", "chat.share", "projects.members.set"])
    assert.equal(may(snap, "site", "sit_1", "manage", cap).effect, "deny", cap);
  assert.equal(may(snap, "site", "sit_1", "edit", "sites.update").effect, "allow");
});

test("what only a person does stays a person's even at Edit, and a check with no capability named grants nothing", () => {
  const snap = build();
  thing(snap, "sit_1", "site");
  for (const cap of ["members.remove", "members.set_role", "access.share", "access.unshare", "agents.set_owner", "spaces.delete"])
    assert.equal(may(snap, "site", "sit_1", "edit", cap).effect, "deny", cap);
  for (const level of ["view", "edit", "manage"] as const)
    assert.equal(may(snap, "site", "sit_1", level).effect, "deny", `no capability named (${level})`);
});

test("the owner AND the person it was made for must both be the asker; the stamp of a thing handed on or made for someone else is nothing", () => {
  const snap = build();
  // dana has her own grant on each, so only the made-for path could make the difference for the agent
  const grant = (id: string, type: string): void =>
    snap.putGrant({ id: `g_${id}`, subject_kind: "actor", subject_id: "usr_dana", resource_type: type, resource_id: id, level: "edit" } as never);
  thing(snap, "sit_ok", "site");
  thing(snap, "sit_handed", "site", { owner_id: "usr_eve" }); // made for dana, now eve's
  thing(snap, "sit_other", "site", { made_for: "usr_eve" }); // made for eve, dana owns it
  for (const id of ["sit_ok", "sit_handed", "sit_other"]) grant(id, "site");
  const steps = (id: string): string => may(snap, "site", id, "edit", "sites.update").steps.map((s) => s.text).join(" | ");
  assert.equal(may(snap, "site", "sit_ok", "edit", "sites.update").effect, "allow");
  assert.match(steps("sit_ok"), /owner of the resource/, "through the made-for path");
  assert.equal(may(snap, "site", "sit_handed", "edit", "sites.update").effect, "deny", "handed on: the owner is no longer the asker");
  assert.equal(may(snap, "site", "sit_other", "edit", "sites.update").effect, "deny", "made for someone else");
  // and for the other asker nothing at all
  assert.equal(may(snap, "site", "sit_ok", "view", "sites.get", null, "usr_eve").effect, "deny", "another asker");
});
