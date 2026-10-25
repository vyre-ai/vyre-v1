// Folders, placement, access.share and my_access (P-L7_02, ARCH 4.12, spec 2.4 and 4.9).
// @reads ../migrations/0002_share_folders.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { handlers } from "../impl.ts";
import { putPrincipal } from "../handlers/roles.ts";
import {
  dropShare, foldersCreate, foldersDelete, foldersList, foldersMove, foldersPlace, foldersRename, foldersUnplace, levelFor, lists,
  myAccess, share, shareOf, sharesOf, unshare,
} from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import type { Db } from "../projections.ts";
import { dropStore, EVERYONE, pkey, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** Enough SQL for the access tables: CREATE, INSERT, DELETE (all or by id) and SELECT *. */
class SqlDb implements Db {
  tables = new Map<string, Record<string, unknown>[]>();
  all(sql: string): unknown[] {
    const name = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(sql)?.[1] ?? "";
    const rows = this.tables.get(name);
    if (!rows) throw new Error(`no table ${name}`);
    return rows.map((r) => ({ ...r }));
  }
  run(sql: string, ...args: unknown[]): { changes: number } {
    if (/^CREATE\s+/i.test(sql)) return { changes: 0 };
    const del = /^DELETE\s+FROM\s+([A-Za-z0-9_]+)(\s+WHERE\s+id\s*=\s*\?)?/i.exec(sql);
    if (del) {
      const name = del[1]!;
      const rows = this.tables.get(name) ?? [];
      const keep = del[2] ? rows.filter((r) => r["id"] !== args[0]) : [];
      this.tables.set(name, keep);
      return { changes: rows.length - keep.length };
    }
    const ins = /^INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
    if (!ins) throw new Error(`unsupported sql: ${sql}`);
    const cols = ins[2]!.split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((c, i) => { row[c] = args[i] ?? null; });
    const list = this.tables.get(ins[1]!) ?? [];
    list.push(row);
    this.tables.set(ins[1]!, list);
    return { changes: 1 };
  }
}

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
