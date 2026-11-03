// Sample Vault > Connections for tests and the screenshot mount: a Team Space where Irfad (an admin) has his own connections, the Space has some for everyone or for Legal, plugins and skills bring
// servers, and the built-in integrations sit beside them; a recorded slice of the MCP registry for Browse. Calls answer in memory; nothing reaches a network.
import type { CatalogEntry } from "../../../../../../lib/mcp-registry.ts";
import type { ConnectionsData } from "./ConnectionsView.tsx";
import type { Account, Connector, Home, HomeRow } from "./model.ts";

/** The Vault sample's clock (layout/sample.ts SAMPLE_NOW), so "Used 12 min ago" reads the same in a test and a screenshot. */
export const SAMPLE_CONN_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const m = (n: number): number => SAMPLE_CONN_NOW - n * 60_000;
const h = (n: number): number => SAMPLE_CONN_NOW - n * 3_600_000;

const row = (o: Partial<HomeRow> & Pick<HomeRow, "key" | "title" | "scope">): HomeRow => ({
  kind: "mcp", name: o.key, share: o.scope === "space" ? ["everyone"] : [], transport: "http", address: "", source: "registry", enabled: true, health: "ok", usedBy: [], keys: [], needs: [], canManage: true, ...o,
});

export function sampleHome(o: { admin?: boolean; personal?: boolean } = {}): Home {
  const admin = o.admin ?? true;
  return {
    mine: [
      row({ key: "notion", title: "Notion", scope: "mine", connectionId: "mcs_notion", address: "https://mcp.notion.com/mcp", auth: "oauth", sourceRef: "com.notion/mcp", tools: 14, checkedAt: m(3), usedAt: m(12), usedBy: ["agt_research", "agt_assistant"] }),
      row({ key: "github", title: "GitHub", scope: "mine", connectionId: "mcs_github", transport: "stdio", address: "npx -y @modelcontextprotocol/server-github", source: "import", sourceRef: ".mcp.json", tools: 26, keys: ["#Github_key.GITHUB_TOKEN"], usedAt: h(5), usedBy: ["agt_assistant"] }),
      row({ key: "linear", title: "Linear", scope: "mine", connectionId: "mcs_linear", address: "https://mcp.linear.app/mcp", auth: "oauth", source: "paste", health: "needs_signin", healthNote: "linear needs to be signed in first." }),
    ],
    space: o.personal ? [] : [
      row({ key: "composio", title: "Composio", kind: "hub", hub: "composio", scope: "space", connectionId: "mcs_composio", address: "https://backend.composio.dev/v3/mcp/srv_nw/mcp", source: "hub", tools: 58, keys: ["#Composio_key.api_key"], usedAt: m(2), usedBy: ["agt_intake", "agt_billing", "agt_research"], canManage: admin }),
      row({ key: "docs", title: "Clio docs", scope: "space", connectionId: "mcs_docs", share: ["grp_legal"], address: "https://mcp.clio.example/mcp", source: "hand", tools: 6, usedAt: h(30), usedBy: ["agt_intake"], canManage: admin }),
      row({ key: "sentry", title: "Sentry", scope: "space", connectionId: "mcs_sentry", address: "https://mcp.sentry.dev/mcp", source: "registry", sourceRef: "io.sentry/mcp", health: "key_refused", healthNote: "sentry did not answer: The server answered 401.", keys: ["#Sentry_key.Authorization"], usedAt: h(52), canManage: admin }),
      row({ key: "pdf-tools/pdf", title: "pdf", kind: "plugin", name: "pdf", scope: "space", pluginId: "plg_pdf", transport: "stdio", address: "node ${CLAUDE_PLUGIN_ROOT}/server.js", source: "plugin", sourceRef: "pdf-tools", health: "unknown", canManage: admin }),
      row({ key: "skill:skl_contracts/contracts", title: "contracts", kind: "skill", name: "contracts", scope: "space", transport: "stdio", address: "uvx contracts-mcp", source: "skill", sourceRef: "contract-review", health: "needs_setup", needs: ["CLIO_TOKEN"], canManage: false }),
    ],
    agents: o.personal ? [] : [row({ key: "billing-db", title: "Billing database", scope: "agent", agentId: "agt_billing", connectionId: "mcs_billing", transport: "stdio", address: "npx -y @acme/postgres-mcp", source: "hand", health: "not_answering", healthNote: "billing-db did not start: no answer", canManage: admin })],
    policy: { spaceAdders: "managers", allowListOn: true, allowList: ["com.notion/mcp", "mcp.linear.app", "@modelcontextprotocol/server-github"] },
    canAddSpace: admin && !o.personal, admin,
  };
}

export const SAMPLE_ACCOUNTS: Account[] = [
  { connectionId: "con_google", connector: "google", title: "irfad@northwind.example", owner: { kind: "person", id: "usr_irfad" }, state: "active", scopes: [], lastSyncAt: m(6), createdAt: 1, handles: [], filled: [] },
  { connectionId: "con_slack", connector: "slack", title: "Northwind Slack", owner: { kind: "space", id: "spc_northwind" }, state: "active", scopes: [], lastSyncAt: m(1), createdAt: 1, handles: [], filled: [] },
  { connectionId: "con_zoom", connector: "zoom", title: "Northwind Zoom", owner: { kind: "space", id: "spc_northwind" }, state: "needs_reconnect", scopes: [], createdAt: 1, handles: [], filled: [] },
];
export const SAMPLE_CONNECTORS = [{ key: "google", title: "Google Workspace" }, { key: "slack", title: "Slack" }, { key: "zoom", title: "Zoom" }] as unknown as Connector[];
export const SAMPLE_GROUPS: Array<{ id: string; name: string }> = [{ id: "grp_legal", name: "Legal" }, { id: "grp_ops", name: "Operations" }, { id: "grp_sales", name: "Sales" }];

/** A recorded slice of the official MCP registry, as plugins.registry.search answers it. */
export const SAMPLE_CATALOG: Array<CatalogEntry & { allowed: boolean }> = [
  { id: "official:com.notion/mcp", source: "official", name: "com.notion/mcp", title: "Notion", description: "Official Notion MCP server: search, read and write pages and databases.", version: "1.0.0", remote: { url: "https://mcp.notion.com/mcp", transport: "http", headers: [] }, signIn: "oauth", allowed: true },
  { id: "official:io.github.awkoy/notion-mcp-server", source: "official", name: "io.github.awkoy/notion-mcp-server", title: "Notion MCP Server", description: "Notion pages and blocks with a Notion integration token.", version: "3.3.0", package: { registry: "npm", runner: "npx", identifier: "notion-mcp-server", version: "3.3.0", env: [{ name: "NOTION_TOKEN", description: "Your Notion integration token", required: true, secret: true }, { name: "NOTION_PAGE_ID", description: "The page it starts from", required: false, secret: false }] }, signIn: "key", allowed: false },
  { id: "official:ai.smithery/smithery-notion", source: "official", name: "ai.smithery/smithery-notion", title: "Smithery Notion", description: "A Notion workspace through Smithery.", version: "1.0.0", remote: { url: "https://server.smithery.ai/@smithery/notion/mcp", transport: "http", headers: [{ name: "Authorization", description: "Bearer token for Smithery", required: true, secret: true, value: "Bearer {smithery_api_key}" }] }, signIn: "key", allowed: false },
  { id: "official:com.mcparmory/notion", source: "official", name: "com.mcparmory/notion", title: "Notion (MCP Armory)", description: "Notion tools packaged for uvx.", version: "1.0.2", package: { registry: "pypi", runner: "uvx", identifier: "mcparmory-notion", version: "1.0.2", env: [] }, signIn: "none", allowed: false },
];

export function sampleConnectionsData(o: { admin?: boolean; personal?: boolean } = {}): ConnectionsData {
  return { home: sampleHome(o), accounts: SAMPLE_ACCOUNTS, connectors: SAMPLE_CONNECTORS, groups: new Map(SAMPLE_GROUPS.map((g) => [g.id, g.name] as const)), error: null, loaded: true };
}

/** Answers the calls the page and the sheet make; anything else goes to `rest` (the sample Vault). */
export function sampleConnectionsCall(rest: (cap: string, input: unknown) => Promise<unknown>, o: { admin?: boolean; personal?: boolean; offline?: boolean } = {}): (cap: string, input: unknown) => Promise<unknown> {
  const home = sampleHome(o);
  return async (cap, input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    switch (cap) {
      case "plugins.connections.home": return home;
      case "connections.list": return { connections: SAMPLE_ACCOUNTS };
      case "connectors.list": return { connectors: SAMPLE_CONNECTORS };
      case "access.groups.list": return { groups: SAMPLE_GROUPS };
      case "plugins.registry.search": {
        const q = String(i["q"] ?? "").toLowerCase();
        return { entries: SAMPLE_CATALOG.filter((e) => !q || `${e.name} ${e.title} ${e.description}`.toLowerCase().includes(q)), offline: o.offline === true, fetchedAt: h(20), source: "official" };
      }
      case "plugins.connection.add_mine": case "plugins.connection.add": return { connection: { connectionId: "mcs_new", name: i["name"], scope: cap.endsWith("mine") ? "mine" : "space", owner: "usr_irfad" } };
      case "plugins.connection.update": case "plugins.connection.forget": return { connectionId: i["connectionId"], removed: true };
      case "plugins.connections.policy_set": return { policy: { ...home.policy, ...i } };
      case "engine.mcp.tools": return { servers: [{ key: i["server"], name: i["server"], from: "connection", ok: true, tools: [{}, {}, {}, {}] }] };
      case "connections.test": return { state: "healthy" };
      default: return rest(cap, input);
    }
  };
}
