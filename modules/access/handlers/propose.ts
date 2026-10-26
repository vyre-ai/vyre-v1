// access.propose_change (spec 4.8, 2.3; ARCH 4.13): the View-level Ask. A person who may only view an object drafts a change; it is stored and put in front of the people who can edit it as a Review task, and
// nothing is written to the object. The editor decides in the task; applying the change is theirs to do with their own access, so a proposal never carries more authority than the proposer had.
//   who reviews   the people who hold Edit (or more) on the object, never the proposer; when nobody does, the admins. One Review task each, all pointing at one stored proposal.
//   what is kept   the proposal (resource, the change as given, the note, who, when) and the tasks it made. The task shows the note and the change as text.
//   the table     access_proposals, in migrations/0003_requests_reviews.sql.
//   a retry       the same idempotency key answers the same task again and makes nothing new.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { ResourceRef } from "../projections.ts";
import { nid, raise, storeOf } from "../projections.ts";
import { adminsOf, personOf } from "./request.ts";
import type { AskCtx } from "./request.ts";

const MAX_CHANGE = 64_000;
const MAX_NOTE = 2_000;
const SHOWN = 4_000;

const asRow = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The people who may edit the object, other than the proposer: Edit or Manage on it, or on what it sits in. */
function editorsFor(ctx: AskCtx, resource: ResourceRef, proposer: string): string[] {
  const store = storeOf(ctx);
  const snap = store.snapshot();
  const people = [...store.principals.values()].filter((p) => p.kind === "person" && p.status === "active" && p.id !== proposer).map((p) => p.id).sort();
  const editors = people.filter((id) => authorize(snap, { principal: id, action: { perm: null, level: "edit" }, resource, now: ctx.now() }).effect === "allow");
  if (editors.length > 0) return editors;
  return adminsOf(ctx, store).filter((id) => id !== proposer);
}

export async function proposeChange(ctx: AskCtx, input: { resource: ResourceRef; change: unknown; note?: string; idempotencyKey: string }) {
  const proposer = personOf(ctx);
  const tid = ctx.trace.traceId;
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey === "") raise(tid, "validation.bad_input", "An idempotency key is required.");
  const again = ctx.db.all(`SELECT * FROM access_proposals WHERE proposer = ? AND idem_key = ?`, proposer, input.idempotencyKey)[0] as { task_ids_json: string } | undefined;
  if (again) return { taskId: (JSON.parse(again.task_ids_json) as string[])[0] ?? "" };

  const change = JSON.stringify(input.change ?? null);
  if (change === undefined || change === "null") raise(tid, "validation.bad_input", "Say what the change is.");
  if (change.length > MAX_CHANGE) raise(tid, "validation.bad_input", "That change is too large to propose. Send a smaller one.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE) : "";
  const store = storeOf(ctx);
  const rec = store.resources.get(input.resource.id);
  // the pipeline has checked that the proposer may view the object; a resource this host does not know has nothing to propose a change to
  if (input.resource.type !== "space" && (!rec || rec.type !== input.resource.type)) raise(tid, "validation.bad_input", "That object does not exist.");

  const reviewers = editorsFor(ctx, input.resource, proposer);
  if (reviewers.length === 0) raise(tid, "validation.bad_input", "Nobody can review a change to this object.");
  const id = nid("prp");
  const name = store.principals.get(proposer)?.name ?? proposer;
  const row = rec?.row as Record<string, unknown> | undefined;
  const title = (typeof row?.["name"] === "string" && row["name"]) || (typeof row?.["title"] === "string" && row["title"]) || `${input.resource.type} ${input.resource.id}`;
  const shown = change.length > SHOWN ? `${change.slice(0, SHOWN)} ...` : change;
  const taskIds: string[] = [];
  for (const reviewer of reviewers) {
    const made = asRow(await ctx.call("tasks.create", {
      kind: "review", title: `${name} proposes a change to ${title}`, summary: note || "No note.", why: `Proposed change: ${shown}`,
      assigned: { kind: "person", id: reviewer }, source: { kind: "manual", id },
      actions: [{ key: "done", label: "Done, I made the change" }, { key: "decline", label: "Decline", note: "optional" }],
      idempotencyKey: `${id}:${reviewer}`,
    }));
    const taskId = asRow(made?.["task"])?.["id"];
    if (typeof taskId !== "string" || taskId === "") raise(tid, "internal.unexpected", "The task for the proposal was not created.");
    taskIds.push(taskId);
  }
  ctx.db.run(
    `INSERT INTO access_proposals (id, proposer, resource_type, resource_id, change_json, note, idem_key, task_ids_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, proposer, input.resource.type, input.resource.id, change, note || null, input.idempotencyKey, JSON.stringify(taskIds), ctx.now(),
  );
  return { taskId: taskIds[0]! };
}
