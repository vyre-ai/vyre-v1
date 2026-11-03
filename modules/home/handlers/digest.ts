// The While you were away digest (spec 3.1 Rules, Provisional b2; ARCH 7.1): three lines on top, then at most seven ranked items, written by the person's assistant on a schedule through
// home.write_digest, stored as a `digest` entity (so it reads offline), and reset once seen. "See all" (home.activity) is the full activity for the period.
// DECISION: ranking is by kind in the order of the spec (decisions with Undo, finished work, changes on followed records, routine results, what waits), newest first inside a kind, and a routine
//   shows once. The assistant may send items in any order; the stored list is always the ranked one.
// DECISION: home.digest returns the newest digest the person has not seen, or null: "it resets once seen". Seen digests stay in the table for the sync window.
// DECISION: home.activity is built from the runs of the person (routine results, decisions their agents made: a Run an agent started, each with runs.undo), runs that finished, changes on
//   the records they follow (events.list per followed record) and open tasks that wait on them but are not due today. It is read when asked and never stored.
import {
  MAX_HEADLINE, clean, digestOut, findDigest, idemFind, idemSave, isService, latestUnseen, localDay, mayActFor, me, newId, page, personTz, rankItems, raise, saveDigest,
} from "../projections.ts";
import type { Digest, DigestItem, HomeCtx, ItemKind } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export async function digest(ctx: HomeCtx): Promise<unknown> {
  const d = latestUnseen(ctx.db, me(ctx));
  return { digest: d ? digestOut(d) : null };
}

export async function writeDigest(ctx: HomeCtx, input: In): Promise<unknown> {
  const key = input.idempotencyKey as string | undefined;
  if (key) {
    const have = idemFind(ctx.db, key);
    if (have && findDigest(ctx.db, have)) return { digestId: have };
  }
  if (!mayActFor(ctx, input.person)) raise(ctx, "permission.not_found", "That digest is not yours to write.");
  if (input.periodEnd < input.periodStart) raise(ctx, "validation.bad_input", "The period ends before it starts.", { reason: "bad_period" });
  const headline = (input.headline as string[]).slice(0, MAX_HEADLINE);
  const items = rankItems(input.items as DigestItem[]);
  const now = ctx.now();
  const d: Digest = { id: newId("dgs", now), person: input.person, periodStart: input.periodStart, periodEnd: input.periodEnd, headline, items, builtBy: input.builtBy };
  saveDigest(ctx.db, d, now);
  if (key) idemSave(ctx.db, key, d.id);
  ctx.emit("digest.written", `entity/${d.id}`, { digestId: d.id, person: d.person, periodStart: d.periodStart, periodEnd: d.periodEnd, items: items.length });
  return { digestId: d.id };
}

export async function markSeen(ctx: HomeCtx, input: In): Promise<unknown> {
  const d = findDigest(ctx.db, input.digestId);
  if (!d || !(isService(ctx) || d.person === me(ctx))) raise(ctx, "permission.not_found", "That digest is not available.");
  if (d.seenAt !== undefined) return { ok: true };   // seen already: it stays reset, nothing more to say
  d.seenAt = ctx.now();
  saveDigest(ctx.db, d, d.seenAt);
  ctx.emit("digest.seen", `entity/${d.id}`, { digestId: d.id, person: d.person });
  return { ok: true };
}

// ---- See all ----

interface RunRow { id: string; kind: string; name?: string; owner: string; startedBy: string; status: string; startedAt: number; endedAt?: number; summary?: string }
interface TaskRow { id: string; title: string; state: string; due?: number; updatedAt?: number }
interface EventRow { id: string; type: string; at: number; actor: string; subject?: { type: string; id: string } }

const line = (r: RunRow, fallback: string): string => r.summary ?? fallback;

async function runItems(ctx: HomeCtx, since: number, until: number): Promise<DigestItem[]> {
  const out: DigestItem[] = [];
  const got = (await ctx.call!("runs.list", { scope: "mine", since, limit: 500 })) as { runs?: RunRow[] } | null;
  for (const r of got?.runs ?? []) {
    const at = r.endedAt ?? r.startedAt;
    if (at > until || r.status === "queued" || r.status === "running" || r.status === "waiting") continue;
    const subject = { type: "run", id: r.id };
    if (r.kind === "routine") {
      out.push({ kind: "routine", title: r.name ?? "Routine", line: line(r, r.status === "succeeded" ? "Done." : "Did not finish."), subject, at });
    } else if (r.status !== "succeeded") {
      continue;
    } else if (r.startedBy.startsWith("agt_")) {
      out.push({ kind: "decision", title: r.name ?? "A decision", line: line(r, "Done for you."), subject, at, undo: { cap: "runs.undo", input: { runId: r.id } } });
    } else {
      out.push({ kind: "finished", title: r.name ?? "Work finished", line: line(r, "Finished."), subject, at });
    }
  }
  return out;
}

async function followItems(ctx: HomeCtx, since: number, until: number): Promise<DigestItem[]> {
  const out: DigestItem[] = [];
  const got = (await ctx.call!("follows.list", {})) as { follows?: { resource: { type: string; id: string }; title: string }[] } | null;
  for (const f of (got?.follows ?? []).filter((x) => x.resource.type === "record").slice(0, 50)) {
    const evs = (await ctx.call!("events.list", { types: ["record.updated"], subject: f.resource, from: since, to: until, limit: 20 })) as { events?: EventRow[] } | null;
    const newest = [...(evs?.events ?? [])].sort((a, b) => b.at - a.at)[0];
    if (newest) out.push({ kind: "record_change", title: f.title, line: `Changed by ${await nameOf(ctx, newest.actor)}.`, subject: f.resource, at: newest.at });
  }
  return out;
}

/** A person's or agent's name for a line, never their id: the directory answers, "someone" stands in. */
async function nameOf(ctx: HomeCtx, actor: string): Promise<string> {
  const kind = actor.startsWith("agt_") ? "agent" : actor.startsWith("usr_") ? "person" : null;
  if (!kind || !ctx.call) return kind ? "someone" : actor.startsWith("svc_") ? "an automation" : "someone";
  try {
    const p = (await ctx.call("access.principals.get", { principal: { kind, id: actor } })) as { principal?: { name?: string } } | null;
    const n = p?.principal?.name;
    return n && !/^(usr|agt)_/.test(n) ? n : "someone";
  } catch { return "someone"; }
}

/** The quiet notices that waited for the person (Digest level: an agent past its interrupt cap, a person who joined, a quiet-hours summary), one item each. */
async function noticeItems(ctx: HomeCtx, person: string, since: number, until: number): Promise<DigestItem[]> {
  type Got = { items?: { kind: string; title: string; at: number; subject?: { type: string; id: string }; count?: number }[] } | null;
  let got: Got = null;
  try { got = (await ctx.call!("notifications.digest.collect", { person, since, until })) as Got; } catch { return []; }
  return (got?.items ?? []).filter((n) => n.kind !== "digest.away" && !/\b(usr|agt)_[a-z0-9]+/.test(n.title)).map((n): DigestItem => ({
    kind: "notice", title: n.title, line: NOTICE_LINE[n.kind] ?? "While you were away.", ...(n.subject ? { subject: n.subject } : {}), at: n.at,
  }));
}
const NOTICE_LINE: Record<string, string> = {
  "member.joined": "Joined the Space.", "agent.capped": "Held back so it would not interrupt you.", "notification.capped": "Held back so it would not interrupt you.",
  "agent.task_finished": "Finished.", "mention.thread": "Mentioned you.", "run.failed": "Did not finish.",
};

/** The While you were away digest for the time since `since`, written by Vyre itself (no model): the activity of that period and the notices that waited. Coming back (devices.touch
 * after four hours) and I'm Back (notifications.away.clear) ask for it. Nothing new means no digest, so the row in Chats shows only after an absence that had something in it. */
export async function awayDigest(ctx: HomeCtx, input: In): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The digest is not available right now.");
  const person = me(ctx);
  const since = Number(input.since), until = ctx.now();
  if (!(since < until)) raise(ctx, "validation.bad_input", "The time away must start before now.", { reason: "bad_period" });
  const key = `away:${person}:${since}`;
  const have = idemFind(ctx.db, key);
  if (have && findDigest(ctx.db, have)) return { digestId: have, items: findDigest(ctx.db, have)!.items.length };
  const happened = [...(await runItems(ctx, since, until)), ...(await followItems(ctx, since, until)), ...(await noticeItems(ctx, person, since, until))];
  if (happened.length === 0) return { items: 0 };
  const items = rankItems(happened);
  const n = happened.length;
  const headline = [`${n} ${n === 1 ? "thing" : "things"} happened while you were away.`];
  const decisions = happened.filter((i) => i.kind === "decision").length;
  if (decisions > 0) headline.push(`${decisions} ${decisions === 1 ? "was a decision" : "were decisions"} your agents made, each with Undo.`);
  const d: Digest = { id: newId("dgs", until), person, periodStart: since, periodEnd: until, headline, items, builtBy: "vyre" };
  // a newer digest replaces an unseen older one: the row shows one period, from the first time away
  const older = latestUnseen(ctx.db, person);
  if (older) { d.periodStart = Math.min(older.periodStart, since); older.seenAt = until; saveDigest(ctx.db, older, until); }
  saveDigest(ctx.db, d, until);
  idemSave(ctx.db, key, d.id);
  ctx.emit("digest.written", `entity/${d.id}`, { digestId: d.id, person, periodStart: d.periodStart, periodEnd: d.periodEnd, items: items.length });
  return { digestId: d.id, items: items.length };
}

async function waitingItems(ctx: HomeCtx, until: number): Promise<DigestItem[]> {
  const got = (await ctx.call!("tasks.my_work", { section: "open", limit: 200 })) as { tasks?: TaskRow[] } | null;
  const endOfToday = localDay(ctx.now(), await personTz(ctx)).end;
  // due today or overdue is in Needs you; this is what waits and is not urgent
  return (got?.tasks ?? [])
    .filter((t) => t.state !== "done" && t.state !== "canceled" && (t.due === undefined || t.due >= endOfToday))
    .map((t) => clean({ kind: "waiting" as ItemKind, title: t.title, line: "Waiting on you.", subject: { type: "task", id: t.id }, at: Math.min(t.updatedAt ?? until, until) }));
}

export async function activity(ctx: HomeCtx, input: In): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The activity is not available right now.");
  const until = (input.until as number | undefined) ?? ctx.now();
  const all = [...(await runItems(ctx, input.since, until)), ...(await followItems(ctx, input.since, until)), ...(await waitingItems(ctx, until))];
  const kinds = input.kinds as ItemKind[] | undefined;
  const items = rankItems(kinds ? all.filter((i) => kinds.includes(i.kind)) : all, true);
  const p = page(items, input.cursor, input.limit);
  return clean({ items: p.rows, next: p.next, total: p.total });
}
