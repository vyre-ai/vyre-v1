// rc.8 polish of the Vault: a provider list that cannot load says so and offers Try again (not "no providers"), the Advanced page carries the sidebar highlight, empty lists each have
// their own words and one action, a provider's models show as a list with their own loading, empty and failed states, and the .env line holds no button inside a button.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import Vault from "../layout/index.tsx";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { AddProvider, ProviderPage } from "../providers/index.ts";
import { withProviders } from "../providers/sample.ts";
import type { Provider } from "../layout/model.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const sample = () => withProviders(createSampleVault());
const providers = (s: ReturnType<typeof sample>): Provider[] => (s.data.screens.query("vault.layout", "providers", {}).getSnapshot() as { data: { providers: Provider[] } }).data.providers;

test("Add an AI provider: a catalog that fails to load says so and Try again asks again", async () => {
  const s = sample();
  let asked = 0;
  const data = { ...s.data, call: async (cap: string, input: unknown) => { if (cap === "providers.catalog") { asked++; throw new Error("no answer"); } return s.data.call(cap, input); } };
  const restore = installDom();
  try {
    const root = await mount(createRoot, <VaultDataProvider value={data}><AddProvider onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    assert.ok(find(root, "provider-load-failed"), "the failure has its own state");
    assert.ok(!textOf(root).includes("No providers to add"), "a failure is not an empty catalog");
    assert.equal(asked, 1);
    await press(find(root, "provider-retry"));
    assert.equal(asked, 2, "Try again calls the catalog again");
  } finally { restore(); }
});

test("Add an AI provider: an empty catalog is an empty state with no retry", async () => {
  const s = sample();
  const data = { ...s.data, call: async (cap: string, input: unknown) => (cap === "providers.catalog" ? { providers: [] } : s.data.call(cap, input)) };
  const restore = installDom();
  try {
    const root = await mount(createRoot, <VaultDataProvider value={data}><AddProvider onClose={() => undefined} onAdded={() => undefined} /></VaultDataProvider>);
    assert.ok(find(root, "provider-none") && !find(root, "provider-retry"));
  } finally { restore(); }
});

test("provider page: the models show as a list, and a failed test says so with Try again", async () => {
  const s = sample();
  const p = providers(s).find((x) => x.id === "prv_claude")!;
  const restore = installDom();
  try {
    const ok = await mount(createRoot, <VaultDataProvider value={s.data}><ProviderPage provider={p} handle="#Northwind_Claude" onNote={() => undefined} /></VaultDataProvider>);
    const models = textOf(find(ok, "provider-models"));
    assert.ok(models.length > 0 && !models.includes("Loading") && !models.includes("Could not"), "the models drew");
    let tests = 0;
    const failing = { ...s.data, call: async (cap: string, input: unknown) => { if (cap === "providers.test") { tests++; throw new Error("down"); } return s.data.call(cap, input); } };
    const bad = await mount(createRoot, <VaultDataProvider value={failing}><ProviderPage provider={p} handle="#Northwind_Claude" onNote={() => undefined} /></VaultDataProvider>);
    assert.ok(textOf(find(bad, "provider-models")).includes("Could not load the models"));
    await press(find(bad, "provider-models-retry"));
    assert.equal(tests, 2, "Try again tests the provider again");
  } finally { restore(); }
});

test("the Advanced page highlights Advanced in the sidebar, not the list that was open", () => {
  const out = clean(renderToStaticMarkup(<Vault data={createSampleVault().data} route={{ surface: "advanced" }} />));
  const row = (id: string): string => new RegExp(`<[^<>]*data-testid="row-${id}"[^<>]*>`).exec(out)?.[0] ?? "";
  assert.ok(has(row("nav-advanced"), 'aria-selected="true"'), "Advanced is selected");
  assert.ok(has(row("nav-all"), 'aria-selected="false"'), "All is not");
  for (const id of ["backups", "devices", "outside-agents", "policy"]) assert.ok(has(out, `data-testid="row-vault-advanced-${id}-leading"`), `${id} has an icon`);
});

test("empty lists have their own words and one action", () => {
  const v = createSampleVault();
  const empty = (sel: object): string => clean(renderToStaticMarkup(<Vault data={v.data} initial={sel as never} />));
  const quiet = createSampleVault();
  // a Space with no providers
  const none = { ...quiet.data, screens: { ...quiet.data.screens, query: (screen: string, name: string, state: Record<string, unknown>) => (screen === "vault.layout" && name === "providers" ? { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: { providers: [] } }) }
      : screen === "vault.layout" && name === "items" ? { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: { items: (quiet.data.screens.query(screen, name, state).getSnapshot() as { data: { items: { kind: string }[] } }).data.items.filter((i) => i.kind !== "ai_subscription") } }) }
      : quiet.data.screens.query(screen, name, state)) } };
  const out = clean(renderToStaticMarkup(<Vault data={none as never} initial={{ kind: "providers" }} />));
  assert.ok(has(out, "No AI providers yet") && has(out, "Add a provider"), "providers: its own title and its own action");
  assert.ok(!has(empty({ kind: "keys" }), "No keys yet"), "a section with items draws the items");
});

test("a .env line holds no button inside a button", () => {
  const out = clean(renderToStaticMarkup(<Vault data={createSampleVault().data} />));
  const line = /<[^<>]*data-testid="env-line-GHL_PIT"[^<>]*>/.exec(out)?.[0] ?? "";
  assert.ok(line.length > 0 && !/role="button"/.test(line), "the line is a group; Reveal and Copy are its buttons");
  assert.ok(has(out, 'aria-label="Reveal GHL_PIT"') && has(out, 'aria-label="Copy GHL_PIT"'));
});

test("help is a tooltip, not a sentence: the policy rows, the provider's privacy mark and a disabled Save say it on hover", () => {
  const policy = clean(renderToStaticMarkup(<Vault data={createSampleVault().data} route={{ surface: "policy" }} />));
  assert.ok(!policy.includes(">A link made for an export can last up to this long<"), "no help sentence on the page");
  const page = clean(renderToStaticMarkup(<VaultDataProvider value={sample().data}><ProviderPage provider={providers(sample()).find((x) => x.id === "prv_claude")!} handle="#Northwind_Claude" onNote={() => undefined} /></VaultDataProvider>));
  assert.ok(has(page, 'title="Only you can use it"') && !has(page, ">Only you can use it<"), "Only you can use it is on hover");
});
