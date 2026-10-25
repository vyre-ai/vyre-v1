// Vault sheets: Add (one Add that understands what you paste) and Edit (Fields / .env with a diff). Rendered over the Northwind sample Space; the writes they make are checked
// against the sample replica. No value reaches the markup; the footer remembers the folder.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../src/places/vault/layout/index.tsx";
import { createSampleVault, northwind } from "../src/places/vault/layout/sample.ts";
import type { SampleVault } from "../src/places/vault/layout/sample.ts";
import { TEMPLATES, MASK, understandPaste, mergeFields, fieldsFor, templateById } from "../src/places/vault/itemenv/env.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const html = (v: SampleVault, props: Record<string, unknown>): string => renderToStaticMarkup(<Vault data={v.data} {...props} />).replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);

test("Add: a search and a reel of apps with Custom first, a name, handle line, fields, folder footer", () => {
  const out = html(createSampleVault(), { sheet: { add: {} } });
  assert.ok(has(out, 'data-testid="add-sheet"') && has(out, 'aria-label="Add to the Vault"'));
  const order = TEMPLATES.map((t) => out.indexOf(`data-testid="add-app-${t.id}"`));
  assert.ok(order.every((i) => i >= 0), "every app is in the reel");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Custom first, then the apps in order");
  assert.equal(TEMPLATES[0]!.id, "custom");
  assert.ok(has(out, 'data-testid="add-paste"') && has(out, "Paste a key, a .env, a link or JSON"));
  assert.ok(has(out, "Agents ask for an item by its handle and never see the values."), "the handle line before a name");
  assert.ok(has(out, 'data-testid="add-empty"'), "no fields until an app or a paste");
  assert.ok(has(out, 'aria-label="Adding to Mine"') , "the footer names where it will go: your Mine folder by default");
  assert.ok(has(out, 'data-testid="add-save"') && has(out, 'aria-disabled="true"'), "Add stays off until there is a name and a value");
});

test("Add: a pasted .env becomes a field per line and the status says what was understood", () => {
  const paste = "GHL_PIT=pit-7c1e4a2b-90d1-4b9e-8a52-3e6d1f0aa417\nGHL_LOCATION_ID=nwLoc7Kq2mXpR4vLnTzB";
  const u = understandPaste(paste);
  assert.equal(u.fields.length, 2);
  assert.match(u.note, /Read a \.env: 2 keys/);
  const merged = mergeFields(fieldsFor(templateById("highlevel")!), u.fields);
  assert.deepEqual(merged.map((f) => f.key), ["GHL_PIT", "GHL_LOCATION_ID"], "a template's own rows are filled, not duplicated");
  assert.ok(merged.every((f) => f.value !== ""));
});

test("Add saves with vault.item.put and the new item shows by name; a name taken in that folder is refused", async () => {
  const v = createSampleVault();
  const u = understandPaste("sk_live_51NwFakeFakeFake00aa");
  const out = (await v.data.call("vault.item.put", { folderId: "fld_finance", name: "Stripe test", kind: u.itemKind, fields: u.fields, template: u.template })) as { item: { id: string; fieldKeys: string[] } };
  assert.deepEqual(out.item.fieldKeys, ["STRIPE_SECRET_KEY"]);
  assert.ok(has(html(v, {}), 'aria-label="Stripe test"'));
  assert.ok(!has(html(v, {}), "sk_live_51NwFakeFakeFake00aa"));
  await assert.rejects(() => v.data.call("vault.item.put", { folderId: "fld_finance", name: "Stripe test", kind: "api_key", fields: [] }), /duplicate/);
});

test("Edit: the sheet opens in .env with every value masked, a diff line and Save off until something changes", () => {
  const v = createSampleVault();
  const out = html(v, { sheet: { edit: "vit_ghl" } });
  assert.ok(has(out, 'data-testid="edit-sheet"') && has(out, "Edit GoHighLevel"));
  assert.ok(has(out, `GHL_PIT=${MASK}`) && has(out, `GHL_LOCATION_ID=${MASK}`), "values are never loaded into the editor");
  assert.ok(has(out, 'data-testid="edit-diff"') && has(out, "No changes"));
  assert.ok(has(out, 'data-testid="edit-save"') && has(out, 'aria-disabled="true"'));
  assert.ok(has(out, 'data-testid="edit-mode-fields"') && has(out, 'data-testid="edit-mode-env"'));
  for (const f of northwind.items[0]!.fields) assert.ok(!has(out, f[1]), `no stored value in the editor: ${f[0]}`);
});

test("Edit saves through vault.item.update: a new key, a changed value, a removed key; the list's field names follow", async () => {
  const v = createSampleVault();
  await v.data.call("vault.item.update", { itemId: "vit_ghl", fieldsSet: [{ key: "GHL_PIPELINE_ID", value: "pl_9f2c", secret: false }, { key: "GHL_PIT", value: "pit-new-5521" }], fieldsRemove: ["GHL_LOCATION_ID"] });
  const out = html(v, {});
  assert.ok(has(out, "GHL_PIT · GHL_PIPELINE_ID"), "the second line shows the new field names");
  assert.ok(!has(out, "GHL_LOCATION_ID"));
  assert.ok(!has(out, "pit-new-5521") && !has(out, "pl_9f2c"));
  const reveal = (await v.data.call("vault.item.reveal", { itemId: "vit_ghl", fields: ["GHL_PIT"] })) as { fields: { value: string }[] };
  assert.equal(reveal.fields[0]!.value, "pit-new-5521", "the changed value is what a reveal returns");
});
