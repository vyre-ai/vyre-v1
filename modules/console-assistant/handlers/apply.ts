// Diff cards: propose, apply, reject (spec 3.10, ARCH 7.10). The assistant only proposes. Apply is a person's act: the steps run through ctx.call as that person,
// so their own permissions decide, and an audit row records the change "on behalf of" the agent that proposed it.
import { BUG_PREFIX, BUG_MESSAGE, PlanError, asRow, changesOf, diffOf, mayRun, ownThread, personOf, planOf, raise, str } from "../projections.ts";
import type { AssistCtx, Change, DiffKind, DiffRec, Step } from "../projections.ts";

interface DiffCard { diffId: string; kind: DiffKind; title: string; changes: Change[]; affects?: string }

export async function propose(ctx: AssistCtx, input: { threadId: string; diff: DiffCard; idempotencyKey?: string }) {
  const thread = ownThread(ctx, input.threadId);
  const d = input.diff;
  const have = diffOf(ctx, d.diffId);
  if (have) {
    // the same card again is the same proposal; another thread's id is taken
    if (have.thread_id !== thread.thread_id) return raise(ctx, "validation.duplicate", "That change id is already used.");
    return { diffId: have.diff_id };
  }
  // a product bug is never a card: the assistant sends a support bundle instead
  if (d.changes.some((c) => c.path.startsWith(BUG_PREFIX))) return raise(ctx, "validation.precondition_failed", BUG_MESSAGE);
  ctx.db.run(
    `INSERT INTO console_assistant_diff (diff_id, thread_id, kind, title, affects, changes_json, proposed_by_kind, proposed_by_id, proposed_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.diffId, thread.thread_id, d.kind, d.title, d.affects ?? null, JSON.stringify(d.changes), ctx.principal.kind, ctx.principal.id, ctx.now(), "proposed",
  );
  ctx.emit("console.change_proposed", d.diffId, { diffId: d.diffId, kind: d.kind, threadId: thread.thread_id });
  return { diffId: d.diffId };
}

function ownDiff(ctx: AssistCtx, diffId: string): DiffRec {
  const d = diffOf(ctx, diffId);
  if (!d) return raise(ctx, "validation.not_found", "No such proposed change.");
  ownThread(ctx, d.thread_id);
  return d;
}

export async function apply(ctx: AssistCtx, input: { diffId: string }) {
  // an agent proposes; only a person applies
  if (ctx.principal.kind !== "person") return raise(ctx, "permission.role_lacks_permission", "Only a person applies a change.");
  const d = ownDiff(ctx, input.diffId);
  if (d.state === "applied") return { applied: true, ...(d.audit_id ? { auditId: d.audit_id } : {}) };
  if (d.state === "rejected") return raise(ctx, "validation.precondition_failed", "This change was rejected.");
  const changes = changesOf(d);
  const behalf = d.proposed_by_kind === "agent" ? { kind: "agent" as const, id: d.proposed_by_id } : undefined;
  let steps: Step[];
  try {
    steps = planOf(d.kind, changes, d.diff_id, d.title);
  } catch (e) {
    if (e instanceof PlanError) return raise(ctx, "validation.precondition_failed", e.message);
    throw e;
  }

  // Without the permission for every step the change cannot run as this person: it goes to the people who hold Manage as a Review task, and nothing is applied.
  if (!mayRun(ctx, steps)) {
    const filed = asRow(await ctx.call("access.propose_change", {
      resource: { type: "space", id: ctx.space }, idempotencyKey: `console-${d.diff_id}`, note: `Proposed in the Console assistant: ${d.title}`,
      change: { diffId: d.diff_id, kind: d.kind, title: d.title, changes },
    }));
    const taskId = str(filed?.["taskId"]);
    const row = asRow(await ctx.call("audit.append", {
      action: "console.change_filed", class: "admin", resource: { type: "space", id: ctx.space },
      ...(behalf ? { onBehalfOf: behalf } : {}), detail: { diffId: d.diff_id, kind: d.kind, title: d.title, taskId },
    }));
    const auditId = str(row?.["auditId"]);
    ctx.db.run(`UPDATE console_assistant_diff SET state = ?, task_id = ?, audit_id = ?, decided_by = ?, decided_at = ? WHERE diff_id = ?`, "filed", taskId ?? null, auditId ?? null, ctx.principal.id, ctx.now(), d.diff_id);
    return { applied: false, ...(auditId ? { auditId } : {}) };
  }

  for (const step of steps) {
    try {
      await step.run(ctx);
    } catch (e) {
      if (e instanceof PlanError) return raise(ctx, "validation.precondition_failed", e.message);
      // a step the target refused stops the rest; the card stays proposed, and applying again repeats only values that are already set
      throw e;
    }
  }
  const row = asRow(await ctx.call("audit.append", {
    action: "console.change_applied", class: "admin", resource: { type: "space", id: ctx.space },
    ...(behalf ? { onBehalfOf: behalf } : {}), detail: { diffId: d.diff_id, kind: d.kind, title: d.title, changes },
  }));
  const auditId = str(row?.["auditId"]);
  ctx.db.run(`UPDATE console_assistant_diff SET state = ?, audit_id = ?, decided_by = ?, decided_at = ? WHERE diff_id = ?`, "applied", auditId ?? null, ctx.principal.id, ctx.now(), d.diff_id);
  ctx.emit("console.change_applied", d.diff_id, { diffId: d.diff_id, kind: d.kind, by: ctx.principal.id, ...(behalf ? { onBehalfOf: behalf.id } : {}) });
  return { applied: true, ...(auditId ? { auditId } : {}) };
}

export async function reject(ctx: AssistCtx, input: { diffId: string; note?: string }) {
  const personId = personOf(ctx);
  const d = ownDiff(ctx, input.diffId);
  if (d.state === "rejected") return { rejected: true };
  if (d.state === "applied") return raise(ctx, "validation.precondition_failed", "This change was already applied.");
  ctx.db.run(`UPDATE console_assistant_diff SET state = ?, note = ?, decided_by = ?, decided_at = ? WHERE diff_id = ?`, "rejected", input.note ?? null, personId, ctx.now(), d.diff_id);
  ctx.emit("console.change_rejected", d.diff_id, { diffId: d.diff_id, by: personId });
  return { rejected: true };
}
