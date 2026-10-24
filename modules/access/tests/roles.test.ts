// Built-in role defaults match the catalogue. A permission change applies as one swap, or not at all.
// @reads ../migrations/0001_access_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/db.ts";
import { BUILT_IN_ROLES, EVERYONE_GROUP } from "../fixtures/seed.ts";
import { putPrincipal, rolesApply, rolesAssign, rolesCreate, rolesPreview } from "../handlers/roles.ts";
import { catalogueSource, dropStore, parseCatalogue, storeOf } from "../projections.ts";

function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  const error = (e as { error?: { code?: string } }).error;
  return error?.code;
}

test("access handlers and the migration tables are wired", () => {
  assert.equal(typeof handlers["access.roles.apply"], "function");
  assert.equal(typeof handlers["access.roles.preview"], "function");
  assert.equal(typeof handlers["access.check"], "function");
  assert.equal(BUILT_IN_ROLES.length, 5);
  assert.equal(EVERYONE_GROUP, "grp_everyone");
  const sql = readFileSync(new URL("../migrations/0001_access_core.sql", import.meta.url), "utf8");
  for (const table of [
    "access_roles", "access_groups", "access_principals", "access_grants", "access_meta",
    "access_assignments", "access_resources", "access_policies", "access_actors", "access_fields", "access_acl",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
});

test("built-in role defaults equal the catalogue", () => {
  const parsed = parseCatalogue(catalogueSource());
  const h = harness();
  const store = storeOf(h.ctx);
  for (const name of ["owner", "admin", "developer", "member", "guest"] as const) {
    const role = store.roles.get(`rol_${name}`);
    assert.ok(role, name);
    assert.equal(role.builtIn, true, name);
    assert.equal(role.name, name.charAt(0).toUpperCase() + name.slice(1), name);
    assert.deepEqual(role.permissions, parsed.get(name), name);
  }
  const owner = store.roles.get("rol_owner")!;
  const admin = store.roles.get("rol_admin")!;
  const developer = store.roles.get("rol_developer")!;
  const member = store.roles.get("rol_member")!;
  const guest = store.roles.get("rol_guest")!;
  assert.deepEqual(guest.permissions, []);
  assert.ok(owner.permissions.includes("access.manage"));
  assert.ok(owner.permissions.includes("engineer.mcp"));
  assert.ok(developer.permissions.includes("console.access"));
  assert.ok(developer.permissions.includes("engineer.mcp"));
  assert.ok(!member.permissions.includes("members.remove"));
  assert.ok(!member.permissions.includes("console.access"));
  assert.ok(!member.permissions.includes("engineer.mcp"));
  assert.ok(admin.permissions.includes("members.remove"));
  assert.equal(owner.assignableToAgents, false);
  assert.equal(admin.assignableToAgents, false);
  assert.equal(developer.assignableToAgents, true);
  assert.equal(member.assignableToAgents, true);
  assert.equal(owner.clearance, "restricted");
  assert.equal(developer.clearance, "confidential");
  assert.equal(member.clearance, "internal");
  assert.equal(guest.clearance, "public");
  assert.equal(store.groups.get(EVERYONE_GROUP)?.name, "Everyone");
  assert.equal(store.groups.get(EVERYONE_GROUP)?.builtIn, true);
  dropStore(h.db);
});

test("diff-then-Apply is atomic", async () => {
  const h = harness();
  const store = storeOf(h.ctx);
  putPrincipal(store, { id: "usr_a", kind: "person", name: "A" });
  putPrincipal(store, { id: "usr_b", kind: "person", name: "B" });
  const created = await rolesCreate(h.ctx, { name: "Clerk", cloneFrom: "rol_guest", idempotencyKey: "k1" });
  const roleId = created.role.id;
  assert.deepEqual(created.role.permissions, []);
  await rolesAssign(h.ctx, { subject: { kind: "person", id: "usr_a" }, roleId });
  const before = [...store.roles.get(roleId)!.permissions];
  const memberBefore = [...store.roles.get("rol_member")!.permissions];
  const preview = await rolesPreview(h.ctx, { roleId, permissions: ["records.edit", "records.edit"] });
  assert.equal(preview.gains.length, 1);
  assert.equal(preview.gains[0]!.principal.id, "usr_a");
  assert.equal(preview.gains[0]!.permission, "records.edit");
  assert.equal(preview.losses.length, 0);
  // A second holder arrives after the preview. The hash covers holders, so Apply must refuse.
  await rolesAssign(h.ctx, { subject: { kind: "person", id: "usr_b" }, roleId });
  await assert.rejects(
    () => rolesApply(h.ctx, { roleId, permissions: ["records.edit"], previewHash: preview.previewHash }),
    (e: unknown) => codeOf(e) === "validation.precondition_failed",
  );
  assert.deepEqual(store.roles.get(roleId)!.permissions, before);
  const again = await rolesPreview(h.ctx, { roleId, permissions: ["records.edit"] });
  assert.equal(again.gains.length, 2);
  const applied = await rolesApply(h.ctx, { roleId, permissions: ["records.edit"], previewHash: again.previewHash });
  assert.deepEqual(applied.role.permissions, ["records.edit"]);
  assert.deepEqual(store.roles.get(roleId)!.permissions, ["records.edit"]);
  await assert.rejects(
    () => rolesApply(h.ctx, { roleId: "rol_member", permissions: ["records.edit"], previewHash: again.previewHash }),
    (e: unknown) => codeOf(e) === "validation.field_locked",
  );
  await assert.rejects(
    () => rolesPreview(h.ctx, { roleId, permissions: ["not.a.permission"] }),
    (e: unknown) => codeOf(e) === "validation.bad_input",
  );
  assert.deepEqual(store.roles.get(roleId)!.permissions, ["records.edit"]);
  assert.deepEqual(store.roles.get("rol_member")!.permissions, memberBefore);
  const same = await rolesCreate(h.ctx, { name: "Other", cloneFrom: "rol_guest", idempotencyKey: "k1" });
  assert.equal(same.role.id, roleId);
  dropStore(h.db);
});
