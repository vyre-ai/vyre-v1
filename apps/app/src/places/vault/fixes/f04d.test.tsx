// P-L9f_04d: the Vault item page finish from the lead's look at P-L9f_04c: Who can use it lists you first as Owner with Manage, then people, agents and Automations (Weekly lead report,
// Use), each with the shared face; Ask in the header; Add field under the fields. The list is drawn from the real grants of the sample item (access.shares_of), not from a hand-made list.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault, { VaultDataProvider } from "../layout/index.tsx";
import { createSampleVault, northwind } from "../layout/sample.ts";
import type { SampleVault } from "../layout/sample.ts";
import type { Share } from "../layout/model.ts";
import { EditSheet } from "../itemenv/EditSheet.tsx";
import { WhoCanUse } from "../itemenv/WhoCanUse.tsx";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const html = (v: SampleVault, props: Record<string, unknown> = {}): string => renderToStaticMarkup(<Vault data={v.data} {...props} />).replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const tag = (out: string, id: string): string => new RegExp(`<[^<>]*data-testid="${id}"[^<>]*>[^<]*`).exec(out)?.[0] ?? "";
const NAMES: Readonly<Record<string, string>> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_intake: "Intake", agt_research: "Research", aut_weekly: "Weekly lead report" };
const nameOf = (s: Share["subject"]): string => NAMES[s.id] ?? s.id;

async function grantsOf(v: SampleVault, itemId: string): Promise<Share[]> {
  const out = (await v.data.call("access.shares_of", { resource: { type: "vault_item", id: itemId } })) as { shares: { grant: { subject: Share["subject"]; level: Share["level"] }; through: Share["through"] }[] };
  return out.shares.map((x) => ({ subject: x.grant.subject, level: x.grant.level, through: x.through }));
}
const who = (shares: readonly Share[], over: Partial<Parameters<typeof WhoCanUse>[0]> = {}): string => renderToStaticMarkup(
  <WhoCanUse shares={shares} you={{ name: "Irfad Imtiaz", level: "manage", owner: true }} nameOf={nameOf} meId="usr_irfad" canManage onLevel={() => undefined} onRemove={() => undefined} onShare={() => undefined} onMenu={() => undefined} {...over} />,
).replaceAll("<!-- -->", "");

test("Who can use it, from the real grants: you first as Owner with Manage, then people, agents and the Automation, in that order", async () => {
  const shares = await grantsOf(createSampleVault(), "vit_ghl");
  assert.ok(shares.some((s) => s.through === "owner" && s.subject.id === "usr_irfad"), "the sample item has its owner grant");
  const out = who(shares);
  const order = ["who:you", "who:person:usr_maya", "who:person:usr_omar", "who:agent:agt_intake", "who:agent:agt_research", "who:service:aut_weekly"].map((k) => at(out, `data-testid="row-${k}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "you, people, agents, then Automations");
  assert.match(tag(out, "who-level-you"), />Manage$/);
  assert.ok(has(out, ">You<") && has(out, ">Owner<"), "the first row says You and Owner");
  assert.equal((out.match(/data-testid="row-who:person:usr_irfad"/g) ?? []).length, 0, "you are not listed a second time under your own name");
});

test("Who can use it: an Automation grant shows with its name, the Automation mark and Use", async () => {
  const out = who(await grantsOf(createSampleVault(), "vit_ghl"));
  assert.ok(has(out, 'aria-label="Weekly lead report can Use. Change"'), "the Automation holds Use, and the level can be changed");
  assert.ok(has(out, "Weekly lead report") && has(out, ">Automation<"), "named, and labelled as an Automation");
  assert.match(out, /data-avatar="automation"[^>]*aria-label="Weekly lead report"|aria-label="Weekly lead report"[^>]*data-avatar="automation"/, "its face is the shared automation mark");
  assert.ok(has(out, 'data-testid="avatar-Intake"') && /data-avatar="agent"/.test(out), "an agent has the shared agent face");
  assert.ok(/data-avatar="person"/.test(out), "a person has the shared person face");
});

test("Who can use it: a person who is not the owner is listed first with the level they hold, and an item shared with no one lists only you", () => {
  const out = who([], { you: { name: "Maya Chen", level: "edit", owner: false } });
  assert.ok(has(out, 'data-testid="row-who:you"') && has(out, ">Person<") && !has(out, ">Owner<"));
  assert.match(tag(out, "who-level-you"), />Edit$/);
  assert.equal((out.match(/data-testid="row-who:[a-z_:]+"/g) ?? []).length, 1, "only you");
});

test("item page: Ask sits in the header next to Edit, and Add field sits under the fields inside the card", () => {
  const out = html(createSampleVault());
  assert.ok(has(out, 'data-testid="item-ask"'), "the shared Ask control");
  assert.ok(at(out, 'data-testid="item-ask"') < at(out, 'data-testid="item-edit"'), "Ask is before Edit in the header");
  const lastLine = out.lastIndexOf('data-testid="env-line-');
  assert.ok(lastLine > 0 && at(out, 'data-testid="env-add-field"') > lastLine, "Add field comes after the last field line");
  assert.ok(at(out, 'data-testid="env-add-field"') < at(out, 'data-testid="item-who"'), "and inside the card, above Who can use it");
  assert.ok(has(out, 'aria-label="Add field"'));
});

test("Add field opens the Edit sheet in Fields with one new empty secret field after the existing ones, and a plain Edit opens in .env", async () => {
  const v = createSampleVault();
  const count = northwind.items.find((i) => i.id === "vit_ghl")!.fields.length;
  const sheet = (addField: boolean): string => renderToStaticMarkup(<VaultDataProvider value={v.data}><EditSheet itemId="vit_ghl" addField={addField} onClose={() => undefined} onSaved={() => undefined} /></VaultDataProvider>).replaceAll("<!-- -->", "");
  const added = sheet(true);
  assert.match(tag(added, "edit-mode-fields"), /aria-selected="true"/);
  assert.ok(has(added, `data-testid="edit-row-${count}"`) && !has(added, `data-testid="edit-row-${count + 1}"`), "one more row than the item has fields");
  const plain = sheet(false);
  assert.match(tag(plain, "edit-mode-env"), /aria-selected="true"/);
  assert.ok(!has(plain, 'data-testid="edit-row-0"'), "no field rows in .env");
});
