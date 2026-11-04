// The edit of a held message (lane l-chrome2a). A hold is the exact call that will be made when the person approves, and the approval is bound to a hash of it, so changing what a held message says
// means changing the stored call and making the hash again; the card (a task) changes with it. Only a person who may handle the hold edits it, never the agent that made it, and only what can be said:
// a message, an email, a text, a post. What is sent after Approve is the edited text, and the Gate's event says who edited it.
import { outwardOf, withBody, withTitle } from "../../../lib/outward.ts";
import { getHold, mayHandle, payloadHasher, previewBlocks, raise, reviseHoldInput, sha } from "../projections.ts";
import { actOf } from "../projections.ts";
import type { GateCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export async function holdsRevise(ctx: GateCtx, input: In): Promise<unknown> {
  const h = getHold(ctx, input.holdId);
  if (h.taskId !== input.taskId) raise(ctx, "validation.precondition_failed", "That hold belongs to another task.", { reason: "task_mismatch" });
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Only a person edits what is about to be sent for them.");
  if (!mayHandle(ctx, h)) raise(ctx, "permission.no_grant", "That is not yours to edit.");
  if (h.state !== "held") raise(ctx, "validation.precondition_failed", `This hold is ${h.state} already.`, { reason: "not_held", state: h.state });
  if (h.sendingAt !== undefined) raise(ctx, "validation.precondition_failed", "This is being sent right now.", { reason: "sending" });
  const was = outwardOf(h.capName, h.input);
  if (!was) raise(ctx, "validation.precondition_failed", "Only a message or a calendar event can be edited before it is sent.", { reason: "not_a_message" });
  const body = String(input.body ?? "");
  // a calendar event may have no agenda; a message needs its words
  if (body.trim() === "" && !was!.event) raise(ctx, "validation.precondition_failed", "A message needs words. Use Don't send to stop it.", { reason: "empty" });
  const title = typeof input.title === "string" ? input.title.trim() : undefined;
  if (title !== undefined && (!was!.event || title === "")) raise(ctx, "validation.precondition_failed", "An event needs a title.", { reason: "empty_title" });
  const withWords = withBody(h.capName, h.input, body);
  const next = title !== undefined && withWords ? withTitle(h.capName, withWords, title) : withWords;
  const hash = payloadHasher();
  if (!next || !hash || !ctx.call) raise(ctx, "internal.unavailable", "Editing is not available right now.", { service: "payload_hash" });
  const inputHash = await sha(next);
  const payloadHash = (hash as NonNullable<typeof hash>)(h.capName, h.capVersion, next, h.principal, h.actingFor);
  const at = ctx.now();
  const a = actOf(h.act);
  // the card first: if the task refuses, the hold is as it was
  await (ctx.call as NonNullable<typeof ctx.call>)("tasks.held_revise", { taskId: h.taskId, blocks: previewBlocks(a, h.capName, next, { by: ctx.principal.id, at }, h.id), payloadHash });
  reviseHoldInput(ctx.db, h, next, inputHash, payloadHash);
  ctx.emit("gate.revised", `task/${h.taskId}`, { holdId: h.id, act: h.act, taskId: h.taskId, by: ctx.principal.id, was: outwardOf(h.capName, h.input)?.body ?? "", now: body }, { vis: "participants" });
  return { ok: true, edited: at };
}
