// Add to Automations on a Vault item: the button starts the session with the app name and the handle (no value), the Automations that use the key are listed and open, and each blocker
// is one sentence with a button that fixes it. The sample Space answers providers.list and automations.vault_usage; nothing here holds a key value.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement, ReactNode } from "react";
import { find, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
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

test("a key item also offers Sync to Records, and it waits behind the same blockers", async () => {
  const v = createSampleVault();
  const root = await open(v, "vit_ghl");
  await settle();
  await press(find(root, "item-sync-records"));
  assert.deepEqual(v.opened.filter((x) => x.startsWith("records-sync:")), ["records-sync:vit_ghl:#Northwind_GHL"]);
  const blocked = createSampleVault();
  const base = blocked.data.call.bind(blocked.data);
  blocked.data = { ...blocked.data, call: async (cap, input) => (cap === "providers.list" ? { providers: [] } : base(cap, input)) };
  const again = await open(blocked, "vit_ghl");
  await settle();
  await press(find(again, "item-sync-records"));
  assert.equal(blocked.opened.some((x) => x.startsWith("records-sync:")), false, "a blocked button starts nothing");
});

test("the Automations that use the key are listed with their steps and each one opens", async () => {
  const v = createSampleVault();
  const root = await open(v, "vit_ghl");
  await settle();
  const text = textOf(root);
  assert.match(text, /New lead to GoHighLevel/);
  assert.match(text, /Create contact/);
  assert.match(text, /2 steps/);
  await press(find(root, "row-aut_nightly"));
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

const withBuilder = (v: SampleVault, status: { allowed: boolean; canGrant: boolean }, personal = false) => {
  const base = v.data.call.bind(v.data);
  const seen: string[] = [];
  v.data = { ...v.data, assistantId: "agt_assistant", ...(personal ? { personal: true } : {}), call: async (cap, input) => {
    if (cap === "access.connector_builder.status") return status;
    if (cap === "access.connector_builder.grant" || cap === "tasks.create") { seen.push(cap); return {}; }
    return base(cap, input);
  } };
  return seen;
};

test("an admin whose assistant may not build connectors sees Allow, and one tap grants it", async () => {
  const v = createSampleVault();
  const seen = withBuilder(v, { allowed: false, canGrant: true });
  const root = await open(v, "vit_ghl");
  await settle();
  assert.match(textOf(root), /needs permission to build connectors/);
  await press(find(root, "auto-gate-fix"));
  await settle();
  assert.deepEqual(seen, ["access.connector_builder.grant"]);
});

test("anyone else sees Ask an admin, which sends one task to the admins and then says so", async () => {
  const v = createSampleVault();
  const seen = withBuilder(v, { allowed: false, canGrant: false });
  const root = await open(v, "vit_ghl");
  await settle();
  assert.match(textOf(root), /An admin can allow it/);
  await press(find(root, "auto-gate-fix"));
  await settle();
  assert.deepEqual(seen, ["tasks.create"]);
  assert.match(textOf(root), /An admin has been asked/);
});

test("in a Personal Space the assistant is allowed without a tap", async () => {
  const v = createSampleVault();
  const seen = withBuilder(v, { allowed: false, canGrant: true }, true);
  const root = await open(v, "vit_ghl");
  await settle();
  assert.deepEqual(seen, ["access.connector_builder.grant"]);
  assert.equal(textOf(root).includes("needs permission"), false);
});

test("a pending connection built on this key asks for its missing secret inline: it is saved to the Vault by the Vault's write, handed to the connection by handle, and the value is cleared", async () => {
  const v = createSampleVault();
  const base = v.data.call.bind(v.data);
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  v.data = { ...v.data, call: async (cap, input) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "connections.list") return { connections: [{ connectionId: "con_r", connector: "resend", state: "pending", handles: ["#Northwind_GHL.GHL_PIT"], filled: ["Resend_Key"] }] };
    if (cap === "connectors.list") return { connectors: [{ key: "resend", title: "Resend", secrets: [{ name: "Resend_Key", description: "the API key" }, { name: "Resend_Webhook", description: "the webhook signing secret" }] }] };
    if (cap === "vault.item.put") return { item: { handle: "#Northwind_Resend_Webhook" } };
    if (cap === "connections.set_secret") return { connection: {} };
    return base(cap, input);
  } };
  const root = await open(v, "vit_ghl");
  await settle();
  assert.match(textOf(root), /Resend needs the webhook signing secret\./);
  assert.equal(textOf(root).includes("the API key"), false, "the slot that is filled is not asked for");
  await typeInto(find(root, "pending-field-con_r:Resend_Webhook"), "whsec_fakefakefakefake1234");
  await settle();
  await press(find(root, "pending-save-con_r:Resend_Webhook"));
  await settle();
  const put = calls.find((c) => c.cap === "vault.item.put")!;
  assert.equal((put.input["fields"] as { value: string }[])[0]!.value, "whsec_fakefakefakefake1234", "the value goes only to the Vault's own write");
  const set = calls.find((c) => c.cap === "connections.set_secret")!;
  assert.deepEqual(set.input, { connectionId: "con_r", slot: "Resend_Webhook", handle: "#Northwind_Resend_Webhook.secret" });
  assert.equal(JSON.stringify(calls.filter((c) => c.cap !== "vault.item.put")).includes("whsec_fake"), false, "no other call carries it");
});
