// What a held share of a Vault key says on its card: the key by its name and who gets it.
import test from "node:test";
import assert from "node:assert/strict";
import { holdShort } from "./hold-words.ts";

test("a held share of a Vault key names the key and who gets it, never a value", () => {
  const input = {
    resource: { type: "vault_item", id: "vit_1" },
    subject: { kind: "agent", id: "agt_1" },
    level: "use",
  };
  assert.equal(holdShort("vault.share", input, { key: "Crm key", recipient: "Dex" }), "share the key Crm key with Dex");
  assert.equal(holdShort("vault.share", input), "share a Vault key with an agent");
});
