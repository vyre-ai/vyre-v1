// The Console's navigation (spec 3.10, CONSOLE-SPEC section 4, binding): Overview; Access; Agents and actors; Data; AI; Comms; Integrations; Infrastructure; Audit log; Space.
// A page hides when the person lacks its permission (a Developer sees Schema, Integrations and Infrastructure logs, and no people management). `built` marks the pages this packet draws;
// the others open their own packets (P-L7b_12 to P-L7b_14) and show a quiet line until then.

export interface PageDef {
  id: string;
  title: string;
  /** The nav group, or "" for a page that stands alone. */
  group: string;
  icon: string;
  /** The permission that shows the page; console.access is implied for all of them. */
  needs: string;
  /** The registry screen the page draws. */
  screen: string;
  built: boolean;
}

const p = (id: string, title: string, group: string, icon: string, needs: string, screen: string, built = false): PageDef => ({ id, title, group, icon, needs, screen, built });

export const PAGES: readonly PageDef[] = [
  p("overview", "Overview", "", "overview", "console.access", "console.overview", true),
  p("usage", "Usage", "", "pulse", "console.access", "console.usage"),
  p("people", "People", "Access", "people", "access.manage", "access.people"),
  p("groups", "Groups", "Access", "people", "access.manage", "access.groups"),
  p("roles", "Roles", "Access", "key", "access.manage", "access.roles"),
  p("grants", "Grants", "Access", "lock", "access.manage", "access.grants"),
  p("policies", "Policies", "Access", "space", "policy.manage", "access.policies"),
  p("checker", "Access checker", "Access", "search", "access.manage", "access.checker"),
  p("reviews", "Access reviews", "Access", "ok", "access.manage", "access.reviews"),
  p("sessions", "Sessions and devices", "Access", "pulse", "access.manage", "devices.sessions"),
  p("agents", "Agents register", "Agents and actors", "agent", "agents.manage", "console.agents-register"),
  p("actors", "Outside actors", "Agents and actors", "plug", "agents.manage", "console.outside-actors"),
  p("computers", "Agent computers", "Agents and actors", "server", "computers.use", "console.agent-computers"),
  p("template", "Agent template", "Agents and actors", "agent", "agents.manage", "console.agent-template"),
  p("schema", "Schema", "Data", "data", "schema.manage", "console.schema"),
  p("labels", "Sensitivity labels", "Data", "lock", "policy.manage", "console.labels"),
  p("retention", "Retention", "Data", "data", "policy.manage", "governance.retention"),
  p("holds", "Holds", "Data", "lock", "records.hold", "governance.holds"),
  p("erase", "Erase a person", "Data", "x", "policy.manage", "governance.erase"),
  p("backups", "Backups", "Data", "data", "server.backups", "console.backups"),
  p("export", "Export", "Data", "up", "records.export", "console.backups"),
  p("models", "Models and providers", "AI", "ai", "ai.models", "console.ai-models"),
  p("gate", "Gate rules", "AI", "ok", "policy.manage", "gate.rules"),
  p("spend", "Spend and limits", "AI", "pulse", "ai.spend", "console.ai-spend"),
  p("logging", "Logging", "AI", "audit", "policy.manage", "console.logging"),
  p("review", "Review sampling", "AI", "eye", "ai.incidents", "console.ai-review"),
  p("incidents", "Incidents", "AI", "warn", "ai.incidents", "console.ai-incidents"),
  p("aipolicy", "AI use policy", "AI", "audit", "policy.manage", "console.ai-spend"),
  p("domains", "Sending domains", "Comms", "mail", "comms.domains", "mail.domains"),
  p("numbers", "Numbers", "Comms", "comms", "comms.numbers", "telephony.numbers"),
  p("inboxes", "Shared inboxes", "Comms", "mail", "comms.shared_send", "mail.shared-inboxes"),
  p("texting", "Texting registration", "Comms", "ok", "comms.numbers", "telephony.registration"),
  p("connectors", "Connectors", "Integrations", "plug", "console.access", "console.integrations"),
  p("connections", "Connections", "Integrations", "plug", "console.access", "console.integrations"),
  p("webhooks", "Webhooks", "Integrations", "plug", "console.access", "events.webhooks"),
  p("keys", "API keys", "Integrations", "key", "console.access", "console.mcp-sessions"),
  p("network", "Network", "Infrastructure", "pulse", "server.network", "console.network"),
  p("server", "Server", "Infrastructure", "server", "server.logs", "console.server-logs"),
  p("updates", "Updates", "Infrastructure", "up", "server.update", "console.server-updates"),
  p("diagnostics", "Diagnostics", "Infrastructure", "pulse", "console.access", "console.diagnostics"),
  p("support", "Support bundle", "Infrastructure", "audit", "server.logs", "console.support-bundle"),
  p("speed", "Speed", "Infrastructure", "pulse", "console.access", "console.speed"),
  p("audit", "Audit log", "", "audit", "audit.read", "audit.log", true),
  p("space", "Space", "", "space", "console.access", "spaces.console"),
];

export const GROUPS: readonly string[] = ["Access", "Agents and actors", "Data", "AI", "Comms", "Integrations", "Infrastructure"];

export function pageById(id: string): PageDef | undefined {
  return PAGES.find((x) => x.id === id);
}

/** The pages this person sees, in nav order. */
export function visiblePages(can: (perm: string) => boolean, allowed?: ReadonlySet<string>): PageDef[] {
  return PAGES.filter((x) => allowed ? allowed.has(x.screen) : can(x.needs));
}

export const DEFAULT_PAGE = "overview";
