// Only an admin shares with everyone in the Space (owner D22). A member adding an AI key or a connection is never offered a Space choice the save would refuse: in its place they get
// "Ask an admin to add it for the team", which sends a Vault request (vault.request) to the admins and saves nothing. An admin keeps the Space choice; a Personal Space shows neither.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { VaultDataProvider } from "../layout/data.tsx";
import type { VaultData } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { AddProvider } from "../providers/index.ts";
import { withProviders } from "../providers/sample.ts";
import { AddConnection, pendingFromEntry } from "../connections/AddConnection.tsx";
import { SAMPLE_CATALOG, sampleConnectionsCall } from "../connections/sample.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const ASK = "Ask an admin to add it for the team";
const SHARED = "Shared with the Space";
const ASKED = "Asked the admins to add it for the team.";

/** The sample Vault with the providers, as an admin or a member: providers.space_key.get answers mayManage, vault.request answers a waiting request. Every call is recorded. */
function vault(o: { admin: boolean; personal?: boolean }): { data: VaultData; calls: { cap: string; input: Record<string, unknown> }[] } {
  const s = withProviders(createSampleVault());
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "providers.space_key.get") return { set: false, models: [], mayManage: o.admin };
    if (cap === "vault.request") return { request: { id: "vrq_new", name: (input as { name: string }).name, fields: ["api_key"], reason: "", state: "waiting", taskId: "tsk_new", at: 0 } };
    return s.data.call(cap, input);
  };
  return { data: { ...s.data, call, ...(o.personal ? { personal: true } : {}) }, calls };
}
const capsOf = (calls: { cap: string }[]): string[] => calls.map((c) => c.cap);

test("add an AI key, a member: the Space choice reads Ask an admin, and choosing it sends a Vault request and saves nothing", async () => {
  const { data, calls } = vault({ admin: false });
  const restore = installDom();
  try {
    const root = await mount(createRoot, <VaultDataProvider value={data}><AddProvider initial={{ providerKey: "openai", connection: "api_key" }} onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    assert.ok(find(root, "provider-key-input"), "the key form shows");
    await press(find(root, "provider-scope"));
    assert.ok(find(root, `menu-item-${ASK}`), "a member is offered Ask an admin");
    assert.equal(find(root, `menu-item-${SHARED}`), null, "a member never sees Shared with the Space");
    await press(find(root, `menu-item-${ASK}`));
    assert.ok(textOf(find(root, "provider-scope")).includes(ASK), "the choice shows");
    assert.equal(find(root, "provider-key-input"), null, "no key is typed in to ask for one");
    assert.equal(find(root, "provider-add"), null, "there is no Add to fail");
    await press(find(root, "provider-ask-admin"));
    const asks = calls.filter((c) => c.cap === "vault.request");
    assert.equal(asks.length, 1, "one Vault request");
    assert.equal(asks[0]!.input["name"], "OpenAI_key");
    assert.deepEqual(asks[0]!.input["fields"], ["api_key"]);
    assert.ok(String(asks[0]!.input["reason"]).includes("OpenAI") && typeof asks[0]!.input["idempotencyKey"] === "string");
    assert.ok(!capsOf(calls).includes("providers.add") && !capsOf(calls).some((c) => c.startsWith("access.share")), "no save and no share");
    assert.equal(textOf(find(root, "provider-asked")).trim(), ASKED, "says so in one line");
    assert.ok(find(root, "provider-done"), "and closes with Done, as an added key does");
  } finally { restore(); }
});

test("add an AI key, an admin keeps Shared with the Space; a Personal Space shows neither", async () => {
  const restore = installDom();
  try {
    const admin = vault({ admin: true });
    const root = await mount(createRoot, <VaultDataProvider value={admin.data}><AddProvider initial={{ providerKey: "openai", connection: "api_key" }} onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    await press(find(root, "provider-scope"));
    assert.ok(find(root, `menu-item-${SHARED}`), "an admin shares with the Space");
    assert.equal(find(root, `menu-item-${ASK}`), null);
    const personal = vault({ admin: true, personal: true });
    const mine = await mount(createRoot, <VaultDataProvider value={personal.data}><AddProvider initial={{ providerKey: "openai", connection: "api_key" }} onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    await press(find(mine, "provider-scope"));
    assert.ok(find(mine, "menu-item-Mine"));
    assert.equal(find(mine, `menu-item-${SHARED}`), null);
    assert.equal(find(mine, `menu-item-${ASK}`), null);
  } finally { restore(); }
});

test("add a connection, a member: Ask an admin in place of Everyone in the Space sends a Vault request, adds no connection and closes", async () => {
  const v = createSampleVault();
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const rest = sampleConnectionsCall(v.data.call);
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    return cap === "vault.request" ? { request: { id: "vrq_new", name: "x", fields: [], reason: "", state: "waiting", taskId: "tsk_new", at: 0 } } : rest(cap, input);
  };
  const data = { ...v.data, call, assistantId: "agt_assistant" };
  const said: string[] = [];
  let closed = 0;
  const restore = installDom();
  try {
    const pending = [pendingFromEntry(SAMPLE_CATALOG[1]!)];
    const root = await mount(createRoot, <VaultDataProvider value={data}><AddConnection canAddSpace={false} canAsk initial={{ pending }} onClose={() => { closed++; }} onAdded={(t) => said.push(t)} /></VaultDataProvider>);
    assert.ok(find(root, "scope-ask") && textOf(find(root, "scope-ask")).includes(ASK), "a member is offered Ask an admin");
    assert.equal(find(root, "scope-space"), null, "and never Everyone in the Space");
    await press(find(root, "scope-ask"));
    assert.equal(find(root, "ask-NOTION_TOKEN"), null, "no key is typed in to ask for one");
    await press(find(root, "setup-ask"));
    const asks = calls.filter((c) => c.cap === "vault.request");
    assert.equal(asks.length, 1, "one Vault request");
    assert.deepEqual(asks[0]!.input["fields"], ["NOTION_TOKEN", "NOTION_PAGE_ID"]);
    assert.ok(/^[A-Za-z][A-Za-z0-9_]*$/.test(String(asks[0]!.input["name"])), "the name is a handle the server takes");
    assert.ok(String(asks[0]!.input["reason"]).includes("npx -y notion-mcp-server@3.3.0"), "the admin sees what to add");
    assert.ok(!capsOf(calls).some((c) => c.startsWith("plugins.connection.") || c === "vault.item.put"), "no connection and no key saved");
    assert.equal(textOf(find(root, "connection-asked")).includes(ASKED), true, "says so in one line");
    await press(find(root, "connection-asked-done"));
    assert.deepEqual(said, [ASKED]);
    assert.equal(closed, 1, "Done closes the sheet");
  } finally { restore(); }
});

test("add a connection: an admin keeps Everyone in the Space, and a Personal Space has no Space choice at all", async () => {
  const v = createSampleVault();
  const restore = installDom();
  try {
    const data = { ...v.data, call: sampleConnectionsCall(v.data.call), assistantId: "agt_assistant" };
    const pending = [pendingFromEntry(SAMPLE_CATALOG[1]!)];
    const admin = await mount(createRoot, <VaultDataProvider value={data}><AddConnection canAddSpace initial={{ pending }} onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    assert.ok(find(admin, "scope-space") && !find(admin, "scope-ask"));
    const personal = await mount(createRoot, <VaultDataProvider value={{ ...data, personal: true }}><AddConnection canAddSpace={false} canAsk initial={{ pending }} onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    assert.ok(!find(personal, "scope-space") && !find(personal, "scope-ask"), "a Personal Space shows neither");
  } finally { restore(); }
});
