// The app hubs a Space can connect (rc.9): one MCP address and one key give every agent the hub's apps as tools. A hub is an ordinary outside-tool connection (plugins.connection.add, https) with the key
// as a Vault handle in a header, plus the hub's id so every card and tool row can say "Runs through Composio". The templates are data: where the address looks like, which header holds the key,
// where the person gets the key, and where an app is signed in on the hub's own page. Mail, files, CRM and the Vault never route through a hub.

export type HubId = "composio" | "pipedream";

export interface HubTemplate {
  id: HubId;
  name: string;
  /** The addresses this hub serves its MCP endpoint from. A connection that names the hub must match. */
  urlPattern: RegExp;
  urlExample: string;
  /** The header the key travels in, and the text before the key in it. */
  header: string;
  prefix: string;
  /** Where the person finds the key, in words and as a page. */
  keyHint: string;
  keyUrl: string;
  /** The hub's own page for signing one app in; {app} is the app's slug. */
  connectUrl: string;
  /** The app a tool belongs to, from its name (the hubs prefix every tool with its app). */
  appOf(tool: string): string;
}

const firstWord = (tool: string): string => (/^[A-Za-z0-9]+/.exec(tool)?.[0] ?? tool).toLowerCase();

export const HUBS: readonly HubTemplate[] = [
  {
    id: "composio", name: "Composio", urlPattern: /^https:\/\/(backend|mcp)\.composio\.dev\//, urlExample: "https://backend.composio.dev/v3/mcp/<server id>/mcp",
    header: "x-api-key", prefix: "", keyHint: "Composio dashboard, Settings, API keys.", keyUrl: "https://platform.composio.dev/", connectUrl: "https://platform.composio.dev/apps/{app}", appOf: firstWord,
  },
  {
    id: "pipedream", name: "Pipedream", urlPattern: /^https:\/\/remote\.mcp\.pipedream\.net(\/|$)/, urlExample: "https://remote.mcp.pipedream.net",
    header: "Authorization", prefix: "Bearer ", keyHint: "Pipedream, Settings, API, a project access token.", keyUrl: "https://pipedream.com/settings/api", connectUrl: "https://pipedream.com/apps/{app}", appOf: firstWord,
  },
];

export const hubById = (id: string | undefined | null): HubTemplate | undefined => HUBS.find((h) => h.id === id);

/** "Runs through Composio", or nothing for a connection that is not a hub. */
export const hubLine = (id: string | undefined | null): string => { const h = hubById(id); return h ? `Runs through ${h.name}` : ""; };

/** The page where one app is signed in on the hub. */
export const connectLink = (hub: HubTemplate, app: string): string => hub.connectUrl.replace("{app}", encodeURIComponent(app));
