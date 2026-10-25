// The inbox gaps left by P-L5_08 (spec 2.18 Recipients, Matching; 3.3):
//   1. inbox.recipients_search also returns team members (access.principals.list, people only) and the people who share a project with the caller (projects.list and
//      projects.members.list), ranked with the records, inboxes and groups the base search already finds, and deduped by email.
//   2. The "on its project" reason of the Inbox: a contact reaches the caller when its record is linked to a project the caller is a member of (projects.members.list).
//   3. Matching a sender closes the Needs you task that asked for the match (tasks.transition).
// DECISION: a person principal carries no email in the frozen contract, so a member's address is the address of their personal mailbox (mail.mailbox.list, ownerId). A member
// with no mailbox the caller can see is still offered, without an address, and is not deduped. Where a record and a member share an address the higher score wins and a tie
// goes to the member (the person who works here, not their card).
// DECISION: P-L5_08b may edit only this file and its test, so the handlers below wrap the P-L5_08 ones instead of changing them. modules/inbox/impl.ts (owned by the lead's
// wiring step) maps inbox.recipients_search to recipientsSearchWithMembers, inbox.match to matchClosingTask and inbox.match_new to matchNewClosingTask; the lead's hunk is three lines.
import { bad, codeOf, ensure, first, list, obj, strOrNull, text } from "../projections.ts";
import type { ConversationRow, InboxCtx, Json } from "../projections.ts";
import { match, matchNew } from "./match.ts";
import { recipientsSearch } from "./views.ts";

type Kind = "contact" | "member" | "inbox" | "group";
export interface RecipientHit { kind: Kind; id: string; label: string; address?: string; score: number }

const PAGES = 5;          // at most this many pages of projects are read for one search
const PAGE = 100;
const PROJECT_BOOST = 0.05;

// ---- small readers

const lower = (s: string): string => s.trim().toLowerCase();

function scoreOf(label: string, address: string, q: string): number {
  const l = lower(label);
  const a = lower(address);
  const n = lower(q);
  if (l === n || a === n) return 1;
  if (l.startsWith(n) || a.startsWith(n)) return 0.9;
  if (l.split(/\s+/).some((w) => w.startsWith(n))) return 0.8;
  return l.includes(n) || a.includes(n) ? 0.6 : 0;
}

/** Every page of a list capability, up to a cap, so a long list never hides the caller's rows. */
async function pages(ctx: InboxCtx, cap: string, input: Json, key: string): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const res = obj(await ctx.call(cap, cursor === undefined ? { ...input, limit: PAGE } : { ...input, limit: PAGE, cursor }));
    out.push(...list(res[key]).map(obj));
    cursor = typeof res.next === "string" && res.next ? res.next : undefined;
    if (cursor === undefined) break;
  }
  return out;
}

/** A capability whose module is down or refuses never fails the search: the other kinds still answer. */
async function soft<T>(ctx: InboxCtx, what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    ctx.log.warn(`inbox: ${what} unavailable`, { code: codeOf(e) });
    return fallback;
  }
}

// ---- projects the caller is on

export interface ProjectReach {
  /** project id -> record ids linked to it, for each project the caller is a member of */
  linked: Map<string, Set<string>>;
  /** principal ids that share at least one of those projects with the caller */
  peers: Set<string>;
}

/** The projects the caller is in, by projects.members.list, with the records each links and the people on it. */
export async function projectReach(ctx: InboxCtx): Promise<ProjectReach> {
  ensure(ctx);
  const linked = new Map<string, Set<string>>();
  const peers = new Set<string>();
  const projects = await pages(ctx, "projects.list", { mine: true }, "projects");
  for (const p of projects) {
    const projectId = text(p.projectId);
    if (!projectId) continue;
    const members = list(obj(await ctx.call("projects.members.list", { projectId })).members).map(obj);
    const ids = members.map((m) => text(m.principal));
    if (!ids.includes(ctx.principal.id)) continue;     // listed for the caller but not a member: no reason
    for (const id of ids) if (id && id !== ctx.principal.id) peers.add(id);
    const records = new Set<string>();
    if (text(p.recordId)) records.add(text(p.recordId));
    const overview = obj(await ctx.call("projects.overview", { projectId }));
    for (const l of list(overview.linked).map(obj)) if (text(l.recordId)) records.add(text(l.recordId));
    linked.set(projectId, records);
  }
  return { linked, peers };
}

/** The "project" reason of the Inbox: true when the contact's record is linked to a project the caller is a member of. */
export async function hasProjectReason(ctx: InboxCtx, contactId: string | null, reach?: ProjectReach): Promise<boolean> {
  if (!contactId) return false;
  const r = reach ?? (await soft<ProjectReach>(ctx, "projects", { linked: new Map(), peers: new Set() }, () => projectReach(ctx)));
  for (const records of r.linked.values()) if (records.has(contactId)) return true;
  return false;
}

/** The contact ids that reach the caller by project reason, for a list of candidates (one projects read for all of them). */
export async function projectContacts(ctx: InboxCtx, contactIds: string[]): Promise<Set<string>> {
  const reach = await soft<ProjectReach>(ctx, "projects", { linked: new Map(), peers: new Set() }, () => projectReach(ctx));
  const out = new Set<string>();
  for (const id of contactIds) if (await hasProjectReason(ctx, id, reach)) out.add(id);
  return out;
}

// ---- recipients

/** inbox.recipients_search with team members and project members added, ranked together and deduped by email. */
export async function recipientsSearchWithMembers(
  ctx: InboxCtx, input: { q: string; kinds?: Kind[]; limit?: number },
): Promise<{ results: RecipientHit[] }> {
  ensure(ctx);
  const q = typeof input.q === "string" ? input.q.trim() : "";
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) bad(ctx, "The limit is 1 to 50.");
  const wantMembers = input.kinds === undefined || input.kinds.includes("member");
  // The base search validates q, limit and kinds and answers contacts, inboxes and groups. Ask it for the full cap so dedupe cannot starve the page.
  const base = await recipientsSearch(ctx, { ...input, kinds: (input.kinds ?? ["contact", "member", "inbox", "group"]).filter((k) => k !== "member"), limit: 50 });
  if (!wantMembers) return { results: base.results.slice(0, limit) };

  const hits: RecipientHit[] = base.results.filter((r) => r.kind !== "member");
  const members = await soft<RecipientHit[]>(ctx, "members", [], () => memberHits(ctx, q));
  hits.push(...members);

  // Dedupe by email: the higher score wins, a tie goes to the member.
  const byAddress = new Map<string, RecipientHit>();
  const keep: RecipientHit[] = [];
  for (const h of hits) {
    const key = h.address && h.address.includes("@") ? lower(h.address) : "";
    if (!key) {
      keep.push(h);
      continue;
    }
    const have = byAddress.get(key);
    if (!have) {
      byAddress.set(key, h);
      continue;
    }
    if (h.score > have.score || (h.score === have.score && h.kind === "member" && have.kind !== "member")) byAddress.set(key, h);
  }
  const merged = [...keep, ...byAddress.values()];
  merged.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { results: merged.slice(0, limit) };
}

async function memberHits(ctx: InboxCtx, q: string): Promise<RecipientHit[]> {
  const people = await pages(ctx, "access.principals.list", { kind: "person", status: "active", q }, "principals");
  if (!people.length) return [];
  const boxes = await soft<Json[]>(ctx, "mailboxes", [], () => pages(ctx, "mail.mailbox.list", { scope: "all", kind: "personal" }, "mailboxes"));
  const addressOf = new Map<string, string>();
  for (const b of boxes) {
    const owner = text(b.ownerId);
    const address = text(b.address);
    if (owner && address && !addressOf.has(owner)) addressOf.set(owner, address);
  }
  const reach = await soft<ProjectReach>(ctx, "projects", { linked: new Map(), peers: new Set() }, () => projectReach(ctx));
  const out: RecipientHit[] = [];
  for (const p of people) {
    const id = text(p.id);
    if (!id || id === ctx.principal.id || text(p.kind) !== "person" || text(p.status) === "removed") continue;
    const label = text(p.name) || id;
    const address = addressOf.get(id) ?? "";
    let score = scoreOf(label, address, q);
    if (score <= 0) score = 0.5;           // the access search already judged it a hit on a field this module cannot see (title, role)
    if (reach.peers.has(id)) score = Math.min(1, Math.round((score + PROJECT_BOOST) * 100) / 100);
    out.push(address ? { kind: "member", id, label, address, score } : { kind: "member", id, label, score });
  }
  return out;
}

// ---- closing the Needs you task on a match

/** Close the Needs you task a conversation raised, once the sender has a record. A task already closed, or a task module that is down, never fails the match. */
export async function closeMatchTask(ctx: InboxCtx, conversationId: string): Promise<string | undefined> {
  ensure(ctx);
  const row = first(ctx.db.all(`SELECT "taskId" FROM inbox_match_task WHERE "conversationId" = ?`, conversationId));
  const taskId = strOrNull(row, "taskId");
  if (!taskId) return undefined;
  try {
    await ctx.call("tasks.transition", { taskId, to: "done", note: "Matched to a record." });
  } catch (e) {
    const code = codeOf(e);
    if (code !== "validation.precondition_failed" && code !== "validation.not_found") ctx.log.warn("inbox: could not close Needs a match", { code });
    return undefined;
  }
  return taskId;
}

export async function matchClosingTask(
  ctx: InboxCtx, input: { conversationId: string; recordId: string; rememberAddress?: boolean },
): Promise<{ conversation: ConversationRow; undoToken: string }> {
  const out = await match(ctx, input);
  await closeMatchTask(ctx, input.conversationId);
  return out;
}

export async function matchNewClosingTask(
  ctx: InboxCtx, input: { conversationId: string; type: "contact" | "company"; name?: string },
): Promise<{ recordId: string; conversation: ConversationRow }> {
  const out = await matchNew(ctx, input);
  await closeMatchTask(ctx, input.conversationId);
  return out;
}
