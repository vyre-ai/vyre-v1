// Add to Automations on a Vault item: the button starts the session with the app name and the handle (no value), the Automations that use the key are listed and open, and each blocker
// is one sentence with a button that fixes it. The sample Space answers providers.list and automations.vault_usage; nothing here holds a key value.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement, ReactNode } from "react";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { VaultDataProvider } from "../layout/data.tsx";
import type { VaultData } from "../layout/data.tsx";
import { ItemEnv } from "../itemenv/index.ts";
import { createSampleVault } from "../layout/sample.ts";
import type { SampleVault } from "../layout/sample.ts";

installDom();
const Wrap = ({ data, children }: { data: VaultData; children: ReactNode }): ReactElement => <VaultDataProvider value={data}>{children}</VaultDataProvider>;
const open = (v: SampleVault, itemId: string): Promise<ReturnType<typeof mount> extends Promise<infer R> ? R : never> =>
  mount(createRoot, <Wrap data={v.data}><ItemEnv itemId={itemId} onEdit={() => undefined} onGone={() => undefined} onNote={() => undefined} /></Wrap>);
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

test("a key item offers Add to Automations, and pressing it hands the item and its handle to the shell", async () => {
  const v = createSampleVault();
  const root = await open(v, "vit_ghl");
  await settle();
  await press(find(root, "item-add-automations"));
  assert.deepEqual(v.opened.filter((x) => x.startsWith("automate:")), ["automate:vit_ghl:#Northwind_GHL"]);
});

test("the Automations that use the key are listed with their steps and each one opens", async () => {
  const v = createSampleVault();
  const root = await open(v, "vit_ghl");
  await settle();
  const text = textOf(root);
  assert.match(text, /New lead to GoHighLevel/);
  assert.match(text, /Create contact/);
  assert.match(text, /2 steps/);
  await press(find(root, "used-by-aut_nightly"));
  assert.ok(v.opened.includes("automation:aut_nightly"));
});

test("an item nothing uses says so, and an item that cannot be a connector has no button", async () => {
  const v = createSampleVault();
  const key = await open(v, "vit_resend");
  await settle();
  assert.match(textOf(key), /No Automation uses this key yet/);
  const card = await open(v, "vit_visa");
  await settle();
  assert.equal(textOf(card).includes("Add to Automations"), false);
});

test("with no AI account the button waits and the notice sends the person to connect one", async () => {
  const v = createSampleVault();
  const base = v.data.call.bind(v.data);
  v.data = { ...v.data, call: async (cap, input) => (cap === "providers.list" ? { providers: [] } : base(cap, input)) };
  const root = await open(v, "vit_ghl");
  await settle();
  assert.match(textOf(root), /Connect one first/);
  await press(find(root, "item-add-automations"));
  assert.equal(v.opened.some((x) => x.startsWith("automate:")), false, "a blocked button starts nothing");
  await press(find(root, "auto-gate-fix"));
  assert.ok(v.opened.includes("add-provider"));
});

test("offline, the notice says the Vault is not reachable and offers Try again", async () => {
  const v = createSampleVault();
  v.setOnline(false);
  const root = await open(v, "vit_ghl");
  await settle();
  assert.match(textOf(root), /Vault is not reachable/);
  await press(find(root, "item-add-automations"));
  assert.equal(v.opened.some((x) => x.startsWith("automate:")), false);
  const before = v.calls.filter((c) => c.cap === "providers.list").length;
  await press(find(root, "auto-gate-fix"));
  await settle();
  assert.ok(v.calls.filter((c) => c.cap === "providers.list").length > before, "Try again asks again");
});
