// A subscription sign-in's page (Vault > AI providers > Codex): a "..." menu with Rename, Sign in again, Disconnect and Move to Trash, each making its real capability call, and the list's Move to Trash
// (right-click or the Delete key) reaching the page, which asks and then trashes with an Undo. Before this the page had no menu and the list's Move to Trash did nothing for a sign-in.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import Vault from "../layout/index.tsx";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { ProviderPage } from "../providers/index.ts";
import { withProviders } from "../providers/sample.ts";
import type { Provider } from "../layout/model.ts";
import { fireUp } from "../../chats/sidebar/chats-open.support.tsx";
import type { Node } from "../../../onboarding/test-dom.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

const providerOf = (s: ReturnType<typeof withProviders>, id: string): Provider => (s.data.screens.query("vault.layout", "providers", {}).getSnapshot() as { data: { providers: Provider[] } }).data.providers.find((p) => p.id === id)!;
const caps = (s: { calls: { cap: string; input: unknown }[] }, cap: string): unknown[] => s.calls.filter((c) => c.cap === cap).map((c) => c.input);

async function page(extra: { askDelete?: number } = {}) {
  const s = withProviders(createSampleVault());
  const p = providerOf(s, "prv_claude");
  assert.equal(p.connection, "subscription");
  const notes: { text: string; undo?: (() => Promise<void> | void) | undefined }[] = [];
  let gone = 0;
  const data = { ...s.data, call: async (cap: string, input: unknown) => (cap === "engine.accounts.list" ? { accounts: [] } : cap === "engine.providers.list" ? { providers: [] } : s.data.call(cap, input)) };
  const root = await mount(createRoot, <VaultDataProvider value={data}><ProviderPage provider={p} handle="#Claude" onNote={(text, undo) => notes.push({ text, undo })} onGone={() => { gone += 1; }} {...extra} /></VaultDataProvider>);
  await flush();
  return { s, p, root: root as Node, notes, gone: () => gone };
}
const openMenu = async (root: Node): Promise<void> => { await press(find(root as never, "provider-more") as never); await flush(); };

test("the page has a More menu with Rename, Sign in again, Disconnect and Move to Trash", async () => {
  const restore = installDom();
  try {
    const a = await page();
    assert.ok(find(a.root as never, "provider-more"), "the button is there");
    await openMenu(a.root);
    for (const l of ["Rename…", "Sign in again", "Disconnect…", "Move to Trash"]) assert.ok(find(a.root as never, `menu-item-${l}`), l);
  } finally { restore(); }
});

test("Sign in again starts the provider's own sign-in", async () => {
  const restore = installDom();
  try {
    const a = await page();
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Sign in again") as never); await flush();
    assert.deepEqual(caps(a.s, "providers.subscription_start").length, 1);
    assert.match(a.notes.at(-1)!.text, /sign in/i, "the instruction is shown");
  } finally { restore(); }
});

test("Disconnect asks first, then removes the provider and closes the page", async () => {
  const restore = installDom();
  try {
    const a = await page();
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Disconnect…") as never); await flush();
    assert.ok(find(a.root as never, "provider-confirm"), "asks");
    assert.equal(caps(a.s, "providers.remove").length, 0, "nothing yet");
    await press(find(a.root as never, "provider-confirm-no") as never); await flush();
    assert.equal(find(a.root as never, "provider-confirm"), null, "Cancel leaves it");
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Disconnect…") as never); await flush();
    await press(find(a.root as never, "provider-confirm-yes") as never); await flush();
    assert.deepEqual(caps(a.s, "providers.remove"), [{ providerId: "prv_claude" }]);
    assert.equal(a.gone(), 1, "the detail closes");
  } finally { restore(); }
});

test("Move to Trash asks, trashes the item, and the line has an Undo that brings it back", async () => {
  const restore = installDom();
  try {
    const a = await page();
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Move to Trash") as never); await flush();
    assert.ok(find(a.root as never, "provider-confirm"));
    await press(find(a.root as never, "provider-confirm-yes") as never); await flush();
    assert.deepEqual(caps(a.s, "vault.item.delete"), [{ itemId: a.p.itemId }]);
    assert.equal(a.gone(), 1);
    const note = a.notes.at(-1)!;
    assert.match(note.text, /to Trash/);
    assert.ok(note.undo, "Undo is offered");
    await note.undo!();
    assert.deepEqual(caps(a.s, "vault.item.restore"), [{ itemId: a.p.itemId }]);
  } finally { restore(); }
});

test("Rename shows the name as a field and saves it with vault.item.update; Cancel keeps the name", async () => {
  const restore = installDom();
  try {
    const a = await page();
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Rename…") as never); await flush();
    assert.ok(find(a.root as never, "provider-rename-input"));
    await press(find(a.root as never, "provider-rename-cancel") as never); await flush();
    assert.equal(find(a.root as never, "provider-rename"), null);
    assert.equal(caps(a.s, "vault.item.update").length, 0);
    await openMenu(a.root);
    await press(find(a.root as never, "menu-item-Rename…") as never); await flush();
    await typeInto(find(a.root as never, "provider-rename-input") as never, "Codex personal");
    await press(find(a.root as never, "provider-rename-save") as never); await flush();
    assert.deepEqual(caps(a.s, "vault.item.update"), [{ itemId: a.p.itemId, name: "Codex personal" }]);
    assert.ok(a.notes.at(-1)!.undo, "Undo puts the old name back");
  } finally { restore(); }
});

test("the list's Move to Trash and the Delete key reach a sign-in's page, which asks", async () => {
  const restore = installDom();
  try {
    const a = await page({ askDelete: 1 });
    assert.ok(find(a.root as never, "provider-confirm"), "asked as soon as the list asked");
  } finally { restore(); }
  // in the place: right-click on the sign-in's row, Move to Trash
  const restore2 = installDom();
  try {
    const s = withProviders(createSampleVault());
    const root = await mount(createRoot, <Vault data={s.data} />);
    await flush();
    const item = providerOf(s, "prv_claude").itemId;
    await fireUp(root as never, `row-${item}`, "onContextMenu", { preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} });
    await press(find(root as never, "menu-item-Move to Trash…") as never); await flush();
    assert.ok(find(root as never, "provider-confirm"), "the page opened and asks");
    await press(find(root as never, "provider-confirm-yes") as never); await flush();
    assert.deepEqual(caps(s, "vault.item.delete"), [{ itemId: item }]);
  } finally { restore2(); }
});
