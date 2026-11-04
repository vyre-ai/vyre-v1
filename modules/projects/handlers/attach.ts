// Projects, the things a project links to (owner, 4 Nov 2026): records, files, chats, tasks, artifacts, mail threads, calendar events, pull requests, commits, CI runs and web addresses.
// Each link says where it came from (a person, an agent, or a rule). A state adapter per kind answers { state, label, url } live from the source; a source that is down gives the link as it was made.
// Rules link matching new items by themselves (a repository, a record filter, an email domain), with ruleId set. A person unlinking one auto item stores an exception, so it never comes back.
import {
  LINK_KINDS, allRules, attachBy, attachesOf, clean, dropAttach, dropException, emitP, ensure, isException, me, newId, raise, replaceRules, rulesOf, saveAttach, saveException, tolerant, updateSnapshot, visible,
} from "../projections.ts";
import type { Attach, In, LinkKind, ProjectsCtx, Rule, RuleKind, RuleSpec } from "../projections.ts";

export interface Live { state?: string | undefined; label?: string | undefined; url?: string | undefined }
type Port = (ctx: ProjectsCtx, ref: string, snapshot: Attach["snapshot"]) => Promise<Live | undefined>;

const title = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : s);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const day = (ms: unknown): string | undefined => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined);

/** A record's own status field is its state; an invoice-like record with a due date and no paid mark reads Overdue once the date has passed. */
export function recordState(fields: Record<string, unknown>, now: number): string | undefined {
  const status = str(fields["status"]) ?? str(fields["state"]);
  const paid = fields["paid"] === true || (status !== undefined && /paid/i.test(status));
  const due = typeof fields["due"] === "number" ? fields["due"] : typeof fields["due_date"] === "number" ? fields["due_date"] : undefined;
  if (!paid && due !== undefined && due < now && (status === undefined || /sent|open|unpaid|due|issued/i.test(status))) return "Overdue";
  if (paid && (status === undefined || /paid/i.test(status))) return "Paid";
  return status === undefined ? undefined : title(status);
}

/** The state adapters, one per kind. They read the source through its own capability, so what a person may not open is not read for them. */
export const ADAPTERS: Readonly<Record<LinkKind, Port>> = {
  record: async (ctx, ref) => {
    const [type, recordId] = ref.includes("/") ? [ref.slice(0, ref.indexOf("/")), ref.slice(ref.indexOf("/") + 1)] : [undefined, ref];
    const got = await tolerant<{ record?: { id: string; type: string; fields: Record<string, unknown> } }>(ctx, "records.get", { ...(type ? { type } : {}), recordId }, {});
    if (!got.record) return undefined;
    const f = got.record.fields;
    return { state: recordState(f, ctx.now()), label: str(f["title"]) ?? str(f["name"]) ?? str(f["number"]) ?? got.record.id, url: `/records/${got.record.type}/${got.record.id}` };
  },
  file: async (ctx, ref) => {
    const got = await tolerant<{ file?: { fileId: string; name: string; updatedAt?: number; deletedAt?: number } }>(ctx, "files.get", { fileId: ref }, {});
    if (!got.file) return undefined;
    const edited = day(got.file.updatedAt);
    return { state: got.file.deletedAt !== undefined ? "In Trash" : edited ? `Edited ${edited}` : undefined, label: got.file.name, url: `/files/${got.file.fileId}` };
  },
  chat: async (ctx, ref) => {
    const got = await tolerant<{ thread?: { threadId: string; title?: string; archived?: boolean } }>(ctx, "threads.get", { threadId: ref }, {});
    if (!got.thread) return undefined;
    return { state: got.thread.archived === true ? "Archived" : "Open", label: got.thread.title ?? "Chat", url: `/chats/${got.thread.threadId}` };
  },
  task: async (ctx, ref) => {
    const got = await tolerant<{ task?: { id: string; title: string; state: string } }>(ctx, "tasks.get", { taskId: ref }, {});
    return got.task ? { state: title(got.task.state), label: got.task.title, url: `/tasks/${got.task.id}` } : undefined;
  },
  artifact: async (ctx, ref) => {
    const got = await tolerant<{ artifact?: { artifactId?: string; title?: string; updatedAt?: number } }>(ctx, "artifacts.get", { artifactId: ref }, {});
    return got.artifact ? { state: day(got.artifact.updatedAt) ? `Edited ${day(got.artifact.updatedAt)}` : undefined, label: got.artifact.title ?? "Artifact", url: `/artifacts/${ref}` } : undefined;
  },
  mail_thread: async (ctx, ref) => {
    const got = await tolerant<{ subject?: string; messages?: Array<{ at?: number; sentAt?: number }> }>(ctx, "mail.thread.get", { threadId: ref }, {});
    if (got.subject === undefined) return undefined;
    const n = got.messages?.length ?? 0;
    return { state: n > 0 ? `${n} ${n === 1 ? "message" : "messages"}` : undefined, label: got.subject, url: `/inbox/mail/${ref}` };
  },
  calendar_event: async (ctx, ref) => {
    const got = await tolerant<{ event?: { id: string; title: string; startsAt: number; endsAt: number; status: string } }>(ctx, "calendar.get_event", { eventId: ref }, {});
    const e = got.event;
    if (!e) return undefined;
    const now = ctx.now();
    return { state: e.status === "canceled" ? "Canceled" : e.endsAt < now ? "Past" : e.startsAt <= now ? "Now" : `On ${day(e.startsAt)}`, label: e.title, url: `/calendar/${e.id}` };
  },
  "github.pr": async (ctx, ref) => {
    const m = /^([^#]+)#(\d+)$/.exec(ref);
    if (!m) return undefined;
    const got = await tolerant<{ pullRequest?: { title: string; state: string; url: string; draft?: boolean } }>(ctx, "github.pull_request.get", { repo: m[1], number: Number(m[2]), consumer: "linked.prs" }, {});
    const pr = got.pullRequest;
    return pr ? { state: pr.draft === true && pr.state === "open" ? "Draft" : title(pr.state), label: pr.title, url: pr.url } : undefined;
  },
  "github.commit": async (_ctx, ref, snap) => {
    const m = /^([^@]+)@([0-9a-f]{7,40})$/.exec(ref);
    return m ? { state: snap?.state ?? "Pushed", label: snap?.label ?? `${m[2]!.slice(0, 7)} in ${m[1]}`, url: snap?.url ?? `https://github.com/${m[1]}/commit/${m[2]}` } : undefined;
  },
  // a CI run arrives with its own fields (l-ci-runners): the adapter shows them as they were last sent
  "ci.run": async (_ctx, ref, snap) => ({ state: snap?.state ?? "Unknown", label: snap?.label ?? ref, url: snap?.url }),
  url: async (_ctx, ref, snap) => ({ state: snap?.state, label: snap?.label ?? ref, url: ref }),
};

/** A link with what its source says now; the source down gives the link as it was made. */
export async function liveOf(ctx: ProjectsCtx, a: Attach): Promise<Live> {
  let live: Live | undefined;
  try { live = await ADAPTERS[a.kind](ctx, a.ref, a.snapshot); } catch { live = undefined; }
  return { state: live?.state ?? a.snapshot?.state, label: live?.label ?? a.snapshot?.label, url: live?.url ?? a.snapshot?.url };
}

const view = (a: Attach, live: Live) => clean({
  linkId: a.linkId, projectId: a.projectId, kind: a.kind, ref: a.ref, source: a.source, addedBy: a.addedBy, ruleId: a.ruleId, addedAt: a.addedAt, state: live.state, label: live.label, url: live.url,
});
const ruleView = (r: Rule) => clean({ ruleId: r.ruleId, kind: r.kind, repo: r.spec.repo, recordType: r.spec.recordType, field: r.spec.field, equals: r.spec.equals, domain: r.spec.domain, by: r.by, at: r.at });

function checkRef(ctx: ProjectsCtx, kind: LinkKind, ref: string): string {
  const r = ref.trim();
  if (!r || r.length > 500) raise(ctx, "validation.bad_input", "Name what to link.");
  if (kind === "github.pr" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(r)) raise(ctx, "validation.bad_input", "A pull request is named owner/repo#number.", { kind });
  if (kind === "github.commit" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{7,40}$/.test(r)) raise(ctx, "validation.bad_input", "A commit is named owner/repo@sha.", { kind });
  if (kind === "url" && !/^https?:\/\/[^\s]+$/i.test(r)) raise(ctx, "validation.bad_input", "A web address starts with http:// or https://.", { kind });
  return r;
}

// ---- the calls ----

export async function linksList(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const rows = attachesOf(ctx.db, p.projectId, input.kind);
  const links = await Promise.all(rows.map(async (a) => view(a, await liveOf(ctx, a))));
  return { links, rules: rulesOf(ctx.db, p.projectId).map(ruleView) };
}

/** Link something to a project. `source` says who: a person (manual), an agent that may edit the project, or a rule. */
export async function linkIn(ctx: ProjectsCtx, projectId: string, o: { kind: LinkKind; ref: string; source: "manual" | "agent" | "rule"; by: string; ruleId?: string; snapshot?: Attach["snapshot"] }): Promise<Attach | null> {
  if (attachBy(ctx.db, projectId, o.kind, o.ref)) return null;
  const a: Attach = { linkId: newId("lnk", ctx.now()), projectId, kind: o.kind, ref: o.ref, source: o.source, addedBy: o.by, ruleId: o.ruleId, addedAt: ctx.now(), snapshot: o.snapshot };
  if (!saveAttach(ctx.db, a)) return null;
  emitP(ctx, "project.item_linked", projectId, clean({ linkId: a.linkId, kind: a.kind, ref: a.ref, source: a.source, ruleId: a.ruleId, by: a.addedBy }));
  return a;
}

export async function link(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const kind = input.kind as LinkKind;
  if (!LINK_KINDS.includes(kind)) raise(ctx, "validation.bad_input", "That kind of thing cannot be linked.", { kind });
  const ref = checkRef(ctx, kind, String(input.ref ?? ""));
  const snap = clean({ state: str(input.state), label: str(input.label), url: str(input.url) });
  // a person linking by hand brings back an item they once unlinked
  dropException(ctx.db, p.projectId, kind, ref);
  const had = attachBy(ctx.db, p.projectId, kind, ref);
  // the same link sent again with a newer state (a CI run, every change) keeps the latest
  if (had && Object.keys(snap).length > 0) { updateSnapshot(ctx.db, p.projectId, kind, ref, snap); had.snapshot = snap; }
  const made = had ?? (await linkIn(ctx, p.projectId, { kind, ref, source: ctx.principal.kind === "agent" ? "agent" : "manual", by: me(ctx), ...(Object.keys(snap).length ? { snapshot: snap } : {}) }));
  if (!made) raise(ctx, "internal.unexpected", "The link could not be saved.");
  return { link: view(made, await liveOf(ctx, made)) };
}

export async function unlink(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const had = attachBy(ctx.db, p.projectId, input.kind, String(input.ref));
  if (!had) return { removed: false };
  dropAttach(ctx.db, p.projectId, had.kind, had.ref);
  // an item a rule linked never comes back by rule once a person took it off
  if (had.source === "rule") saveException(ctx.db, p.projectId, had.kind, had.ref, me(ctx), ctx.now());
  emitP(ctx, "project.item_unlinked", p.projectId, { linkId: had.linkId, kind: had.kind, ref: had.ref, by: me(ctx) });
  return { removed: true };
}

const RULE_KINDS: readonly RuleKind[] = ["repo", "record_filter", "email_domain"];
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function ruleSpec(ctx: ProjectsCtx, kind: RuleKind, r: In): RuleSpec {
  if (kind === "repo") {
    if (typeof r.repo !== "string" || !REPO.test(r.repo)) raise(ctx, "validation.bad_input", "A repository rule names owner/repo.", { kind });
    return { repo: r.repo };
  }
  if (kind === "email_domain") {
    const d = typeof r.domain === "string" ? r.domain.toLowerCase().replace(/^@/, "") : "";
    if (!DOMAIN.test(d)) raise(ctx, "validation.bad_input", "An email rule names a domain, like client.com.", { kind });
    return { domain: d };
  }
  if (typeof r.recordType !== "string" || r.recordType === "") raise(ctx, "validation.bad_input", "A record rule names the record type.", { kind });
  if ((r.field === undefined) !== (r.equals === undefined)) raise(ctx, "validation.bad_input", "A record filter needs both the field and the value it equals.", { kind });
  return clean({ recordType: r.recordType as string, field: typeof r.field === "string" ? r.field : undefined, equals: typeof r.equals === "string" ? r.equals : undefined });
}

export async function rulesSet(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const list = Array.isArray(input.rules) ? (input.rules as In[]) : [];
  if (list.length > 25) raise(ctx, "validation.bad_input", "A project holds at most 25 rules.");
  const before = rulesOf(ctx.db, p.projectId);
  const keep = new Map(before.map((r) => [r.ruleId, r]));
  const now = ctx.now();
  const next: Rule[] = list.map((r) => {
    const kind = r.kind as RuleKind;
    if (!RULE_KINDS.includes(kind)) raise(ctx, "validation.bad_input", "That kind of rule does not exist.", { kind });
    const spec = ruleSpec(ctx, kind, r);
    const old = typeof r.ruleId === "string" ? keep.get(r.ruleId) : undefined;
    return { ruleId: old?.ruleId ?? newId("rul", now), projectId: p.projectId, kind, spec, by: old?.by ?? me(ctx), at: old?.at ?? now };
  });
  replaceRules(ctx.db, p.projectId, next);
  // items a removed rule linked stay linked (they are in the project now); they become manual-looking only in the sense that no rule owns them
  emitP(ctx, "project.link_rules_set", p.projectId, { rules: next.length, by: me(ctx) });
  return { rules: next.map(ruleView) };
}

// ---- rules at work ----

/** A new item as the events that announce it carry it. */
export type Item =
  | { kind: "github.pr"; ref: string; repo: string }
  | { kind: "github.commit"; ref: string; repo: string }
  | { kind: "ci.run"; ref: string; repo: string; state?: string; label?: string; url?: string }
  | { kind: "record"; ref: string; recordType: string; fields: Record<string, unknown> }
  | { kind: "mail_thread"; ref: string; fromDomain: string };

/** Does the rule take this item? */
export function ruleTakes(rule: Rule, item: Item): boolean {
  const s = rule.spec;
  switch (rule.kind) {
    case "repo": return (item.kind === "github.pr" || item.kind === "github.commit" || item.kind === "ci.run") && s.repo !== undefined && item.repo.toLowerCase() === s.repo.toLowerCase();
    case "record_filter":
      return item.kind === "record" && item.recordType === s.recordType && (s.field === undefined || String(item.fields[s.field] ?? "") === s.equals);
    case "email_domain": return item.kind === "mail_thread" && s.domain !== undefined && (item.fromDomain === s.domain || item.fromDomain.endsWith(`.${s.domain}`));
  }
}

/** Link a new item to every project with a rule that takes it, unless a person unlinked it from that project before. Answers the links made. */
export async function offer(ctx: ProjectsCtx, item: Item): Promise<Attach[]> {
  ensure(ctx.db);
  const made: Attach[] = [];
  const done = new Set<string>();
  for (const rule of allRules(ctx.db)) {
    if (done.has(rule.projectId) || !ruleTakes(rule, item)) continue;
    done.add(rule.projectId);
    if (isException(ctx.db, rule.projectId, item.kind, item.ref)) continue;
    const snapshot = item.kind === "ci.run" ? clean({ state: item.state, label: item.label, url: item.url }) : undefined;
    const a = await linkIn(ctx, rule.projectId, { kind: item.kind, ref: item.ref, source: "rule", by: rule.by, ruleId: rule.ruleId, ...(snapshot && Object.keys(snapshot).length ? { snapshot } : {}) });
    if (a) made.push(a);
  }
  return made;
}

/** The item an event announces, or null when it is none a rule can take. */
export async function itemOf(ctx: ProjectsCtx, ev: { name: string; payload: Record<string, unknown> }): Promise<Item | null> {
  const p = ev.payload;
  const repo = str(p["repo"]);
  switch (ev.name) {
    case "pull_request.opened": return repo && typeof p["number"] === "number" ? { kind: "github.pr", ref: `${repo}#${p["number"]}`, repo } : null;
    case "repo.pushed": return repo && str(p["sha"]) ? { kind: "github.commit", ref: `${repo}@${p["sha"]}`, repo } : null;
    case "record.created": return str(p["recordId"]) && str(p["type"]) ? { kind: "record", ref: `${p["type"]}/${p["recordId"]}`, recordType: String(p["type"]), fields: (p["fields"] as Record<string, unknown>) ?? {} } : null;
    case "mail.received": {
      const from = str(p["from"]);
      const domain = from?.includes("@") ? from.slice(from.lastIndexOf("@") + 1).toLowerCase() : undefined;
      if (!domain || !str(p["messageId"])) return null;
      const msg = await tolerant<{ message?: { threadId?: string } }>(ctx, "mail.message.get", { messageId: p["messageId"] }, {});
      return { kind: "mail_thread", ref: msg.message?.threadId ?? String(p["messageId"]), fromDomain: domain };
    }
    default: return null;
  }
}
