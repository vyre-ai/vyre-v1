// Apps place (spec 3.6): the groups of the sidebar, the rows each group lists, and the words on them. Pure, so the sidebar, the list, the menus and the tests agree.
import type { CapMap } from "../../../../../../generated/types.ts";

export type SiteRow = CapMap["sites.list"]["out"]["sites"][number];
export type FormRow = CapMap["forms.list"]["out"]["forms"][number];
export type CampaignRow = CapMap["campaigns.list"]["out"]["campaigns"][number];
export type TemplateRow = CapMap["templates.list"]["out"]["templates"][number];
export type DomainRow = CapMap["mail.domain.list"]["out"]["domains"][number];

export const GROUPS = [
  { key: "sites", title: "Sites", one: "site", empty: "No sites yet. Ask an agent to build one." },
  { key: "forms", title: "Forms", one: "form", empty: "No forms yet. Make one with New." },
  { key: "campaigns", title: "Campaigns", one: "campaign", empty: "No campaigns yet. Make one with New." },
  { key: "templates", title: "Templates", one: "template", empty: "No templates to install." },
  { key: "domains", title: "Sending domains", one: "sending domain", empty: "No sending domain yet. Add one to send campaigns." },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];
export const groupOf = (key: GroupKey): (typeof GROUPS)[number] => GROUPS.find((g) => g.key === key)!;

/** One row of any group: what the list draws and what the menu acts on. */
export interface AppRow { group: GroupKey; id: string; title: string; note: string; state?: string; /** Counts shown at the right ("14", "3 sent"). */ count?: string }

const KIND_WORDS = { public: "Public form", one_use: "One-use link", booking: "Booking page", survey: "Survey" } as const;
const CAMPAIGN_KIND = { one_time: "One time", sequence: "Sequence", triggered: "Triggered" } as const;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);

export function siteRow(s: SiteRow): AppRow { return { group: "sites", id: s.siteId, title: s.name, note: `${cap(s.kind)} · ${s.productionUrl ? "live" : s.stagingUrl ? "on staging" : s.state}`, state: s.state }; }
export function formRow(f: FormRow): AppRow { return { group: "forms", id: f.formId, title: f.name, note: `${KIND_WORDS[f.kind]} · ${cap(f.state)}`, state: f.state, count: plural(f.submissions, "answer") }; }
export function campaignRow(c: CampaignRow): AppRow { return { group: "campaigns", id: c.campaignId, title: c.name, note: `${CAMPAIGN_KIND[c.kind]} · ${cap(c.state)}`, state: c.state, count: c.sent > 0 ? `${c.sent} sent` : plural(c.audienceCount, "person", "people") }; }
export function templateRow(t: TemplateRow): AppRow { return { group: "templates", id: t.templateId, title: t.title, note: `${cap(t.kind.replace("_", " "))} · v${t.version}`, count: t.adds.length ? `Adds ${t.adds.length}` : "" }; }
export function domainRow(d: DomainRow): AppRow {
  const ok = d.spf === "pass" && d.dkim === "pass" && d.dmarc === "pass";
  return { group: "domains", id: d.id, title: d.name, note: `${cap(d.provider)} · ${d.verified && ok ? "Verified" : d.spf === "pending" || d.dkim === "pending" ? "Checking" : "Needs attention"}${d.isDefault ? " · Default" : ""}`, state: d.verified && ok ? "verified" : "check" };
}

/** The sidebar filter: a row matches when every word of the search is in its title or note. */
export function matches(r: AppRow, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${r.title} ${r.note}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** What a row's menu offers, by group and state. Each is one capability call (see actions.ts). */
export type RowAction = "publish" | "unpublish" | "launch" | "pause" | "resume" | "stop" | "install" | "check" | "open";
export function actionsFor(r: AppRow): readonly RowAction[] {
  if (r.group === "forms") return r.state === "published" ? ["open", "unpublish"] : ["open", "publish"];
  if (r.group === "campaigns") return r.state === "running" ? ["open", "pause", "stop"] : r.state === "paused" ? ["open", "resume", "stop"] : r.state === "draft" || r.state === "scheduled" ? ["open", "launch"] : ["open"];
  if (r.group === "templates") return ["open", "install"];
  if (r.group === "domains") return ["check"];
  return ["open"];
}
export const ACTION_LABEL: Readonly<Record<RowAction, string>> = { publish: "Publish", unpublish: "Unpublish", launch: "Launch", pause: "Pause", resume: "Resume", stop: "Stop", install: "Install", check: "Check the records", open: "Open" };
/** Actions that need a person's yes first (Gate): launching sends mail, publishing makes a form public. */
export const NEEDS_YES: ReadonlySet<RowAction> = new Set<RowAction>(["launch", "publish"]);

/** A held call (ARCH 4.6): the capability parked it for approval. */
export function heldOf(out: unknown): { taskId: string } | null {
  const o = out as { status?: string; taskId?: string } | null | undefined;
  return o && o.status === "held" && typeof o.taskId === "string" ? { taskId: o.taskId } : null;
}
