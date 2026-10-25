// Vault layout and ItemEnv: the screen. The sidebar, the list and the open item render from the Northwind sample Space through the live screen queries; names and field names show but no
// value is ever in the markup; a reveal is one logged capability call after one agreement; every write the place makes changes what the next render shows; the place opens offline
// and draws a frame of the right size before data. Names below are the test names the packet's evidence links.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault, { VaultLoading } from "../layout/index.tsx";
import { VaultDataProvider } from "../layout/data.tsx";
import type { VaultData } from "../layout/data.tsx";
import type { ReactElement, ReactNode } from "react";
import { ItemEnv } from "../itemenv/index.ts";
import { createSampleVault, harbor, northwind } from "../layout/sample.ts";
import type { SampleSpace, SampleVault } from "../layout/sample.ts";
import { visibleItems, countItems } from "../layout/model.ts";
import type { Item } from "../layout/model.ts";
import { MASK, createRevealStore } from "../itemenv/index.ts";

const VaultProviderWrapper = ({ data, children }: { data: VaultData; children: ReactNode }): ReactElement => <VaultDataProvider value={data}>{children}</VaultDataProvider>;
const size = (width: number): void => Dimensions.set({ window: { width, height: 800, scale: 1, fontScale: 1 }, screen: { width, height: 800, scale: 1, fontScale: 1 } });
size(1280);

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const html = (v: SampleVault, props: Record<string, unknown> = {}): string => clean(renderToStaticMarkup(<Vault data={v.data} {...props} />));
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const has = (s: string, needle: string): boolean => s.includes(needle);
const allValues = (sp: SampleSpace): string[] => sp.items.flatMap((i) => i.fields.map((f) => f[1])).filter((v) => v.length >= 6);
const queryOf = <T,>(v: SampleVault, screen: string, name: string, state: Record<string, unknown> = {}): T => {
  const snap = v.data.screens.query(screen, name, state).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: T }).data;
};
const itemNames = (v: SampleVault): string[] => queryOf<{ items: { name: string }[] }>(v, "vault.layout", "items").items.map((i) => i.name);

test("sidebar: sections in the prototype's order with counts, Requested and Health only when they have something", () => {
  const out = html(createSampleVault());
  const order = ["nav-requested", "nav-all", "nav-providers", "nav-keys", "nav-logins", "nav-cards", "nav-health", "nav-folder-fld_marketing", "nav-folder-fld_finance", "nav-folder-fld_ops", "nav-mine", "nav-advanced"].map((id) => at(out, `data-testid="row-${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Requested, All, AI providers, Keys, Logins, Cards, Health, Shared folders, Mine, Advanced");
  for (const label of ["All", "AI providers", "Keys", "Logins", "Cards", "Health", "Marketing", "Finance", "Operations", "Mine", "Advanced", "Shared"]) assert.ok(has(out, label), label);
  const nav = (id: string): string => out.slice(at(out, `data-testid="row-${id}-trailing"`), at(out, `data-testid="row-${id}-trailing"`) + 400);
  assert.ok(has(nav("nav-all"), ">16<"), "16 items in All");
  assert.ok(has(nav("nav-providers"), ">3<"), "three providers");
  assert.ok(has(nav("nav-health"), ">2<"), "two items past their rotation date");
  assert.ok(has(nav("nav-mine"), ">3<"));
  assert.ok(has(nav("nav-requested"), ">1<"));
  const quiet = html(createSampleVault(harbor));
  assert.ok(!has(quiet, 'data-testid="row-nav-requested"'), "nothing waits on a key in Harbor Studio");
  assert.ok(!has(quiet, 'data-testid="row-nav-health"'), "and nothing needs a look");
});

test("list: newest use first, field names on the second line, Used 14 min ago, a dot on rows worth a look", () => {
  const out = html(createSampleVault());
  const rows = ["GoHighLevel", "Northwind Forms", "Stripe", "Claude", "Stripe webhooks", "Google Workspace"].map((n) => at(out, `aria-label="${n}"`));
  assert.deepEqual([...rows].sort((a, b) => a - b), rows, "most recently used first");
  assert.ok(has(out, "GHL_PIT · GHL_LOCATION_ID"), "field names, joined");
  assert.ok(has(out, "Login · USERNAME · PASSWORD"), "a login reads Login then its fields");
  assert.ok(has(out, "Used 14 min ago") && has(out, "Used 2 h ago") && has(out, "Used 3 h ago"));
  assert.ok(has(out, 'data-testid="look-vit_ghl"') && has(out, 'data-testid="look-vit_stripe"'), "the two past their rotation date carry the dot");
  assert.ok(!has(out, 'data-testid="look-vit_forms"'));
});

test("the open item is a .env block of hidden values: names and metadata only until reveal", () => {
  const v = createSampleVault();
  const out = html(v);
  assert.ok(has(out, 'data-testid="env-card"') && has(out, "# GoHighLevel · agents ask for #Northwind_GHL"));
  assert.ok(has(out, 'data-testid="env-line-GHL_PIT"') && has(out, 'data-testid="env-line-GHL_LOCATION_ID"'));
  assert.equal(out.split(MASK).length - 1 >= 2, true, "each field shows the mask");
  for (const value of [...allValues(northwind), ...allValues(harbor)]) assert.ok(!has(out, value), `no value in the markup: ${value.slice(0, 4)}...`);
  assert.ok(has(out, "#Northwind_GHL") && has(out, "API key"));
  assert.ok(has(out, "You can manage it · Shared › Marketing"), "the access line names where it sits");
  assert.ok(has(out, "Rotated 214 days ago · every 90 days · due"), "rotation line");
  assert.equal(v.calls.length, 0, "rendering reads the local copy and calls nothing");
  assert.ok(!v.calls.some((c) => c.cap === "vault.item.reveal"));
});

test("Fields view lists key, Secret or Plain, and the hidden value", () => {
  const out = html(createSampleVault(), { view: "fields" });
  assert.ok(has(out, "Secret") && has(out, "Plain"));
  assert.ok(has(out, 'data-testid="env-mode-fields"') && has(out, 'data-testid="env-mode-env"'));
  assert.ok(!has(out, "# GoHighLevel · agents ask for"), "no .env comment line in Fields");
  assert.ok(has(out, "nwLoc7Kq2mXpR4vLnTzB") === false);
});

test("reveal asks once, then each reveal is one logged capability call and the value shows", async () => {
  const v = createSampleVault();
  const timers: (() => void)[] = [];
  const store = createRevealStore({ itemId: "vit_ghl", call: v.data.call, copy: (t) => { v.copied.push(t); }, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined });
  await store.reveal(["GHL_PIT"]);
  assert.equal(v.calls.length, 0, "the first reveal stops at the agreement");
  assert.deepEqual(store.get().asking, { keys: ["GHL_PIT"], then: "show" });
  await store.agree();
  assert.equal(v.calls.filter((c) => c.cap === "vault.item.reveal").length, 1);
  assert.deepEqual(v.calls[0]!.input, { itemId: "vit_ghl", fields: ["GHL_PIT"] });
  assert.equal(store.get().shown.get("GHL_PIT"), "pit-7c1e4a2b-90d1-4b9e-8a52-3e6d1f0aa417");
  assert.equal(store.get().asking, null);
  await store.reveal(["GHL_LOCATION_ID"]);
  assert.equal(v.calls.filter((c) => c.cap === "vault.item.reveal").length, 2, "no second agreement for the same item");
  assert.equal(store.get().shown.get("GHL_LOCATION_ID"), "nwLoc7Kq2mXpR4vLnTzB");
  const log = queryOf<{ entries: { action: string; field?: string; actor: { id: string } }[] }>(v, "vault.item", "history", { itemId: "vit_ghl" }).entries;
  assert.ok(log.some((e) => e.action === "revealed" && e.field === "GHL_PIT" && e.actor.id === "usr_irfad"), "the item's history shows the reveal under my name");
  store.hide(["GHL_PIT"]);
  assert.ok(!store.get().shown.has("GHL_PIT"), "hide puts the mask back");
  timers.forEach((t) => t());
  assert.equal(store.get().shown.size, 0, "revealed values hide again when their timer ends");
  store.dispose();
});

test("a declined agreement makes no call; copy reveals first and leaves nothing on screen", async () => {
  const v = createSampleVault();
  const store = createRevealStore({ itemId: "vit_ghl", call: v.data.call, copy: (t) => { v.copied.push(t); } });
  await store.reveal(["GHL_PIT"]);
  store.decline();
  assert.equal(v.calls.length, 0);
  assert.equal(store.get().asking, null);
  await store.copy("GHL_LOCATION_ID");
  assert.ok(store.get().asking, "copy asks the same question");
  await store.agree();
  assert.deepEqual(v.copied, ["nwLoc7Kq2mXpR4vLnTzB"], "the text reached the clipboard");
  assert.equal(store.get().shown.size, 0, "a copy does not leave the value on screen");
  assert.equal(v.calls.filter((c) => c.cap === "vault.item.reveal").length, 1);
  store.dispose();
});

test("a provider sign-in is never revealed; a Use-level item cannot be revealed; the words say why", async () => {
  const v = createSampleVault();
  const claude = createRevealStore({ itemId: "vit_claude", call: v.data.call, copy: () => undefined });
  await claude.reveal(["CLAUDE_SETUP_TOKEN"]);
  await claude.agree();
  assert.equal(claude.get().shown.size, 0);
  assert.match(claude.get().error ?? "", /AI provider sign-in/);
  const rivera = createRevealStore({ itemId: "vit_rivera", call: v.data.call, copy: () => undefined });
  await rivera.reveal(["PORTAL_PIN"]);
  await rivera.agree();
  assert.equal(rivera.get().shown.size, 0);
  assert.match(rivera.get().error ?? "", /use this item but not see/);
  const out = clean(renderToStaticMarkup(<VaultProviderWrapper data={v.data}><ItemEnv itemId="vit_rivera" onEdit={() => undefined} onGone={() => undefined} onNote={() => undefined} /></VaultProviderWrapper>));
  assert.ok(!has(out, 'data-testid="env-reveal-all"'), "a Use-level item offers no Reveal all");
  assert.ok(has(out, "You can use it"), "and says what you can do");
  assert.ok(has(out, "opacity:0") || has(out, "opacity: 0"), "the per-line tools stay hidden");
  claude.dispose(); rivera.dispose();
});

test("offline: the place opens from the saved copy and says so; reveal waits for a connection", () => {
  const v = createSampleVault(northwind, { online: false });
  const out = html(v);
  assert.ok(has(out, "Offline, showing your saved copy"));
  assert.ok(has(out, 'data-testid="env-offline"') && has(out, "Revealing needs a connection"));
  assert.ok(has(out, 'data-testid="env-card"'), "names still show");
});

test("the frame before data and the empty Vault", () => {
  const loading = clean(renderToStaticMarkup(<VaultLoading />));
  assert.ok(has(loading, 'data-testid="vault-loading"'));
  const noData = clean(renderToStaticMarkup(<Vault />));
  assert.ok(has(noData, "vault-loading-frame"), "without the shell's data the place draws its loading frame");
  const empty = createSampleVault({ ...northwind, items: [], history: [], providers: [], requests: [] });
  const out = html(empty);
  assert.ok(has(out, "Your vault is empty") && has(out, "Add an item"));
  assert.ok(has(html(createSampleVault(), { initial: { kind: "health" } }), "GoHighLevel"));
  assert.ok(has(html(createSampleVault(harbor), { initial: { kind: "cards" } }), "Harbor Visa"));
});

test("sections filter the list: Keys, Logins, Cards, AI providers, a folder, Mine", () => {
  const v = createSampleVault();
  const list = (sel: object): string => { const out = html(v, { initial: sel }); return out.slice(at(out, 'data-testid="vault-list"')); };
  const keys = list({ kind: "keys" });
  assert.ok(has(keys, "GoHighLevel") && has(keys, "Postgres · Northwind prod") && !has(keys, "Northwind Forms") && !has(keys, "Northwind Visa"));
  const logins = list({ kind: "logins" });
  assert.ok(has(logins, "Google Workspace") && has(logins, "GitHub") && !has(logins, "GoHighLevel"));
  assert.ok(has(list({ kind: "cards" }), "Northwind Visa"));
  const prov = list({ kind: "providers" });
  assert.ok(has(prov, "Claude") && has(prov, "OpenCode Go key") && has(prov, "Anthropic API key") && !has(prov, "Stripe"));
  assert.ok(has(prov, "Sign in with Claude Max · Mine"), "a provider row says how it signs in and Mine or Shared");
  const fin = list({ kind: "folder", folderId: "fld_finance" });
  assert.ok(has(fin, "Stripe") && has(fin, "Northwind Visa") && !has(fin, "GoHighLevel"));
  const mine = list({ kind: "mine" });
  assert.ok(has(mine, "Claude") && has(mine, "GitHub") && !has(mine, "Stripe"));
});

test("writes change what the next render shows: new folder, move to Trash and back, rotate, new item", async () => {
  const v = createSampleVault();
  await v.data.call("vault.folders.create", { name: "Sales", scope: "shared" });
  assert.ok(has(html(v), "Sales"), "the folder is in the sidebar");
  assert.ok(itemNames(v).includes("Resend"));
  await v.data.call("vault.item.delete", { itemId: "vit_resend" });
  assert.ok(!itemNames(v).includes("Resend"), "in Trash");
  await v.data.call("vault.item.restore", { itemId: "vit_resend" });
  assert.ok(itemNames(v).includes("Resend"), "and back");
  await v.data.call("vault.item.mark_rotated", { itemId: "vit_ghl" });
  assert.ok(!has(html(v), 'data-testid="look-vit_ghl"'), "a rotated item loses its dot");
  const put = (await v.data.call("vault.item.put", { folderId: "fld_ops", name: "Clio", kind: "api_key", fields: [{ key: "CLIO_API_KEY", value: "fake-clio-key-123", secret: true }] })) as { item: { id: string } };
  assert.ok(itemNames(v).includes("Clio"));
  await assert.rejects(() => v.data.call("vault.item.put", { folderId: "fld_ops", name: "clio", kind: "api_key", fields: [{ key: "A", value: "b" }] }), /duplicate/, "a name already in the folder is refused");
  const out = html(v);
  assert.ok(has(out, `aria-label="Clio"`) && !has(out, "fake-clio-key-123"), "the new item shows by name, never by value");
  assert.ok(put.item.id.startsWith("vit_new"));
});

test("speed: 10,000 keys filter and count fast and the list renders only a window", async () => {
  const v = createSampleVault(northwind, { extraItems: 10_000 });
  const items = queryOf<{ items: Item[] }>(v, "vault.layout", "items").items;
  assert.equal(items.length, 10_016);
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); visibleItems(items, { kind: "keys" }, "sample", new Set(), new Set()); countItems(items, new Set(), null, 0); samples.push(performance.now() - t0); }
  samples.sort((a, b) => a - b);
  assert.ok(samples[1]! < 100, `median filter plus count ${samples[1]!.toFixed(1)} ms is under the 100 ms complete-paint budget`);
  const out = html(v);
  const rowsDrawn = out.split('data-testid="row-vit_').length - 1;
  assert.ok(rowsDrawn > 5 && rowsDrawn < 60, `only a window of rows is drawn (${rowsDrawn})`);
  assert.ok(has(out, "10016"), "the count is the whole list");
});

test("copy and design rules: no em dash, no emoji, every control labelled", () => {
  const out = html(createSampleVault());
  assert.ok(!out.includes(String.fromCharCode(0x2014)), "no em dash in any copy");
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(out), "no emoji");
  for (const label of ["Add an item", "More", "Edit"]) assert.ok(has(out, `aria-label="${label}"`), `${label} is labelled`);
  assert.ok(has(out, 'role="menu"') || has(out, "Vault sections"), "the sidebar is a labelled menu");
});
