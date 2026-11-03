// Apps place (spec 3.6): the groups of the sidebar, the rows each group lists, and the words on them. Pure, so the sidebar, the list, the menus and the tests agree.
import type { CapMap } from "../../../../../../generated/types.ts";

export type SiteRow = CapMap["sites.list"]["out"]["sites"][number];
export type FormRow = CapMap["forms.list"]["out"]["forms"][number];
export type TemplateRow = CapMap["templates.list"]["out"]["templates"][number];
export type DomainRow = CapMap["mail.domain.list"]["out"]["domains"][number];

export const GROUPS = [
  { key: "sites", title: "Sites", one: "site", empty: "No sites yet. An agent can build and run one for you." },
  { key: "forms", title: "Forms", one: "form", empty: "No forms yet." },
  { key: "templates", title: "Templates", one: "template", empty: "No templates yet." },
  { key: "domains", title: "Sending domains", one: "sending domain", empty: "No sending domain yet." },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];
export const groupOf = (key: GroupKey): (typeof GROUPS)[number] => GROUPS.find((g) => g.key === key)!;

/** One row of any group: what the list draws and what the menu acts on. */
export interface AppRow { group: GroupKey; id: string; title: string; note: string; state?: string; /** Counts shown at the right ("14"). */ count?: string }

const KIND_WORDS = { public: "Public form", one_use: "One-use link", booking: "Booking page", survey: "Survey" } as const;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);

/** "3 min ago", "2 h ago", "4 Nov": short, and no clock that ticks while the list is open. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const STATE_WORD: Readonly<Record<string, string>> = { building: "Deploying", ready: "Live", failed: "Failed", stopped: "Stopped", queued: "Waiting" };
/** One line per site: whether it is up, where, and (for a site Vyre deploys) its last deploy and who started it. */
export function siteRow(s: SiteRow, o: { now?: number; nameOf?: (id: string) => string; me?: string } = {}): AppRow {
  if (!s.deployed) return { group: "sites", id: s.siteId, title: s.name, note: s.blocked ? "Taken down" : s.live ? s.url ?? "Live" : "Not published", state: s.state };
  const last = s.lastDeploy;
  const who = last?.by ? (last.by === o.me ? "you" : o.nameOf?.(last.by) ?? "a teammate") : null;
  const when = last ? `${last.state === "failed" ? "failed" : "deployed"} ${ago(last.finishedAt ?? last.at, o.now ?? Date.now())}${who ? ` by ${who}` : ""}` : "not deployed yet";
  const state = s.blocked ? "Taken down" : STATE_WORD[s.state] ?? s.state;
  const where = s.live && s.url ? s.url.replace(/^https:\/\//, "") : null;
  return { group: "sites", id: s.siteId, title: s.name, note: [state, where, when].filter(Boolean).join(" · "), state: s.state };
}
export function formRow(f: FormRow): AppRow { return { group: "forms", id: f.formId, title: f.name, note: `${KIND_WORDS[f.kind]} · ${cap(f.state)}`, state: f.state, count: plural(f.submissions, "answer") }; }
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
export type RowAction = "publish" | "unpublish" | "install" | "check" | "open";
export function actionsFor(r: AppRow): readonly RowAction[] {
  if (r.group === "forms") return r.state === "published" ? ["open", "unpublish"] : ["open", "publish"];
  if (r.group === "templates") return ["open", "install"];
  if (r.group === "domains") return ["check"];
  return ["open"];
}
export const ACTION_LABEL: Readonly<Record<RowAction, string>> = { publish: "Publish", unpublish: "Unpublish", install: "Install", check: "Check the records", open: "Open" };
/** Actions that need a person's yes first (Gate): publishing makes a form public. */
export const NEEDS_YES: ReadonlySet<RowAction> = new Set<RowAction>(["publish"]);

/** A held call (ARCH 4.6): the capability parked it for approval. */
export function heldOf(out: unknown): { taskId: string } | null {
  const o = out as { status?: string; taskId?: string } | null | undefined;
  return o && o.status === "held" && typeof o.taskId === "string" ? { taskId: o.taskId } : null;
}
