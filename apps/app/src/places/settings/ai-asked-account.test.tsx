// A link that names an AI account (settings.page, page "ai", account <handle>: a failed turn's Sign in again) opens Your AI on that account and starts its own sign-in; with no account named, nothing starts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings, northwind } from "./sample.ts";
import { isAskedAccount } from "./asked-account.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

test("the handle names the account with or without the #, and by ref, provider id or name", () => {
  assert.ok(isAskedAccount("#Dana_Codex", { ref: "#Dana_Codex" }));
  assert.ok(isAskedAccount("dana_codex", { ref: "#Dana_Codex" }));
  assert.ok(isAskedAccount("prv_1", { ref: "#x", providerId: "prv_1" }));
  assert.ok(!isAskedAccount(null, { ref: "#x" }) && !isAskedAccount("#other", { ref: "#x" }));
});

async function open(account: string | undefined): Promise<{ started: string[]; marked: boolean; panel: boolean }> {
  const s = createSampleSettings(northwind);
  s.replica.put("accounts", [
    { id: "acc_a", ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", provider: "claude-code", title: "Claude", name: "Claude, dana@example.com", mine: true, status: "ok" },
    { id: "acc_b", ref: "#Dana_Codex", driver: "codex", kind: "subscription", provider: "codex", title: "Codex", name: "Codex, dana@example.com", mine: true, status: "expired" },
  ] as never);
  const base = s.data.call;
  const seen: string[] = [];
  const data = { ...s.data, call: async (cap: string, input: unknown) => { if (cap === "providers.subscription_start") { seen.push((input as { providerKey: string }).providerKey); return { flowId: "f1", instruction: "Sign in.", needsCode: false }; } return base(cap, input); } };
  const restore = installDom();
  try {
    const root = await mount(createRoot, <SettingsDataProvider value={data as never}><SettingsPlace width={1280} initialPage="ai" {...(account ? { initialAccount: account } : {})} /></SettingsDataProvider>);
    await flush(); await flush();
    const started = seen;
    return { started, marked: find(root as never, "account-sign-in") !== null, panel: find(root as never, "page-ai") !== null };
  } finally { restore(); }
}

test("Your AI opened on an account starts that account's sign-in, once; opened without one it starts nothing", async () => {
  const asked = await open("#Dana_Codex");
  assert.ok(asked.panel);
  assert.deepEqual(asked.started, ["codex"], "the sign-in of the asked account, and only that");
  assert.equal(asked.marked, true, "its sign-in shows under that account");
  assert.deepEqual((await open(undefined)).started, []);
  assert.deepEqual((await open("#Nobody")).started, [], "an account that is not there starts nothing");
});
