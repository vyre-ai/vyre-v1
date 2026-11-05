// A subscription account that needs signing in again (or whose engine says so) offers Sign in again on its page, which starts that provider's own sign-in right there; one that works does not.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { ProviderPanel } from "../providers/index.ts";
import { withProviders } from "../providers/sample.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

async function panel(state: string, connection: string): Promise<{ root: ReturnType<typeof find>; calls: string[]; restore(): void }> {
  const s = withProviders(createSampleVault());
  const base = (s.data.screens.query("vault.layout", "providers", {}).getSnapshot() as { data: { providers: Array<Record<string, unknown>> } }).data.providers[0]!;
  const p = { ...base, state, connection, providerKey: "codex" };
  const calls: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push(cap);
    if (cap === "engine.accounts.list") return { accounts: [] };
    if (cap === "engine.providers.list") return { providers: [] };
    if (cap === "providers.subscription_start") return { flowId: "f1", instruction: "Sign in.", needsCode: false };
    return s.data.call(cap, input);
  };
  const restore = installDom();
  const root = await mount(createRoot, <VaultDataProvider value={{ ...s.data, call }}><ProviderPanel provider={p as never} onNote={() => undefined} onRemoved={() => undefined} /></VaultDataProvider>);
  await flush();
  return { root: root as never, calls, restore };
}

test("needs sign in: the page offers Sign in again, and pressing it starts the provider's own sign-in; a working sign-in and an API key do not offer it", async () => {
  const a = await panel("needs_sign_in", "subscription");
  try {
    assert.ok(find(a.root as never, "provider-sign-in-again"), "offered");
    await press(find(a.root as never, "provider-sign-in-again")); await flush();
    assert.ok(a.calls.includes("providers.subscription_start"), "the sign-in started");
  } finally { a.restore(); }
  const b = await panel("ok", "subscription");
  try { assert.equal(find(b.root as never, "provider-sign-in-again"), null); } finally { b.restore(); }
  const c = await panel("failing", "api_key");
  try { assert.equal(find(c.root as never, "provider-sign-in-again"), null); } finally { c.restore(); }
});
