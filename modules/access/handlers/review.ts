// Access reviews (spec 2.3, 4.8, ARCH 7.10): the quarterly review of who holds what. A review lists the grants that exist when it opens and gives every Manage holder
// one Review task with their share, so each reviewer gets one card, not one per grant. Keep or remove is one click per grant; remove revokes it at once.
import { grantView, nid, page, raise, storeOf } from "../projections.ts";
import type { AccessCtx, AccessStore, GrantRec } from "../projections.ts";
import { adminsOf, approversFor } from "./request.ts";
import type { AskCtx } from "./request.ts";

const DAY_MS = 86_400_000;
const DEFAULT_EVERY_DAYS = 90;
/** A reviewer has two weeks to look at their share. */
const DUE_DAYS = 14;
/** Runs of the quarterly job carry this prefix in their idempotency key; each one schedules the next. */
export const QUARTERLY = "quarterly-";

export interface ReviewCtx extends AskCtx {
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
}

interface ReviewRow { id: string; state: "open" | "closed"; idem_key: string; scope_json: string | null; opened_at: number; opened_by: string; closed_at: number | null }
interface ItemRow { review_id: string; grant_id: string; grant_json: string; reviewer: string; task_id: string | null; last_used_at: number | null; decision: "keep" | "remove" | null; decided_at: number | null }

const reviewById = (ctx: AccessCtx, id: string): ReviewRow | undefined => ctx.db.all(`SELECT * FROM access_reviews WHERE id = ?`, id)[0] as ReviewRow | undefined;
const itemsOf = (ctx: AccessCtx, reviewId: string): ItemRow[] => ctx.db.all(`SELECT * FROM access_review_items WHERE review_id = ?`, reviewId) as ItemRow[];

function reviewOut(r: ReviewRow, items: readonly ItemRow[]) {
  return { id: r.id, state: r.state, openedAt: r.opened_at, ...(r.closed_at !== null ? { closedAt: r.closed_at } : {}), items: items.length, decided: items.filter((i) => i.decision !== null).length };
}

function mustReview(ctx: AccessCtx, id: string): ReviewRow {
  const r = reviewById(ctx, id);
  if (!r) return raise(ctx.trace.traceId, "validation.not_found", "No such access review.");
  return r;
}

/** Who looks at a grant: the owner of the resource, else a Manage holder, else an admin. */
function reviewerOf(ctx: AccessCtx, store: AccessStore, g: GrantRec, fallback: string): string {
  const res = store.resources.get(g.resource.id);
  const owner = res?.ownerId ? store.principals.get(res.ownerId) : undefined;
  if (owner && owner.kind === "person" && owner.status === "active") return owner.id;
  const holder = approversFor(ctx, store, g.resource, "").find((id) => id !== g.subject.id);
  return holder ?? adminsOf(ctx, store)[0] ?? fallback;
}

async function everyDays(ctx: ReviewCtx): Promise<number> {
  try {
    const out = await ctx.call("settings.get", { key: "access.review_every_days" });
    const v = (out && typeof out === "object" ? (out as Record<string, unknown>)["value"] : undefined) ?? out;
    return typeof v === "number" && Number.isInteger(v) && v >= 7 ? v : DEFAULT_EVERY_DAYS;
  } catch {
    return DEFAULT_EVERY_DAYS;
  }
}

export async function reviewsStart(ctx: ReviewCtx, input: { scope?: string[]; idempotencyKey: string }) {
  const store = storeOf(ctx);
  const again = (ctx.db.all(`SELECT * FROM access_reviews`) as ReviewRow[]).find((r) => r.idem_key === input.idempotencyKey);
  if (again) return { review: reviewOut(again, itemsOf(ctx, again.id)) };

  const now = ctx.now();
  const live = [...store.grants.values()]
    .filter((g) => g.conditions.expiresAt === undefined || g.conditions.expiresAt > now)
    .filter((g) => !input.scope || input.scope.length === 0 || input.scope.includes(g.resource.type))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const id = nid("rvw");
  const byReviewer = new Map<string, GrantRec[]>();
  for (const g of live) {
    const who = reviewerOf(ctx, store, g, ctx.principal.id);
    byReviewer.set(who, [...(byReviewer.get(who) ?? []), g]);
  }
  // one Review task per reviewer, holding their whole share
  const taskOf = new Map<string, string>();
  for (const [reviewer, grants] of [...byReviewer].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const made = await ctx.call("tasks.create", {
      kind: "review", title: `Access review: ${grants.length} grant${grants.length === 1 ? "" : "s"} to check`,
      summary: "Keep or remove each grant. Removing takes the access away at once.", why: "Access is reviewed on a schedule so nobody keeps access they no longer need.",
      assigned: { kind: "person", id: reviewer }, source: { kind: "manual", id }, due: now + DUE_DAYS * DAY_MS, idempotencyKey: `${id}:${reviewer}`,
      blocks: [{
        type: "table", v: 1,
        data: { columns: ["Who", "Level", "Resource"], rows: grants.map((g) => [store.principals.get(g.subject.id)?.name ?? g.subject.id, g.level, `${g.resource.type} ${g.resource.id}`]) },
      }],
    });
    const task = made && typeof made === "object" ? (made as Record<string, unknown>)["task"] : undefined;
    const taskId = task && typeof task === "object" ? (task as Record<string, unknown>)["id"] : undefined;
    if (typeof taskId !== "string") return raise(ctx.trace.traceId, "internal.unexpected", "The review task was not created.");
    taskOf.set(reviewer, taskId);
  }
  ctx.db.run(
    `INSERT INTO access_reviews (id, state, idem_key, scope_json, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, ?)`,
    id, "open", input.idempotencyKey, input.scope && input.scope.length > 0 ? JSON.stringify(input.scope) : null, now, ctx.principal.id,
  );
  for (const [reviewer, grants] of byReviewer) {
    for (const g of grants) {
      ctx.db.run(
        `INSERT INTO access_review_items (review_id, grant_id, grant_json, reviewer, task_id) VALUES (?, ?, ?, ?, ?)`,
        id, g.id, JSON.stringify(grantView(g)), reviewer, taskOf.get(reviewer) ?? null,
      );
    }
  }
  ctx.emit("access_review.opened", id, { reviewId: id, items: live.length });
  // the quarterly job continues itself: each run schedules the next
  if (input.idempotencyKey.startsWith(QUARTERLY) && ctx.schedule) {
    const at = now + (await everyDays(ctx)) * DAY_MS;
    await ctx.schedule(at, "access.reviews.start", { idempotencyKey: `${QUARTERLY}${at}` });
  }
  return { review: reviewOut(mustReview(ctx, id), itemsOf(ctx, id)) };
}

export async function reviewsList(ctx: AccessCtx, input: { state?: "open" | "closed"; cursor?: string; limit?: number }) {
  const all = (ctx.db.all(`SELECT * FROM access_reviews`) as ReviewRow[])
    .filter((r) => !input.state || r.state === input.state)
    .sort((a, b) => b.opened_at - a.opened_at || (a.id < b.id ? -1 : 1))
    .map((r) => reviewOut(r, itemsOf(ctx, r.id)));
  const p = page(all, input.cursor, input.limit);
  return { reviews: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function reviewsGet(ctx: AccessCtx, input: { reviewId: string }) {
  const r = mustReview(ctx, input.reviewId);
  const items = itemsOf(ctx, r.id).sort((a, b) => (a.grant_id < b.grant_id ? -1 : 1));
  return {
    review: reviewOut(r, items),
    // the grant as it was when the review opened, so a removed grant still shows what was removed
    items: items.map((i) => ({ grant: JSON.parse(i.grant_json) as unknown, ...(i.last_used_at !== null ? { lastUsedAt: i.last_used_at } : {}), ...(i.decision ? { decision: i.decision } : {}) })),
  };
}

async function finishCard(ctx: ReviewCtx, taskId: string, note: string): Promise<void> {
  try {
    await ctx.call("tasks.transition", { taskId, to: "done", note });
  } catch (e) {
    ctx.log.warn("access review card did not close", { taskId, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function reviewsDecide(ctx: ReviewCtx, input: { reviewId: string; grantId: string; decision: "keep" | "remove" }) {
  const r = mustReview(ctx, input.reviewId);
  if (r.state !== "open") raise(ctx.trace.traceId, "validation.precondition_failed", "This review is closed.");
  const items = itemsOf(ctx, r.id);
  const item = items.find((i) => i.grant_id === input.grantId);
  if (!item) return raise(ctx.trace.traceId, "validation.not_found", "That grant is not part of this review.");
  if (item.decision === input.decision) return { ok: true };
  if (item.decision === "remove") raise(ctx.trace.traceId, "validation.precondition_failed", "That grant was already removed.");

  if (input.decision === "remove") {
    const store = storeOf(ctx);
    const g = store.grants.get(input.grantId);
    if (g) {
      store.grants.delete(g.id);
      store.bump();
      ctx.emit("grant.revoked", g.id, { grantId: g.id, subject: g.subject, resource: g.resource, reason: `access review ${r.id}` });
      ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "assignment", by: ctx.principal.id });
      try { store.persist(ctx.db); } catch (e) { store.grants.set(g.id, g); store.bump(); throw e; }
    }
  }
  ctx.db.run(`UPDATE access_review_items SET decision = ?, decided_at = ? WHERE review_id = ? AND grant_id = ?`, input.decision, ctx.now(), r.id, input.grantId);
  // the reviewer's card is done when their last grant is decided
  const left = items.filter((i) => i.reviewer === item.reviewer && i.grant_id !== input.grantId && i.decision === null).length;
  if (left === 0 && item.task_id) await finishCard(ctx, item.task_id, "Every grant decided");
  return { ok: true };
}

export async function reviewsClose(ctx: ReviewCtx, input: { reviewId: string }) {
  const r = mustReview(ctx, input.reviewId);
  const items = itemsOf(ctx, r.id);
  if (r.state === "closed") return { review: reviewOut(r, items) };
  const now = ctx.now();
  ctx.db.run(`UPDATE access_reviews SET state = ?, closed_at = ? WHERE id = ?`, "closed", now, r.id);
  // undecided grants stay as they are; reviewers who still hold a card lose it
  const pending = new Set(items.filter((i) => i.task_id !== null && i.decision === null).map((i) => i.task_id!));
  for (const taskId of pending) await finishCard(ctx, taskId, "Review closed");
  const removed = items.filter((i) => i.decision === "remove").length;
  ctx.emit("access_review.closed", r.id, { reviewId: r.id, kept: items.length - removed, removed });
  return { review: reviewOut({ ...r, state: "closed", closed_at: now }, items) };
}
