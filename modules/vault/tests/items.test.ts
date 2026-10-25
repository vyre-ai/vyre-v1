// Vault items (P-L7_09; spec 2.17, 3.8; ARCH 7.8): items are a name plus KEY=value fields; Mine items are sealed under the owner's item key and unreadable by anyone else, admins included; Shared items
// are sealed by the filler and decryptable only there; lists and get never carry a value; reveal needs View, is logged per field and never lands in an event, a call, a log or the database in the clear.
// @reads /modules/vault/migrations/0001_vault.sql
// @reads /modules/vault/handlers/items.ts
// @reads /modules/vault/handlers/crypto.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { Filler } from "../handlers/index.ts";
import { openMine, wrapKeyFromPersonKey } from "../handlers/crypto.ts";
import { ADMIN, AGENT, MAYA, NOW, ROB, SECRET, contractErrors, harness, keyOfPerson, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { validateEvent } from "../../../generated/validators.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `k-${++seq}`;

async function folder(h: Harness, scope: "mine" | "shared", name = `${scope} folder`, parentId?: string): Promise<string> {
  return String(out(out(await v.foldersCreate(h.ctx, { name, scope, ...(parentId ? { parentId } : {}), idempotencyKey: key() })).folder).id);
}
async function put(h: Harness, folderId: string, name: string, o: Json = {}): Promise<string> {
  const made = out(await v.itemPut(h.ctx, {
    folderId, name, kind: "api_key", fields: [{ key: "username", value: "dana" }, { key: "api_key", value: SECRET }], idempotencyKey: key(), ...o,
  } as Parameters<typeof v.itemPut>[1]));
  assert.deepEqual(contractErrors("vault.item.put", "out", made), []);
  return String(out(made.item).id);
}
const secretRow = (h: Harness, id: string) => h.rows(`SELECT * FROM vault_secret WHERE "itemId" = ?`, id)[0] ?? {};
const reveal = async (h: Harness, id: string, o: Json = {}) => out(await v.itemReveal(h.ctx, { itemId: id, ...o }));

test("a Mine item is sealed under its owner's item key (enc=2); lists and get carry names and field keys, never a value", async () => {
  const h = harness();
  const mine = await folder(h, "mine", "My keys");
  const made = out(await v.itemPut(h.ctx, { folderId: mine, name: "Dana Lawmatics", kind: "api_key", fields: [{ key: "username", value: "dana" }, { key: "api_key", value: SECRET }], idempotencyKey: "put-1" }));
  const item = out(made.item);
  assert.deepEqual([item.scope, item.owner, item.handle, item.fieldKeys, item.yourLevel, item.label, item.createdAt, item.spaceOnly], ["mine", MAYA, "#Dana_Lawmatics", ["username", "api_key"], "manage", 0, NOW, false]);
  assert.deepEqual(h.named("vault.item_created")[0]?.payload, { itemId: item.id, kind: "api_key", folderId: mine, scope: "mine" });

  const sealed = secretRow(h, String(item.id));
  assert.equal(sealed.enc, 2, "Mine rows are enc=2");
  assert.ok(String(sealed.keyId).startsWith("k_") && sealed.wrapped, "an item key, wrapped for the owner");
  assert.ok(!String(sealed.box).includes(SECRET) && !String(sealed.box).includes("dana"), "the box is ciphertext");
  assert.ok(!h.everything().includes(SECRET), "no value in the database, an event, a call or a log");

  const got = out(await v.itemGet(h.ctx, { itemId: String(item.id) }));
  assert.deepEqual(contractErrors("vault.item.get", "out", got), []);
  assert.deepEqual(got.fields, [{ key: "username", secret: false, hasValue: true }, { key: "api_key", secret: true, hasValue: true }]);
  const listed = out(await v.itemsList(h.ctx, {}));
  assert.deepEqual(contractErrors("vault.items.list", "out", listed), []);
  assert.ok(!JSON.stringify([got, listed]).includes(SECRET));
  assert.equal(await refusedWith(v.itemGet(h.ctx, { itemId: "vit_nope" })), "validation.not_found");
  assert.equal(await refusedWith(v.itemGet(h.ctx, { itemId: "nope" })), "validation.bad_input");
});

test("reveal gives the owner their values, asks the key, is logged per field and leaves no value anywhere", async () => {
  const h = harness();
  const id = await put(h, await folder(h, "mine"), "Dana Lawmatics");
  const all = await reveal(h, id);
  assert.deepEqual(contractErrors("vault.item.reveal", "out", all), []);
  assert.deepEqual(all.fields, [{ key: "username", value: "dana" }, { key: "api_key", value: SECRET }]);
  const one = await reveal(h, id, { fields: ["api_key"], reason: "paste into the Lawmatics admin" });
  assert.deepEqual(one.fields, [{ key: "api_key", value: SECRET }]);
  assert.deepEqual(h.named("vault.revealed")[1]?.payload, { itemId: id, fields: ["api_key"] });
  assert.equal(h.named("vault.revealed")[1]?.vis, "participants");
  const hist = out(await v.itemHistory(h.ctx, { itemId: id }));
  assert.deepEqual(contractErrors("vault.item.history", "out", hist), []);
  const revealed = (hist.entries as Json[]).filter((e) => e.action === "revealed");
  assert.deepEqual(revealed.map((e) => e.field).sort(), ["api_key", "api_key", "username"]);
  assert.equal(revealed.find((e) => e.detail)?.detail, "paste into the Lawmatics admin");
  assert.deepEqual(out((hist.entries as Json[])[0]?.actor), { kind: "person", id: MAYA });
  assert.ok(!h.everything().includes(SECRET), "a reveal does not write the value down");
  assert.equal(await refusedWith(reveal(h, id, { fields: ["nope"] })), "validation.bad_input");
  assert.equal(await refusedWith(reveal(h, id, { fields: ["bad key"] })), "validation.bad_input");

  // the session did not unlock the person key: the metadata is still there, the values are not
  h.lock(MAYA);
  assert.equal(await refusedWith(reveal(h, id)), "auth.unauthenticated");
  assert.equal(out(out(await v.itemGet(h.ctx, { itemId: id })).item).id, id);
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, fieldsSet: [{ key: "x", value: "y" }] })), "auth.unauthenticated");
});

test("a Mine item is unreadable by admins, even with every permission and a grant on the item", async () => {
  const h = harness();
  const id = await put(h, await folder(h, "mine"), "Private login");
  h.allow(ADMIN, "vault.reveal");
  h.allow(ADMIN, "vault.shared_create");
  h.grant(ADMIN, id, "manage");
  h.actAs("person", ADMIN);
  assert.deepEqual(out(await v.itemsList(h.ctx, {})).items, [], "not in the admin's list");
  assert.equal(out(await v.itemsList(h.ctx, {})).total, 0);
  for (const run of [
    () => v.itemGet(h.ctx, { itemId: id }), () => v.itemReveal(h.ctx, { itemId: id }), () => v.itemHistory(h.ctx, { itemId: id }),
    () => v.itemUpdate(h.ctx, { itemId: id, name: "mine now" }), () => v.itemDelete(h.ctx, { itemId: id }), () => v.itemMarkRotated(h.ctx, { itemId: id }),
    () => v.share(h.ctx, { resource: { type: "vault_item", id }, subject: { kind: "person", id: ADMIN }, level: "view", idempotencyKey: key() }),
  ]) assert.equal(await refusedWith(run()), "validation.not_found");

  // and the key says the same: the admin's own key opens nothing of Maya's
  const sealed = secretRow(h, id);
  assert.throws(() => openMine(id, { enc: 2, keyId: String(sealed.keyId), box: JSON.parse(String(sealed.box)), wrapped: JSON.parse(String(sealed.wrapped)), rev: 1 }, wrapKeyFromPersonKey(keyOfPerson(ADMIN))));
  const own = openMine(id, { enc: 2, keyId: String(sealed.keyId), box: JSON.parse(String(sealed.box)), wrapped: JSON.parse(String(sealed.wrapped)), rev: 1 }, wrapKeyFromPersonKey(keyOfPerson(MAYA)));
  assert.equal(own.find((f) => f.key === "api_key")?.value, SECRET);
});

test("a Shared item is sealed by the filler (enc=1): only the filler opens it, and reveal needs View and the Reveal permission", async () => {
  const h = harness();
  const shared = await folder(h, "shared", "Team keys");
  h.grant(ROB, shared, "edit");
  h.actAs("person", ROB);
  const id = await put(h, shared, "Stripe live");
  const sealed = secretRow(h, id);
  assert.deepEqual([sealed.enc, sealed.wrapped, sealed.keyId], [1, null, h.filler.keyId]);
  assert.ok(!String(sealed.box).includes(SECRET));
  const rowBox = { enc: 1 as const, keyId: String(sealed.keyId), box: JSON.parse(String(sealed.box)), rev: 1 };
  assert.equal(h.filler.open(id, rowBox).find((f) => f.key === "api_key")?.value, SECRET);
  assert.throws(() => new Filler(new Uint8Array(32).fill(9)).open(id, rowBox), "another service key opens nothing");
  assert.ok(!h.everything().includes(SECRET));
  assert.equal((await reveal(h, id) as Json).fields !== undefined, true, "the owner may reveal what they made");

  // Maya at Use sees the name and can use it, but not the value; at View she needs the Reveal permission as well; an agent never reveals
  h.actAs("person", MAYA);
  h.grant(MAYA, id, "use");
  assert.equal(out(out(await v.itemGet(h.ctx, { itemId: id })).item).yourLevel, "use");
  assert.equal(await refusedWith(reveal(h, id)), "permission.no_grant", "Use is not View");
  h.grant(MAYA, id, "view");
  assert.equal(await refusedWith(reveal(h, id)), "permission.no_grant", "View without the Reveal permission");
  h.allow(MAYA, "vault.reveal");
  assert.deepEqual((await reveal(h, id, { fields: ["api_key"] })).fields, [{ key: "api_key", value: SECRET }]);
  assert.equal(await refusedWith(v.itemHistory(h.ctx, { itemId: id })), "permission.no_grant", "history needs Edit");
  h.grant(MAYA, id, "edit");
  const entries = out(await v.itemHistory(h.ctx, { itemId: id })).entries as Json[];
  assert.ok(entries.some((e) => e.action === "revealed" && e.field === "api_key" && out(e.actor).id === MAYA), "her reveal is in the history under her name");
});

test("history needs Edit; an agent has Use only and cannot reveal even with View and the permission", async () => {
  const h = harness();
  const shared = await folder(h, "shared");
  const id = await put(h, shared, "Shared login");
  h.grant(ROB, id, "view");
  h.actAs("person", ROB);
  assert.equal(await refusedWith(v.itemHistory(h.ctx, { itemId: id })), "permission.no_grant");
  h.actAs("agent", AGENT);
  h.grant(AGENT, id, "view");
  h.allow(AGENT, "vault.reveal");
  assert.equal(await refusedWith(reveal(h, id)), "permission.no_grant", "agents get a handle, never the value");
  assert.equal(out(out(await v.itemGet(h.ctx, { itemId: id })).item).id, id, "but they see the name");
  assert.equal(h.named("vault.revealed").length, 0);
});

test("the list: sections, counts, filters, search and pages; other people's Mine items never appear", async () => {
  const h = harness();
  const mine = await folder(h, "mine", "Mine");
  const shared = await folder(h, "shared", "Team");
  h.grant(ROB, shared, "edit");
  const m1 = await put(h, mine, "Banking", { kind: "login" });
  const s1 = await put(h, shared, "analytics", { kind: "env" });
  h.actAs("person", ROB);
  const robMine = await folder(h, "mine", "Rob mine");
  await put(h, robMine, "Rob private");
  const s2 = await put(h, shared, "Zapier");
  h.actAs("person", MAYA);
  h.grant(MAYA, s2, "view");
  h.grant(MAYA, await folderOf(h, "Rob mine"), "manage");
  h.grant(MAYA, s1, "manage");

  const names = async (o: Json = {}): Promise<string[]> => (out(await v.itemsList(h.ctx, o)).items as Json[]).map((i) => String(i.name));
  assert.deepEqual(await names(), ["analytics", "Banking", "Zapier"], "sorted by name, other people's Mine items left out");
  assert.deepEqual(await names({ section: "personal" }), ["analytics", "Banking"]);
  assert.deepEqual(await names({ section: "shared" }), ["Zapier"]);
  assert.deepEqual(await names({ section: "space" }), ["analytics", "Zapier"]);
  assert.deepEqual(await names({ section: "starred" }), []);
  assert.deepEqual(await names({ folder: mine }), ["Banking"]);
  assert.deepEqual(await names({ kind: "env" }), ["analytics"]);
  assert.deepEqual(await names({ q: "ZAP" }), ["Zapier"]);
  const all = out(await v.itemsList(h.ctx, {}));
  assert.deepEqual(all.counts, { personal: 2, shared: 1, space: 2, starred: 0, following: 0 });
  assert.deepEqual((all.items as Json[]).map((i) => i.yourLevel), ["manage", "manage", "view"]);
  const p1 = out(await v.itemsList(h.ctx, { limit: 2 }));
  assert.deepEqual([(p1.items as Json[]).length, p1.next, p1.total], [2, "2", 3]);
  assert.deepEqual((out(await v.itemsList(h.ctx, { limit: 2, cursor: "2" })).items as Json[]).map((i) => i.name), ["Zapier"]);
  assert.equal(await refusedWith(v.itemsList(h.ctx, { section: "everything" })), "validation.bad_input");
  assert.equal(await refusedWith(v.itemsList(h.ctx, { kind: "password" })), "validation.bad_input");
  assert.equal(await refusedWith(v.itemsList(h.ctx, { limit: 501 })), "validation.bad_input");
  assert.ok(m1 !== s1);
  assert.ok(!JSON.stringify(all).includes(SECRET));
});

function folderOf(h: Harness, name: string): Promise<string> {
  const row = h.rows(`SELECT * FROM vault_folder WHERE "name" = ?`, name)[0];
  return Promise.resolve(String(row?.id));
}

test("update sets and removes fields, re-seals with a new revision, and says which field keys changed, never their values", async () => {
  const h = harness();
  const id = await put(h, await folder(h, "mine"), "Dana Lawmatics");
  const rev1 = secretRow(h, id).rev;
  const changed = out(out(await v.itemUpdate(h.ctx, { itemId: id, fieldsSet: [{ key: "api_key", value: "rotated-value-777" }, { key: "note", value: "renewal in May" }], fieldsRemove: ["username"] })).item);
  assert.deepEqual(contractErrors("vault.item.update", "out", { item: changed }), []);
  assert.deepEqual(changed.fieldKeys, ["api_key", "note"]);
  assert.equal(secretRow(h, id).rev, Number(rev1) + 1);
  assert.deepEqual(h.named("vault.item_updated")[0]?.payload, { itemId: id, fieldsChanged: ["api_key", "note", "username"], settingsChanged: [] });
  assert.deepEqual((await reveal(h, id)).fields, [{ key: "api_key", value: "rotated-value-777" }, { key: "note", value: "renewal in May" }]);
  assert.deepEqual(out(await v.itemGet(h.ctx, { itemId: id })).fields, [{ key: "api_key", secret: true, hasValue: true }, { key: "note", secret: true, hasValue: true }]);
  assert.ok(!h.everything().includes("rotated-value-777"));

  const settings = out(out(await v.itemUpdate(h.ctx, { itemId: id, name: "Dana Lawmatics v2", spaceOnly: true, injectIntoDeployments: true, rotateEveryDays: 30 })).item);
  assert.deepEqual([settings.name, settings.handle, settings.spaceOnly, settings.injectIntoDeployments, settings.rotateEveryDays], ["Dana Lawmatics v2", "#Dana_Lawmatics_v2", true, true, 30]);
  assert.deepEqual(h.named("vault.item_updated")[1]?.payload, { itemId: id, fieldsChanged: [], settingsChanged: ["name", "spaceOnly", "injectIntoDeployments", "rotateEveryDays"] });
  assert.equal(out(out(await v.itemUpdate(h.ctx, { itemId: id, rotateEveryDays: null })).item).rotateEveryDays, undefined);
  const before = h.named("vault.item_updated").length;
  await v.itemUpdate(h.ctx, { itemId: id, name: "Dana Lawmatics v2", spaceOnly: true });
  assert.equal(h.named("vault.item_updated").length, before, "nothing changed, nothing announced");

  const other = await put(h, await folderOf(h, "mine folder"), "Other");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: other, name: "dana lawmatics V2" })), "validation.duplicate");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, fieldsRemove: ["nope"] })), "validation.bad_input");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, fieldsRemove: ["api_key", "note"] })), "validation.bad_input", "an item keeps at least one field");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, spaceOnly: "yes" as unknown as boolean })), "validation.bad_input");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, rotateEveryDays: 0 })), "validation.bad_input");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, fieldsSet: [{ key: "api_key", value: "x" }, { key: "api_key", value: "y" }] })), "validation.bad_input");
});

test("a Shared item can be edited by someone with Edit, and a person at View cannot change it", async () => {
  const h = harness();
  const id = await put(h, await folder(h, "shared"), "Team key");
  h.actAs("person", ROB);
  h.grant(ROB, id, "view");
  assert.equal(await refusedWith(v.itemUpdate(h.ctx, { itemId: id, name: "mine" })), "permission.no_grant");
  h.grant(ROB, id, "edit");
  await v.itemUpdate(h.ctx, { itemId: id, fieldsSet: [{ key: "api_key", value: "edited-by-rob" }] });
  assert.equal(secretRow(h, id).enc, 1);
  h.actAs("person", MAYA);
  assert.deepEqual((await reveal(h, id, { fields: ["api_key"] })).fields, [{ key: "api_key", value: "edited-by-rob" }]);
  const hist = out(await v.itemHistory(h.ctx, { itemId: id }));
  assert.ok((hist.entries as Json[]).some((e) => e.action === "edited" && e.field === "api_key" && out(e.actor).id === ROB));
});

test("move across Mine and Shared re-encrypts: enc flips, the value survives, a subscription sign-in stays Mine", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const shared = await folder(h, "shared");
  const id = await put(h, mine, "Moves around");
  assert.equal(secretRow(h, id).enc, 2);
  const moved = out(out(await v.itemMove(h.ctx, { itemId: id, folderId: shared })).item);
  assert.deepEqual([moved.scope, moved.folderId, secretRow(h, id).enc, secretRow(h, id).wrapped], ["shared", shared, 1, null]);
  assert.deepEqual((await reveal(h, id, { fields: ["api_key"] })).fields, [{ key: "api_key", value: SECRET }]);
  assert.deepEqual(h.named("vault.item_moved")[0]?.payload, { itemId: id, fromFolderId: mine, toFolderId: shared });
  assert.deepEqual(h.named("item.moved")[0]?.payload, { resource: { type: "vault_item", id }, fromFolderId: mine, toFolderId: shared }, "item.moved takes vfd_ folders, so a Vault move carries from and to on the shared event");
  await v.itemMove(h.ctx, { itemId: id, folderId: mine });
  assert.deepEqual([secretRow(h, id).enc, Boolean(secretRow(h, id).wrapped)], [2, true]);
  assert.deepEqual((await reveal(h, id, { fields: ["api_key"] })).fields, [{ key: "api_key", value: SECRET }]);
  assert.ok(!h.everything().includes(SECRET));
  assert.equal(out(out(await v.itemMove(h.ctx, { itemId: id, folderId: mine })).item).folderId, mine);
  assert.equal(h.named("vault.item_moved").length, 2, "moving to where it is changes nothing");

  const sub = await put(h, mine, "Claude sign-in", { kind: "ai_subscription", fields: [{ key: "credentials", value: "{token}" }] });
  assert.equal(await refusedWith(v.itemMove(h.ctx, { itemId: sub, folderId: shared })), "validation.precondition_failed");
  assert.equal(await refusedWith(v.itemPut(h.ctx, { folderId: shared, name: "No", kind: "ai_subscription", fields: [{ key: "credentials", value: "x" }], idempotencyKey: key() })), "validation.precondition_failed");
  const dup = await put(h, shared, "Moves around");
  assert.equal(await refusedWith(v.itemMove(h.ctx, { itemId: id, folderId: shared })), "validation.duplicate");
  assert.ok(dup !== id);
  assert.equal(await refusedWith(v.itemMove(h.ctx, { itemId: id, folderId: "vfd_nope" })), "validation.not_found");

  // Edit is not enough to move an item that is not yours
  const theirs = await put(h, shared, "Shared one");
  h.actAs("person", ROB);
  h.grant(ROB, theirs, "edit");
  h.grant(ROB, shared, "edit");
  assert.equal(await refusedWith(v.itemMove(h.ctx, { itemId: theirs, folderId: mine })), "permission.no_grant");
});

test("Trash and back: delete hides an item everywhere, restore brings it back whole; rotation is recorded", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const id = await put(h, mine, "Short lived");
  await put(h, mine, "Keeper");
  assert.deepEqual(await v.itemDelete(h.ctx, { itemId: id }), { ok: true });
  assert.deepEqual(h.named("vault.item_deleted")[0]?.payload, { itemId: id });
  assert.deepEqual((out(await v.itemsList(h.ctx, {})).items as Json[]).map((i) => i.name), ["Keeper"]);
  assert.equal(await refusedWith(v.itemGet(h.ctx, { itemId: id })), "validation.not_found");
  assert.equal(await refusedWith(v.itemDelete(h.ctx, { itemId: id })), "validation.not_found");
  // the name is free while it is in Trash, so a restore into a taken name is refused
  const again = await put(h, mine, "Short lived");
  assert.equal(await refusedWith(v.itemRestore(h.ctx, { itemId: id })), "validation.duplicate");
  await v.itemDelete(h.ctx, { itemId: again });
  const back = out(out(await v.itemRestore(h.ctx, { itemId: id })).item);
  assert.deepEqual(contractErrors("vault.item.restore", "out", { item: back }), []);
  assert.deepEqual((await reveal(h, id, { fields: ["api_key"] })).fields, [{ key: "api_key", value: SECRET }]);
  assert.equal(await refusedWith(v.itemRestore(h.ctx, { itemId: id })), "validation.precondition_failed", "it is not in Trash");
  assert.deepEqual(h.named("vault.item_restored")[0]?.payload, { itemId: id });

  h.advance(5000);
  const rotated = out(out(await v.itemMarkRotated(h.ctx, { itemId: id })).item);
  assert.equal(rotated.lastRotatedAt, NOW + 5000);
  assert.deepEqual(h.named("vault.item_rotated")[0]?.payload, { itemId: id });
  const actions = (out(await v.itemHistory(h.ctx, { itemId: id })).entries as Json[]).map((e) => e.action);
  for (const a of ["created", "deleted", "restored", "rotated", "revealed"]) assert.ok(actions.includes(a), a);
});

test("share and unshare are a front over access: Shared items and folders only, Manage needed, subscription sign-ins never", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const shared = await folder(h, "shared");
  const id = await put(h, shared, "Team key");
  const mineItem = await put(h, mine, "Private");
  const subject = { kind: "person", id: ROB };
  assert.deepEqual(await v.share(h.ctx, { resource: { type: "vault_item", id }, subject, level: "view", idempotencyKey: "share-1" }), { granted: true });
  assert.deepEqual(h.calls("access.share")[0]?.input, { resource: { type: "vault_item", id }, subject, level: "view", idempotencyKey: "share-1" });
  assert.deepEqual(await v.share(h.ctx, { resource: { type: "vault_folder", id: shared }, subject, level: "use", idempotencyKey: "share-2" }), { granted: true });
  assert.equal(h.calls("access.share").length, 2);
  assert.deepEqual(await v.unshare(h.ctx, { resource: { type: "vault_item", id }, subject }), { revoked: 1 });
  assert.deepEqual(h.calls("access.unshare")[0]?.input, { resource: { type: "vault_item", id }, subject });
  const actions = (out(await v.itemHistory(h.ctx, { itemId: id })).entries as Json[]).map((e) => e.action);
  assert.ok(actions.includes("shared") && actions.includes("unshared"));

  assert.equal(await refusedWith(v.share(h.ctx, { resource: { type: "vault_item", id: mineItem }, subject, level: "view", idempotencyKey: key() })), "validation.precondition_failed", "Mine is private");
  assert.equal(await refusedWith(v.share(h.ctx, { resource: { type: "vault_folder", id: mine }, subject, level: "view", idempotencyKey: key() })), "validation.precondition_failed");
  assert.equal(await refusedWith(v.share(h.ctx, { resource: { type: "record", id } as never, subject, level: "view", idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await refusedWith(v.share(h.ctx, { resource: { type: "vault_item", id }, subject, level: "view", idempotencyKey: "" })), "validation.bad_input");
  h.actAs("person", ROB);
  h.grant(ROB, id, "edit");
  assert.equal(await refusedWith(v.share(h.ctx, { resource: { type: "vault_item", id }, subject, level: "view", idempotencyKey: key() })), "permission.no_grant", "Edit cannot share, Manage can");
  assert.equal(await refusedWith(v.unshare(h.ctx, { resource: { type: "vault_item", id }, subject })), "permission.no_grant");
  assert.equal(h.calls("access.share").length, 2, "nothing reached access");
});

test("folders: Mine is private to its owner, Shared follows access, names are unique, a folder lives with its own kind", async () => {
  const h = harness();
  const mine = await folder(h, "mine", "Banks");
  const shared = await folder(h, "shared", "Team");
  const child = await folder(h, "shared", "Billing", shared);
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: "banks", scope: "mine", idempotencyKey: key() })), "validation.duplicate");
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: "Inside", scope: "mine", parentId: shared, idempotencyKey: key() })), "validation.precondition_failed");
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: " ", scope: "mine", idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: "X", scope: "both" as "mine", idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: "X", scope: "mine", parentId: "vfd_nope", idempotencyKey: key() })), "validation.not_found");
  await put(h, child, "Invoice key");
  const all = out(await v.foldersList(h.ctx, {}));
  assert.deepEqual(contractErrors("vault.folders.list", "out", all), []);
  assert.deepEqual((all.folders as Json[]).map((f) => [f.name, f.itemCount, f.yourLevel]), [["Banks", 0, "manage"], ["Billing", 1, "manage"], ["Team", 0, "manage"]]);
  assert.equal(out((all.folders as Json[])[1]).parentId, shared);
  assert.deepEqual(h.named("vault.folder_created").map((e) => e.payload.scope), ["mine", "shared", "shared"]);

  h.actAs("person", ROB);
  assert.deepEqual((out(await v.foldersList(h.ctx, {})).folders as Json[]).length, 0, "Rob sees neither Maya's Mine nor Shared folders he has no grant on");
  h.grant(ROB, shared, "view");
  assert.deepEqual((out(await v.foldersList(h.ctx, { scope: "shared" })).folders as Json[]).map((f) => [f.name, f.yourLevel]), [["Team", "view"]]);
  assert.equal(await refusedWith(v.itemPut(h.ctx, { folderId: shared, name: "No", kind: "note", fields: [{ key: "note", value: "x" }], idempotencyKey: key() })), "permission.no_grant", "View cannot add");
  assert.equal(await refusedWith(v.itemPut(h.ctx, { folderId: mine, name: "No", kind: "note", fields: [{ key: "note", value: "x" }], idempotencyKey: key() })), "validation.not_found", "a Mine folder is not Rob's");
  h.actAs("agent", AGENT);
  assert.equal(await refusedWith(v.foldersCreate(h.ctx, { name: "Agent mine", scope: "mine", idempotencyKey: key() })), "permission.no_grant");
});

test("put checks its input: kinds, keys, duplicates, sizes and what an agent may do", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const base = { folderId: mine, name: "Item", kind: "note", fields: [{ key: "note", value: "x" }], idempotencyKey: "k" };
  const put1 = (o: Json) => v.itemPut(h.ctx, { ...base, idempotencyKey: key(), ...o } as Parameters<typeof v.itemPut>[1]);
  assert.equal(await refusedWith(put1({ idempotencyKey: "" })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ folderId: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ name: " " })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ name: "x".repeat(201) })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ kind: "password" })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: [] })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: "note=x" })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: [{ key: "1bad", value: "x" }] })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: [{ key: "note", value: 5 }] })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: [{ key: "a", value: "x" }, { key: "a", value: "y" }] })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ fields: [{ key: "big", value: "x".repeat(65537) }] })), "validation.too_large");
  assert.equal(await refusedWith(put1({ rotateEveryDays: 0 })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ spaceOnly: "yes" })), "validation.bad_input");
  assert.equal(await refusedWith(put1({ folderId: "vfd_nope" })), "validation.not_found");
  await put1({});
  assert.equal(await refusedWith(put1({})), "validation.duplicate");
  assert.equal(await refusedWith(put1({ name: "ITEM" })), "validation.duplicate", "names are unique per folder, ignoring case");
  const second = out(out(await put1({ name: "Item!" })).item);
  assert.equal(second.handle, "#Item_2", "a handle drops what is not a letter, digit or underscore, and is unique across the Space");
  const third = out(out(await put1({ name: "Item?", folderId: await folder(h, "mine", "Other") })).item);
  assert.equal(third.handle, "#Item_3");
  assert.equal(h.rows(`SELECT * FROM vault_meta`).length, 3);
  h.actAs("agent", AGENT);
  assert.equal(await refusedWith(put1({})), "validation.not_found", "a Mine folder is not the agent's");
  h.actAs("person", MAYA);
  h.lock(MAYA);
  assert.equal(await refusedWith(put1({ name: "Locked" })), "auth.unauthenticated");
  assert.equal(h.rows(`SELECT * FROM vault_meta`).length, 3, "nothing half saved");
  assert.equal(h.rows(`SELECT * FROM vault_secret`).length, 3);
});

test("the service answers its health probe and says so when its key is gone", async () => {
  const h = harness();
  const ok = out(await v.serviceHealth(h.ctx));
  assert.deepEqual(contractErrors("vault.service_health", "out", ok), []);
  assert.equal(ok.state, "healthy");
  h.cleanup();
  const down = out(await v.serviceHealth(h.ctx));
  assert.equal(down.state, "down");
  assert.deepEqual(contractErrors("vault.service_health", "out", down), []);
  const g = harness();
  const shared = await folder(g, "shared");
  g.cleanup();
  assert.equal(await refusedWith(v.itemPut(g.ctx, { folderId: shared, name: "No key", kind: "note", fields: [{ key: "note", value: "x" }], idempotencyKey: key() })), "internal.unavailable");
});

test("a whole session leaves no value in the database, an event, a call or a log", async () => {
  const h = harness();
  const mine = await folder(h, "mine");
  const shared = await folder(h, "shared");
  const a = await put(h, mine, "A");
  const b = await put(h, shared, "B");
  await reveal(h, a);
  await reveal(h, b);
  await v.itemUpdate(h.ctx, { itemId: a, fieldsSet: [{ key: "extra", value: SECRET + "-2" }] });
  await v.itemMove(h.ctx, { itemId: a, folderId: shared });
  await v.share(h.ctx, { resource: { type: "vault_item", id: a }, subject: { kind: "person", id: ROB }, level: "use", idempotencyKey: key() });
  await v.itemDelete(h.ctx, { itemId: b });
  await v.itemRestore(h.ctx, { itemId: b });
  await v.itemsList(h.ctx, {});
  await v.itemGet(h.ctx, { itemId: a });
  await v.itemHistory(h.ctx, { itemId: a });
  assert.ok(!h.everything().includes("sk-live"), "no value, whole or in part");
  assert.ok(!h.everything().includes("NEVER-IN-A-LOG"));
});


test("item.moved takes a Files folder (fld_) and a Vault folder (vfd_) on from and to, and refuses any other id", () => {
  const res = { type: "vault_item", id: "vit_a1b2c3" };
  assert.deepEqual(validateEvent("item.moved", { resource: res, fromFolderId: "vfd_a1b2c3", toFolderId: "vfd_d4e5f6" }), [], "a Vault move");
  assert.deepEqual(validateEvent("item.moved", { resource: { type: "file", id: "fil_a1b2c3" }, fromFolderId: "fld_a1b2c3", toFolderId: "fld_d4e5f6" }), [], "a Files move");
  assert.deepEqual(validateEvent("item.moved", { resource: res }), [], "from and to stay optional");
  assert.notDeepEqual(validateEvent("item.moved", { resource: res, toFolderId: "chn_a1b2c3" }), [], "another kind of id is refused");
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// run on the final commit of P-CC_28
