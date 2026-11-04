// Vault > Connections on screen (owner ruling D28): the sidebar row, Mine and Space with a steady dot, who can use each, which agents used it and when; plugin and skill servers and built-in
// integrations in the same list; the rules for admins only; a Personal Space without a Space section. Settings and the Console open this page through the shell's door.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../layout/index.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { sampleConnectionsData, sampleConnectionsCall } from "../connections/sample.ts";
import { AddConnection, pendingFromEntry } from "../connections/AddConnection.tsx";
import { VaultDataProvider } from "../layout/data.tsx";
import { SAMPLE_CATALOG } from "../connections/sample.ts";
import { ShellRuntimeProvider } from "../../../shell/providers/runtime.tsx";
import { sampleRuntime } from "../../../shell/providers/misc-test-runtime.tsx";
import { PlaceHashProvider } from "../../../shell/hash/context.tsx";
import VaultPlace, { vaultData, vaultRoute } from "../../../shell/providers/vault.tsx";
import { settingsData } from "../../../shell/providers/settings.tsx";
import { createSampleSettings } from "../../settings/sample.ts";
import { SettingsPlace } from "../../settings/SettingsPlace.tsx";
import { SettingsDataProvider } from "../../settings/data.tsx";
import { ConsoleDataProvider } from "../../../console/shell/data.tsx";
import { createSampleConsole } from "../../../console/shell/sample.ts";
import { ConnectionsInVault } from "../../../console/pages/Plugins.tsx";

Dimensions.set({ window: { width: 1440, height: 900, scale: 1, fontScale: 1 }, screen: { width: 1440, height: 900, scale: 1, fontScale: 1 } });
const has = (s: string, n: string): boolean => s.includes(n);
const page = (o: { admin?: boolean; personal?: boolean } = {}): string => {
  const v = createSampleVault();
  const data = { ...v.data, call: sampleConnectionsCall(v.data.call, o), nav: { ...v.data.nav, openConnections: () => undefined }, ...(o.personal ? { personal: true } : {}) };
  return renderToStaticMarkup(<Vault data={data} route={{ surface: "connections" }} connectionsInitial={sampleConnectionsData(o)} />).replaceAll("<!-- -->", "");
};

test("the page: Mine and Space, a dot per row, who can use it, the agents that used it and when, in one list with plugins, skills and built-in integrations", () => {
  const out = page();
  assert.ok(has(out, 'data-testid="vault-connections"'));
  assert.ok(has(out, 'data-testid="row-nav-connections"'), "the sidebar has a Connections row");
  for (const id of ["connections-mine", "connections-space", "connections-agents", "connections-rules", "connections-hubs"]) assert.ok(has(out, `data-testid="${id}"`), id);
  // the dot is a steady fill with its words beside it; nothing animates
  assert.ok(has(out, 'data-testid="conn-dot-mcs_notion"'));
  assert.ok(!/animation|@keyframes|blink/i.test(out), "nothing blinks");
  assert.ok(has(out, "Working, 14 tools") && has(out, "Needs sign-in") && has(out, "Key refused") && has(out, "Not answering"));
  assert.ok(has(out, "You and your agents"), "Mine is for me and my agents");
  assert.ok(has(out, "Legal"), "a Space connection shared with a group says which");
  assert.ok(has(out, "Research and Assistant"), "which agents used it, by name");
  assert.ok(has(out, "Used 12 min ago"));
  assert.ok(has(out, "From plugin pdf-tools") && has(out, "From skill contract-review") && has(out, "App hub"));
  assert.ok(has(out, "Google Workspace") && has(out, "Northwind Slack") && has(out, "Northwind Zoom"), "built-in integrations sit in the same list");
  assert.ok(has(out, "Only Billing"), "an agent's own connection");
  assert.ok(has(out, "Who can add Space connections") && has(out, "Allow-list"), "admins get the rules");
  assert.ok(has(out, 'data-testid="connections-add"'));
});

test("a member sees no rules and no hub card; a Personal Space has no Space section, no rules and no sharing", () => {
  const member = page({ admin: false });
  assert.ok(!has(member, 'data-testid="connections-rules"') && !has(member, 'data-testid="connections-hubs"'));
  const personal = page({ personal: true });
  assert.ok(has(personal, 'data-testid="connections-mine"'));
  assert.ok(!has(personal, 'data-testid="connections-rules"') && !has(personal, 'data-testid="connections-hubs"') && !has(personal, 'data-testid="connections-agents"'));
});

test("the Add sheet: three ways in, the registry results with how each signs in, and a picked server asks for its key with where it goes", () => {
  const v = createSampleVault();
  const data = { ...v.data, call: sampleConnectionsCall(v.data.call), assistantId: "agt_assistant" };
  const draw = (initial: Parameters<typeof AddConnection>[0]["initial"], canAddSpace = true): string => renderToStaticMarkup(<VaultDataProvider value={data}><AddConnection canAddSpace={canAddSpace} onClose={() => undefined} onAdded={() => undefined} {...(initial ? { initial } : {})} /></VaultDataProvider>).replaceAll("<!-- -->", "");
  const browse = draw(undefined);
  for (const w of ["browse", "paste", "import"]) assert.ok(has(browse, `data-testid="connection-way-${w}"`), w);
  assert.ok(has(browse, "official MCP Registry"));
  const paste = draw({ way: "paste", text: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 npx -y @modelcontextprotocol/server-github" }); // secret-scan: fake
  assert.ok(has(paste, 'data-testid="row-draft-github"') && has(paste, "1 key goes to the Vault"));
  const imported = draw({ way: "import", text: '[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n' });
  assert.ok(has(imported, 'data-testid="row-draft-context7"'));
  const setup = draw({ pending: [pendingFromEntry(SAMPLE_CATALOG[1]!)] });
  assert.ok(has(setup, 'data-testid="connection-setup"') && has(setup, 'data-testid="ask-NOTION_TOKEN"') && has(setup, "goes into your Vault"));
  assert.ok(has(setup, 'data-testid="scope-mine"') && has(setup, 'data-testid="scope-space"'));
  assert.ok(has(setup, "npx -y notion-mcp-server@3.3.0"), "the command shows, with no key in it");
  assert.ok(!has(draw({ pending: [pendingFromEntry(SAMPLE_CATALOG[0]!)] }, false), 'data-testid="scope-space"'), "someone who may not add Space connections adds their own");
  // a fresh Space has no allow-list: its page says so and the sample's rules start Off
  const fresh = renderToStaticMarkup(<Vault data={{ ...data, call: sampleConnectionsCall(v.data.call, { fresh: true }), nav: { ...v.data.nav, openConnections: () => undefined } }} route={{ surface: "connections" }} connectionsInitial={sampleConnectionsData({ fresh: true })} />);
  assert.ok(has(fresh, "Off: people can add any server") && !has(fresh, 'data-testid="rules-allow-list"'));
});

test("Settings and the Console open Vault > Connections, and the address opens the page", () => {
  const s = createSampleVault();
  const opened: Array<{ screen?: string; args?: unknown }> = [];
  const base = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const rt = { ...base, open: (t: { screen?: string; args?: unknown }) => void opened.push(t) };
  vaultData(rt as never).nav.openConnections?.();
  const settings = createSampleSettings();
  settingsData({ ...sampleRuntime({ screens: settings.data.screens, call: settings.data.call }), open: (t: { screen?: string; args?: unknown }) => void opened.push(t) } as never).nav.openConnections?.();
  assert.deepEqual(opened, [{ screen: "vault.layout", args: { connections: "true" } }, { screen: "vault.layout", args: { connections: "true" } }]);
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { connections: "true" } }), { surface: "connections" });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { connections: "add" } }), { surface: "connections", add: true });
  const placed = renderToStaticMarkup(<ShellRuntimeProvider value={base}><PlaceHashProvider hash="screen=vault.layout&connections=true" opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.ok(has(placed, 'data-testid="vault-connections"'), "the address mounts the page");
  // Settings > Connected: the summary and Open in Vault
  const conn = renderToStaticMarkup(<SettingsDataProvider value={settings.data}><SettingsPlace initialPage="connected" /></SettingsDataProvider>);
  assert.ok(has(conn, 'data-testid="settings-open-connections"') && has(conn, "Open in Vault"));
  assert.ok(!has(conn, "App hubs"), "the hub card moved to the Vault");
  // the Console's Plugins page: the same link, through openApp
  const c = createSampleConsole();
  const apps: unknown[] = [];
  const consoleOut = renderToStaticMarkup(<ConsoleDataProvider value={{ ...c.data, nav: { ...c.data.nav, openApp: (t) => void apps.push(t) } }}><ConnectionsInVault /></ConsoleDataProvider>);
  assert.ok(has(consoleOut, 'data-testid="console-connections-open"') && has(consoleOut, "Vault"));
});
