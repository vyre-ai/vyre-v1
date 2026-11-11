// A record's Files folder holds copies of the record's shares (source projfolder:<recordId>, written by the projects module). Taking a share off the record, or lowering it, takes the copy away
// or lowers it in the same call, so a person who lost the record cannot keep its folder until the next record event or the ten-minute sweep. Other grants on the folder are not touched.
import test from "node:test";
import assert from "node:assert/strict";
import { putPrincipal } from "../handlers/roles.ts";
import { share, unshare, updateGrant } from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { MemoryDb } from "../fixtures/db.ts";
import { storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;

function rig() {
  const db = new MemoryDb();
  const ctx: ShareCtx = { space: "spc_test", principal: { kind: "person", id: "usr_ada" }, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => NOW, db, emit() {} };
  const store = storeOf(ctx);
  for (const id of ["usr_ada", "usr_bea"]) { putPrincipal(store, { id, kind: "person", name: id }); store.setRoles(id, [id === "usr_ada" ? "rol_owner" : "rol_member"]); }
  store.resources.set("spc_test", { id: "spc_test", type: "space", parentId: null, label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set("deal", { id: "deal", type: "record_type", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set("rec_one", { id: "rec_one", type: "record", parentId: "deal", label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set("fld_rec", { id: "fld_rec", type: "folder", parentId: "rec_one", label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set("fld_other", { id: "fld_other", type: "folder", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  store.bump();
  const bea = { kind: "person", id: "usr_bea" } as const;
  const on = (folder: string) => [...store.grants.values()].filter((g) => g.resource.id === folder && g.subject.id === "usr_bea").map((g) => `${g.level}:${g.source ?? ""}`).sort();
  return { ctx, store, bea, on };
}

test("unsharing a record takes its copy on the record's folder away in the same call, and leaves other grants", async () => {
  const { ctx, bea, on } = rig();
  await share(ctx, { resource: { type: "record", id: "rec_one" }, subject: bea, level: "edit", idempotencyKey: "k1" } as never);
  await share(ctx, { resource: { type: "folder", id: "fld_rec" }, subject: bea, level: "edit", source: "projfolder:rec_one", idempotencyKey: "k2" } as never);
  await share(ctx, { resource: { type: "folder", id: "fld_other" }, subject: bea, level: "view", idempotencyKey: "k3" } as never);
  assert.deepEqual(on("fld_rec"), ["edit:projfolder:rec_one"]);
  await unshare(ctx, { resource: { type: "record", id: "rec_one" }, subject: bea });
  assert.deepEqual(on("fld_rec"), [], "the folder copy went with the record share");
  assert.deepEqual(on("fld_other"), ["view:"], "an unrelated folder share stays");
});

test("lowering a record share lowers its copy on the record's folder in the same call", async () => {
  const { ctx, store, bea, on } = rig();
  const g = (await share(ctx, { resource: { type: "record", id: "rec_one" }, subject: bea, level: "edit", idempotencyKey: "k1" } as never)).grant as { id: string };
  await share(ctx, { resource: { type: "folder", id: "fld_rec" }, subject: bea, level: "edit", source: "projfolder:rec_one", idempotencyKey: "k2" } as never);
  await updateGrant(ctx, { grantId: g.id, level: "view" });
  assert.deepEqual(on("fld_rec"), ["view:projfolder:rec_one"]);
  assert.ok(store.grants.size > 0);
});
