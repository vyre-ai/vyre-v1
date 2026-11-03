// The Vault's four sections in the app (owner, 3 Nov; north star prototype/vyre-vault.html): the sidebar order, the context-aware +, the question in All, the Google and Microsoft page and
// Connections with two tabs in a Team Space and one list in a Personal Space.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../layout/index.tsx";
import { Sidebar } from "../layout/Sidebar.tsx";
import { createSampleVault, northwind } from "../layout/sample.ts";

const clean = (s: string): string => s.replace(/<!-- -->/g, "");
const has = (s: string, n: string): boolean => s.includes(n);

test("the sidebar runs All, AI accounts, Google and Microsoft, Connections, then Everything else: Keys, Logins, Cards", () => {
  const counts = { all: 9, providers: 2, google: 1, connections: 1, keys: 3, logins: 1, cards: 1, mine: 4, health: 0, requested: 0, folders: new Map<string, number>() };
  const side = (personal: boolean): string => clean(renderToStaticMarkup(<Sidebar counts={counts} folders={[]} selection={{ kind: "all" }} onSelect={() => undefined} onAdvanced={() => undefined} onNewFolder={async () => undefined} onFolderMenu={() => undefined} canCreateShared hideShared={personal} />));
  const out = side(false);
  const order = ["All", "AI accounts", "Google and Microsoft", "Connections", "Everything else", "Keys", "Logins", "Cards", "Mine"].map((l) => out.indexOf(l));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.ok(!side(true).includes(">Mine<") && side(true).includes("AI accounts"), "a Personal Space: no Mine row, the sections stay");
});

test("the + adds the page's own kind; in All it is a plain Add that asks first", () => {
  const v = createSampleVault(northwind);
  const plus = (kind: string): string => /aria-label="(Add[^"]*)"[^>]*data-testid="add-item"|data-testid="add-item"[^>]*aria-label="(Add[^"]*)"/.exec(clean(renderToStaticMarkup(<Vault data={v.data} initial={{ kind } as never} />)))?.slice(1).find(Boolean) ?? "";
  assert.equal(plus("all"), "Add");
  assert.equal(plus("providers"), "Add an AI account");
  assert.equal(plus("keys"), "Add a key, login or card");
  assert.equal(plus("logins"), "Add a key, login or card");
  assert.equal(plus("google"), "Add Google or Microsoft");
});

test("Google and Microsoft is its own page with two cards; Connections has two tabs in a Team Space and none in a Personal Space", () => {
  const v = createSampleVault(northwind);
  const gm = clean(renderToStaticMarkup(<Vault data={v.data} initial={{ kind: "google" }} />));
  assert.ok(has(gm, 'data-testid="gm-google"') && has(gm, 'data-testid="gm-microsoft"'), "two cards");
  const team = clean(renderToStaticMarkup(<Vault data={v.data} initial={{ kind: "connections" }} />));
  assert.ok(has(team, "Apps and tool servers your agents can use") && has(team, 'data-testid="conn-tab-my"') && has(team, 'data-testid="conn-tab-space"') && has(team, 'role="tablist"'), "a real tab strip");
  const solo = clean(renderToStaticMarkup(<Vault data={{ ...v.data, personal: true }} initial={{ kind: "connections" }} />));
  assert.ok(has(solo, "Apps and tool servers your agents can use") && !has(solo, 'data-testid="conn-tab-my"'), "one list, no tabs");
});

test("AI accounts in a Team Space has My AI accounts and Space AI accounts tabs; a Personal Space has one list", () => {
  const v = createSampleVault(northwind);
  const team = clean(renderToStaticMarkup(<Vault data={v.data} initial={{ kind: "providers" }} />));
  assert.ok(has(team, 'data-testid="ai-tab-my"') && has(team, 'data-testid="ai-tab-space"') && has(team, ">Space AI accounts<"), "two tabs");
  const solo = clean(renderToStaticMarkup(<Vault data={{ ...v.data, personal: true }} initial={{ kind: "providers" }} />));
  assert.ok(!has(solo, 'data-testid="ai-tab-my"'), "no tabs in a Personal Space");
});
