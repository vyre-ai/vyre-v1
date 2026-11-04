// The Console is nine places, each one page with a quiet tab strip; a tab is one job. The 55 pages it grew from are still the building blocks (nav.ts is their registry: permission, screen, icon): a tab shows
// one of them, or several as views under a small text switch (Permissions, Roles, Grants, Check access), and the Space defaults that used to be six pages of their own sit under the page they configure.
// An old page id still works: it lands on its place in a section (go("sessions"), a link from an alert, an address from before), and the search finds the old names.
import { pageById } from "./nav.ts";
import type { PageDef } from "./nav.ts";

export interface ViewDef { page: string; label: string }
export interface TabDef {
  label: string;
  /** The first view is the tab's page; a second or third shows as a text switch under the strip. */
  views: readonly ViewDef[];
  /** Pages drawn after a view, as the section of defaults that page configures (Space defaults used to be pages of their own): view page -> pages. */
  extras?: Readonly<Record<string, readonly string[]>>;
}
export interface SectionDef { id: string; title: string; icon: string; /** One sentence under the title: the job in plain words. */ subtitle: string; tabs: readonly TabDef[] }

const v = (page: string, label: string): ViewDef => ({ page, label });

export const SECTIONS: readonly SectionDef[] = [
  { id: "overview", title: "Home", icon: "overview", subtitle: "How the Space is doing and what needs you", tabs: [{ label: "Home", views: [v("overview", "Home")] }] },
  { id: "access", title: "People", icon: "people", subtitle: "Invite people and decide what they can do", tabs: [
    { label: "Members", views: [v("people", "Members")] },
    { label: "Teams", views: [v("groups", "Teams")] },
    { label: "Roles", views: [v("permissions", "Roles and permissions"), v("roles", "Role details"), v("grants", "Extra access")] },
    { label: "Requests", views: [v("requests", "Requests")] },
  ] },
  { id: "agents", title: "Agents", icon: "agent", subtitle: "The Space's agents and the outside agents that work here", tabs: [
    { label: "Space agents", views: [v("agents", "Space agents")] },
    { label: "Outside agents", views: [v("actors", "Outside agents")] },
    { label: "Skills and plugins", views: [v("skills", "Skills"), v("plugins", "Plugins and tools")] },
    { label: "Activity", views: [v("activity", "Activity")] },
    { label: "Defaults for new agents", views: [v("template", "Defaults for new agents")] },
  ] },
  { id: "ai", title: "AI", icon: "ai", subtitle: "Which AI accounts this Space uses and what each one may see", tabs: [
    { label: "AI accounts", views: [v("aiaccounts", "AI accounts")] },
    { label: "What each provider may see", views: [v("aisee", "What each provider may see")], extras: { aisee: ["models"] } },
    { label: "Spend and limits", views: [v("spend", "Spend and limits"), v("usage", "Usage")] },
    { label: "Approvals", views: [v("gate", "Approvals")], extras: { gate: ["def-agents"] } },
    { label: "Review", views: [v("review", "Sampling"), v("incidents", "Incidents")] },
    { label: "Voice", views: [v("voice", "Voice")] },
    { label: "AI use policy", views: [v("aipolicy", "AI use policy"), v("internet", "Internet access"), v("memlearn", "Memory learning")], extras: { memlearn: ["def-memory"] } },
  ] },
  { id: "data", title: "Data", icon: "data", subtitle: "Record types, how long things are kept, backups and export", tabs: [
    { label: "Record types", views: [v("schema", "Record types")], extras: { schema: ["def-data"] } },
    { label: "Labels", views: [v("labels", "Labels")] },
    { label: "Keep and delete", views: [v("retention", "Keep and delete"), v("holds", "Legal holds"), v("erase", "Erase a person")] },
    { label: "Backups", views: [v("backups", "Backups")] },
    { label: "Export", views: [v("export", "Export")] },
  ] },
  { id: "messaging", title: "Messaging", icon: "comms", subtitle: "How the Space sends email and texts", tabs: [
    { label: "Email", views: [v("domains", "Sending domains"), v("inboxes", "Shared inboxes")], extras: { domains: ["def-apps"] } },
    { label: "Phone and texting", views: [v("numbers", "Numbers"), v("texting", "Texting registration")] },
    { label: "Rules", views: [v("sendrules", "Sending rules"), v("dnc", "Do-not-contact list")] },
  ] },
  { id: "apps", title: "Apps", icon: "plug", subtitle: "Connect the tools your team already uses", tabs: [
    { label: "Connected apps", views: [v("apps", "Connected apps"), v("company", "Company sign-in"), v("google", "Google Workspace"), v("microsoft", "Microsoft 365")] },
    { label: "Developers", views: [v("webhooks", "Webhooks"), v("keys", "API keys")] },
  ] },
  { id: "machines", title: "Computers", icon: "server", subtitle: "Every computer and server the Space runs on", tabs: [
    { label: "Overview", views: [v("machines", "Overview")] },
    { label: "Servers", views: [v("servers", "Servers"), v("network", "Address and network"), v("updates", "Updates")] },
    { label: "Agent computers", views: [v("agentcomputers", "Agent computers")] },
    { label: "Diagnostics", views: [v("diagnostics", "Diagnostics"), v("server", "Server logs"), v("speed", "Speed"), v("support", "Support bundle")] },
  ] },
  { id: "security", title: "Security", icon: "filter", subtitle: "Sign-in rules, devices and the audit log", tabs: [
    { label: "Sign-in", views: [v("policies", "Sign-in rules"), v("sessions", "Sessions and devices")] },
    { label: "Access reviews", views: [v("reviews", "Access reviews")], extras: { reviews: ["def-access"] } },
    { label: "Audit log", views: [v("audit", "Audit log")] },
  ] },
  { id: "space", title: "Space", icon: "space", subtitle: "The Space's name, plan and ownership", tabs: [
    { label: "General", views: [v("space", "General")], extras: { space: ["def-advanced"] } },
    { label: "Billing", views: [v("billing", "Billing")] },
    { label: "Transfer or delete", views: [v("spacedel", "Transfer or delete")] },
  ] },
];

/** Pages that went away into another: the old id lands on the new one. The Space defaults land on the page they now sit under. */
export const REDIRECTS: Readonly<Record<string, string>> = (() => {
  const r: Record<string, string> = { computers: "machines", checker: "people", connectors: "apps", connections: "apps", kit: "diagnostics", invites: "requests", runs: "activity" };
  for (const s of SECTIONS) for (const t of s.tabs) for (const [host, defs] of Object.entries(t.extras ?? {})) for (const d of defs) r[d] = host;
  return r;
})();
export const resolve = (id: string): string => REDIRECTS[id] ?? id;

export function sectionOf(page: string): SectionDef | undefined {
  const id = resolve(page);
  return SECTIONS.find((s) => s.tabs.some((t) => t.views.some((x) => x.page === id)));
}
export const tabOf = (page: string): TabDef | undefined => { const id = resolve(page); return sectionOf(id)?.tabs.find((t) => t.views.some((x) => x.page === id)); };

type Visible = (page: PageDef) => boolean;
/** A section's tabs a person may open: a tab shows the views they may open, and goes when none is. */
export function visibleTabs(section: SectionDef, ok: Visible): { tab: TabDef; views: ViewDef[] }[] {
  const out: { tab: TabDef; views: ViewDef[] }[] = [];
  for (const tab of section.tabs) {
    const views = tab.views.filter((x) => { const d = pageById(x.page); return d !== undefined && ok(d); });
    if (views.length > 0) out.push({ tab, views });
  }
  return out;
}
export const visibleSections = (ok: Visible): SectionDef[] => SECTIONS.filter((s) => visibleTabs(s, ok).length > 0);

/** Where a click on a section lands: the page it was last on, else its first page a person may open. */
export function landing(section: SectionDef, ok: Visible, last?: string): string | undefined {
  const tabs = visibleTabs(section, ok);
  if (last && tabs.some((t) => t.views.some((x) => x.page === last))) return last;
  return tabs[0]?.views[0]?.page;
}

/** Names people knew: the search finds them and says where they went. */
export const OLD_NAMES: readonly (readonly [string, string])[] = [
  ["Sessions", "sessions"], ["Sessions and devices", "sessions"], ["Policies", "policies"], ["Groups", "groups"], ["People", "people"], ["Invites", "requests"], ["Permissions", "permissions"], ["Grants", "grants"], ["Roles", "roles"],
  ["Access checker", "checker"], ["Check access", "checker"], ["Infrastructure", "machines"], ["Machines", "machines"], ["Server", "server"], ["Computers", "machines"], ["Agent computers", "agentcomputers"], ["Network", "network"],
  ["Network nodes", "machines"], ["Actors", "actors"], ["Outside actors", "actors"], ["Agent template", "template"], ["Agents register", "agents"], ["Runs", "activity"], ["Schema", "schema"], ["Sensitivity labels", "labels"],
  ["Retention and holds", "retention"], ["Retention", "retention"], ["Holds", "holds"], ["Models and providers", "aiaccounts"], ["Models", "models"], ["Allowed models by label", "aisee"], ["Gate rules", "gate"],
  ["Logging and review", "review"], ["Incidents", "incidents"], ["Kit", "kit"], ["Connectors", "connectors"], ["Connections", "connections"], ["API keys", "keys"], ["Webhooks", "webhooks"], ["Sending domains", "domains"],
  ["Sending rules", "sendrules"], ["Suppression list", "dnc"], ["Shared inboxes", "inboxes"], ["Telephony", "numbers"], ["Texting registration", "texting"], ["Usage", "usage"], ["Space defaults", "space"],
  ["Review schedule", "reviews"], ["Agents and approvals", "gate"], ["Memory", "memlearn"], ["Files and data", "schema"], ["Email and calling", "domains"], ["Advanced", "space"], ["Diagnostics", "diagnostics"],
  ["Support bundle", "support"], ["Speed", "speed"], ["Updates", "updates"], ["Erase a person", "erase"], ["Connect your company", "company"], ["Overview", "overview"],
];

/** The words after an old name in the search: where the page is now. */
export function nowIn(page: string): string {
  const id = resolve(page), s = sectionOf(id), t = tabOf(id);
  if (!s || !t) return "";
  const view = t.views.find((x) => x.page === id);
  return `${s.title}, ${t.label}${t.views.length > 1 && view ? `, ${view.label}` : ""}`;
}
