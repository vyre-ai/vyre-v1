// Vault Add sheet and item page as in the prototype (P-L9f_04c): a compact sheet with one search and a row of app icons, one hint line, fields only after an app or a paste, an Add to menu
// in the footer; and on the item page the who line from the real grants, the Fields and .env tabs, Copy as .env, and the list of who can use it with a level menu on each line.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../layout/index.tsx";
import { createSampleVault, northwind } from "../layout/sample.ts";
import type { SampleVault } from "../layout/sample.ts";
import { accessLine, fmtList, whoLine } from "../layout/model.ts";
import type { Folder, Item, Share } from "../layout/model.ts";
import { folderEntries, startDraft, whereLabel } from "../itemenv/AddAnything.tsx";
import { brandForName } from "../../../../../../ui/src/AppIcon/index.tsx";
import { TEMPLATES, formatEnv } from "../itemenv/env.ts";
import { LEVEL_LABEL, levelEntries } from "../itemenv/WhoCanUse.tsx";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuItem } from "../../../../../../ui/src/Menu/props.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const html = (v: SampleVault, props: Record<string, unknown>): string => renderToStaticMarkup(<Vault data={v.data} {...props} />).replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => {
  const i = s.indexOf(n);
  assert.ok(i >= 0, `expected ${n}`);
  return i;
};
const tag = (out: string, id: string): string => new RegExp(`<[^<>]*data-testid="${id}"[^<>]*>`).exec(out)?.[0] ?? "";
const keysOf = (out: string): string[] => {
  const keys: string[] = [];
  for (let i = 0; tag(out, `add-key-${i}`) !== ""; i++) keys.push(/value="([^"]*)"/.exec(tag(out, `add-key-${i}`))?.[1] ?? "");
  return keys;
};

const marketing: Folder = { id: "fld_marketing", name: "Marketing", scope: "shared", owner: "usr_irfad", itemCount: 3, whoCanExport: [], yourLevel: "manage" };
const mine: Folder = { id: "fld_mine", name: "Mine", scope: "mine", owner: "usr_irfad", itemCount: 3, whoCanExport: [], yourLevel: "manage" };
const finance: Folder = { ...marketing, id: "fld_finance", name: "Finance" };
const item = (o: Partial<Item>): Item => ({ id: "vit_x", name: "x", kind: "api_key", folderId: "fld_marketing", owner: "usr_irfad", scope: "shared", fieldKeys: [], handle: "#N_x", spaceOnly: false, injectIntoDeployments: false, yourLevel: "manage", label: 0, createdAt: 0, updatedAt: 0, ...o });

test("add sheet: one search and a row of app icons, a hint line, and nothing else until an app or a paste", () => {
  const out = html(createSampleVault(), { sheet: { add: {} } });
  assert.ok(has(out, 'data-testid="add-sheet-icon"'), "the title carries the plus tile");
  assert.ok(has(out, 'data-testid="add-search"') && has(out, 'placeholder="Search apps"'));
  assert.ok(has(out, ">Paste a key or .env, or pick an app<"), "the single hint line");
  for (const gone of ["Agents ask for an item by its handle", "Pick an app, or paste something above", "Vyre works out what it is", "data-testid=\"add-paste\"", "data-testid=\"add-empty\""]) assert.ok(!has(out, gone), `no explaining copy: ${gone}`);
  assert.ok(!has(out, 'data-testid="add-name"') && !has(out, 'data-testid="add-key-0"'), "no name or fields yet");
  const order = TEMPLATES.map((t) => at(out, `data-testid="add-app-${t.id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the reel runs in the order of the templates");
  assert.deepEqual(TEMPLATES.slice(0, 3).map((t) => t.id), ["custom", "login", "card"], "the three plain kinds come first, as in the prototype");
});

test("add sheet: the reel shows brand marks, not letter tiles, for the apps that have one", () => {
  const out = html(createSampleVault(), { sheet: { add: {} } });
  for (const name of ["Stripe", "Twilio", "OpenAI", "Anthropic", "GitHub", "Slack", "Postgres"]) {
    assert.ok(has(out, `data-testid="logo-${name}"`), `${name} has its icon`);
  }
  const stripe = new RegExp(`data-testid="logo-Stripe"[\\s\\S]*?</svg>`).exec(out)?.[0] ?? "";
  assert.ok(has(stripe, "<svg") && has(stripe, "<path"), "the mark is drawn as a path");
  assert.ok(has(stripe, "color:#635BFF"), "in the brand's own colour");
  assert.ok(brandForName("Postgres") === "db", "Postgres maps to its mark");
  assert.ok(brandForName("Stripe webhooks") === "stripe" && brandForName("Rivera client portal") === null);
  const items = html(createSampleVault(), {});
  assert.ok(has(items, 'data-testid="logo-Stripe"'), "the item list uses the same mark");
});

test("add sheet: picking an app shows its template: the name and one row per key, the status line gone", () => {
  const out = html(createSampleVault(), { sheet: { add: { app: "twilio" } } });
  assert.ok(!has(out, 'data-testid="add-hint"'), "the hint goes once something is started");
  assert.ok(has(tag(out, "add-name"), 'value="Twilio"'), "the name is the app's");
  assert.deepEqual(keysOf(out), ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
  assert.ok(has(out, 'data-testid="add-handle"') && has(out, "#Northwind_Twilio"));
  const draft = startDraft(undefined, "custom");
  assert.deepEqual(draft.draft.fields, [{ key: "", value: "", secret: true }], "Custom starts with one blank row");
  assert.equal(draft.draft.name, "");
  assert.equal(startDraft(undefined, "nothing-like-this").draft.fields.length, 0, "an unknown app starts nothing");
});

test("add sheet: pasting a .env fills a field per line with a status that says what was found, and the paste undoes", () => {
  const paste = "GHL_PIT=pit-7c1e4a2b-90d1-4b9e-8a52-3e6d1f0aa417\nGHL_LOCATION_ID=nwLoc7Kq2mXpR4vLnTzB";
  const out = html(createSampleVault(), { sheet: { add: { paste } } });
  assert.deepEqual(keysOf(out), ["GHL_PIT", "GHL_LOCATION_ID"]);
  assert.ok(has(out, 'data-testid="add-status"') && has(out, "Read a .env: 2 keys"));
  assert.ok(!has(out, 'data-testid="add-hint"'));
  const d = startDraft(paste);
  assert.equal(d.status?.undo.fields.length, 0, "Undo goes back to the empty sheet");
  assert.equal(startDraft("   ").status, null, "a blank paste is not a paste");
  const withApp = startDraft("sk_live_51NwFakeFakeFake00aa", "stripe");
  assert.deepEqual(withApp.draft.fields.map((f) => f.key), ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], "a paste fills the rows of the app that is picked");
  assert.equal(withApp.status?.undo.template, "stripe", "Undo returns to the picked app");
});

test("add sheet footer: Add to names where it goes and its menu switches Mine and Shared", () => {
  assert.equal(whereLabel(mine), "Mine");
  assert.equal(whereLabel(marketing), "Shared › Marketing");
  assert.equal(whereLabel(undefined), "Choose a folder");
  const picked: string[] = [];
  const entries = folderEntries([marketing, mine, finance], "fld_mine", (id) => void picked.push(id));
  const list = entries.filter(isItem) as MenuItem[];
  assert.deepEqual(list.map((x) => [x.label, x.checked === true]), [["Mine", true], ["Shared › Marketing", false], ["Shared › Finance", false]], "Mine first, then each shared folder, the target checked");
  for (const x of list) x.onSelect?.();
  assert.deepEqual(picked, ["fld_mine", "fld_marketing", "fld_finance"]);
  const out = html(createSampleVault(), { sheet: { add: {} } });
  assert.ok(has(out, ">Add to<") && has(tag(out, "add-folder"), 'aria-label="Adding to Mine"') && has(out, ">Mine<"));
  assert.ok(has(out, 'data-testid="add-cancel"') && has(out, 'data-testid="add-save"'));
});

test("item page: the who line comes from the real grants, you and the owner left out", () => {
  const nameOf = (s: Share["subject"]): string => ({ agt_intake: "Intake", agt_research: "Research", agt_billing: "Billing", usr_omar: "Omar Haddad", usr_maya: "Maya Chen", usr_irfad: "Irfad Imtiaz" })[s.id] ?? s.id;
  const shares: Share[] = [
    { subject: { kind: "person", id: "usr_irfad" }, level: "manage", through: "owner" },
    { subject: { kind: "agent", id: "agt_intake" }, level: "use", through: "direct" },
    { subject: { kind: "agent", id: "agt_research" }, level: "use", through: "direct" },
    { subject: { kind: "agent", id: "agt_billing" }, level: "use", through: "direct" },
    { subject: { kind: "person", id: "usr_omar" }, level: "view", through: "direct" },
    { subject: { kind: "person", id: "usr_maya" }, level: "edit", through: "direct" },
  ];
  assert.equal(whoLine(item({}), marketing, shares, "usr_irfad", nameOf), "Intake, Research and 1 more can use it · Omar can see it · Maya can change it · Shared › Marketing");
  assert.equal(whoLine(item({}), marketing, shares.slice(0, 3), "usr_irfad", nameOf), "Intake and Research can use it · Shared › Marketing");
  assert.equal(whoLine(item({}), marketing, [shares[0]!], "usr_irfad", nameOf), accessLine(item({}), marketing), "with no one else the plain line");
  assert.equal(fmtList(["A"]), "A");
  assert.equal(fmtList(["A", "B"]), "A and B");
  assert.equal(fmtList(["A", "B", "C", "D"]), "A, B and 2 more");
  assert.equal(whoLine(item({ scope: "mine", folderId: "fld_mine" }), mine, [], "usr_irfad", nameOf), "Only you can use it · Mine");
});

test("item page: Fields and .env tabs, Copy as .env, and who can use it with a level on each line", () => {
  const out = html(createSampleVault(), {});
  assert.ok(has(out, 'data-testid="env-mode-fields"') && has(out, 'data-testid="env-mode-env"'));
  assert.ok(has(out, 'data-testid="env-copy-all"') && has(out, "Copy as .env"));
  assert.ok(at(out, 'data-testid="env-card"') < at(out, 'data-testid="item-who"') && at(out, 'data-testid="item-who"') < at(out, ">Recent use<"), "who can use it sits between the card and Recent use");
  assert.ok(has(out, ">Who can use it<") && has(out, 'data-testid="who-share"'), "a Share button for someone who manages the item");
  assert.ok(has(out, 'data-testid="who-empty"'), "before the grants arrive the list says only you");
});

test("who can use it: the grants of the sample item, a level menu with the current one checked, and Stop sharing", async () => {
  const v = createSampleVault();
  const read = async (): Promise<Share[]> => {
    const out = (await v.data.call("access.shares_of", { resource: { type: "vault_item", id: "vit_ghl" } })) as { shares: { grant: { subject: Share["subject"]; level: Share["level"] }; through: Share["through"] }[] };
    const list: Share[] = [];
    for (const x of out.shares) list.push({ subject: x.grant.subject, level: x.grant.level, through: x.through });
    return list;
  };
  const before = await read();
  assert.deepEqual(before.map((s) => `${s.subject.id}:${s.level}:${s.through}`), ["usr_irfad:manage:owner", "agt_intake:use:direct", "agt_research:use:direct", "agt_billing:use:direct", "usr_omar:view:direct", "usr_maya:edit:direct"]);
  const picked: string[] = [];
  const entries = levelEntries("view", (l) => void picked.push(l), () => void picked.push("remove"));
  const items = entries.filter(isItem) as MenuItem[];
  assert.deepEqual(items.map((x) => [x.label, x.checked === true, x.danger === true]), [["Use", false, false], ["View", true, false], ["Edit", false, false], ["Manage", false, false], ["Stop sharing", false, true]]);
  for (const x of items) x.onSelect?.();
  assert.deepEqual(picked, ["use", "view", "edit", "manage", "remove"]);
  assert.deepEqual(Object.values(LEVEL_LABEL), ["Use", "View", "Edit", "Manage"]);
  await v.data.call("vault.share", { resource: { type: "vault_item", id: "vit_ghl" }, subject: { kind: "person", id: "usr_omar" }, level: "edit" });
  assert.equal((await read()).find((s) => s.subject.id === "usr_omar")?.level, "edit", "the level changed in place");
  await v.data.call("vault.unshare", { resource: { type: "vault_item", id: "vit_ghl" }, subject: { kind: "agent", id: "agt_billing" } });
  assert.ok(!(await read()).some((s) => s.subject.id === "agt_billing"), "stopped sharing removes the line");
  assert.deepEqual(v.calls.map((c) => c.cap), ["access.shares_of", "vault.share", "access.shares_of", "vault.unshare", "access.shares_of"]);
});

test("Copy as .env: the whole item is one logged reveal, then the text is KEY=value per line", async () => {
  const v = createSampleVault();
  const out = (await v.data.call("vault.item.reveal", { itemId: "vit_ghl" })) as { fields: { key: string; value: string }[] };
  const values = new Map(out.fields.map((f) => [f.key, f.value] as const));
  const text = formatEnv(out.fields, values);
  assert.deepEqual(text.split("\n").map((l) => l.split("=")[0]), northwind.items.find((i) => i.id === "vit_ghl")!.fields.map((f) => f[0]));
  assert.ok(text.split("\n").every((l) => /^[A-Z0-9_]+=.+$/.test(l)));
});
