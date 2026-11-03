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
  p("usage", "Usage", "", "chart", "console.access", "console.usage"),
  p("people", "People", "Access", "people", "access.manage", "access.people"),
  p("groups", "Groups", "Access", "group", "access.manage", "access.groups"),
  p("roles", "Roles", "Access", "key", "access.manage", "access.roles"),
  p("permissions", "Permissions", "Access", "grid", "access.manage", "access.permissions"),
  p("grants", "Grants", "Access", "lock", "access.manage", "access.grants"),
  p("policies", "Policies", "Access", "space", "policy.manage", "access.policies"),
  p("checker", "Access checker", "Access", "search", "access.manage", "access.checker"),
  p("reviews", "Access reviews", "Access", "ok", "access.manage", "access.reviews"),
  p("sessions", "Sessions and devices", "Access", "device", "access.manage", "devices.sessions"),
  p("agents", "Agents register", "Agents and actors", "agent", "agents.manage", "console.agents-register"),
  p("actors", "Outside actors", "Agents and actors", "open", "agents.manage", "console.outside-actors"),
  p("computers", "Agent computers", "Agents and actors", "monitor", "computers.use", "console.agent-computers"),
  p("template", "Agent template", "Agents and actors", "doc", "agents.manage", "console.agent-template"),
  p("skills", "Skills", "Agents and actors", "assistant", "agents.manage", "console.skills"),
  p("plugins", "Plugins and tools", "Agents and actors", "plug", "agents.manage", "console.plugins"),
  p("schema", "Schema", "Data", "data", "schema.manage", "console.schema"),
  p("labels", "Sensitivity labels", "Data", "tag", "policy.manage", "console.labels"),
  p("retention", "Retention", "Data", "clock", "policy.manage", "governance.retention"),
  p("holds", "Holds", "Data", "hold", "records.hold", "governance.holds"),
  p("erase", "Erase a person", "Data", "x", "policy.manage", "governance.erase"),
  p("backups", "Backups", "Data", "box", "server.backups", "console.backups"),
  p("models", "Models and providers", "AI", "ai", "ai.models", "console.ai-models"),
  p("gate", "Gate rules", "AI", "filter", "policy.manage", "gate.rules"),
  p("spend", "Spend and limits", "AI", "coins", "ai.spend", "console.ai-spend"),
  p("review", "Review sampling", "AI", "eye", "ai.incidents", "console.ai-review"),
  p("incidents", "Incidents", "AI", "warn", "ai.incidents", "console.ai-incidents"),
  p("aipolicy", "AI use policy", "AI", "scale", "policy.manage", "console.ai-spend"),
  p("memlearn", "Memory learning", "AI", "learn", "policy.manage", "access.policies"),
  // the setting engine.egress, saved with settings.set_space (policy.manage), so the page shows to whoever may set Space policy, like the Space defaults below
  p("internet", "Internet access", "AI", "internet", "policy.manage", "access.policies"),
  p("domains", "Sending domains", "Comms", "mail", "comms.domains", "mail.domains"),
  p("numbers", "Numbers", "Comms", "phone", "comms.numbers", "telephony.numbers"),
  p("inboxes", "Shared inboxes", "Comms", "inbox", "comms.shared_send", "mail.shared-inboxes"),
  p("texting", "Texting registration", "Comms", "chat", "comms.numbers", "telephony.registration"),
  p("company", "Connect your company", "Integrations", "building", "connectors.manage", "company.setup"),
  p("google", "Google Workspace", "Integrations", "cloud", "connectors.manage", "google.setup"),
  p("microsoft", "Microsoft 365", "Integrations", "windows", "connectors.manage", "microsoft.setup"),
  p("connectors", "Connectors", "Integrations", "braces", "console.access", "console.integrations"),
  p("connections", "Connections", "Integrations", "link", "console.access", "console.integrations"),
  p("webhooks", "Webhooks", "Integrations", "bolt", "console.access", "events.webhooks"),
  p("keys", "API keys", "Integrations", "code", "console.access", "console.mcp-sessions"),
  p("network", "Network", "Infrastructure", "globe", "server.network", "console.network"),
  p("server", "Server", "Infrastructure", "server", "server.logs", "console.server-logs"),
  p("updates", "Updates", "Infrastructure", "up", "server.update", "console.server-updates"),
  p("diagnostics", "Diagnostics", "Infrastructure", "wrench", "console.access", "console.diagnostics"),
  p("support", "Support bundle", "Infrastructure", "life", "server.logs", "console.support-bundle"),
  p("speed", "Speed", "Infrastructure", "gauge", "console.access", "console.speed"),
  p("audit", "Audit log", "", "audit", "audit.read", "audit.log", true),
  p("space", "Space", "", "home", "console.access", "spaces.console"),
  // Space defaults: what a person's own choices in Settings sit inside. They share the Policies screen, so whoever may set policy has them all.
  p("def-access", "Review schedule", "Space defaults", "check", "policy.manage", "access.policies"),
  p("def-agents", "Agents and approvals", "Space defaults", "gear", "policy.manage", "access.policies"),
  p("def-memory", "Memory", "Space defaults", "pulse", "policy.manage", "access.policies"),
  p("def-data", "Files and data", "Space defaults", "list", "policy.manage", "access.policies"),
  p("def-apps", "Email and calling", "Space defaults", "comms", "policy.manage", "access.policies"),
  p("def-advanced", "Advanced", "Space defaults", "download", "policy.manage", "access.policies"),
];

export const GROUPS: readonly string[] = ["Space defaults", "Access", "Agents and actors", "Data", "AI", "Comms", "Integrations", "Infrastructure"];

export function pageById(id: string): PageDef | undefined {
  return PAGES.find((x) => x.id === id);
}

/** The pages this person sees, in nav order. */
export function visiblePages(can: (perm: string) => boolean, allowed?: ReadonlySet<string>): PageDef[] {
  return PAGES.filter((x) => allowed ? allowed.has(x.screen) : can(x.needs));
}

export const DEFAULT_PAGE = "overview";

/** What each page is for: the tooltip beside its title. */
export const PAGE_NOTE: Readonly<Record<string, string>> = {
  actors: "Agents that connect from elsewhere",
  agents: "Every agent in this Space",
  aipolicy: "The policy people agree to",
  company: "Sign-in, people, mail, calendar and files from Google Workspace or Microsoft 365",
  audit: "Who did what, and when",
  backups: "Where and how often",
  checker: "Why someone can or cannot open something",
  computers: "Limits and sleep for each",
  connections: "Live connections",
  connectors: "Sync with other apps",
  "def-access": "How often access is reviewed",
  "def-advanced": "Addresses and regions most Spaces never change",
  "def-agents": "Approvals and limits for everyone in this Space",
  "def-apps": "How this Space sends email and handles calls",
  "def-data": "What needs review before it changes",
  "def-memory": "Who pays for shared memory, and the monthly cap",
  memlearn: "How much each person's chats may teach memory each day",
  diagnostics: "Run checks",
  domains: "Your own domain for email",
  erase: "Remove someone's data",
  gate: "What needs an approval",
  google: "One connection for everyone",
  grants: "Access to one thing",
  groups: "People who share access",
  holds: "Keep things past retention",
  inboxes: "Mailboxes a team reads",
  internet: "What AI tools can reach on the internet",
  incidents: "What went wrong",
  keys: "Access for scripts",
  labels: "What each label protects",
  microsoft: "One connection for everyone",
  models: "Which AI this Space allows",
  network: "Addresses and certificates",
  numbers: "Phone numbers",
  overview: "Checks, recent admin changes, last backup",
  people: "Invite, change a role, remove",
  plugins: "What agents can reach",
  policies: "Sign-in requirements and public links",
  retention: "How long things are kept",
  review: "Turns a person checks",
  reviews: "Confirm who keeps access",
  roles: "What each role may do",
  permissions: "Who may do what, with per-person exceptions",
  schema: "Record types and fields",
  server: "Logs",
  sessions: "Sign anyone out",
  skills: "What agents can learn",
  space: "What people see, and who owns this Space",
  speed: "Response times",
  spend: "Budgets",
  support: "For a support request",
  template: "What a new agent starts with",
  texting: "Carrier registration",
  updates: "Versions and the release channel",
  usage: "Turns and spend by agent, person and model",
  webhooks: "Events to other systems",
};
