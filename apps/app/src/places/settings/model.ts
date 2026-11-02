// The Settings model: the pages of You and of the Space, which SettingDef sits in which section, how a value is drawn (a switch, a choice, a number, text or hours) from its schema, what
// each row says on hover, and Cmd-F across all of it. Pure functions over the rows `settings.list` returns. team/v1/AUDIT-settings-2nov.md says why each row is here or gone.
import type { CapMap } from "../../../../../generated/types.ts";

export type SettingRow = CapMap["settings.list"]["out"]["rows"][number];
export type PageInfo = CapMap["settings.pages"]["out"]["pages"][number];
export type YouPage = "profile" | "notifications" | "appearance" | "ai" | "connected" | "signin" | "computer";
export type SpacePage = "space" | "people" | "agents" | "data" | "apps" | "advanced";
export type PageKey = YouPage | SpacePage;

export interface PageDef { key: PageKey; title: string; group: "you" | "space"; icon: string; /** the other `page` strings a registry row can carry for this page */ pages: readonly string[] }

export const PAGES: readonly PageDef[] = [
  { key: "profile", title: "Profile", group: "you", icon: "person", pages: [] },
  { key: "notifications", title: "Notifications", group: "you", icon: "bell", pages: ["Notifications"] },
  { key: "appearance", title: "Appearance", group: "you", icon: "palette", pages: [] },
  { key: "ai", title: "AI", group: "you", icon: "chip", pages: ["Models and usage", "Chats", "Memory and privacy"] },
  { key: "connected", title: "Connected", group: "you", icon: "link", pages: ["Connections"] },
  { key: "signin", title: "Sign-in and devices", group: "you", icon: "key", pages: ["Sign-in and devices"] },
  { key: "computer", title: "This computer", group: "you", icon: "laptop", pages: ["This computer"] },
  { key: "space", title: "Space", group: "space", icon: "grid", pages: [] },
  { key: "people", title: "People and access", group: "space", icon: "people", pages: [] },
  { key: "agents", title: "Agents and rules", group: "space", icon: "shield", pages: [] },
  { key: "data", title: "Data", group: "space", icon: "box", pages: [] },
  { key: "apps", title: "Connected apps", group: "space", icon: "link", pages: [] },
  { key: "advanced", title: "Advanced", group: "space", icon: "gear", pages: [] },
];

/** Addresses from before the pages folded together still land on the right page. */
export const OLD_PAGES: Readonly<Record<string, PageKey>> = { connections: "connected", models: "ai", privacy: "ai", keyboard: "appearance", spaces: "signin" };

export function pageByKey(key: string): PageDef {
  return PAGES.find((p) => p.key === key) ?? PAGES[0]!;
}

/** The page a row belongs to. Space-wide rows are placed by SPACE_ROWS instead, and rows that have no place in Settings by HIDDEN_ROWS. */
export function pageOfRow(row: SettingRow): PageDef | null {
  if (row.scope === "space" || HIDDEN_ROWS.includes(row.key)) return null;
  return PAGES.find((p) => p.group === "you" && (p.key === row.page || p.pages.includes(row.page))) ?? null;
}

// ---------------------------------------------------------------- sections: the headings a page's rows sit under

export interface SectionDef { title: string; note?: string; keys: readonly string[] }

/** Person rows that stay in the registry but are not rows here: remembered state, what a Kit install or the composer sets, and what the chat's mode dial replaces. */
export const HIDDEN_ROWS: readonly string[] = [
  "chat.ask_agent", "kit.person_choice", "comms.default_sender_email", "comms.default_sender_text",
  "security.terminal_mode", "security.chrome_mode", "security.team_agents_on_my_computer", "chrome.agents_use_my_browser",
];

/** Settings that a page draws itself (a card, a picker, a table) and so are not repeated as rows. */
export const DRAWN_BY_PAGE: Readonly<Record<string, readonly string[]>> = {
  profile: ["profile.photo", "profile.display_name", "profile.handle", "profile.title", "profile.contact"],
  appearance: ["appearance.skin"],
  notifications: ["notifications.quiet_hours", "notifications.hand_needs_you_to"],
};

export const SECTIONS: Readonly<Record<YouPage, readonly SectionDef[]>> = {
  profile: [{ title: "Availability", keys: ["profile.timezone", "profile.working_hours"] }],
  notifications: [{ title: "Delivery", keys: ["notifications.email_backstop", "notifications.alert_replies", "notifications.routines_all"] }],
  appearance: [],
  ai: [{ title: "Working with agents", keys: ["engine.local_runs", "chat.agent_tabs"] }],
  connected: [],
  signin: [],
  computer: [],
};

export interface Section { title: string; rows: SettingRow[] }

/** Rows of one page, in sections. A row the table does not name goes in the last section, so no row of the registry is lost. */
export function sectionsFor(page: YouPage, rows: readonly SettingRow[]): Section[] {
  const mine = rows.filter((r) => pageOfRow(r)?.key === page);
  const drawn = new Set(DRAWN_BY_PAGE[page] ?? []);
  const left = mine.filter((r) => !drawn.has(r.key));
  const out: Section[] = [];
  const used = new Set<string>();
  for (const def of SECTIONS[page]) {
    const hit = def.keys.map((k) => left.find((r) => r.key === k)).filter((r): r is SettingRow => r !== undefined && !used.has(r.key));
    for (const r of hit) used.add(r.key);
    if (hit.length > 0) out.push({ title: def.title, rows: hit });
  }
  const rest = left.filter((r) => !used.has(r.key));
  if (rest.length > 0) out.push({ title: out.length === 0 ? pageByKey(page).title : "More", rows: rest });
  return out;
}

// ---------------------------------------------------------------- the Space pages

export type SpaceControl =
  | { kind: "switch" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "number"; min: number; max: number; unit: string }
  | { kind: "list" }
  | { kind: "text" }
  /** One true or false inside a Space setting that holds several. */
  | { kind: "flag"; field: string };

export interface SpaceRowDef { id: string; key: string; page: SpacePage; section: string; label: string; help: string; control: SpaceControl; words?: string }

const yes = [{ value: "server_copy", label: "Yes" }, { value: "live_only", label: "No" }];
const sr = (key: string, page: SpacePage, section: string, label: string, control: SpaceControl, help: string, words?: string): SpaceRowDef => ({ id: control.kind === "flag" ? `${key}.${control.field}` : key, key, page, section, label, help, control, ...(words ? { words } : {}) });

/** What a Space admin sets, each row with its reader in team/v1/AUDIT-settings-2nov.md. Shipped defaults are good, so most Spaces never touch these. */
export const SPACE_ROWS: readonly SpaceRowDef[] = [
  sr("access.review_every_days", "people", "Access", "Review who has access every", { kind: "number", min: 7, max: 365, unit: "days" }, "How often Vyre asks admins to confirm who keeps access."),
  sr("gate.timeout_hours", "agents", "Approvals", "A waiting approval times out after", { kind: "number", min: 1, max: 720, unit: "hours" }, "A held action nobody answers is dropped after this long. A Gate rule can set its own.", "gate hold"),
  sr("gate.email_backstop_hours", "agents", "Approvals", "Email the approver after", { kind: "number", min: 1, max: 72, unit: "hours" }, "One email to the approver if a hold is still waiting.", "gate hold reminder"),
  sr("gate.drafted_by_label", "agents", "Approvals", "Label messages an agent drafted", { kind: "switch" }, "Adds a line saying an agent drafted it to messages that leave Vyre."),
  sr("tasks.require_human_approver", "agents", "Approvals", "Only people can approve", { kind: "switch" }, "An agent can never be the approver of a task."),
  sr("tasks.allow_self_review", "agents", "Approvals", "A reviewer can also be the assignee", { kind: "switch" }, "Off, whoever does the work cannot also review or approve it."),
  sr("changesets.different_person", "agents", "Approvals", "The approver must be someone else", { kind: "switch" }, "The person who asked an agent for file changes cannot approve them."),
  sr("engine.agent_hops", "agents", "Limits", "Agents can reply to each other", { kind: "number", min: 1, max: 20, unit: "times" }, "After this many replies between agents, a person has to answer. It stops loops."),
  sr("tasks.review_loop_limit", "agents", "Limits", "A reviewer can send work back", { kind: "number", min: 1, max: 10, unit: "times" }, "After this many send-backs, a person decides."),
  sr("memory.require_review", "agents", "Memory and automations", "Review shared memory first", { kind: "switch" }, "Everything an agent learns for the Space waits in Proposed until someone accepts it."),
  sr("memory.meaning_search", "agents", "Memory and automations", "Search by meaning", { kind: "choice", options: [{ value: "local", label: "On this server" }, { value: "key", label: "With the memory key" }, { value: "off", label: "Off" }] }, "Finds memory by meaning as well as by its words."),
  sr("automations.run_automations_on_import", "agents", "Memory and automations", "Imports run automations", { kind: "switch" }, "Off, records that arrive by import or sync do not fire automations."),
  sr("reports.vyre", "agents", "Memory and automations", "Send problem reports to Vyre", { kind: "choice", options: [{ value: "on", label: "On" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }] }, "Where Report a problem goes. On sends it to the Vyre team, Ask leaves that to an admin, Off keeps it here."),
  sr("git.protected_branches", "data", "Files", "Branches that need an approved push", { kind: "list" }, "An agent's push to one of these waits for an approval."),
  sr("files.review_changes", "data", "Files", "Review agent changes in Git folders", { kind: "flag", field: "git" }, "An agent's changes wait for review before they reach the repository."),
  sr("files.review_changes", "data", "Files", "Review agent changes in cloud folders", { kind: "flag", field: "cloud_mount" }, "An agent's changes wait for review before they reach Drive or OneDrive."),
  sr("files.review_changes", "data", "Files", "Review agent changes in other folders", { kind: "flag", field: "plain" }, "An agent's changes to a plain folder wait for review."),
  sr("vault.export_expiry_max", "data", "Files", "Longest life of a .env link", { kind: "choice", options: [{ value: "1h", label: "1 hour" }, { value: "1d", label: "1 day" }, { value: "7d", label: "7 days" }] }, "A pulled .env link stops working after this long."),
  sr("mail.provider", "apps", "Email and texts", "Send email through", { kind: "choice", options: [{ value: "resend", label: "Resend" }, { value: "mailgun", label: "Mailgun" }] }, "The service that sends this Space's email."),
  sr("contacts.sms_requires_consent", "apps", "Email and texts", "Texts need consent", { kind: "switch" }, "A contact must have agreed to texts before anyone can text them. Replying to their text is always allowed."),
  sr("telephony.recording_default", "apps", "Email and texts", "Record calls on new numbers", { kind: "choice", options: [{ value: "off", label: "Off" }, { value: "announce", label: "Announce and record" }, { value: "ask", label: "Ask each call" }] }, "The recording rule a new number starts with."),
  sr("google.auto_connect", "apps", "Suites", "Connect people's Google mail and calendar", { kind: "switch" }, "When Google Workspace is connected, each person's mail and calendar connect by themselves."),
  sr("microsoft.auto_connect", "apps", "Suites", "Connect people's Microsoft mail and calendar", { kind: "switch" }, "When Microsoft 365 is connected, each person's mail and calendar connect by themselves."),
  sr("mounts.public_address", "advanced", "Files", "Public address for file changes", { kind: "text" }, "Where Drive and OneDrive send change notices. Empty, Vyre checks them on a timer."),
  sr("files.local_mount_default", "advanced", "Files", "Local folders keep a server copy", { kind: "choice", options: yes }, "Yes keeps a copy on the Space server, so a folder is there when the computer is off."),
  sr("mailgun.region", "advanced", "Email", "Mailgun region", { kind: "choice", options: [{ value: "us", label: "US" }, { value: "eu", label: "EU" }] }, "Pick the region your Mailgun account lives in."),
];

export interface AdminLink { id: string; title: string; note: string }
const al = (id: string, title: string, note: string): AdminLink => ({ id, title, note });

/** The pages that used to be the Console, under the Space page each belongs to. Each opens right here. The ids are the Console's (console/shell/nav.ts). */
export const ADMIN_LINKS: Readonly<Record<SpacePage, readonly AdminLink[]>> = {
  space: [al("space", "Name, image and owner", "What people see, and who owns this Space"), al("overview", "Health and activity", "Checks, recent admin changes, last backup"), al("usage", "Usage", "Turns and spend by agent, person and model")],
  people: [al("people", "People", "Invite, change a role, remove"), al("groups", "Groups", "People who share access"), al("roles", "Roles", "What each role may do"), al("grants", "Grants", "Access to one thing"), al("policies", "Policies", "Sign-in requirements and public links"), al("checker", "Access checker", "Why someone can or cannot open something"), al("reviews", "Access reviews", "Confirm who keeps access"), al("sessions", "Sessions and devices", "Sign anyone out")],
  agents: [al("agents", "Agents", "Every agent in this Space"), al("actors", "Outside actors", "Agents that connect from elsewhere"), al("computers", "Agent computers", "Limits and sleep for each"), al("template", "Agent template", "What a new agent starts with"), al("skills", "Skills", "What agents can learn"), al("plugins", "Plugins and tools", "What agents can reach"), al("models", "Models and providers", "Which AI this Space allows"), al("gate", "Gate rules", "What needs an approval"), al("spend", "Spend and limits", "Budgets"), al("review", "Review sampling", "Turns a person checks"), al("incidents", "Incidents", "What went wrong"), al("aipolicy", "AI use policy", "The policy people agree to")],
  data: [al("schema", "Schema", "Record types and fields"), al("labels", "Sensitivity labels", "What each label protects"), al("retention", "Retention", "How long things are kept"), al("holds", "Holds", "Keep things past retention"), al("erase", "Erase a person", "Remove someone's data"), al("backups", "Backups", "Where and how often"), al("export", "Export", "Take this Space with you")],
  apps: [al("domains", "Sending domains", "Your own domain for email"), al("numbers", "Numbers", "Phone numbers"), al("inboxes", "Shared inboxes", "Mailboxes a team reads"), al("texting", "Texting registration", "Carrier registration"), al("google", "Google Workspace", "One connection for everyone"), al("microsoft", "Microsoft 365", "One connection for everyone"), al("connectors", "Connectors", "Sync with other apps"), al("connections", "Connections", "Live connections"), al("webhooks", "Webhooks", "Events to other systems"), al("keys", "API keys", "Access for scripts")],
  advanced: [al("network", "Network", "Addresses and certificates"), al("server", "Server", "Logs"), al("updates", "Updates", "Versions and the release channel"), al("diagnostics", "Diagnostics", "Run checks"), al("support", "Support bundle", "For a support request"), al("speed", "Speed", "Response times"), al("audit", "Audit log", "Who did what")],
};

/** The Space page a Console page sits under. */
export function adminHome(id: string): { page: SpacePage; link: AdminLink } | null {
  for (const page of Object.keys(ADMIN_LINKS) as SpacePage[]) { const link = ADMIN_LINKS[page].find((l) => l.id === id); if (link) return { page, link }; }
  return null;
}

/** The Space pages this person sees: a page shows when it holds a row they can change or a link they can open. */
export function spacePagesFor(admin: { pages: ReadonlySet<string>; canPolicy: boolean } | undefined): SpacePage[] {
  if (!admin) return [];
  return (Object.keys(ADMIN_LINKS) as SpacePage[]).filter((p) => (admin.canPolicy && SPACE_ROWS.some((r) => r.page === p)) || ADMIN_LINKS[p].some((l) => admin.pages.has(l.id)));
}

// ---------------------------------------------------------------- how a value is drawn

export type Control =
  | { kind: "switch" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "number"; min?: number; max?: number; step: number }
  | { kind: "text"; pattern?: string; mono?: boolean }
  | { kind: "hours" }
  | { kind: "list" }
  | { kind: "summary" };

export interface Schema { type?: string; enum?: readonly unknown[]; minimum?: number; maximum?: number; pattern?: string; properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; $ref?: string }

/** What the registry's schema says that the row itself does not: the choices of an enum and the range of a number. The shell may pass the real schema; this table covers the person rows. */
export const HINTS: Readonly<Record<string, Schema>> = {};

/** The registry row carries no schema through `settings.list`, so the control is chosen from the value and the default together, with the hints above for choices and ranges. */
export const TIMEZONES: readonly { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/Los_Angeles", label: "Pacific Time, Los Angeles" },
  { value: "America/Denver", label: "Mountain Time, Denver" },
  { value: "America/Chicago", label: "Central Time, Chicago" },
  { value: "America/New_York", label: "Eastern Time, New York" },
  { value: "America/Sao_Paulo", label: "Brasilia Time, Sao Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Central European Time, Berlin" },
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Asia/Dubai", label: "Gulf Time, Dubai" },
  { value: "Asia/Karachi", label: "Pakistan Time, Karachi" },
  { value: "Asia/Kolkata", label: "India Time, Kolkata" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia Time, Kuala Lumpur" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Japan Time, Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
];

/** "8:11 PM" in a time zone, at a moment. A zone the runtime does not know falls back to UTC. */
export function timeIn(at: number, tz: string): string {
  try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(at)); }
  catch { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(at)); }
}

export function controlFor(row: SettingRow, schema: Schema | undefined = HINTS[row.key]): Control {
  if (row.key === "profile.timezone") {
    const cur = typeof row.value === "string" ? row.value : "UTC";
    const options = TIMEZONES.some((z) => z.value === cur) ? TIMEZONES : [{ value: cur, label: cur }, ...TIMEZONES];
    return { kind: "choice", options };
  }
  if (row.key.endsWith("working_hours")) return { kind: "hours" };
  if (schema?.enum) return { kind: "choice", options: schema.enum.map((v) => ({ value: String(v), label: labelOf(String(v)) })) };
  const v = row.default;
  if (typeof v === "boolean") return { kind: "switch" };
  if (typeof v === "number") return { kind: "number", ...(schema?.minimum !== undefined ? { min: schema.minimum } : {}), ...(schema?.maximum !== undefined ? { max: schema.maximum } : {}), step: v >= 1000 ? 100 : 1 };
  if (typeof v === "string") return { kind: "text", ...(schema?.pattern ? { pattern: schema.pattern } : {}), ...(row.key.includes("handle") ? { mono: true } : {}) };
  if (Array.isArray(v)) return { kind: "list" };
  return { kind: "summary" };
}

/** The plain name of a row, where the registry's title is longer than the row needs. */
export const ROW_LABELS: Readonly<Record<string, string>> = {
  "notifications.email_backstop": "Email me if an approval waits",
  "notifications.routines_all": "Tell me when routines succeed",
  "notifications.alert_replies": "Alert me on replies",
  "notifications.hand_needs_you_to": "Hand Needs you to",
  "notifications.quiet_hours": "Quiet hours",
  "engine.local_runs": "Run my chats on this computer",
  "chat.agent_tabs": "Agents can open side tabs",
};
/** What a row does. It shows on hover, never as a line on the page. */
export const ROW_HELP: Readonly<Record<string, string>> = {
  "profile.timezone": "Used for your working hours, quiet hours and whatever agents schedule for you.",
  "profile.working_hours": "When you work. People and agents see it, Find a time keeps to it, and outside it only calls, urgent approvals and incidents interrupt you.",
  "notifications.email_backstop": "One email if an approval has been waiting on you for 4 hours.",
  "notifications.alert_replies": "A reply in a thread you follow interrupts you. Off, it is a badge.",
  "notifications.routines_all": "Failures always reach you. On, successes do too.",
  "notifications.quiet_hours": "No sounds or pushes between these times. What arrives waits in one summary.",
  "notifications.hand_needs_you_to": "While you are away, what needs you goes to this person.",
  "engine.local_runs": "Your private chats run here while this computer is on. Off, they run on the Space's computer. One chat can pick its own place in the model menu.",
  "chat.agent_tabs": "Lets an agent open or switch a tab beside your chat to show you something.",
  "model.default": "The model a new chat starts with. You can change it in any chat.",
  "model.fallback": "Used when the default is out of credits or down.",
};
/** Rows that need a team Space: a Personal Space has no one to share with, so they are not drawn there. */
export const TEAM_ONLY_ROWS: readonly string[] = ["engine.local_runs", "notifications.hand_needs_you_to"];
export const rowLabel = (row: SettingRow): string => ROW_LABELS[row.key] ?? row.title;
export const rowHelp = (row: SettingRow): string | undefined => ROW_HELP[row.key];

export function labelOf(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface Hours { days: number[]; from: string; to: string; tz?: string }

/** "Mon to Fri, 9:00 AM to 5:30 PM": runs of days are joined, times are in the person's own clock style. */
export function hoursSummary(h: Hours | null | undefined): string {
  if (!h || h.days.length === 0) return "No set hours";
  const days = [...h.days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1]! + 1) last.push(d); else runs.push([d]);
  }
  const parts: string[] = [];
  for (const r of runs) parts.push(r.length >= 3 ? `${DAY_NAMES[r[0]!]} to ${DAY_NAMES[r[r.length - 1]!]}` : r.map((d) => DAY_NAMES[d]!).join(", "));
  return `${parts.join(", ")}, ${clock(h.from)} to ${clock(h.to)}`;
}

export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The text a summary row shows for a structured value. */
export function summaryOf(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.length <= 3 ? value.map(String).join(", ") : `${value.length} items`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "Default";
  return entries.map(([k, v]) => `${labelOf(k)} ${typeof v === "object" ? "set" : String(v)}`).join(", ").slice(0, 60);
}

// ---------------------------------------------------------------- search (Cmd-F)

export interface Hit { key: string; page: PageKey; title: string; score: number; sub?: string; admin?: string }

/** Extra words that find a row whose title says too little. */
export const HIT_HELP: Readonly<Record<string, { sub?: string; words?: string }>> = {
  "appearance.skin": { words: "theme dark light colour color" },
};

/** Rows a page draws itself that Cmd-F still finds. */
export const DRAWN_ROWS: readonly { key: string; page: PageKey; title: string; sub: string; words: string }[] = [
  { key: "signin.password", page: "signin", title: "Password", sub: "Change your password", words: "sign in login" },
  { key: "signin.github", page: "signin", title: "GitHub", sub: "Sign in with one click", words: "sign in login" },
  { key: "signin.totp", page: "signin", title: "Authenticator app", sub: "One-time codes on your phone", words: "second factor 2fa totp" },
  { key: "signin.passkey", page: "signin", title: "Passkeys", sub: "Touch ID and security keys", words: "second factor biometric" },
  { key: "signin.devs", page: "signin", title: "Devices", sub: "Where you are signed in", words: "computers sign out" },
  { key: "signin.spaces", page: "signin", title: "Your Spaces", sub: "Open or leave a Space", words: "switch leave" },
  { key: "shortcuts", page: "appearance", title: "Keyboard shortcuts", sub: "Every shortcut, in one list", words: "keys hotkey keybinding" },
  { key: "model.default", page: "ai", title: "Default model", sub: "For new chats", words: "claude sonnet opus gpt" },
  { key: "model.fallback", page: "ai", title: "Fallback model", sub: "When the default is unavailable", words: "backup" },
  { key: "usage", page: "ai", title: "Usage this month", sub: "You and your agents", words: "limit cost tokens spend" },
  { key: "open-vault", page: "ai", title: "AI accounts", sub: "Sign-ins and keys live in the Vault", words: "provider api key openai anthropic subscription" },
  { key: "memory.keys", page: "ai", title: "Who pays for memory", sub: "The account memory upkeep uses", words: "upkeep spend" },
  { key: "connect-mailbox", page: "connected", title: "Connect a mailbox", sub: "Google, Microsoft or IMAP", words: "email gmail outlook" },
  { key: "connect-calendar", page: "connected", title: "Connect a calendar", sub: "Google or Microsoft", words: "events" },
  { key: "connect-twilio", page: "connected", title: "Connect Twilio", sub: "Texts and calls", words: "phone number sms" },
  { key: "computers-list", page: "computer", title: "Computers", sub: "Where your agents can run", words: "server docker device" },
];

/** What a search looks through beyond the person's own rows: nothing in a Personal Space or for someone who cannot change the Space. */
export interface SearchScope { personal?: boolean; admin?: { pages: ReadonlySet<string>; canPolicy: boolean } | undefined }

const matches = (words: readonly string[], hay: string): boolean => words.every((w) => hay.toLowerCase().includes(w));
const scored = (title: string, words: readonly string[]): number => (title.toLowerCase().startsWith(words[0]!) ? 2 : 1);

/** Words in any order; a title that starts with the first word ranks above one that only contains it. */
export function searchRows(rows: readonly SettingRow[], q: string, scope: SearchScope = {}): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: Hit[] = [];
  for (const r of rows) {
    const page = pageOfRow(r);
    if (!page || (scope.personal && TEAM_ONLY_ROWS.includes(r.key))) continue;
    const help = HIT_HELP[r.key];
    const label = rowLabel(r);
    if (!matches(words, `${label} ${r.key.replace(/[._]/g, " ")} ${page.title} ${help?.sub ?? ""} ${help?.words ?? ""}`)) continue;
    out.push({ key: r.key, page: page.key, title: label, score: scored(label, words), ...(help?.sub ? { sub: help.sub } : {}) });
  }
  for (const d of DRAWN_ROWS) {
    if (!matches(words, `${d.title} ${d.sub} ${d.words} ${pageByKey(d.page).title}`)) continue;
    out.push({ key: d.key, page: d.page, title: d.title, score: scored(d.title, words), sub: d.sub });
  }
  if (scope.admin?.canPolicy) for (const r of SPACE_ROWS) {
    if (!matches(words, `${r.label} ${r.words ?? ""} ${r.help} ${r.key.replace(/[._]/g, " ")} ${pageByKey(r.page).title}`)) continue;
    out.push({ key: r.id, page: r.page, title: r.label, score: scored(r.label, words), sub: pageByKey(r.page).title });
  }
  if (scope.admin) for (const page of Object.keys(ADMIN_LINKS) as SpacePage[]) for (const l of ADMIN_LINKS[page]) {
    if (!scope.admin.pages.has(l.id) || !matches(words, `${l.title} ${l.note} ${pageByKey(page).title}`)) continue;
    out.push({ key: `admin.${l.id}`, page, title: l.title, score: scored(l.title, words), sub: l.note, admin: l.id });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function moneyLabel(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** "a, b ,c" as a list: trimmed, no empties. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) if (part.trim()) out.push(part.trim());
  return out;
}
