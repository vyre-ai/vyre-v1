// Folders, placement, access.share and my_access (P-L7_02, ARCH 4.12, spec 2.4 and 4.9).
// @reads ../migrations/0002_share_folders.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { handlers } from "../impl.ts";
import { putPrincipal } from "../handlers/roles.ts";
import {
  agentsCanCallGet, agentsCanCallSet, dropShare, foldersCreate, foldersDelete, foldersList, foldersMove, foldersPlace, foldersRename, foldersUnplace, levelFor, lists,
  automationSenders, deciders, myAccess, share, shareOf, sharesOf, unshare, updateGrant,
} from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { MemoryDb } from "../fixtures/db.ts";
import type { Db } from "../projections.ts";
import { agentLevel, dropStore, EVERYONE, pkey, setPrivate, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** The access tables' in-memory SQL (modules/access/fixtures/db.ts). */
class SqlDb extends MemoryDb {}

function rig() {
  const db = new SqlDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  let clock = NOW;
  const ctx: ShareCtx = {
    space: "spc_test", principal: { kind: "person", id: "usr_admin" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock, db, emit(name, subject, payload) { events.push({ name, subject, payload }); },
  };
  const store = storeOf(ctx);
  const everyone = store.groups.get(EVERYONE)!;
  for (const id of ["usr_admin", "usr_a", "usr_b", "usr_c"]) {
    putPrincipal(store, { id, kind: "person", name: id });
    store.setRoles(id, [id === "usr_admin" ? "rol_owner" : "rol_member"]);
    everyone.members.push({ kind: "person", id });
  }
  store.bump();
  const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
  const item = (id: string, owner: string | null, type = "site", extra: Record<string, unknown> = {}) => {
    store.resources.set(id, { id, type, parentId: null, label: "public", ownerId: owner, holds: 0, row: { title: id, ...extra } });
    store.bump();
  };
  return { db, ctx, events, store, as, item, tick(ms: number) { clock += ms; }, names: () => events.map((e) => e.name) };
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "no code"; }
  return "no error";
}
const viaOf = (r: ReturnType<typeof rig>, person: string, id: string, type = "site") => myAccess(r.ctx, person).find((x) => x.id === id && x.type === type);

test("every sharing capability has a real handler and the migration declares the tables", () => {
  for (const k of [
    "access.share", "access.unshare", "access.shares_of", "access.lists", "folders.create", "folders.rename", "folders.move",
    "folders.delete", "folders.list", "folders.place", "folders.unplace",
  ]) assert.equal(typeof handlers[k as keyof typeof handlers], "function", k);
  const sql = readFileSync(new URL("../migrations/0002_share_folders.sql", import.meta.url), "utf8");
  for (const t of ["access_folders", "access_placement", "access_placement_prev", "access_my_access"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
});

test("new items are Personal; a shared folder shares what is placed in it and moving out takes it back", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  assert.equal(viaOf(r, "usr_a", "sit_x")?.via, "owner");
  assert.equal(viaOf(r, "usr_b", "sit_x"), undefined);
  const { folder } = await foldersCreate(r.as("usr_a"), { type: "site", name: "Clients" });
  await foldersPlace(r.as("usr_a"), { resource: { type: "site", id: "sit_x" }, folderId: folder.id });
  assert.equal(viaOf(r, "usr_b", "sit_x"), undefined, "an unshared folder shares nothing");
  assert.equal(viaOf(r, "usr_a", "sit_x")?.via, "owner");
  await share(r.as("usr_a"), { resource: { type: "folder", id: folder.id }, subject: { kind: "person", id: "usr_b" }, level: "view" });
  assert.deepEqual({ ...viaOf(r, "usr_b", "sit_x") }, { person: "usr_b", type: "site", id: "sit_x", level: "view", via: "folder" });
  assert.equal(viaOf(r, "usr_b", "fld_missing", "folder"), undefined);
  assert.equal(viaOf(r, "usr_a", "sit_x")?.via, "folder", "the owner now sees it as shared");
  const seen = await lists(r.as("usr_b"), { type: "site", section: "shared" });
  assert.deepEqual(seen.rows.map((x) => [x.id, x.level, x.via, x.folderId]), [["sit_x", "view", "folder", folder.id]]);
  assert.equal(seen.counts["shared"], 1);
  assert.equal(seen.counts[folder.id], 1);
  // nothing was copied: the item has the folder as its parent and no grant of its own
  assert.equal(r.store.resources.get("sit_x")?.parentId, folder.id);
  assert.equal([...r.store.grants.values()].filter((g) => g.resource.id === "sit_x").length, 0);
  await foldersUnplace(r.as("usr_a"), { resource: { type: "site", id: "sit_x" } });
  assert.equal(r.store.resources.get("sit_x")?.parentId, null);
  assert.equal(viaOf(r, "usr_b", "sit_x"), undefined, "moving out removes the inherited access");
  assert.equal(viaOf(r, "usr_a", "sit_x")?.via, "owner");
  const d = authorize(r.store.snapshot(), { principal: "usr_b", action: { perm: null, level: "view" }, resource: { type: "site", id: "sit_x" }, now: NOW });
  assert.equal(d.effect, "deny");
  assert.deepEqual(r.names().filter((n) => n === "item.moved"), ["item.moved", "item.moved"]);
});

test("a direct grant survives a move out; moving between folders restores the original parent on unplace", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  const f1 = (await foldersCreate(a, { type: "site", name: "One" })).folder;
  const f2 = (await foldersCreate(a, { type: "site", name: "Two" })).folder;
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_c" }, level: "edit" });
  await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: f1.id });
  await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: f2.id });
  assert.equal(r.store.resources.get("sit_x")?.parentId, f2.id);
  assert.equal(shareOf(r.ctx).placement.get("site:sit_x"), f2.id);
  await foldersUnplace(a, { resource: { type: "site", id: "sit_x" } });
  assert.equal(r.store.resources.get("sit_x")?.parentId, null);
  assert.equal(viaOf(r, "usr_c", "sit_x")?.level, "edit");
  assert.equal(viaOf(r, "usr_c", "sit_x")?.via, "grant");
});

test("a delegated grant stays inside its parent: you cannot give more than you hold", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_c" }, level: "edit" });
  assert.equal(await code(share(r.as("usr_c"), { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_b" }, level: "manage" })), "permission.not_contained");
  await share(r.as("usr_c"), { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_b" }, level: "edit" });
  assert.equal(viaOf(r, "usr_b", "sit_x")?.level, "edit");
  // a viewer cannot share at all, and a stranger does not even see it
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_admin" }, level: "view" });
  assert.equal(await code(share(r.as("usr_admin"), { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_b" }, level: "view" })), "permission.no_grant");
  r.item("sit_y", "usr_a");
  assert.equal(await code(share(r.as("usr_b"), { resource: { type: "site", id: "sit_y" }, subject: { kind: "person", id: "usr_b" }, level: "view" })), "permission.no_grant");
  // placing into a folder hands the folder's grants over, so the mover must hold at least that much on the item
  const fld = (await foldersCreate(a, { type: "site", name: "Team" })).folder;
  await share(a, { resource: { type: "folder", id: fld.id }, subject: { kind: "person", id: "usr_b" }, level: "manage" });
  await share(a, { resource: { type: "folder", id: fld.id }, subject: { kind: "person", id: "usr_c" }, level: "edit" });
  assert.equal(await code(foldersPlace(r.as("usr_c"), { resource: { type: "site", id: "sit_x" }, folderId: fld.id })), "permission.not_contained");
  assert.equal(r.store.resources.get("sit_x")?.parentId, null, "a refused move changes nothing");
  await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: fld.id });
  assert.equal(viaOf(r, "usr_b", "sit_x")?.level, "manage");
});

test("link grants: view only, expiry defaults to 30 days and caps at 90, the policy decides who may make them", async () => {
  const r = rig();
  r.item("sit_x", "usr_admin");
  const admin = r.ctx;
  const token = "a1b2c3d4e5f60718";
  const input = { resource: { type: "site", id: "sit_x" }, subject: { kind: "link" as const, id: token }, level: "view" as const };
  assert.equal(await code(share(admin, { ...input, level: "edit" })), "validation.precondition_failed");
  assert.equal(await code(share(admin, { ...input, subject: { kind: "link", id: "short" } })), "validation.bad_input");
  assert.equal(await code(share(admin, { ...input, conditions: { expiresAt: NOW + 91 * DAY } })), "validation.precondition_failed");
  const { grant } = await share(admin, input);
  assert.equal(grant.conditions.expiresAt, NOW + 30 * DAY);
  assert.equal(grant.subject.kind, "link");
  // a Member owns an item of their own but the default policy is admins only
  r.item("sit_m", "usr_a");
  assert.equal(await code(share(r.as("usr_a"), { ...input, resource: { type: "site", id: "sit_m" } })), "permission.role_lacks_permission");
  r.store.policies.set(pkey("sharing.public_links", "space"), { key: "sharing.public_links", scope: "space", kind: "sharing", value: "members", updatedAt: NOW });
  await share(r.as("usr_a"), { ...input, resource: { type: "site", id: "sit_m" } });
  r.store.policies.set(pkey("sharing.public_links", "space"), { key: "sharing.public_links", scope: "space", kind: "sharing", value: "off", updatedAt: NOW });
  assert.equal(await code(share(admin, { ...input, subject: { kind: "link", id: "ffeeddccbbaa9988" } })), "validation.precondition_failed");
  // the link never gives a signed-in person anything
  assert.equal(myAccess(r.ctx, "usr_b").some((x) => x.id === "sit_x"), false);
  const shown = await sharesOf(admin, { resource: { type: "site", id: "sit_x" } });
  assert.deepEqual(shown.shares.map((s) => s.through), ["owner", "direct"]);
});

test("link grants: none is made for anything Restricted, by its own label or a folder above it (lead ruling 3 Nov, l-labelinherit)", async () => {
  const r = rig();
  const admin = r.ctx;
  const put = (id: string, type: string, parentId: string | null, label: "public" | "restricted" = "public") => { r.store.resources.set(id, { id, type, parentId, label, ownerId: "usr_admin", holds: 0 }); r.store.bump(); };
  put("vfd_partners", "vault_folder", null, "restricted");
  put("vfd_deals", "vault_folder", "vfd_partners");
  put("vit_bank", "vault_item", "vfd_deals");
  put("vfd_open", "vault_folder", null);
  put("vit_open", "vault_item", "vfd_open");
  const link = (id: string, token: string) => share(admin, { resource: { type: id.startsWith("vit") ? "vault_item" : "vault_folder", id }, subject: { kind: "link", id: token }, level: "view" });
  for (const id of ["vfd_partners", "vfd_deals", "vit_bank"]) assert.equal(await code(link(id, "a1b2c3d4e5f60718")), "validation.precondition_failed", id);
  put("vit_own", "vault_item", "vfd_open", "restricted");
  assert.equal(await code(link("vit_own", "a1b2c3d4e5f60718")), "validation.precondition_failed", "its own label counts as well");
  const { grant } = await link("vit_open", "a1b2c3d4e5f60718");
  assert.equal(grant.subject.kind, "link", "outside a Restricted folder a link is made as before");
  // the folder becomes Restricted: the link made before it cannot be renewed or changed
  put("vfd_open", "vault_folder", null, "restricted");
  assert.equal(await code(updateGrant(admin, { grantId: grant.id, conditions: { expiresAt: NOW + 10 * DAY } })), "validation.precondition_failed");
});

test("a Space folder is visible to everyone and only a person who may share can make one", async () => {
  const r = rig();
  r.item("sit_x", "usr_admin");
  assert.equal(await code(foldersCreate(r.as("usr_a"), { type: "site", name: "Everyone", scope: "space" })), "permission.role_lacks_permission");
  const { folder } = await foldersCreate(r.ctx, { type: "site", name: "Public sites", scope: "space" });
  assert.equal(folder.scope, "space");
  await foldersPlace(r.ctx, { resource: { type: "site", id: "sit_x" }, folderId: folder.id });
  assert.deepEqual({ ...viaOf(r, "usr_a", "sit_x") }, { person: "usr_a", type: "site", id: "sit_x", level: "view", via: "space" });
  assert.equal(viaOf(r, "usr_admin", "sit_x")?.via, "space");
  const mine = await lists(r.as("usr_a"), { type: "site" });
  assert.equal(mine.counts["space"], 1);
  assert.equal(mine.counts["personal"], 0);
  assert.equal(await code(foldersCreate(r.ctx, { type: "site", name: "Inner", parentId: folder.id, scope: "personal" })), "validation.precondition_failed");
  assert.equal(await code(foldersCreate(r.as("usr_a"), { type: "site", name: "Inner", parentId: folder.id })), "permission.no_grant", "view is not enough to add a folder here");
  const inner = (await foldersCreate(r.ctx, { type: "site", name: "Inner", parentId: folder.id })).folder;
  assert.equal(inner.scope, "space", "a child takes its parent's scope");
});

test("deleting a folder gives its items back, revokes its grants and leaves no orphan", async () => {
  const r = rig();
  r.item("sit_own", "usr_a");
  r.item("sit_free", null);
  const a = r.as("usr_a");
  const f = (await foldersCreate(a, { type: "site", name: "Old" })).folder;
  const sub = (await foldersCreate(a, { type: "site", name: "Sub", parentId: f.id })).folder;
  await foldersPlace(a, { resource: { type: "site", id: "sit_own" }, folderId: f.id });
  await foldersPlace(a, { resource: { type: "site", id: "sit_free" }, folderId: sub.id }).catch(() => undefined);
  await share(a, { resource: { type: "folder", id: f.id }, subject: { kind: "person", id: "usr_b" }, level: "view" });
  assert.equal(viaOf(r, "usr_b", "sit_own")?.via, "folder");
  r.events.length = 0;
  assert.deepEqual(await foldersDelete(a, { folderId: f.id }), { deleted: true });
  assert.equal(r.store.resources.has(f.id), false);
  assert.equal(r.store.resources.has(sub.id), false);
  assert.equal(shareOf(r.ctx).folders.size, 0);
  assert.equal(r.store.resources.get("sit_own")?.parentId, null);
  assert.equal(viaOf(r, "usr_b", "sit_own"), undefined);
  assert.equal(viaOf(r, "usr_a", "sit_own")?.via, "owner");
  assert.equal([...r.store.grants.values()].some((g) => g.resource.id === f.id), false);
  assert.ok(r.names().includes("grant.revoked") && r.names().includes("folder.deleted"));
  assert.equal(r.names().filter((n) => n === "folder.deleted").length, 2);
  assert.deepEqual(myAccess(r.ctx, "usr_a").filter((x) => x.type === "folder"), []);
});

test("an ownerless item taken out of a folder goes to the person who took it out", async () => {
  const r = rig();
  r.item("sit_free", "usr_admin");
  const f = (await foldersCreate(r.ctx, { type: "site", name: "Shared", scope: "space" })).folder;
  await share(r.ctx, { resource: { type: "folder", id: f.id }, subject: { kind: "person", id: "usr_a" }, level: "manage" });
  await foldersPlace(r.ctx, { resource: { type: "site", id: "sit_free" }, folderId: f.id });
  r.store.resources.get("sit_free")!.ownerId = null;   // the owner was removed from the Space
  r.store.bump();
  await foldersUnplace(r.as("usr_a"), { resource: { type: "site", id: "sit_free" } });
  assert.equal(r.store.resources.get("sit_free")?.ownerId, "usr_a");
  assert.equal(viaOf(r, "usr_a", "sit_free")?.via, "owner");
});

test("unshare by grant, by resource and subject, and by source (a project member leaving)", async () => {
  const r = rig();
  for (const id of ["prj_1", "prj_2", "prj_3"]) r.item(id, "usr_admin", "project");
  const src = "project:prj_1";
  for (const id of ["prj_1", "prj_2"]) await share(r.ctx, { resource: { type: "project", id }, subject: { kind: "person", id: "usr_b" }, level: "edit", source: src });
  const own = await share(r.ctx, { resource: { type: "project", id: "prj_3" }, subject: { kind: "person", id: "usr_b" }, level: "view" });
  assert.equal(myAccess(r.ctx, "usr_b").filter((x) => x.type === "project").length, 3);
  assert.equal(await code(unshare(r.ctx, {})), "validation.bad_input");
  assert.equal(await code(unshare(r.as("usr_a"), { source: src })), "permission.no_grant");
  r.events.length = 0;
  assert.deepEqual(await unshare(r.ctx, { source: src }), { revoked: 2 });
  assert.deepEqual(myAccess(r.ctx, "usr_b").filter((x) => x.type === "project").map((x) => x.id), ["prj_3"]);
  assert.equal(r.names().filter((n) => n === "grant.revoked").length, 2);
  assert.deepEqual(await unshare(r.ctx, { resource: { type: "project", id: "prj_3" }, subject: { kind: "person", id: "usr_b" } }), { revoked: 1 });
  assert.equal(r.store.grants.has(own.grant.id), false);
  assert.deepEqual(await unshare(r.ctx, { grantId: own.grant.id }).catch(() => "gone"), "gone");
  assert.equal(myAccess(r.ctx, "usr_b").filter((x) => x.type === "project").length, 0);
});

test("sharing again with the same key does nothing twice; the same subject and source updates in place", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  const input = { resource: { type: "site", id: "sit_x" }, subject: { kind: "person" as const, id: "usr_b" }, level: "view" as const, idempotencyKey: "k1" };
  const first = await share(a, input);
  const again = await share(a, input);
  assert.equal(again.grant.id, first.grant.id);
  assert.equal(r.names().filter((n) => n === "grant.created").length, 1);
  const up = await share(a, { ...input, idempotencyKey: "k2", level: "edit" });
  assert.equal(up.grant.id, first.grant.id);
  assert.equal(up.grant.level, "edit");
  assert.equal(r.names().filter((n) => n === "grant.created").length, 1);
  assert.equal(viaOf(r, "usr_b", "sit_x")?.level, "edit");
  assert.equal(await code(share(a, { ...input, idempotencyKey: "k3", subject: { kind: "person", id: "usr_nobody" } })), "validation.not_found");
  assert.equal(await code(share(a, { ...input, idempotencyKey: "k4", subject: { kind: "agent", id: "usr_b" } })), "validation.bad_input");
  assert.equal(await code(share(a, { ...input, idempotencyKey: "k5", conditions: { expiresAt: NOW - 1 } })), "validation.precondition_failed");
});

test("sharing a folder emits grant.created, access.changed and folder.shared in that order; unsharing it says removed", async () => {
  const r = rig();
  const f = (await foldersCreate(r.as("usr_a"), { type: "site", name: "F" })).folder;
  r.events.length = 0;
  const { grant } = await share(r.as("usr_a"), { resource: { type: "folder", id: f.id }, subject: { kind: "person", id: "usr_b" }, level: "use" });
  assert.deepEqual(r.names(), ["grant.created", "access.changed", "folder.shared"]);
  assert.deepEqual(r.events[2]?.payload, { folderId: f.id, subject: { kind: "person", id: "usr_b" }, level: "use", removed: false });
  r.events.length = 0;
  await unshare(r.as("usr_a"), { grantId: grant.id });
  assert.deepEqual(r.names(), ["grant.revoked", "access.changed", "folder.shared"]);
  assert.equal((r.events[2]?.payload as { removed: boolean }).removed, true);
});

test("shares_of names who has access and through what", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  const f = (await foldersCreate(a, { type: "site", name: "F" })).folder;
  await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: f.id });
  await share(a, { resource: { type: "folder", id: f.id }, subject: { kind: "person", id: "usr_b" }, level: "view" });
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "role", id: "rol_guest" }, level: "view" });
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_c" }, level: "edit" });
  const { shares } = await sharesOf(a, { resource: { type: "site", id: "sit_x" } });
  assert.deepEqual(shares.map((s) => [s.grant.subject.id, s.through]).sort(), [["rol_guest", "role"], ["usr_a", "owner"], ["usr_b", "folder"], ["usr_c", "direct"]]);
  assert.equal(await code(sharesOf(r.as("usr_b"), { resource: { type: "site", id: "sit_x" } })), "no error", "a viewer may look");
  r.item("sit_y", "usr_a");
  assert.equal(await code(sharesOf(r.as("usr_b"), { resource: { type: "site", id: "sit_y" } })), "permission.no_grant");
});

test("shares_of tells the caller their own level, so the sheet offers nothing above it", async () => {
  const r = rig();
  r.item("sit_m", "usr_a");
  const a = r.as("usr_a");
  await share(a, { resource: { type: "site", id: "sit_m" }, subject: { kind: "person", id: "usr_b" }, level: "edit" });
  assert.equal((await sharesOf(a, { resource: { type: "site", id: "sit_m" } })).mine, "manage");
  assert.equal((await sharesOf(r.as("usr_b"), { resource: { type: "site", id: "sit_m" } })).mine, "edit");
});

test("shares_of never lists the item itself or another person's private agent, but its own person still sees it", async () => {
  const r = rig();
  r.item("agt_dex", "usr_a", "agent");
  const store = r.store;
  putPrincipal(store, { id: "agt_dex", kind: "agent", name: "Dex" });
  putPrincipal(store, { id: "agt_aliza", kind: "agent", name: "Assistant", owner: "usr_b" });
  putPrincipal(store, { id: "agt_docs", kind: "agent", name: "Docs" });
  setPrivate(store, "agt_aliza", true);
  store.bump();
  const a = r.as("usr_a");
  const res = { type: "agent" as const, id: "agt_dex" };
  for (const id of ["agt_dex", "agt_aliza", "agt_docs"]) await share(a, { resource: res, subject: { kind: "agent", id }, level: "edit" });
  const seen = async (who: string): Promise<string[]> => (await sharesOf(r.as(who), { resource: res })).shares.map((s) => s.grant.subject.id).sort();
  assert.deepEqual(await seen("usr_a"), ["agt_docs", "usr_a"], "not itself, not Aliza's private agent");
  await share(a, { resource: res, subject: { kind: "person", id: "usr_b" }, level: "view" });
  assert.deepEqual(await seen("usr_b"), ["agt_aliza", "agt_docs", "usr_a", "usr_b"], "its own person still sees it");
});

test("deciders names the people who hold Manage, and shows a caller who cannot see the resource nothing but those ids", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_b" }, level: "manage" });
  await share(a, { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_c" }, level: "view" });
  assert.deepEqual(await deciders(r.as("usr_a"), { resource: { type: "site", id: "sit_x" } }), { people: ["usr_a", "usr_b"] });
  // usr_c may not list the shares, but can still find who decides
  assert.equal(await code(sharesOf(r.as("usr_d"), { resource: { type: "site", id: "sit_x" } })), "permission.no_grant");
  assert.deepEqual(await deciders(r.as("usr_d"), { resource: { type: "site", id: "sit_x" } }), { people: ["usr_a", "usr_b"] });
  assert.equal(await code(deciders(r.as("usr_a"), { resource: { type: "site", id: "sit_none" } })), "validation.not_found");
});

test("folders: names are unique among siblings, a folder cannot move into itself or across scopes, counts follow the items", async () => {
  const r = rig();
  for (const id of ["sit_1", "sit_2", "sit_3"]) r.item(id, "usr_a");
  const a = r.as("usr_a");
  const top = (await foldersCreate(a, { type: "site", name: "Top" })).folder;
  assert.equal(await code(foldersCreate(a, { type: "site", name: "top" })), "validation.duplicate");
  assert.equal(await code(foldersCreate(a, { type: "site", name: "  " })), "validation.bad_input");
  const other = (await foldersCreate(r.as("usr_b"), { type: "site", name: "Top" })).folder;
  assert.notEqual(other.id, top.id, "another person's personal folder may share a name");
  const kid = (await foldersCreate(a, { type: "site", name: "Kid", parentId: top.id })).folder;
  assert.equal(await code(foldersMove(a, { folderId: top.id, parentId: kid.id })), "validation.precondition_failed");
  assert.equal(await code(foldersMove(a, { folderId: top.id, parentId: top.id })), "validation.precondition_failed");
  assert.equal(await code(foldersCreate(a, { type: "form", name: "Wrong", parentId: top.id })), "validation.precondition_failed");
  await foldersPlace(a, { resource: { type: "site", id: "sit_1" }, folderId: top.id });
  await foldersPlace(a, { resource: { type: "site", id: "sit_2" }, folderId: kid.id });
  assert.equal(await code(foldersPlace(a, { resource: { type: "form", id: "frm_x" }, folderId: top.id })), "validation.not_found");
  r.item("frm_x", "usr_a", "form");
  assert.equal(await code(foldersPlace(a, { resource: { type: "form", id: "frm_x" }, folderId: top.id })), "validation.precondition_failed");
  const tree = await foldersList(a, { type: "site" });
  assert.deepEqual(tree.folders.map((f) => [f.name, f.parentId ?? null, f.count]).sort(), [["Kid", top.id, 1], ["Top", null, 2]]);
  assert.deepEqual((await foldersList(r.as("usr_c"), { type: "site" })).folders, []);
  await foldersRename(a, { folderId: kid.id, name: "Kiddo" });
  assert.equal(await code(foldersRename(a, { folderId: kid.id, name: "kiddo" })), "no error");
  assert.equal(await code(foldersRename(r.as("usr_b"), { folderId: kid.id, name: "Mine" })), "permission.no_grant");
  const moved = await foldersMove(a, { folderId: kid.id, parentId: null });
  assert.equal(moved.folder.parentId, undefined);
  assert.equal((await foldersList(a, { type: "site" })).folders.find((f) => f.id === top.id)?.count, 1);
  const space = (await foldersCreate(r.ctx, { type: "site", name: "S", scope: "space" })).folder;
  assert.equal(await code(foldersMove(a, { folderId: kid.id, parentId: space.id })), "validation.precondition_failed");
  const view = await lists(a, { type: "site", folder: top.id });
  assert.deepEqual(view.rows.map((x) => x.id), ["sit_1"]);
  assert.equal(view.counts["personal"], 3);
});

test("the vault ladder is use < view < edit < manage when levels are compared", async () => {
  const r = rig();
  r.item("vit_1", "usr_admin", "vault_item");
  await share(r.ctx, { resource: { type: "vault_item", id: "vit_1" }, subject: { kind: "person", id: "usr_b" }, level: "use" });
  await share(r.ctx, { resource: { type: "vault_item", id: "vit_1" }, subject: { kind: "role", id: "rol_member" }, level: "view" });
  assert.equal(levelFor(r.store, "usr_b", r.store.resources.get("vit_1")!, NOW), "view", "view is above use in the vault");
  r.item("sit_1", "usr_admin");
  await share(r.ctx, { resource: { type: "site", id: "sit_1" }, subject: { kind: "person", id: "usr_b" }, level: "use" });
  await share(r.ctx, { resource: { type: "site", id: "sit_1" }, subject: { kind: "role", id: "rol_member" }, level: "view" });
  assert.equal(levelFor(r.store, "usr_b", r.store.resources.get("sit_1")!, NOW), "use", "use is above view elsewhere");
});

test("the cache follows time: a grant that expires leaves the list without any write", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  await share(r.as("usr_a"), { resource: { type: "site", id: "sit_x" }, subject: { kind: "person", id: "usr_b" }, level: "view", conditions: { expiresAt: NOW + 1000 } });
  assert.equal((await lists(r.as("usr_b"), { type: "site" })).rows.length, 1);
  r.tick(1001);
  assert.equal((await lists(r.as("usr_b"), { type: "site" })).rows.length, 0);
  assert.equal(myAccess(r.ctx, "usr_b").length, 0);
  assert.equal(r.db.tables.get("access_my_access")?.some((x) => x["person"] === "usr_b" && x["resourceId"] === "sit_x"), false);
});

test("Starred and Following come from the marks the host hands in, and are empty without them", async () => {
  const r = rig();
  r.item("sit_1", "usr_a");
  r.item("sit_2", "usr_a");
  assert.deepEqual((await lists(r.as("usr_a"), { type: "site", section: "starred" })).rows, []);
  const marked: ShareCtx = {
    ...r.as("usr_a"), marks: () => ({ starred: new Set(["sit_2"]), following: new Set(["sit_1", "sit_2"]) }),
  };
  const starred = await lists(marked, { type: "site", section: "starred" });
  assert.deepEqual(starred.rows.map((x) => [x.id, x.starred, x.following]), [["sit_2", true, true]]);
  assert.equal((await lists(marked, { type: "site", section: "following" })).rows.length, 2);
  assert.deepEqual([starred.counts["starred"], starred.counts["following"], starred.counts["personal"]], [1, 2, 2]);
  assert.equal((await lists(marked, { type: "site", limit: 1 })).next, "1");
});

test("a reload from the tables gives the same folders, placement and my_access", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  const a = r.as("usr_a");
  const f = (await foldersCreate(a, { type: "site", name: "F" })).folder;
  await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: f.id });
  await share(a, { resource: { type: "folder", id: f.id }, subject: { kind: "person", id: "usr_b" }, level: "edit" });
  const byId = (rows: ReturnType<typeof myAccess>) => [...rows].sort((x, y) => (x.id < y.id ? -1 : 1));
  const before = { access: byId(myAccess(r.ctx, "usr_b")), listed: (await lists(r.as("usr_b"), { type: "site" })).rows };
  const rows = r.db.tables.get("access_my_access")!.length;
  dropStore(r.db);
  dropShare(r.db);
  const ss = shareOf(r.ctx);
  assert.equal(ss.folders.get(f.id)?.name, "F");
  assert.equal(ss.placement.get("site:sit_x"), f.id);
  assert.equal(ss.prev.get("site:sit_x"), null);
  assert.deepEqual(byId(myAccess(r.ctx, "usr_b")), before.access);
  assert.deepEqual((await lists(r.as("usr_b"), { type: "site" })).rows, before.listed);
  assert.equal(r.db.tables.get("access_my_access")!.length, rows, "the rebuild after a reload writes nothing new");
  await foldersUnplace(a, { resource: { type: "site", id: "sit_x" } });
  assert.equal(viaOf(r, "usr_b", "sit_x"), undefined);
});

// run on the final commit of P-CC_28

// ---- what a person's press gives a Space Automation

test("a person's press gives the Automation's service use of what its steps name, inside their own access, and takes back what no step names", async () => {
  const r = rig();
  const store = storeOf(r.ctx);
  const box = (id: string): void => { store.resources.set(id, { id, type: "mailbox", parentId: null, label: "public", ownerId: "usr_a", holds: 0, row: { title: id } }); };
  box("mbx_mine"); box("mbx_other");
  store.grants.set("gnt_b", { id: "gnt_b", subject: { kind: "person", id: "usr_b" }, resource: { type: "mailbox", id: "mbx_mine" }, level: "use", conditions: {}, by: "usr_a", createdAt: NOW } as never);
  store.bump();
  const press = { ...r.as("usr_b"), depth: 1 } as ShareCtx;
  const input = { automationId: "aut_flow", give: [{ type: "mailbox", id: "mbx_mine" }, { type: "mailbox", id: "mbx_other" }], keep: [] };
  const out = await automationSenders(press, input);
  assert.ok(out.granted.some((g) => g.resource.id === "mbx_mine" && g.level === "use"), JSON.stringify(out));
  assert.ok(out.refused.some((x) => x.id === "mbx_other"), "their own access is the ceiling");
  const row = [...store.grants.values()].find((g) => g.resource.id === "mbx_mine" && g.source === "automation:aut_flow")!;
  assert.deepEqual([row.subject, row.by], [{ kind: "service", id: "svc_flow" }, "usr_b"], "the row says who pressed");
  assert.ok(r.events.some((e) => e.name === "grant.created" && (e.payload as { source?: string }).source === "automation:aut_flow"));
  const again = await automationSenders(press, { automationId: "aut_flow", give: [], keep: [] });
  assert.ok(again.revoked >= 1, "a sender no step names loses its row");
  assert.equal([...store.grants.values()].filter((g) => g.source === "automation:aut_flow").length, 0);
});

test("only a person's press reaches it: not a direct call, not an agent, not a service", async () => {
  const r = rig();
  const input = { automationId: "aut_flow", give: [], keep: [] };
  await assert.rejects(automationSenders(r.as("usr_a"), input), /turning it on/, "a direct call");
  await assert.rejects(automationSenders({ ...r.ctx, depth: 1, principal: { kind: "agent", id: "agt_a" } } as ShareCtx, input), /turning it on/, "an agent's save");
  await assert.rejects(automationSenders({ ...r.ctx, depth: 1, principal: { kind: "service", id: "svc_x" } } as ShareCtx, input), /turning it on/);
});

test("sharing with Everyone skips the admin check for the host's own service alone: any other svc_ principal, any other service and an id that only looks like the host's are refused", async () => {
  const r = rig();
  r.item("sit_all", null);
  const asP = (kind: string, id: string): ShareCtx => ({ ...r.ctx, principal: { kind, id } as ShareCtx["principal"] });
  const toEveryone = (ctx: ShareCtx) => share(ctx, { resource: { type: "site", id: "sit_all" }, subject: { kind: "group", id: EVERYONE }, level: "view" });
  for (const [kind, id] of [["service", "svc_form_a1b2c3"], ["service", "svc_engine"], ["service", "svc_hostile"], ["service", "svc_host_2"], ["agent", "svc_host"], ["person", "svc_host"]] as const) {
    assert.equal(await code(toEveryone(asP(kind, id))), "permission.role_lacks_permission", `${kind} ${id} is refused`);
  }
  assert.equal(await code(toEveryone(r.as("usr_a"))), "permission.role_lacks_permission", "a member is refused");
  // the host's own service passes the Everyone gate; the share then needs the right to share the item, like any share (this rig gives the host no grant, so that is where it stops)
  assert.equal(await code(toEveryone(asP("service", "svc_host"))), "permission.no_grant", "the host's own service is past the Everyone gate");
});

test("a guest never shares with Everyone, not even an item Everyone already holds at that level: refused before the existing-grant shortcut; an admin may repeat it", async () => {
  const r = rig();
  putPrincipal(r.store, { id: "usr_guest", kind: "person", name: "usr_guest" });
  r.store.setRoles("usr_guest", ["rol_guest"]);
  r.store.bump();
  r.item("sit_open", "usr_admin");
  const toEveryone = (ctx: ShareCtx, level: "view" | "use") => share(ctx, { resource: { type: "site", id: "sit_open" }, subject: { kind: "group", id: EVERYONE }, level });
  await toEveryone(r.as("usr_admin"), "use");   // the admin shares it with Everyone first
  assert.equal(await code(toEveryone(r.as("usr_guest"), "use")), "permission.role_lacks_permission", "the same level again: still refused for a guest");
  assert.equal(await code(toEveryone(r.as("usr_guest"), "view")), "permission.role_lacks_permission", "a lower level: refused for a guest");
  const agentForGuest: ShareCtx = { ...r.ctx, principal: { kind: "agent", id: "agt_guestbot" }, actingFor: "usr_guest" } as ShareCtx;
  assert.equal(await code(toEveryone(agentForGuest, "use")), "permission.role_lacks_permission", "an agent acting for a guest: refused");
  assert.equal(await code(toEveryone(r.as("usr_admin"), "use")), "no error", "an admin repeats it");
});

test("agents can call: On unless a person with Manage turns it Off; an agent, a Viewer and a stranger cannot change it", async () => {
  const r = rig();
  r.item("agt_dex", "usr_a", "agent");
  putPrincipal(r.store, { id: "agt_x", kind: "agent", name: "X", owner: "usr_a" });
  const res = { type: "agent" as const, id: "agt_dex" };
  const a = r.as("usr_a");
  assert.deepEqual(await agentsCanCallGet(a, { agentId: "agt_dex" }), { on: true }, "On by default");
  assert.equal((await sharesOf(a, { resource: res })).agentsCanCall, true);
  await share(a, { resource: res, subject: { kind: "person", id: "usr_b" }, level: "view" });
  assert.equal(await code(agentsCanCallSet(r.as("usr_b"), { agentId: "agt_dex", on: false })), "permission.no_grant", "a Viewer cannot");
  assert.equal(await code(agentsCanCallSet(r.as("usr_c"), { agentId: "agt_dex", on: false })), "permission.no_grant", "a stranger cannot");
  const agent: ShareCtx = { ...a, principal: { kind: "agent", id: "agt_x" } };
  assert.equal(await code(agentsCanCallSet(agent, { agentId: "agt_dex", on: false })), "permission.no_grant", "an agent never does");
  assert.deepEqual(await agentsCanCallGet(a, { agentId: "agt_dex" }), { on: true }, "nothing changed");
  assert.deepEqual(await agentsCanCallSet(a, { agentId: "agt_dex", on: false }), { on: false });
  assert.deepEqual(await agentsCanCallGet(r.as("usr_c"), { agentId: "agt_dex" }), { on: false }, "anyone can read it");
  assert.equal((await sharesOf(a, { resource: res })).agentsCanCall, false);
  assert.deepEqual(await agentsCanCallSet(a, { agentId: "agt_dex", on: true }), { on: true });
  assert.equal((await sharesOf(a, { resource: res })).agentsCanCall, true);
  assert.equal(await code(agentsCanCallGet(a, { agentId: "sit_none" })), "validation.not_found");
});

test("an agent has three levels: an old Can chat with (view) grant reads as Can use, and sharing at view stores use", async () => {
  const r = rig();
  r.item("agt_dex", "usr_a", "agent");
  const a = r.as("usr_a");
  const res = { type: "agent" as const, id: "agt_dex" };
  assert.equal(agentLevel("agent", "view"), "use");
  assert.equal(agentLevel("agent", "use"), "use");
  assert.deepEqual(["edit", "manage"].map((l) => agentLevel("agent", l as "edit" | "manage")), ["edit", "manage"]);
  assert.equal(agentLevel("file", "view"), "view", "other kinds keep View");
  const g = (await share(a, { resource: res, subject: { kind: "person", id: "usr_b" }, level: "view" })).grant;
  assert.equal(g.level, "use");
  assert.equal((await sharesOf(a, { resource: res })).shares.find((x) => x.grant.subject.id === "usr_b")?.grant.level, "use");
  // a stored row from before the merge is read as use
  r.store.grants.set("gnt_old", { id: "gnt_old", subject: { kind: "person", id: "usr_c" }, resource: { type: "agent", id: "agt_dex" }, level: "view", conditions: {}, by: "usr_a", createdAt: 1 });
  assert.equal(agentLevel("agent", r.store.grants.get("gnt_old")!.level), "use");
});

test("migration 0005 turns every stored View grant on an agent into Use and drops a duplicate", () => {
  const sql = readFileSync(new URL("../migrations/0005_agent_levels.sql", import.meta.url), "utf8");
  assert.match(sql, /UPDATE "access_grants" SET "level" = 'use' WHERE "resourceType" = 'agent' AND "level" = 'view'/);
  assert.match(sql, /DELETE FROM "access_grants" WHERE "resourceType" = 'agent' AND "level" = 'view' AND EXISTS/);
  const db = new DatabaseSync(":memory:");
  db.exec('CREATE TABLE "access_grants" ("id" TEXT, "subjectKind" TEXT, "subjectId" TEXT, "resourceType" TEXT, "resourceId" TEXT, "level" TEXT)');
  const put = db.prepare('INSERT INTO "access_grants" VALUES (?,?,?,?,?,?)');
  put.run("g1", "person", "usr_b", "agent", "agt_dex", "view");     // becomes use
  put.run("g2", "person", "usr_c", "agent", "agt_dex", "view");     // also holds use: the view row goes
  put.run("g3", "person", "usr_c", "agent", "agt_dex", "use");
  put.run("g4", "person", "usr_b", "file", "fil_1", "view");        // another kind: untouched
  put.run("g5", "person", "usr_d", "agent", "agt_dex", "edit");
  db.exec(sql);
  const rows = db.prepare('SELECT "id","level" FROM "access_grants" ORDER BY "id"').all().map((r) => [r.id, r.level]);
  assert.deepEqual(rows, [["g1", "use"], ["g3", "use"], ["g4", "view"], ["g5", "edit"]]);
});

test("sharing with notify tells the person once; without it nobody is told; never oneself", async () => {
  const r = rig();
  r.item("agt_dex", "usr_a", "agent");
  const a = r.as("usr_a");
  const res = { type: "agent" as const, id: "agt_dex" };
  await share(a, { resource: res, subject: { kind: "person", id: "usr_b" }, level: "use" });
  assert.equal(r.names().filter((n) => n === "access.shared_with").length, 0, "no notify, no word");
  await share(a, { resource: res, subject: { kind: "person", id: "usr_c" }, level: "use", notify: { message: "Take a look" } });
  const told = r.events.filter((e) => e.name === "access.shared_with");
  assert.equal(told.length, 1);
  assert.deepEqual(told[0]!.payload, { to: "usr_c", resource: res, level: "use", byName: "usr_a", title: "agt_dex", message: "Take a look" });
  await share(a, { resource: res, subject: { kind: "person", id: "usr_a" }, level: "use", notify: {} });
  assert.equal(r.events.filter((e) => e.name === "access.shared_with").length, 1, "not oneself");
});
