// sharedThrough (review 12 Nov, fourth look 1): is a Vault item shared with this agent itself, by a grant on the item or a Vault folder above it, held to every condition authorize applies to a
// grant (start and end, expiry, the ceiling against the effective label, hidden fields asked for, the row filter)? A role's grant on the Space never counts, nor does a type-wide grant.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize, sharedThrough } from "../src/authorize/index.ts";

const NOW = 1_000_000;
function world() {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "agt_scout", kind: "agent", status: "active" });
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active" });
  s.putRole({ id: "member", clearance: 2, perms: [] });
  s.addPrincipalRole({ holder: "agt_scout", role: "member" });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  s.putResource({ id: "spc", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  s.putResource({ id: "vfd_team", type: "vault_folder", parent_id: "spc", label: 0, owner_id: "usr_dana", holds: 0 });
  s.putResource({
    id: "vit_bank",
    type: "vault_item",
    parent_id: "vfd_team",
    label: 1,
    owner_id: "usr_dana",
    holds: 0,
  });
  // the agent's role reaches the whole Space: that is not a share of the item
  s.putGrant({
    id: "g_space",
    subject_kind: "role",
    subject_id: "member",
    resource_type: "space",
    resource_id: "spc",
    level: "edit",
  });
  s.putGrant({
    id: "g_type",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_item",
    resource_id: null,
    level: "use",
  });
  return s;
}
const ask = (s: AccessSnapshot, fields?: string[], now = NOW) =>
  sharedThrough(
    s,
    {
      principal: "agt_scout",
      action: { perm: null, level: "use" },
      resource: { type: "vault_item", id: "vit_bank" },
      ...(fields ? { fields } : {}),
      now,
    },
    ["vault_item", "vault_folder"],
  );

test("a role's grant on the Space and a type-wide grant are not a share of the item", () => {
  const s = world();
  assert.equal(
    authorize(s, {
      principal: "agt_scout",
      actingFor: "usr_dana",
      action: { perm: null, level: "use" },
      resource: { type: "vault_item", id: "vit_bank" },
      now: NOW,
    }).effect,
    "allow",
    "authorize lets the role through",
  );
  assert.equal(ask(s), false);
});

test("a share of the item or its folder counts, held to its window, its ceiling, its hidden fields and its filter", () => {
  const s = world();
  s.putGrant({
    id: "g_folder",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_folder",
    resource_id: "vfd_team",
    level: "use",
    conditions: { hiddenFields: ["password"] },
  });
  assert.equal(ask(s, ["username"]), true, "a folder share reaches the item");
  assert.equal(ask(s, ["password"]), false, "but not the field it hides");
  s.putGrant({
    id: "g_item",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_item",
    resource_id: "vit_bank",
    level: "use",
    conditions: { notBefore: NOW + 10, notAfter: NOW + 100 },
  });
  assert.equal(ask(s, ["password"]), false, "a share that has not started");
  assert.equal(ask(s, ["password"], NOW + 50), true, "within its window");
  assert.equal(ask(s, ["password"], NOW + 200), false, "after it ended");
  const c = world();
  c.putGrant({
    id: "g_low",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_item",
    resource_id: "vit_bank",
    level: "use",
    conditions: { labelCeiling: 0 },
  });
  assert.equal(ask(c), false, "a ceiling below the item's label");
  const f = world();
  f.putGrant({
    id: "g_filter",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_item",
    resource_id: "vit_bank",
    level: "use",
    conditions: { rowFilter: { op: "eq", field: "kind", value: "x" } as never },
  });
  assert.equal(ask(f), false, "a filtered share, with no row to hold it to");
  const e = world();
  e.putGrant({
    id: "g_old",
    subject_kind: "actor",
    subject_id: "agt_scout",
    resource_type: "vault_item",
    resource_id: "vit_bank",
    level: "use",
    expires_at: NOW - 1,
  });
  assert.equal(ask(e), false, "an expired share");
});

test("a share with a group the agent is in counts; the agent's clearance must reach the label", () => {
  const s = world();
  s.addMember({ group: "grp_deploy", member: "agt_scout" });
  s.putGrant({
    id: "g_grp",
    subject_kind: "group",
    subject_id: "grp_deploy",
    resource_type: "vault_item",
    resource_id: "vit_bank",
    level: "use",
  });
  assert.equal(ask(s), true);
  s.putResource({
    id: "vit_bank",
    type: "vault_item",
    parent_id: "vfd_team",
    label: 3,
    owner_id: "usr_dana",
    holds: 0,
  });
  assert.equal(ask(s), false, "label above the agent's clearance");
});
