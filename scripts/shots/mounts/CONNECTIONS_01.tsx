// Mount for Vault > Connections (lane l-connections, owner rulings D28 and D29), over scripted answers. ?part=
//   vault           a Team Space admin: Mine, Space (everyone or Legal), agents' own, plugin and skill servers, built-in integrations, app hubs and the Space's rules
//   member          the same Space as a member: no rules, no hub card, nothing to share
//   personal        a Personal Space: Mine only
//   browse          Add a connection, Browse the MCP registry for "notion"
//   paste           Add a connection, Paste an address: a command with its key in front
//   import          Add a connection, Import a config: a Codex config.toml
//   setup           Add a connection, a registry server that needs a key: where the key goes and who can use it
//   settings        Settings > Connected: the summary and Open in Vault
//   console         Console > Plugins and tools: the Connections summary and Open in Vault
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import type { VaultData } from "../../../apps/app/src/places/vault/layout/data.tsx";
import { createSampleVault } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { SAMPLE_CATALOG, sampleConnectionsCall, sampleConnectionsData } from "../../../apps/app/src/places/vault/connections/sample.ts";
import { pendingFromEntry } from "../../../apps/app/src/places/vault/connections/AddConnection.tsx";
import type { AddInitial } from "../../../apps/app/src/places/vault/connections/AddConnection.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { PluginsPage } from "../../../apps/app/src/console/pages/Plugins.tsx";

export const title = "Vault > Connections";

function vaultFor(o: { admin?: boolean; personal?: boolean }): VaultData {
  const v = createSampleVault();
  return { ...v.data, assistantId: "agt_assistant", call: sampleConnectionsCall(v.data.call, o), nav: { ...v.data.nav, openConnections: () => undefined }, ...(o.personal ? { personal: true } : {}) };
}

const ADD: Record<string, AddInitial> = {
  browse: { way: "browse", query: "notion" },
  paste: { way: "paste", text: "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_9f3kQe7LmZt2Vb8N npx -y @modelcontextprotocol/server-github" },
  import: { way: "import", text: '# ~/.codex/config.toml\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n\n[mcp_servers.figma]\nurl = "https://mcp.figma.com/mcp"\nbearer_token_env_var = "FIGMA_OAUTH_TOKEN"\n\n[mcp_servers.brave]\ncommand = "npx"\nargs = ["-y", "@brave/brave-search-mcp-server"]\nenv = { BRAVE_API_KEY = "BSAq8Lr2Tz5Wm9Xc3Vb7Nk1Jh4Gf6Dd0Ss", REGION = "eu" }\n' },
  setup: { pending: [pendingFromEntry(SAMPLE_CATALOG[1]!)] },
};

function consoleData(): ConsoleData {
  const base = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "plugins.marketplaces.list": { marketplaces: [{ marketplaceId: "mkt_anthropic", name: "anthropic-skills", kind: "git", source: "https://github.com/anthropics/skills", owner: "Anthropic", plugins: 14, allowed: true, warnings: [], updatedAt: 1 }] },
    "plugins.list": { plugins: [{ pluginId: "plg_pdf", name: "pdf-tools", marketplace: "anthropic-skills", marketplaceId: "mkt_anthropic", scope: "space", enabled: true, parts: { skills: ["pdf"], commands: [], agents: [], hooks: 0, mcpServers: ["pdf"] }, userConfig: [], config: {}, configured: true, warnings: [], installedAt: 1 }] },
    "plugins.browse": { plugins: [], total: 0 },
    "agents.list": { agents: [] },
  };
  const call = sampleConnectionsCall(base.call);
  return { ...base, call, screens: { ...base.screens, capQuery: (cap: string) => { const state = rows[cap] === undefined ? { status: "loading" } : { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "vault"), []);
  const admin = useMemo(() => vaultFor({ admin: true }), []);
  const member = useMemo(() => vaultFor({ admin: false }), []);
  const personal = useMemo(() => vaultFor({ personal: true }), []);
  const settings = useMemo(() => { const s = createSampleSettings(); return { ...s.data, call: sampleConnectionsCall(s.data.call) }; }, []);
  const cons = useMemo(() => consoleData(), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "settings") return <SettingsDataProvider value={settings}><View style={{ flex: 1, minHeight: 760 }}><SettingsPlace initialPage="connected" /></View></SettingsDataProvider>;
  if (part === "console") return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 760, padding: 24 }}><PluginsPage /></View></ConsoleDataProvider>;
  const o = part === "member" ? { admin: false } : part === "personal" ? { personal: true } : { admin: true };
  const data = part === "member" ? member : part === "personal" ? personal : admin;
  return (
    <View style={{ flex: 1, minHeight: 760 }}>
      <Vault data={data} route={{ surface: "connections" }} connectionsInitial={sampleConnectionsData(o)} {...(ADD[part] ? { connectionsAdd: ADD[part] } : {})} />
    </View>
  );
}
