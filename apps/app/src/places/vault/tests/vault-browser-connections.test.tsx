// Vault > Connections with Browser connections on screen: the rows with where each site runs and what each agent may do, the Add a site button, and the sheet with the three places a site runs,
// a right for each agent (No access, Read only, Act) and the line that a send, a post, a payment and a delete are always held.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../layout/index.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { SAMPLE_AGENTS, SAMPLE_SITES, sampleConnectionsCall, sampleConnectionsData } from "../connections/sample.ts";
import { BrowserSheet } from "../connections/BrowserSheet.tsx";
import { VaultDataProvider } from "../layout/data.tsx";

Dimensions.set({ window: { width: 1440, height: 900, scale: 1, fontScale: 1 }, screen: { width: 1440, height: 900, scale: 1, fontScale: 1 } });
const has = (s: string, n: string): boolean => s.includes(n);
const data = () => { const v = createSampleVault(); return { ...v.data, call: sampleConnectionsCall(v.data.call), nav: { ...v.data.nav, openConnections: () => undefined } }; };
const agents = SAMPLE_AGENTS.map((a) => ({ id: a.agentId, name: a.name }));

test("the page lists each Browser connection in Mine with where it runs and what each agent may do, and has an Add a site button", () => {
  const out = renderToStaticMarkup(<Vault data={data()} route={{ surface: "connections" }} connectionsInitial={sampleConnectionsData()} />).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="connections-add-site"'));
  for (const s of SAMPLE_SITES) assert.ok(has(out, `data-testid="row-conn-${s.id}"`) || has(out, s.host), s.host);
  assert.ok(has(out, "Browser · My Chrome"), "where it runs");
  assert.ok(has(out, "Browser · My Chrome and agent computers") && has(out, "Browser · Agent computers"));
  assert.ok(has(out, "Intake reads"), "what each agent may do");
});

test("the sheet: the site, three places it runs, a right for each agent, and the always-held line", () => {
  const out = renderToStaticMarkup(<VaultDataProvider value={data()}><BrowserSheet site={null} agents={agents} onClose={() => undefined} onSaved={() => undefined} /></VaultDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="browser-sheet"') && has(out, "Add a site"));
  for (const k of ["chrome", "computers", "both"]) assert.ok(has(out, `data-testid="browser-runs-${k}"`), k);
  for (const a of SAMPLE_AGENTS) for (const r of ["off", "read", "act"]) assert.ok(has(out, `data-testid="browser-right-${a.agentId}-${r}"`), `${a.agentId} ${r}`);
  assert.ok(has(out, "No access") && has(out, "Read only") && has(out, ">Act<"));
  assert.ok(has(out, "Sends, posts, payments and deletes are always held for you"));
  assert.ok(has(out, 'data-testid="browser-save"') && !has(out, 'data-testid="browser-remove"'), "a new site has no Remove");
  const editing = renderToStaticMarkup(<VaultDataProvider value={data()}><BrowserSheet site={SAMPLE_SITES[0]!} agents={agents} onClose={() => undefined} onSaved={() => undefined} /></VaultDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(has(editing, "Browser: app.gohighlevel.com") && has(editing, 'data-testid="browser-remove"'));
});
