// A label on a folder reaches everything in it (lane l-labelinherit, docs/notes/restricted-label-inheritance.md). The effective label of a resource is the highest label on its chain: its own and
// every folder above it. authorize, scopeFor (predicate and SQL) and the acl_index agree on it, for an item put into a Restricted folder, a folder relabelled after its items exist, an item moved in,
// and an item cut off from its container (Only people added), which still carries its container's label.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AccessSnapshot, aclRows, authorize, evalPred, scopeFor, toSql } from "../src/authorize/index.ts";
import type { Level, ResourceRow } from "../src/authorize/index.ts";

const NOW = 1_000;
const PUBLIC = 0, INTERNAL = 1, RESTRICTED = 3;

/** A Space with an Owner (cleared for Restricted) and a Member (cleared for Internal), both with Edit on the Space, as the built-in roles have. */
function space(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "owner", clearance: RESTRICTED, perms: ["vault.read", "files.read"], name: "Owner" });
  s.putRole({ id: "member", clearance: INTERNAL, perms: ["vault.read", "files.read"], name: "Member" });
  s.putPrincipal({ id: "usr_owner", kind: "person", status: "active", name: "Owner" });
  s.putPrincipal({ id: "usr_member", kind: "person", status: "active", name: "Member" });
  s.addPrincipalRole({ holder: "usr_owner", role: "owner" });
  s.addPrincipalRole({ holder: "usr_member", role: "member" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: PUBLIC, owner_id: "usr_owner", holds: 0 });
  s.putGrant({ id: "g_owner", subject_kind: "role", subject_id: "owner", resource_type: "space", resource_id: "spc_1", level: "manage" });
  s.putGrant({ id: "g_member", subject_kind: "role", subject_id: "member", resource_type: "space", resource_id: "spc_1", level: "edit" });
  return s;
}
const res = (id: string, type: string, parent: string | null, label = PUBLIC, extra: Partial<ResourceRow> = {}): ResourceRow => ({ id, type, parent_id: parent, label, owner_id: "usr_owner", holds: 0, ...extra });
const can = (s: AccessSnapshot, who: string, type: string, id: string, level: Level = "view") => authorize(s, { principal: who, action: { perm: null, level }, resource: { type, id }, now: NOW });

test("an item put into a Restricted Vault folder is above a Member's clearance and open to the Owner", () => {
  const s = space();
  s.putResource(res("vfd_partners", "vault_folder", "spc_1", RESTRICTED));
  s.putResource(res("vit_bank", "vault_item", "vfd_partners"));   // born public, as the Vault's Add sheet makes it
  const d = can(s, "usr_member", "vault_item", "vit_bank");
  assert.equal(d.effect, "deny");
  assert.equal(d.reason, "above_clearance");
  assert.equal(can(s, "usr_owner", "vault_item", "vit_bank").effect, "allow");
  assert.equal(s.effectiveLabel("vit_bank"), RESTRICTED);
});

test("a Files folder deep in the tree: a Restricted folder covers its subfolders and their files", () => {
  const s = space();
  s.putResource(res("fld_root", "folder", "spc_1"));
  s.putResource(res("fld_hr", "folder", "fld_root", RESTRICTED));
  s.putResource(res("fld_pay", "folder", "fld_hr"));
  s.putResource(res("fil_payroll", "file", "fld_pay", INTERNAL));
  s.putResource(res("fil_menu", "file", "fld_root"));
  for (const id of ["fld_pay", "fil_payroll"]) assert.equal(can(s, "usr_member", id.startsWith("fil") ? "file" : "folder", id).reason, "above_clearance", id);
  assert.equal(can(s, "usr_member", "file", "fil_menu").effect, "allow", "a file outside the folder is untouched");
  assert.equal(can(s, "usr_owner", "file", "fil_payroll").effect, "allow");
});

test("relabelling a folder after its items exist reaches them; lowering it again opens them", () => {
  const s = space();
  s.putResource(res("vfd_team", "vault_folder", "spc_1"));
  for (let i = 0; i < 3; i++) s.putResource(res(`vit_${i}`, "vault_item", "vfd_team"));
  assert.equal(can(s, "usr_member", "vault_item", "vit_1").effect, "allow");
  s.putResource(res("vfd_team", "vault_folder", "spc_1", RESTRICTED));
  for (let i = 0; i < 3; i++) assert.equal(can(s, "usr_member", "vault_item", `vit_${i}`).reason, "above_clearance");
  s.putResource(res("vfd_team", "vault_folder", "spc_1", PUBLIC));
  assert.equal(can(s, "usr_member", "vault_item", "vit_2").effect, "allow");
});

test("moving an item into a Restricted folder closes it; moving it out opens it", () => {
  const s = space();
  s.putResource(res("vfd_open", "vault_folder", "spc_1"));
  s.putResource(res("vfd_partners", "vault_folder", "spc_1", RESTRICTED));
  s.putResource(res("vit_key", "vault_item", "vfd_open"));
  assert.equal(can(s, "usr_member", "vault_item", "vit_key").effect, "allow");
  s.putResource(res("vit_key", "vault_item", "vfd_partners"));
  assert.equal(can(s, "usr_member", "vault_item", "vit_key").reason, "above_clearance");
  s.putResource(res("vit_key", "vault_item", "vfd_open"));
  assert.equal(can(s, "usr_member", "vault_item", "vit_key").effect, "allow");
});

test("creating inside a Restricted folder needs the clearance, at any depth", () => {
  const s = space();
  s.putResource(res("fld_hr", "folder", "spc_1", RESTRICTED));
  s.putResource(res("fld_pay", "folder", "fld_hr"));
  const create = (who: string) => authorize(s, { principal: who, action: { perm: null, level: "edit" }, resource: { type: "file", id: null, parent: "fld_pay" }, now: NOW });
  assert.equal(create("usr_member").reason, "above_clearance");
  assert.equal(create("usr_owner").effect, "allow");
});

test("a grant's label ceiling and a provider policy compare the inherited label", () => {
  const s = space();
  s.putPrincipal({ id: "usr_guest", kind: "person", status: "active", name: "Guest" });
  s.putRole({ id: "cleared", clearance: RESTRICTED, perms: [], name: "Cleared" });
  s.addPrincipalRole({ holder: "usr_guest", role: "cleared" });
  s.putResource(res("fld_conf", "folder", "spc_1", 2));
  s.putResource(res("fil_x", "file", "fld_conf"));
  s.putGrant({ id: "g_cap", subject_kind: "actor", subject_id: "usr_guest", resource_type: "folder", resource_id: "fld_conf", level: "view", conditions: { labelCeiling: INTERNAL } });
  assert.equal(can(s, "usr_guest", "file", "fil_x").effect, "deny", "the ceiling of 1 is below the folder's 2");
  s.setPolicies([{ kind: "provider_label", allow: { cloud: INTERNAL } }]);
  const d = authorize(s, { principal: "usr_owner", action: { perm: null, level: "view" }, resource: { type: "file", id: "fil_x" }, provider: "cloud", now: NOW });
  assert.equal(d.reason, "provider_label", "an item in a Confidential folder does not go to a provider allowed only Internal");
});

test("an item cut off from its container (Only people added) still carries the container's label", () => {
  const s = space();
  s.putResource(res("rt_matter", "record_type", "spc_1", RESTRICTED));
  s.putResource(res("rec_1", "record", null, PUBLIC, { home: "rt_matter", owner_id: "usr_owner" }));
  s.putGrant({ id: "g_added", subject_kind: "actor", subject_id: "usr_member", resource_type: "record", resource_id: "rec_1", level: "view" });
  assert.equal(can(s, "usr_member", "record", "rec_1").reason, "above_clearance");
});

test("scopeFor, its SQL and the acl_index agree with authorize on inherited labels", () => {
  const s = space();
  s.putResource(res("fld_open", "folder", "spc_1"));
  s.putResource(res("fld_hr", "folder", "spc_1", RESTRICTED));
  s.putResource(res("fld_pay", "folder", "fld_hr"));
  const rows: { id: string; owner_id: string | null; label: number; holds: number }[] = [];
  const put = (id: string, parent: string, label: number, owner: string | null) => { rows.push({ id, owner_id: owner, label, holds: 0 }); s.putResource({ ...res(id, "file", parent, label), owner_id: owner }); };
  put("fil_a", "fld_open", PUBLIC, "usr_owner");
  put("fil_b", "fld_open", INTERNAL, null);
  put("fil_c", "fld_hr", PUBLIC, null);
  put("fil_d", "fld_pay", INTERNAL, "usr_member");   // the Member's own file in a Restricted folder: owning it is not clearance
  put("fil_e", "fld_pay", PUBLIC, null);
  // a record-level grant and a type-wide grant, so the acl and the type-wide label paths are both walked
  s.putGrant({ id: "g_rec", subject_kind: "actor", subject_id: "usr_member", resource_type: "file", resource_id: "fil_e", level: "view" });
  s.putGrant({ id: "g_tw", subject_kind: "actor", subject_id: "usr_member", resource_type: "file", resource_id: null, level: "view", conditions: { labelCeiling: 2 } });
  for (const who of ["usr_member", "usr_owner"]) {
    const sc = scopeFor(s, { principal: who, entityType: "file", level: "view", now: NOW });
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE file (id TEXT PRIMARY KEY, owner_id TEXT, label INTEGER, holds INTEGER); CREATE TABLE acl_index (person TEXT, entity_type TEXT, entity_id TEXT, level_rank INTEGER)");
      for (const r of rows) db.prepare("INSERT INTO file VALUES (?, ?, ?, ?)").run(r.id, r.owner_id, r.label, r.holds);
      for (const a of aclRows(sc.predicate, "file")) db.prepare("INSERT INTO acl_index VALUES (?, ?, ?, ?)").run(a.person, a.entity_type, a.entity_id, a.level_rank);
      const q = toSql(sc.predicate);
      const sql = new Set((db.prepare(`SELECT id FROM file WHERE ${q.sql}`).all(...q.params) as { id: string }[]).map((x) => x.id));
      const want = rows.filter((r) => can(s, who, "file", r.id).effect === "allow").map((r) => r.id);
      assert.deepEqual(want, who === "usr_member" ? ["fil_a", "fil_b"] : ["fil_a", "fil_b", "fil_c", "fil_d", "fil_e"], who);
      for (const r of rows) assert.equal(evalPred(sc.predicate, r), want.includes(r.id), `predicate ${who} ${r.id}`);
      assert.deepEqual([...sql].sort(), want, `sql ${who}`);
    } finally { db.close(); }
  }
});

test("the effective label is read once per folder: 2,000 items in one folder walk the chain once, and a relabel is seen at once", () => {
  const s = space();
  s.putResource(res("vfd_a", "vault_folder", "spc_1"));
  s.putResource(res("vfd_b", "vault_folder", "vfd_a", RESTRICTED));
  for (let i = 0; i < 2000; i++) s.putResource(res(`vit_${i}`, "vault_item", "vfd_b"));
  assert.equal(s.labelWalks, 0);
  for (let i = 0; i < 2000; i++) assert.equal(s.effectiveLabel(`vit_${i}`), RESTRICTED);
  assert.equal(s.labelWalks, 2000 + 3, "each item and each folder above it (two folders and the Space) is read once");
  for (let i = 0; i < 2000; i++) s.effectiveLabel(`vit_${i}`);
  assert.equal(s.labelWalks, 2003, "a second pass reads nothing");
  s.putResource(res("vfd_b", "vault_folder", "vfd_a", PUBLIC));
  assert.equal(s.effectiveLabel("vit_1999"), PUBLIC, "the relabel drops the cache");
  for (let i = 0; i < 2000; i++) assert.equal(can(s, "usr_member", "vault_item", `vit_${i}`).effect, "allow");
});
