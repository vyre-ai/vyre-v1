import test from "node:test";
import assert from "node:assert/strict";
import { matchPerson, unmatchPerson, connectedLine, googleCheckLine, googleChecked, memberToggle, microsoftCheckLine, microsoftChecked, storeInVault } from "./flow.ts";
import type { Run } from "./flow.ts";

function runner(answers: Record<string, unknown> = {}) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const run: Run = async (cap, input, success) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    const out = cap in answers ? answers[cap] : {};
    if (out === undefined) return undefined;
    if (typeof success === "function") await success(out as never);
    return out as never;
  };
  return { run, calls };
}

const RESTRICT = (type: string, id: string) => ({ cap: "access.labels.set", input: { resource: { type, id }, label: "restricted" } });

test("a secret goes to the Vault in one call, into the Company connections folder the person may add to, under the name without the hash, and the folder and the item are Restricted", async () => {
  const r = runner({ "vault.item.put": { item: { id: "vit_new" } } });
  const ok = await storeInVault(r.run, { name: "#Google_DWD", handle: "#Google_DWD", text: "{secret}", folders: [{ id: "fld_view", yourLevel: "view", name: "Company connections" }, { id: "fld_other", yourLevel: "edit", name: "Team keys" }, { id: "fld_edit", yourLevel: "edit", name: "Company connections" }] });
  assert.equal(ok, true);
  assert.deepEqual(r.calls, [
    RESTRICT("vault_folder", "fld_edit"),
    { cap: "vault.item.put", input: { folderId: "fld_edit", name: "Google_DWD", kind: "other", fields: [{ key: "key", value: "{secret}", secret: true }], idempotencyKey: "" } },
    RESTRICT("vault_item", "vit_new"),
  ], "the folder is labelled before the value goes in, the item after, and an unrelated folder is never used");
});

test("with no Company connections folder to add to, one shared folder is made first, and labelled before the item goes in", async () => {
  const r = runner({ "vault.folders.create": { folder: { id: "fld_new" } }, "vault.item.put": { item: { id: "vit_new" } } });
  assert.equal(await storeInVault(r.run, { name: "Microsoft_App", handle: "#Microsoft_App", text: "x", folders: [{ id: "fld_view", yourLevel: "view", name: "Company connections" }] }), true);
  assert.deepEqual(r.calls.map((c) => c.cap), ["vault.folders.create", "access.labels.set", "vault.item.put", "access.labels.set"]);
  assert.equal(r.calls[0]!.input.scope, "shared");
  assert.equal(r.calls[2]!.input.folderId, "fld_new");
  assert.deepEqual(r.calls[1], RESTRICT("vault_folder", "fld_new"));
});

test("a folder that could not be made stops before any secret is sent", async () => {
  const r = runner({ "vault.folders.create": undefined });
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "{secret}", folders: [] }), false);
  assert.deepEqual(r.calls.map((c) => c.cap), ["vault.folders.create"]);
});

test("a folder that could not be restricted stops before any secret is sent", async () => {
  const r = runner({ "access.labels.set": undefined });
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "{secret}", folders: [{ id: "f", yourLevel: "manage", name: "Company connections" }] }), false);
  assert.deepEqual(r.calls.map((c) => c.cap), ["access.labels.set"]);
});

test("a key already in the Vault is restricted and replaced in place, never duplicated", async () => {
  const r = runner();
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "{new}", folders: [], existingItemId: "vit_1" }), true);
  assert.deepEqual(r.calls, [RESTRICT("vault_item", "vit_1"), { cap: "vault.item.update", input: { itemId: "vit_1", fieldsSet: [{ key: "key", value: "{new}", secret: true }] } }]);
});

test("a refused Vault write answers false so the box keeps what was typed", async () => {
  const r = runner({ "vault.item.put": undefined });
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "x", folders: [{ id: "f", yourLevel: "manage", name: "Company connections" }] }), false);
});

test("the words after each step name what happened and what is missing", () => {
  assert.equal(connectedLine(1, 0), "Connected. 1 member is matched and 0 mail connections are waiting to be accepted.");
  assert.equal(connectedLine(12, 1), "Connected. 12 members are matched and 1 mail connection is waiting to be accepted.");
  assert.equal(googleCheckLine({ ok: true, email: "admin@firm.com", scopesMissing: [] }, "x@y.z"), "Google answered for admin@firm.com. Every scope is allowed.");
  assert.equal(googleCheckLine({ ok: false, scopesMissing: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"] }, "a@b.c"), "Missing in the Admin console: drive, documents.");
  assert.equal(googleCheckLine({ ok: false, scopesMissing: [], detail: "Gmail answered 403 for a@b.c." }, "a@b.c"), "Gmail answered 403 for a@b.c.");
  assert.deepEqual(googleChecked({ ok: false, scopesMissing: ["s"], detail: "d" }), { ok: false, missing: ["s"], detail: "d" });
  assert.match(microsoftCheckLine({ ok: false, missingPermissions: ["Mail.Send"], detail: "Grant admin consent for: Mail.Send." }), /^Not yet consented: Mail.Send\./);
  assert.match(microsoftCheckLine({ ok: true, missingPermissions: [] }), /Consent is given/);
  assert.deepEqual(microsoftChecked({ ok: true, missingPermissions: [] }), { ok: true, missing: [], detail: undefined });
});

test("including or excluding a member sends the opposite of what they are now", async () => {
  const r = runner();
  await memberToggle(r.run, "google.dwd.set_excluded", { email: "a@firm.com", mapped: true, excluded: false });
  await memberToggle(r.run, "ms.consent.set_excluded", { email: "b@firm.com", mapped: true, excluded: true });
  assert.deepEqual(r.calls, [
    { cap: "google.dwd.set_excluded", input: { email: "a@firm.com", excluded: true } },
    { cap: "ms.consent.set_excluded", input: { email: "b@firm.com", excluded: false } },
  ]);
});

test("matching sends the address in lower case with the person, and unmatching sends the address alone", async () => {
  const r = runner();
  await matchPerson(r.run, "google.dwd.map_member", " Maya@Firm.com ", "usr_maya");
  await unmatchPerson(r.run, "ms.consent.map_member", "maya@firm.com");
  assert.deepEqual(r.calls, [
    { cap: "google.dwd.map_member", input: { email: "maya@firm.com", userId: "usr_maya", idempotencyKey: "" } },
    { cap: "ms.consent.map_member", input: { email: "maya@firm.com", idempotencyKey: "" } },
  ]);
});
