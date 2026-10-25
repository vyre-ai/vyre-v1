// P-H_15: built-in roles derive their permissions from the permission catalogue.
import test from "node:test";
import assert from "node:assert/strict";
import { catalogueRolePerms, withCatalogue } from "../src/authorize/roles.ts";
import { ROLE_PERMS } from "../src/grants/roles.ts";
import { PERMISSIONS } from "../../manifests/permissions.ts";
import { coreEvents } from "../../fixtures/seed/core/recipe.ts";

const perm = (key: string, ...on: string[]) => ({ key, defaults: Object.fromEntries(on.map((r) => [r, true])) });

test("catalogue roles: owner holds every permission, admin every one but ownership transfer, member only its defaults", () => {
  const cat = [perm("a.read", "owner", "admin", "member"), perm("a.manage", "owner", "admin"), perm("space.transfer_ownership", "owner"), perm("a.build", "owner", "admin", "developer")];
  const r = catalogueRolePerms(cat);
  assert.deepEqual(r.owner, ["a.build", "a.manage", "a.read", "space.transfer_ownership"]);
  assert.deepEqual(r.admin, ["a.build", "a.manage", "a.read"], "ownership transfer is the owner's alone");
  assert.deepEqual(r.member, ["a.read"]);
  assert.deepEqual(r.manager, ["a.build", "a.read"], "manager is member plus developer defaults");
  assert.deepEqual(r.temp, []);
});

test("catalogue roles: a new catalogue row reaches the roles with no hand edit", () => {
  const before = catalogueRolePerms([perm("a.read", "owner", "member")]);
  const after = catalogueRolePerms([perm("a.read", "owner", "member"), perm("a.new", "owner", "member")]);
  assert.ok(!before.member.includes("a.new") && after.member.includes("a.new") && after.owner.includes("a.new") && after.admin.includes("a.new"));
});

test("catalogue roles: the real catalogue gives the owner schema.manage and records.edit, and a member records.edit but not schema.manage", () => {
  const r = catalogueRolePerms(PERMISSIONS);
  assert.equal(r.owner.length, PERMISSIONS.length, "owner holds every row");
  for (const k of ["schema.manage", "records.edit", "records.create", "connectors.manage"]) assert.ok(r.owner.includes(k) && r.admin.includes(k), k);
  assert.ok(r.member.includes("records.edit") && r.member.includes("records.create"));
  assert.ok(!r.member.includes("schema.manage") && !r.member.includes("records.delete") && !r.member.includes("connectors.manage"));
  assert.deepEqual(r.member, PERMISSIONS.filter((p) => p.defaults.member).map((p) => p.key).sort(), "member is exactly the catalogue's member defaults");
});

test("catalogue roles: the kernel's own bundles stay, the catalogue is added on top", () => {
  const all = withCatalogue(ROLE_PERMS, PERMISSIONS);
  for (const id of Object.keys(ROLE_PERMS) as (keyof typeof ROLE_PERMS)[]) for (const p of ROLE_PERMS[id]) assert.ok(all[id].includes(p), `${id} keeps ${p}`);
  assert.ok(all.owner.includes("space.upgrade") && !all.admin.includes("space.upgrade"), "the owner-only kernel bundle is still the owner's alone");
});

test("catalogue roles: the seeded core Space defines its roles from the catalogue", () => {
  const defined = new Map(coreEvents().filter((e) => e.type === "role.defined").map((e) => [e.entity_id, (e.payload as { perms: string[] }).perms]));
  for (const p of PERMISSIONS) assert.ok(defined.get("owner")!.includes(p.key), `owner has ${p.key}`);
  assert.ok(defined.get("member")!.includes("records.edit"));
  assert.ok(!defined.get("member")!.includes("schema.manage"));
});
