// The item's own link and the call input the Share sheet builds: an artifact has its address on the Space, every other kind its vyre:// deep link, never the page the person is on.
import test from "node:test";
import assert from "node:assert/strict";
import { itemLink, withNotify } from "./rows.ts";

test("an artifact links to its address on the Space; other kinds to their deep link", () => {
  assert.equal(itemLink("site", "sit_ab12", "https://northwind.vyre.run"), "https://northwind.vyre.run/a/sit_ab12");
  assert.equal(itemLink("note", "not_1", "https://x"), "vyre://note/not_1");
  assert.equal(itemLink("agent", "agt_dex", "https://x"), "vyre://agent/agt_dex");
  assert.equal(itemLink("folder", "fld_1", "https://x"), "vyre://folder/fld_1");
  assert.equal(itemLink("record_type", "deal", "https://x"), "vyre://record_type/deal");
  assert.equal(itemLink("vault_item", "vit_1", "https://x"), "vyre://vault/vit_1");
  assert.equal(itemLink("automation", "aut_1", "https://x"), "vyre://automation/aut_1");
});

test("withNotify adds notify only when the person asked to tell them, with the message", () => {
  const base = { resource: { type: "agent", id: "agt_dex" } };
  assert.deepEqual(withNotify(base), base);
  assert.deepEqual(withNotify(base, { notify: false }), base);
  assert.deepEqual(withNotify(base, { notify: true }), { ...base, notify: {} });
  assert.deepEqual(withNotify(base, { notify: true, message: "Take a look" }), { ...base, notify: { message: "Take a look" } });
});
