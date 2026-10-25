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
    if (newest) out.push({ kind: "record_change", title: f.title, line: `Changed by ${newest.actor}.`, subject: f.resource, at: newest.at });
  }
  return out;
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
