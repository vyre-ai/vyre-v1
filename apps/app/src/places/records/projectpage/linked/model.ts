// The Linked tab, as plain functions: how links group, how a state reads, who may open a link (through reach, the one access rule), how a pasted address becomes a link, how a rule reads, and the CI rows.
// Nothing here draws or calls; the tab, the sheets and the tests share it.
import type { CapMap } from "../../../../../../../generated/types.ts";
import { hiddenTitle } from "../../../../../../../ui/src/blocks/link-card/state.ts";
import { reach } from "../../../../shell/reach/reach.ts";
import type { Reach, Viewer } from "../../../../shell/reach/reach.ts";

export type Out = CapMap["projects.links.list"]["out"];
export type Link = Out["links"][number];
export type Rule = Out["rules"][number];
export type LinkKind = Link["kind"];
export type Run = CapMap["ci.runs.list"]["out"]["runs"][number];

export const GROUPS = ["Files", "Records", "Code", "Money", "Chats"] as const;
export type Group = (typeof GROUPS)[number];
export type Show = "All" | Group;
export const SHOWS: readonly Show[] = ["All", ...GROUPS];

const GROUP_OF: Readonly<Record<LinkKind, Group>> = {
  file: "Files", url: "Files", artifact: "Files", record: "Records", task: "Records", calendar_event: "Records", chat: "Chats", mail_thread: "Chats",
  "github.pr": "Code", "github.commit": "Code", "ci.run": "Code",
};
/** A record of an invoice type is money; every other record is a record. */
const isMoney = (l: { kind: LinkKind; ref: string }): boolean => l.kind === "record" && /^(invoice|invoices|bill|payment)s?\//i.test(l.ref);
export const groupOf = (l: { kind: LinkKind; ref?: string }): Group => (l.ref !== undefined && isMoney({ kind: l.kind, ref: l.ref }) ? "Money" : GROUP_OF[l.kind]);

/** What each kind is called where a sentence needs it. */
export const KIND_WORD: Readonly<Record<LinkKind, string>> = {
  task: "task", record: "record", calendar_event: "event", file: "file", chat: "chat", mail_thread: "email", "github.pr": "pull request", "github.commit": "commit", "ci.run": "check run", artifact: "page", url: "web link",
};

/** What reach and access.request call the thing a link points at. */
const ITEM_TYPE: Readonly<Record<LinkKind, string>> = {
  task: "task", record: "record", calendar_event: "event", file: "file", chat: "thread", mail_thread: "mail", "github.pr": "pr", "github.commit": "commit", "ci.run": "run", artifact: "site", url: "url",
};
export const itemTypeOf = (l: { kind: LinkKind }): string => ITEM_TYPE[l.kind];

/** Things that live outside Vyre: they open at their own address, and the Space's access rule does not govern them. */
export const isOutside = (l: { kind: LinkKind }): boolean => l.kind === "github.pr" || l.kind === "github.commit" || l.kind === "ci.run" || l.kind === "url";

/** The viewer's level on what a link points at. The Space reads the source as the viewer when it lists links, so a source the viewer cannot open comes back with no name. */
export const levelOf = (l: Link): "view" | "none" => (isOutside(l) || l.label !== undefined ? "view" : "none");

/** The resource access.request names for a link (a record is named type/id in its ref). Null for what lives outside Vyre. */
export function askResource(l: Link): { type: string; id: string } | null {
  if (isOutside(l)) return null;
  if (l.kind === "record") { const i = l.ref.indexOf("/"); return { type: "record", id: i < 0 ? l.ref : l.ref.slice(i + 1) }; }
  const type: Record<string, string> = { task: "task", file: "file", chat: "thread", artifact: "site", calendar_event: "event", mail_thread: "mail_thread" };
  return { type: type[l.kind] ?? l.kind, id: l.ref };
}

/** What the row calls itself: the name, or for what the viewer cannot open only the kind ("A task you don't have access to"), never anything about it. */
export function titleOf(l: Link): string {
  if (levelOf(l) === "none") return hiddenTitle(ITEM_TYPE[l.kind]);
  return l.label ?? l.ref;
}

/** Where a click goes: reach, the one access rule. A link the viewer cannot open still shows a peek, because someone on the project linked it and the viewer is in the project. */
export function reachOf(l: Link, viewer: Viewer): Reach {
  if (isOutside(l)) return { to: "open", where: l.url ?? l.ref, target: { place: "chats" } };
  const id = l.kind === "record" && l.ref.includes("/") ? l.ref.slice(l.ref.indexOf("/") + 1) : l.ref;
  return reach({ kind: "item", type: ITEM_TYPE[l.kind], id, title: titleOf(l), level: levelOf(l), summary: `${hiddenTitle(ITEM_TYPE[l.kind])}.` }, viewer);
}

/** A state as the person reads it: a day the Space wrote as 2025-10-24 is "24 Oct" in their own format (the year only when it is not this one). */
export function stateWords(state: string | undefined, now: number, locale?: string): string | undefined {
  if (state === undefined) return undefined;
  const m = /^(Edited|On) (\d{4})-(\d{2})-(\d{2})$/.exec(state);
  if (!m) return state;
  const at = Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]));
  const year = new Date(at).getUTCFullYear() === new Date(now).getUTCFullYear();
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(year ? {} : { year: "numeric" }), timeZone: "UTC" }).format(at);
  return `${m[1]} ${day}`;
}

export type Tone = "ok" | "bad" | "warn" | "";
/** How a state word is coloured: finished, paid and merged are good; overdue, failed and closed are not. */
export function toneOf(state: string | undefined): Tone {
  if (state === undefined) return "";
  if (/^(paid|merged|passed|finished|done|signed)/i.test(state)) return "ok";
  if (/^(overdue|failed|refused|closed|canceled|in trash)/i.test(state)) return "bad";
  if (/^(draft|waiting|due|queued)/i.test(state)) return "warn";
  return "";
}

/** The line under a link's name: who linked it, and the quiet mark when a rule did. */
export function byLine(l: Link, meId: string, nameOf: (id: string) => string): { by: string; auto: boolean } {
  return { by: `Linked by ${l.addedBy === meId ? "you" : nameOf(l.addedBy)}`, auto: l.source === "rule" };
}

export function filterLinks(links: readonly Link[], show: Show): Link[] {
  return links.filter((l) => show === "All" || groupOf(l) === show);
}

export const countFor = (links: readonly Link[], runs: readonly Run[], show: Show): number =>
  links.filter((l) => show === "All" || groupOf(l) === show).length + (show === "All" || show === "Code" ? runs.length : 0);

/** A pasted address as a link: a pull request or commit on GitHub by its name, any other web address as itself. Null for text that is not an address. */
export function parseAddress(text: string): { kind: LinkKind; ref: string; label?: string; url: string } | null {
  const t = text.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(t)) return null;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (u.hostname === "github.com") {
    const pr = /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/.exec(u.pathname);
    if (pr) return { kind: "github.pr", ref: `${pr[1]}#${pr[2]}`, label: `${pr[1]}#${pr[2]}`, url: t };
    const c = /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/commit\/([0-9a-f]{7,40})/.exec(u.pathname);
    if (c) return { kind: "github.commit", ref: `${c[1]}@${c[2]}`, label: `${c[2]!.slice(0, 7)} in ${c[1]}`, url: t };
  }
  return { kind: "url", ref: t, label: u.hostname.replace(/^www\./, ""), url: t };
}

/** A search hit as a link, or null for what cannot be linked (people, settings, apps). */
export function linkOfHit(h: { kind: string; id: string; title: string; recordType?: string | undefined }): { kind: LinkKind; ref: string; label: string } | null {
  switch (h.kind) {
    case "record": return { kind: "record", ref: h.recordType ? `${h.recordType}/${h.id}` : h.id, label: h.title };
    case "file": return { kind: "file", ref: h.id, label: h.title };
    case "chat": case "channel": return { kind: "chat", ref: h.id, label: h.title };
    case "task": return { kind: "task", ref: h.id, label: h.title };
    default: return null;
  }
}

// ---- rules

export type RuleKind = Rule["kind"];
export const RULE_KINDS: readonly { key: RuleKind; label: string; hint: string; example: string }[] = [
  { key: "repo", label: "Everything from a repository", hint: "Pull requests and checks of owner/repo", example: "vyre-ai/website" },
  { key: "record_filter", label: "Records that match", hint: "A record type, a field and the value it holds", example: "invoice · client = Rivera" },
  { key: "email_domain", label: "Email from an address", hint: "Every thread from this domain", example: "client.com" },
];

export interface RuleForm { kind: RuleKind; repo: string; recordType: string; field: string; equals: string; domain: string }
export const EMPTY_RULE: RuleForm = { kind: "repo", repo: "", recordType: "", field: "", equals: "", domain: "" };

/** What a rule says, in words. */
export function ruleText(r: Pick<Rule, "kind" | "repo" | "recordType" | "field" | "equals" | "domain">): string {
  if (r.kind === "repo") return `Everything from ${r.repo ?? "a repository"}`;
  if (r.kind === "email_domain") return `Email from @${(r.domain ?? "").replace(/^@/, "")}`;
  const t = r.recordType ?? "Records";
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} where ${r.field ?? "a field"} is ${r.equals ?? "a value"}`;
}

/** Why a rule form cannot be added yet, or "" when it can. */
export function ruleProblem(f: RuleForm): string {
  if (f.kind === "repo") return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(f.repo.trim()) ? "" : "Name the repository as owner/repo.";
  if (f.kind === "email_domain") return /^@?[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(f.domain.trim()) ? "" : "Give a domain such as client.com.";
  return f.recordType.trim() !== "" && f.field.trim() !== "" && f.equals.trim() !== "" ? "" : "Give the record type, the field and the value.";
}

/** The body projects.links.rules.set takes for a form. */
export function ruleBody(f: RuleForm): { kind: RuleKind; repo?: string; recordType?: string; field?: string; equals?: string; domain?: string } {
  if (f.kind === "repo") return { kind: "repo", repo: f.repo.trim() };
  if (f.kind === "email_domain") return { kind: "email_domain", domain: f.domain.trim().replace(/^@/, "") };
  return { kind: "record_filter", recordType: f.recordType.trim(), field: f.field.trim(), equals: f.equals.trim() };
}

/** The rule as the list sends it back, as the input the set takes (a rule keeps its id). */
export const ruleInput = (r: Rule): { ruleId: string } & ReturnType<typeof ruleBody> => ({ ruleId: r.ruleId, ...ruleBody({ kind: r.kind, repo: r.repo ?? "", recordType: r.recordType ?? "", field: r.field ?? "", equals: r.equals ?? "", domain: r.domain ?? "" }) });

// ---- CI rows (the runs of a GitHub-linked project)

export type RunLook = "failed" | "passed" | "running" | "waiting" | "stopped";
export function runLook(r: Pick<Run, "state" | "conclusion">): RunLook {
  if (r.state === "failed" || r.state === "refused") return "failed";
  if (r.state === "finished") return r.conclusion !== null && r.conclusion !== "success" ? "failed" : "passed";
  if (r.state === "running" || r.state === "starting") return "running";
  if (r.state === "queued") return "waiting";
  return "stopped";
}
export const RUN_WORD: Readonly<Record<RunLook, string>> = { failed: "Failed", passed: "Passed", running: "Running", waiting: "Waiting", stopped: "Stopped" };

export function secs(n: number): string { return n >= 60 ? `${Math.floor(n / 60)} m ${String(Math.round(n % 60)).padStart(2, "0")} s` : `${Math.round(n)} s`; }
export function agoWords(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
export const dollars = (n: number): string => `$${n < 0.01 && n > 0 ? "0.01" : n.toFixed(2)}`;

/** The line under a run: when, how long, what it cost. */
export function runLine(r: Run, now: number): string {
  const at = r.endedAt ?? r.startedAt ?? r.queuedAt;
  const took = r.startedAt !== null && r.endedAt !== null ? ` · ${secs((r.endedAt - r.startedAt) / 1000)}` : "";
  return `${agoWords(at, now)}${took} · ${dollars(r.costUsd)}`;
}

/** The first failed run, newest first: the one the fix card talks about. */
export const failedRun = (runs: readonly Run[]): Run | null => runs.find((r) => runLook(r) === "failed") ?? null;

/** What the fix card asks the Assistant. */
export const fixAsk = (projectTitle: string, r: Run): string => `@Assistant the checks failed in ${projectTitle} (${r.repo}, ${r.jobName}${r.note ? `: ${r.note}` : ""}). Can you read the run and fix it?`;
