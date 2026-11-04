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
export interface SectionDef { id: string; title: string; icon: string; tabs: readonly TabDef[] }

const v = (page: string, label: string): ViewDef => ({ page, label });

export const SECTIONS: readonly SectionDef[] = [
  { id: "overview", title: "Overview", icon: "overview", tabs: [{ label: "Overview", views: [v("overview", "Overview")] }] },
  { id: "access", title: "People and access", icon: "people", tabs: [
    { label: "People", views: [v("people", "People")] },
    { label: "Groups", views: [v("groups", "Groups")] },
    { label: "Permissions", views: [v("permissions", "Permissions"), v("roles", "Roles"), v("grants", "Grants"), v("checker", "Check access")] },
    { label: "Sign-in and sessions", views: [v("policies", "Sign-in rules"), v("sessions", "Sessions and devices")] },
    { label: "Reviews", views: [v("reviews", "Reviews")], extras: { reviews: ["def-access"] } },
  ] },
  { id: "ai", title: "AI", icon: "ai", tabs: [
    { label: "Models", views: [v("models", "Models and providers")] },
    { label: "Spend and usage", views: [v("spend", "Spend and limits"), v("usage", "Usage")] },
    { label: "AI rules", views: [v("aipolicy", "AI use policy"), v("internet", "Internet access"), v("memlearn", "Memory learning")], extras: { memlearn: ["def-memory"] } },
  ] },
  { id: "agents", title: "Agents and skills", icon: "agent", tabs: [
    { label: "Agents", views: [v("agents", "Agents")] },
    { label: "Outside agents", views: [v("actors", "Outside agents")] },
    { label: "Skills and plugins", views: [v("skills", "Skills"), v("plugins", "Plugins and tools")] },
    { label: "Agent template", views: [v("template", "Agent template")] },
  ] },
  { id: "connections", title: "Connections", icon: "plug", tabs: [
    { label: "Connectors", views: [v("connectors", "Connectors"), v("connections", "Connections")] },
    { label: "Company sign-in", views: [v("company", "Set up"), v("google", "Google Workspace"), v("microsoft", "Microsoft 365")] },
    { label: "Webhooks and keys", views: [v("webhooks", "Webhooks"), v("keys", "API keys")] },
    { label: "Email", views: [v("domains", "Sending domains"), v("inboxes", "Shared inboxes")], extras: { domains: ["def-apps"] } },
    { label: "Phone", views: [v("numbers", "Numbers"), v("texting", "Texting registration")] },
  ] },
  { id: "machines", title: "Machines", icon: "server", tabs: [
    { label: "Machines", views: [v("machines", "Machines")] },
    { label: "Logs and checks", views: [v("server", "Server logs"), v("diagnostics", "Diagnostics"), v("speed", "Speed"), v("support", "Support bundle")] },
    { label: "Updates", views: [v("updates", "Updates")] },
  ] },
  { id: "safety", title: "Safety", icon: "filter", tabs: [
    { label: "Gate rules", views: [v("gate", "Gate rules")], extras: { gate: ["def-agents"] } },
    { label: "Reviews and incidents", views: [v("review", "Review sampling"), v("incidents", "Incidents")] },
    { label: "Retention and holds", views: [v("retention", "Retention"), v("holds", "Holds"), v("erase", "Erase a person")] },
    { label: "Audit log", views: [v("audit", "Audit log")] },
  ] },
  { id: "data", title: "Data", icon: "data", tabs: [
    { label: "Schema", views: [v("schema", "Record types"), v("labels", "Sensitivity labels")], extras: { schema: ["def-data"] } },
    { label: "Backups", views: [v("backups", "Backups")] },
  ] },
  { id: "space", title: "Space", icon: "space", tabs: [
    { label: "Identity", views: [v("space", "Space")], extras: { space: ["def-advanced"] } },
    { label: "Address and network", views: [v("network", "Address and network")] },
  ] },
];

/** Pages that went away into another: the old id lands on the new one. The Space defaults land on the page they now sit under. */
export const REDIRECTS: Readonly<Record<string, string>> = (() => {
  const r: Record<string, string> = { computers: "machines" };
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
  ["Sessions", "sessions"], ["Access checker", "checker"], ["Infrastructure", "machines"], ["Server", "server"], ["Computers", "machines"], ["Agent computers", "machines"], ["Network nodes", "machines"],
  ["Actors", "actors"], ["Outside actors", "actors"], ["Policies", "policies"], ["Sending rules", "domains"], ["Shared inboxes", "inboxes"], ["Telephony", "numbers"], ["Usage", "usage"],
  ["Space defaults", "space"], ["Review schedule", "reviews"], ["Agents and approvals", "gate"], ["Memory", "memlearn"], ["Files and data", "schema"], ["Email and calling", "domains"], ["Advanced", "space"],
  ["Grants", "grants"], ["Roles", "roles"], ["Diagnostics", "diagnostics"], ["Support bundle", "support"], ["Speed", "speed"], ["Updates", "updates"], ["Holds", "holds"], ["Retention", "retention"],
  ["Erase a person", "erase"], ["Connect your company", "company"], ["Sensitivity labels", "labels"], ["Incidents", "incidents"],
];

/** The words after an old name in the search: where the page is now. */
export function nowIn(page: string): string {
  const id = resolve(page), s = sectionOf(id), t = tabOf(id);
  if (!s || !t) return "";
  const view = t.views.find((x) => x.page === id);
  return `${s.title}, ${t.label}${t.views.length > 1 && view ? `, ${view.label}` : ""}`;
}
