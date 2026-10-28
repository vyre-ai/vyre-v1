import test from "node:test";
import assert from "node:assert/strict";
import { createSampleVault } from "../layout/sample.ts";
import { declineVaultRequest, fulfilVaultRequest, revokeVaultExport } from "../layout/routed-actions.ts";

test("a waiting Vault request can be fulfilled with an existing item", async () => {
  const s = createSampleVault();

  await fulfilVaultRequest(s.data, "req_twilio", { itemId: "vit_twilio" });

  assert.deepEqual(s.calls.at(-1), {
    cap: "vault.requests.fulfil",
    input: { requestId: "req_twilio", itemId: "vit_twilio" },
  });
  assert.equal(s.replica.rows("requests")[0]?.["state"], "fulfilled");
});

test("a waiting Vault request can be fulfilled with newly entered fields", async () => {
  const s = createSampleVault();

  await fulfilVaultRequest(s.data, "req_twilio", {
    fields: [{ key: "TWILIO_AUTH_TOKEN", value: "secret" }],
    folderId: "fld_ops",
  });

  assert.deepEqual(s.calls.at(-1), {
    cap: "vault.requests.fulfil",
    input: {
      requestId: "req_twilio",
      fields: [{ key: "TWILIO_AUTH_TOKEN", value: "secret" }],
      folderId: "fld_ops",
    },
  });
  assert.equal(s.replica.rows("requests")[0]?.["state"], "fulfilled");
});

test("a waiting Vault request can be declined with a note", async () => {
  const s = createSampleVault();

  await declineVaultRequest(s.data, "req_twilio", "Use the shared account instead");

  assert.deepEqual(s.calls.at(-1), {
    cap: "vault.requests.decline",
    input: { requestId: "req_twilio", note: "Use the shared account instead" },
  });
  assert.equal(s.replica.rows("requests")[0]?.["state"], "declined");
});

test("an active export can be revoked", async () => {
  const s = createSampleVault();

  await revokeVaultExport(s.data, "vex_marketing");

  assert.deepEqual(s.calls.at(-1), {
    cap: "vault.exports.revoke",
    input: { exportId: "vex_marketing" },
  });
  assert.equal(s.replica.rows("exports").length, 0);
});
