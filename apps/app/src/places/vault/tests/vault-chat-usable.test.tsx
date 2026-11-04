// A key that tests fine ("Working") but that chats cannot use says so on its page, from the same engine.accounts.list { place: chat } the chat's resolver reads, with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { ProviderPanel } from "../providers/index.ts";
import { withProviders } from "../providers/sample.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

async function stateOf(usable: boolean | undefined): Promise<string> {
  const s = withProviders(createSampleVault());
  const providers = (s.data.screens.query("vault.layout", "providers", {}).getSnapshot() as { data: { providers: Array<{ id: string; state: string }> } }).data.providers;
  const p = providers.find((x) => x.state === "ok")!;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "engine.accounts.list") return { accounts: usable === undefined ? [] : [{ providerId: p.id, usable, ...(usable ? {} : { why: "Your Claude Code sign-in is locked on this server." }) }] };
    if (cap === "engine.providers.list") return { providers: [] };
    return s.data.call(cap, input);
  };
  const restore = installDom();
  try {
    const root = await mount(createRoot, <VaultDataProvider value={{ ...s.data, call }}><ProviderPanel provider={p as never} onNote={() => undefined} onRemoved={() => undefined} /></VaultDataProvider>);
    return textOf(find(root, "provider-state"));
  } finally { restore(); }
}

test("Working until the chat list says the chats cannot use it: then Works, but not in chats, with why", async () => {
  assert.equal(await stateOf(true), "Working");
  assert.equal(await stateOf(undefined), "Working");
  assert.equal(await stateOf(false), "Works, but not in chats: Your Claude Code sign-in is locked on this server.");
});
