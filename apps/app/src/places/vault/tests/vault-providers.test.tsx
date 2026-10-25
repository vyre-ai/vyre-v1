// Vault AI providers, Health and Import (spec 3.8, 2.17): the provider panel over the list, Add an AI provider, the Health section and the Import sheet, from the Northwind sample Space through
// the live screen queries. Screens render with react-dom/server over react-native-web (ruling 28); controls are checked by the capability calls they make, because a static render has no
// clicks. Path mapping: the packet names apps/app/tests/vault-providers*.test.tsx, which lanes-check rejects as outside lane L9f; the lane's tests live beside the screens, as P-L9f_04's do.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import Vault from "../layout/index.tsx";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault, harbor } from "../layout/sample.ts";
import type { Provider } from "../layout/model.ts";
import { AddProvider, ProviderPanel, canShare, countWords, howConnected, normalizeAddress, scopeWords, testWords, tokenWords, usageWords, userKind } from "../providers/index.ts";
import { withProviders, CATALOG } from "../providers/sample.ts";
import type { ProviderSample } from "../providers/sample.ts";
import { HealthView, issueLine, summaryWords, worstFirst } from "../health/index.ts";
import { DEDUPE, ImportSheet, SOURCES, duplicates, planWords, previewLine, resultWords } from "../import/index.ts";
import type { Parsed } from "../import/index.ts";

const size = (width: number): void => Dimensions.set({ window: { width, height: 800, scale: 1, fontScale: 1 }, screen: { width, height: 800, scale: 1, fontScale: 1 } });
size(1280);

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const sample = (space = undefined as undefined | typeof harbor, o: Parameters<typeof withProviders>[1] = {}): ProviderSample => withProviders(createSampleVault(space), o);
const within = (s: ProviderSample, el: ReactNode): string => clean(renderToStaticMarkup(<VaultDataProvider value={s.data}>{el}</VaultDataProvider>));
const providersOf = (s: ProviderSample): Provider[] => (s.data.screens.query("vault.layout", "providers", {}).getSnapshot() as { data: { providers: Provider[] } }).data.providers;
const provider = (s: ProviderSample, id: string): Provider => providersOf(s).find((p) => p.id === id)!;
const callsTo = (s: ProviderSample, cap: string): { cap: string; input: unknown }[] => s.calls.filter((c) => c.cap === cap);

test("providers: the words for how a provider connects, whose it is, what it cost and who uses it", () => {
  const s = sample();
  const claude = provider(s, "prv_claude");
  const anthropic = provider(s, "prv_anthropic");
  assert.equal(howConnected(claude), "Subscription, yours");
  assert.equal(howConnected(anthropic), "API key #Northwind_OpenAI");
  assert.equal(scopeWords(claude), "Mine");
  assert.equal(scopeWords(anthropic), "Shared");
  assert.equal(canShare(claude), false, "a subscription sign-in is never shareable");
  assert.equal(canShare(anthropic), true);
  assert.equal(usageWords(claude), "4.2M tokens this month");
  assert.equal(usageWords(anthropic), "1.1M tokens, $13.20 this month");
  assert.equal(usageWords({ usage: { tokens: 0, costCents: 0, periodStart: 0 } }), "Not used this month");
  assert.equal(tokenWords(900_000), "900k tokens");
  assert.equal(tokenWords(640), "640 tokens");
  assert.equal(userKind("aut_weekly"), "automation");
  assert.equal(userKind("agt_intake"), "agent");
  assert.equal(countWords(1, "model"), "1 model");
  assert.equal(countWords(3, "model"), "3 models");
});

test("providers: a subscription opens on the prototype's own page, with the sign-in box, models, Used by and no .env card", () => {
  const out = clean(renderToStaticMarkup(<Vault data={sample().data} initial={{ kind: "providers" }} />));
  assert.ok(has(out, 'data-testid="provider-page"') && !has(out, 'data-testid="item-env"') && !has(out, 'data-testid="provider-panel"'), "its own page, no card, no strip");
  assert.ok(has(out, "Signed in with Claude Max") && has(out, "Sign in again") && has(out, ">Models<") && has(out, "Only you can use it"));
  assert.ok(has(out, ">Used by<") && has(out, ">Intake<") && has(out, ">Research<") && has(out, ">Recent use<"));
  assert.ok(has(out, "This month:") && has(out, "4.2M tokens"), "the month's total line");
  assert.ok(has(out, 'data-testid="provider-ask"') && !has(out, 'data-testid="provider-share"'), "Ask in the header, nothing to share");
  assert.deepEqual(["Claude", "OpenCode Go key", "OpenAI key"].map((n) => has(out, n)), [true, true, true], "the prototype's three providers");
});

test("providers: an API key can be shared and lets the Space use it", () => {
  const s = sample();
  const out = within(s, <ProviderPanel provider={provider(s, "prv_anthropic")} onNote={() => undefined} onRemoved={() => undefined} />);
  assert.ok(has(out, 'data-testid="provider-share"') && has(out, 'data-testid="provider-space"') && !has(out, 'data-testid="provider-private"'));
  assert.match(out.match(/<[^>]*data-testid="provider-space"[^>]*>/)?.[0] ?? "", /aria-checked="true"/, "the shared key is on for the Space");
  assert.ok(has(out, "1 agent or Automation") && has(out, ">Intake<"));
});

test("providers: Test connection says what came back, with the models and how long it took", async () => {
  const s = sample();
  const out = (await s.data.call("providers.test", { providerId: "prv_anthropic" })) as { ok: boolean; models: string[]; latencyMs: number };
  assert.equal(testWords(out), "Connected in 240 ms. 3 models available.");
  assert.equal(testWords({ ok: false, models: [], latencyMs: 0, detail: "The key was refused." }), "That did not connect. The key was refused.");
  await assert.rejects(() => s.data.call("providers.test", { providerId: "nope" }), /No such provider/);
});

test("providers: Space use switches on a key and refuses a subscription; Remove drops the provider and its item", async () => {
  const s = sample();
  await s.data.call("providers.set_space_use", { providerId: "prv_opencode", allow: true });
  assert.equal(provider(s, "prv_opencode").spaceMayUse, true);
  await assert.rejects(() => s.data.call("providers.set_space_use", { providerId: "prv_claude", allow: true }), /cannot be shared/);
  await s.data.call("providers.remove", { providerId: "prv_opencode" });
  assert.ok(!providersOf(s).some((p) => p.id === "prv_opencode"));
});

test("add provider: the gallery comes from the definition files, and a bare address gets http", async () => {
  const s = sample();
  const cat = (await s.data.call("providers.catalog", {})) as { providers: { key: string; connections: string[] }[] };
  assert.deepEqual(cat.providers.map((c) => c.key), CATALOG.map((c) => c.key));
  assert.ok(cat.providers.find((c) => c.key === "claude-code")!.connections.includes("subscription"));
  assert.equal(normalizeAddress("localhost:11434"), "http://localhost:11434");
  assert.equal(normalizeAddress(" https://models.example:8080/v1 "), "https://models.example:8080/v1");
  assert.equal(normalizeAddress("not an address"), null);
  assert.equal(normalizeAddress("   "), null);
  const sheet = within(s, <AddProvider onClose={() => undefined} onAdded={() => undefined} />);
  assert.ok(has(sheet, 'data-testid="add-provider"') && has(sheet, "Add an AI provider") && has(sheet, 'data-testid="provider-cancel"'));
});

test("add provider: an API key is added once, in the scope chosen, with an item behind it", async () => {
  const s = sample();
  const before = providersOf(s).length;
  await assert.rejects(() => s.data.call("providers.add", { providerKey: "openai", connection: "api_key", apiKey: "  ", scope: "mine", idempotencyKey: "k0" }), /Paste the key/);
  const out = (await s.data.call("providers.add", { providerKey: "openai", connection: "api_key", apiKey: "sk-fake", scope: "shared", idempotencyKey: "k1" })) as { provider: Provider };
  assert.equal(out.provider.scope, "shared");
  assert.equal(out.provider.connection, "api_key");
  assert.equal(providersOf(s).length, before + 1);
  const items = (s.data.screens.query("vault.layout", "items", {}).getSnapshot() as { data: { items: { id: string }[] } }).data.items;
  assert.ok(items.some((i) => i.id === out.provider.itemId), "the item the key lives in");
});

test("add provider: a subscription opens its own sign-in, then is Mine; a local model asks for an address", async () => {
  const s = sample();
  const start = (await s.data.call("providers.subscription_start", { providerKey: "grok", idempotencyKey: "s1" })) as { flowId: string; instruction: string; userCode?: string };
  assert.ok(start.instruction.includes("Grok") && start.userCode);
  const done = (await s.data.call("providers.subscription_complete", { flowId: start.flowId })) as { provider: Provider };
  assert.equal(done.provider.scope, "mine");
  assert.equal(done.provider.connection, "subscription");
  await assert.rejects(() => s.data.call("providers.subscription_complete", { flowId: "never" }), /not started/);
  await assert.rejects(() => s.data.call("providers.add", { providerKey: "ollama", connection: "local_model", scope: "mine", idempotencyKey: "l0" }), /address/);
  const local = (await s.data.call("providers.add", { providerKey: "ollama", connection: "local_model", address: "http://localhost:11434", scope: "mine", idempotencyKey: "l1" })) as { provider: Provider };
  assert.equal(local.provider.via, "Local model at http://localhost:11434");
  const t = (await s.data.call("providers.test", { providerId: local.provider.id })) as { ok: boolean; models: string[] };
  assert.ok(t.ok && t.models.includes("llama3.1"));
});

test("health: one summary line and a row for each flagged item with what is wrong, worst first", () => {
  const s = sample();
  const h = (s.data.screens.query("vault.health", "health", {}).getSnapshot() as { data: Parameters<typeof HealthView>[0]["health"] }).data;
  const out = within(s, <HealthView health={h} selectedId={null} onSelect={() => undefined} />);
  assert.ok(has(out, 'data-testid="vault-health"') && has(out, "2 rotation due"), "the summary");
  assert.ok(has(out, "GoHighLevel") && has(out, "Stripe") && has(out, "Its rotation reminder has passed"), "the rows");
  assert.equal(summaryWords({ weak: 2, reused: 1, stale: 0, rotationDue: 0 }), "2 weak, 1 reused");
  assert.equal(summaryWords({ weak: 0, reused: 0, stale: 0, rotationDue: 0 }), "All clear");
  assert.equal(issueLine(["weak", "stale"]), "Weak, easy to guess · Not changed in a long time");
  const sorted = worstFirst([{ itemId: "a", name: "Zed", issues: ["weak"] }, { itemId: "b", name: "Amy", issues: ["weak", "reused"] }, { itemId: "c", name: "Bo", issues: ["weak"] }]);
  assert.deepEqual(sorted.map((i) => i.itemId), ["b", "c", "a"]);
  const empty = within(s, <HealthView health={{ ...h, items: [] }} selectedId={null} onSelect={() => undefined} />);
  assert.ok(has(empty, 'data-testid="health-clear"'));
});

test("health: the section in the place shows the summary above the flagged rows, and opens an item in the card", () => {
  const out = clean(renderToStaticMarkup(<Vault data={sample().data} initial={{ kind: "health" }} />));
  assert.ok(has(out, 'data-testid="vault-health"') && has(out, 'data-testid="health-summary"'));
  assert.ok(at(out, 'data-testid="vault-health"') < at(out, 'data-testid="item-env"'), "the list sits left of the card");
  assert.ok(!has(clean(renderToStaticMarkup(<Vault data={sample(harbor).data} initial={{ kind: "all" }} />)), 'data-testid="vault-health"'));
});

const FILE: readonly Parsed[] = [
  { name: "Notion", kind: "login", fieldKeys: ["USERNAME", "PASSWORD"], warnings: [] },
  { name: "GitHub", kind: "login", fieldKeys: ["USERNAME", "PASSWORD"], duplicateOf: "vit_github", warnings: [] },
  { name: "Company card", kind: "card", fieldKeys: ["CARD_NUMBER"], warnings: ["no billing address"] },
];

test("import: four sources, a plan in words before anything changes, and the result after", () => {
  assert.deepEqual(SOURCES.map((x) => x.name), ["1Password", "Bitwarden", "LastPass", "Chrome passwords"]);
  assert.deepEqual(DEDUPE.map((d) => d.key), ["skip", "overwrite", "keep_both"]);
  assert.equal(duplicates(FILE), 1);
  assert.equal(planWords(FILE, "skip"), "2 new, 1 already here will be skipped.");
  assert.equal(planWords(FILE, "overwrite"), "2 new, 1 already here will be replaced.");
  assert.equal(planWords(FILE, "keep_both"), "2 new, 1 already here will be kept and added again.");
  assert.equal(planWords(FILE.slice(0, 1), "skip"), "1 item will be added.");
  assert.equal(planWords([], "skip"), "There is nothing in that file to import.");
  assert.equal(previewLine(FILE[1]!), "Login · 2 fields · already in your Vault");
  assert.equal(previewLine(FILE[2]!), "Card · 1 field · no billing address");
  assert.equal(resultWords({ created: 4, updated: 0, skipped: 1 }), "Added 4, skipped 1.");
  assert.equal(resultWords({ created: 2, updated: 1, skipped: 0 }), "Added 2, replaced 1.");
});

test("import: the sheet starts on where the export came from, and a chosen source asks for the file", () => {
  const s = sample();
  const folders = (s.data.screens.query("vault.layout", "folders", {}).getSnapshot() as { data: { folders: Parameters<typeof ImportSheet>[0]["folders"] } }).data.folders;
  const first = within(s, <ImportSheet folders={folders} onClose={() => undefined} onDone={() => undefined} />);
  assert.ok(has(first, "Import into the Vault") && has(first, ">1Password<") && has(first, ">Bitwarden<") && has(first, ">LastPass<") && has(first, ">Chrome passwords<"));
  const second = within(s, <ImportSheet folders={folders} initialSource="bitwarden" onClose={() => undefined} onDone={() => undefined} />);
  assert.ok(has(second, "Import from Bitwarden") && has(second, 'data-testid="import-choose"') && has(second, "nothing is added until you press Import"));
  assert.ok(!has(second, 'data-testid="import-go"'), "no Import button before a file is read");
});

test("import: the file is read first, then the import runs with the choices made and says how many of each", async () => {
  const s = sample(undefined, { importItems: FILE });
  const file = await s.data.pickFile!(".json,.csv");
  assert.equal(file, "file_export1");
  const parsed = (await s.data.call("vault.import_parse", { source: "bitwarden", fileId: file })) as { items: Parsed[] };
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(callsTo(s, "vault.import"), [], "reading changes nothing");
  assert.deepEqual(await s.data.call("vault.import", { source: "bitwarden", fileId: file, folderId: "fld_mine", dedupe: "skip", idempotencyKey: "i1" }), { created: 2, updated: 0, skipped: 1 });
  assert.deepEqual(await s.data.call("vault.import", { source: "bitwarden", fileId: file, folderId: "fld_mine", dedupe: "overwrite", idempotencyKey: "i2" }), { created: 2, updated: 1, skipped: 0 });
  assert.deepEqual(await s.data.call("vault.import", { source: "bitwarden", fileId: file, folderId: "fld_mine", dedupe: "keep_both", idempotencyKey: "i3" }), { created: 3, updated: 0, skipped: 0 });
  const cancelled = sample(undefined, { pick: null });
  assert.equal(await cancelled.data.pickFile!(".csv"), null, "cancelling the chooser hands back nothing");
  assert.deepEqual(cancelled.picked, []);
});

test("a person can reach all three from the place: More holds Add an AI provider and Import, and the plus adds a provider in that section", () => {
  const out = clean(renderToStaticMarkup(<Vault data={sample().data} initial={{ kind: "providers" }} />));
  assert.ok(has(out, 'data-testid="vault-more"') && has(out, 'aria-label="Add an AI provider"'), "More, and a plus that says what it adds here");
  const all = clean(renderToStaticMarkup(<Vault data={sample().data} />));
  assert.ok(has(all, 'aria-label="Add an item"'), "elsewhere the plus adds an item");
  const sheets = [
    clean(renderToStaticMarkup(<Vault data={sample().data} sheet={{ addProvider: true }} />)),
    clean(renderToStaticMarkup(<Vault data={sample().data} sheet={{ importFrom: true }} />)),
  ];
  assert.ok(has(sheets[0]!, 'data-testid="add-provider"') && has(sheets[1]!, 'data-testid="import-sheet"'));
});

test("no value reaches any of these screens, and no copy uses an em dash", () => {
  const s = sample();
  const all = [
    clean(renderToStaticMarkup(<Vault data={s.data} initial={{ kind: "providers" }} />)),
    clean(renderToStaticMarkup(<Vault data={s.data} initial={{ kind: "health" }} />)),
    within(s, <AddProvider onClose={() => undefined} onAdded={() => undefined} />),
    clean(renderToStaticMarkup(<Vault data={s.data} sheet={{ importFrom: "lastpass" }} />)),
  ].join("\n");
  for (const secret of ["sk-ant-oat01-fake", "sk-proj-fake", "oc-fake-fake"]) assert.ok(!has(all, secret), "no secret in the markup");
  assert.ok(!has(all, String.fromCharCode(0x2014)), "no em dash");
});
