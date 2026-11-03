// The Vault for a member in a browser on a server Space: every section switches the list (an empty Vault used to answer "Your vault is empty" on every section, so a click looked dead),
// the Shared items they can use list, AI providers says whether the Space AI key covers them and offers Connect Claude, ChatGPT and Grok right there, and a list the Space did not
// answer says so instead of loading for ever.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import Vault from "../layout/index.tsx";
import type { VaultData } from "../layout/data.tsx";
import { createSampleVault, northwind } from "../layout/sample.ts";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

/** Northwind as a browser member sees it: Shared items only, no providers, and the Space AI key answered live. */
function member(key: { set: boolean; name?: string; models?: string[] } = { set: true, name: "OpenCode Go", models: ["glm-5.3", "kimi-k3"] }): VaultData {
  const v = createSampleVault({ ...northwind, items: northwind.items.filter((i) => i.scope === "shared"), providers: [] });
  const call = v.data.call;
  return {
    ...v.data, aiHome: "none",
    call: async (cap, input) => {
      if (cap === "providers.space_key.get") return { ...key, models: key.models ?? [], mayManage: false };
      if (cap === "access.principals.list") return { principals: [{ id: "usr_owner", kind: "person", name: "Irfad Imtiaz", status: "active", roles: ["rol_owner"] }] };
      return call(cap, input);
    },
  };
}
const title = (root: Parameters<typeof textOf>[0]): string => textOf(find(root as never, "list-title"));

test("a browser member's Vault: every section switches the list, and Shared items list", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Vault data={member()} />);
    assert.match(title(root), /^All/);
    assert.ok(textOf(root).includes("GoHighLevel"), "a Shared item the member can use is listed");
    for (const [row, want] of [["nav-keys", /^Keys/], ["nav-logins", /^Logins/], ["nav-cards", /^Cards/], ["nav-mine", /^Mine/], ["nav-providers", /^AI accounts/], ["nav-all", /^All/]] as const) {
      await press(find(root, `row-${row}`));
      assert.match(title(root), want, `${row} switches the list`);
    }
  } finally { restore(); }
});

test("AI providers in a browser: the Space key covers the member, and their own Claude, ChatGPT or Grok is one press away; never an empty Vault", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Vault data={member()} initial={{ kind: "providers" }} />);
    await flush();
    const text = textOf(root);
    assert.ok(find(root, "vault-space-ai"), "the Space key line");
    assert.ok(text.includes("You're covered") && text.includes("This Space's AI key (OpenCode Go) works for you.") && text.includes("glm-5.3"), text);
    for (const word of ["Connect Claude", "Connect ChatGPT", "Connect Grok", "Use an API key"]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes("Your vault is empty"), "the AI providers section never says the Vault is empty");
  } finally { restore(); }
});

test("AI providers in a browser with no Space key: who can add one, by name and role", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Vault data={member({ set: false })} initial={{ kind: "providers" }} />);
    await flush();
    const text = textOf(root);
    assert.ok(text.includes("This Space has no AI key yet") && text.includes("Ask Irfad Imtiaz (owner) to add one in Console, or connect your own account."), text);
  } finally { restore(); }
});

test("AI providers in the desktop app: Connect Claude, ChatGPT and Grok are right in the section", async () => {
  const restore = installDom();
  try {
    const v = createSampleVault({ ...northwind, providers: [] });
    const root = await mount(createRoot, <Vault data={{ ...v.data, aiHome: "computer" }} initial={{ kind: "providers" }} />);
    const text = textOf(root);
    for (const word of ["Connect Claude", "Connect ChatGPT", "Connect Grok", "Use an API key"]) assert.ok(text.includes(word), word);
    await press(find(root, "row-vault-connect-claude-code"));
    assert.ok(find(root, "add-provider"), "a Connect row opens Add an AI provider on that provider");
  } finally { restore(); }
});

test("an empty section says what it is about; a Vault list the Space did not answer says so", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Vault data={member()} initial={{ kind: "mine" }} />);
    assert.ok(textOf(root).includes("Nothing of yours yet") && !textOf(root).includes("Your vault is empty"));
  } finally { restore(); }
  const base = member();
  // one snapshot, the same object every time, as a live query keeps it
  const failed = { status: "loading", error: { message: "The Space could not answer", code: "gateway.unavailable" } };
  const failedQuery = { subscribe: () => () => undefined, getSnapshot: () => failed };
  const failing: VaultData = { ...base, screens: { ...base.screens, query: (screen: string, name: string, state: Record<string, unknown>) => (screen === "vault.layout" && name === "items"
    ? failedQuery
    : base.screens.query(screen, name, state)) } as ScreenHooks };
  const restore2 = installDom();
  try {
    const root = await mount(createRoot, <Vault data={failing} />);
    assert.ok(find(root, "vault-load-failed") && textOf(root).includes("The Space could not answer"), "a failed read explains itself");
  } finally { restore2(); }
});
