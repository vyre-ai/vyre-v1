import test from "node:test";
import assert from "node:assert/strict";
import { connectedLine, googleCheckLine, googleChecked, memberToggle, microsoftCheckLine, microsoftChecked, storeInVault } from "./flow.ts";
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

test("a secret goes to the Vault in one call, into a folder the person may add to, under the name without the hash", async () => {
  const r = runner();
  const ok = await storeInVault(r.run, { name: "#Google_DWD", handle: "#Google_DWD", text: "{secret}", folders: [{ id: "fld_view", yourLevel: "view" }, { id: "fld_edit", yourLevel: "edit" }] });
  assert.equal(ok, true);
  assert.deepEqual(r.calls, [{ cap: "vault.item.put", input: { folderId: "fld_edit", name: "Google_DWD", kind: "other", fields: [{ key: "key", value: "{secret}", secret: true }], idempotencyKey: "" } }]);
});

test("with no folder to add to, one shared folder is made first", async () => {
  const r = runner({ "vault.folders.create": { folder: { id: "fld_new" } } });
  assert.equal(await storeInVault(r.run, { name: "Microsoft_App", handle: "#Microsoft_App", text: "x", folders: [{ id: "fld_view", yourLevel: "view" }] }), true);
  assert.deepEqual(r.calls.map((c) => c.cap), ["vault.folders.create", "vault.item.put"]);
  assert.equal(r.calls[0]!.input.scope, "shared");
  assert.equal(r.calls[1]!.input.folderId, "fld_new");
});

test("a folder that could not be made stops before any secret is sent", async () => {
  const r = runner({ "vault.folders.create": undefined });
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "{secret}", folders: [] }), false);
  assert.deepEqual(r.calls.map((c) => c.cap), ["vault.folders.create"]);
});

test("a key already in the Vault is replaced in place, never duplicated", async () => {
  const r = runner();
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "{new}", folders: [], existingItemId: "vit_1" }), true);
  assert.deepEqual(r.calls, [{ cap: "vault.item.update", input: { itemId: "vit_1", fieldsSet: [{ key: "key", value: "{new}", secret: true }] } }]);
});

test("a refused Vault write answers false so the box keeps what was typed", async () => {
  const r = runner({ "vault.item.put": undefined });
  assert.equal(await storeInVault(r.run, { name: "Google_DWD", handle: "#Google_DWD", text: "x", folders: [{ id: "f", yourLevel: "manage" }] }), false);
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
