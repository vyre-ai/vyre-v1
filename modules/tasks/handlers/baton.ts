// The baton tools (work baton, item 2): how whoever holds a work task ends their part. Five calls, each one a move on the one state machine, never a second one:
//   tasks.submit   Assigned: outputs and a one-line summary. Goes to the Reviewer, else the Approver, else Done.
//   tasks.ask      Assigned: a question. An Answer task opens for the requester or a named person, the work waits on it, and the answer wakes the doer.
//   tasks.block    Assigned: a reason. An Unblock task opens for whoever the task escalates to, and the work waits on it.
//   tasks.review   Reviewer: approve, or send back with numbered fixes. After the loop limit the reviewer seat passes to a person, who decides.
//   tasks.decide   Approver: approve (Done, held actions release) or reject with a reason (back to Assigned).
// Every move goes through checkMove and commitMove (handlers/state.ts), so the table of 4.7, the self-review rule, the human-approver rule and the review-loop limit apply exactly as they do to a person.
// What was handed over is written to the task's working notes (outputs, summary, fixes) and as a line in its thread, so the next holder and the people reading the thread see the same words.
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { allTasks, clean, emitTask, getTask, holds, isOpen, out, raise, readPolicy, touch, visibleTo, whoIs } from "../projections.ts";
import type { Assignee, Task, TaskState, TasksCtx } from "../projections.ts";
import { afterReview, checkMove, commitMove, create, dependenciesAdd, label, submitTarget } from "./state.ts";
import { postLine, syncThread } from "./thread.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** Working-note keys the baton uses. The step that made the task writes the first four; the tools write the rest. */
export const NOTE = {
  schema: "output_schema",            // JSON Schema the submitted outputs must match (an AI step's deliverable)
  escalateTo: "baton.escalate_to",    // JSON assignee who gets a blocked task (the step's escalateTo)
  owner: "baton.owner",               // the person behind an automation task: who is asked when nobody else is named
  nudgeMinutes: "baton.nudge_minutes",
  brief: "brief",
  outputs: "outputs",                 // JSON of what the doer submitted
  summary: "summary",
  fixes: "fixes",                     // JSON array of what the reviewer or approver asked to change; cleared by the next submit
  asked: "asked",                     // JSON array of {taskId, question}: questions put to people for this task
} as const;

const LINE_CHARS = 3_500;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const json = <T>(v: string | undefined, fallback: T): T => { if (!v) return fallback; try { return JSON.parse(v) as T; } catch { return fallback; } };
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}...`);

/** A work task the caller may see. The baton is for work tasks; a request (Approve, Review, Answer, Unblock) is answered with tasks.act. */
function workTask(ctx: TasksCtx, id: string): Task {
  const t = getTask(ctx, id);
  if (!visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  if (t.kind !== "work") raise(ctx, "validation.precondition_failed", "The baton is for work tasks. Answer this one with tasks.act.", { reason: "not_work", kind: t.kind });
  return t;
}

/** It is not the caller's turn: say whose it is and what the task is waiting for, so the agent stops instead of trying again. */
function notYourTurn(ctx: TasksCtx, t: Task, want: string): never {
  const holder = t.state === "in_review" ? t.reviewer : t.state === "awaiting_approval" ? t.approver : isOpen(t.state) ? t.assigned : undefined;
  const who = holder ? `${holder.kind} ${holder.id}` : "nobody";
  raise(ctx, "validation.precondition_failed", `This task is ${label(t.state)}, so ${want} is not your move now. It is with ${who}.`, { reason: "not_your_turn", state: t.state });
}

/** The person behind a task, for a question or an escalation nobody named: its creator, the owner of its agent, the owner the step recorded, else a person in a slot. */
function fallbackPerson(t: Task): Assignee | undefined {
  const asked = [t.createdBy, t.responsible, t.workingNotes[NOTE.owner]];
  for (const id of asked) if (typeof id === "string" && id.startsWith("usr_")) return { kind: "person", id };
  for (const a of [t.reviewer, t.approver]) if (a && a.kind === "person") return a;
  return undefined;
}

const numbered = (fixes: readonly string[]): string => fixes.map((f, i) => `${i + 1}. ${f}`).join("\n");

/** The outputs of a submit: an object, matched against the schema the step recorded. A mismatch names the fields, so the doer fixes them and submits again. */
function checkOutputs(ctx: TasksCtx, t: Task, outputs: unknown): Record<string, unknown> {
  if (outputs !== undefined && (typeof outputs !== "object" || outputs === null || Array.isArray(outputs))) {
    raise(ctx, "validation.bad_input", "outputs is an object of named fields.", { errors: ["/outputs: must be an object"] });
  }
  const schema = json<JsonSchema | null>(t.workingNotes[NOTE.schema], null);
  const value = (outputs ?? {}) as Record<string, unknown>;
  if (schema) {
    const problems = validate(schema, value);
    if (problems.length > 0) raise(ctx, "validation.bad_input", `The outputs do not match what this task asks for: ${problems.slice(0, 5).join("; ")}.`, { errors: problems.slice(0, 20), reason: "outputs_mismatch" });
  }
  return value;
}

/** One line in the thread by the person or agent that acted. Failing to write it never undoes the move. */
async function line(ctx: TasksCtx, t: Task, kind: string, body: string): Promise<void> {
  await postLine(ctx, t, cut(body, LINE_CHARS), `${kind}:${t.version}`);
}

// ---- tasks.submit ----

export async function submit(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = workTask(ctx, input.taskId);
  const summary = text(input.summary);
  if (!summary) raise(ctx, "validation.bad_input", "Say in one line what you did.", { errors: ["/summary: required"] });
  if (t.state !== "todo" && t.state !== "doing") notYourTurn(ctx, t, "handing the work in");
  const outputs = checkOutputs(ctx, t, input.outputs);
  const to = submitTarget(t);
  const checked = checkMove(ctx, t, to, { note: summary });
  t.workingNotes = { ...t.workingNotes, [NOTE.outputs]: JSON.stringify(outputs), [NOTE.summary]: summary };
  delete t.workingNotes[NOTE.fixes];
  const applied = commitMove(ctx, t, to, checked);
  const shown = Object.keys(outputs).length > 0 ? `\n\nDeliverable:\n${JSON.stringify(outputs, null, 2)}` : "";
  await line(ctx, t, "submit", `Submitted: ${summary}${shown}`);
  return { task: out(ctx, t), next: to === "in_review" ? "review" : to === "awaiting_approval" ? "approval" : "done", from: applied.from };
}

// ---- tasks.ask and tasks.block ----

/** Open a child task the work waits on. The parent depends on it, so it shows Blocked until the child is Done or Canceled; finishing it wakes the doer again. */
async function openChild(ctx: TasksCtx, t: Task, kind: "answer" | "unblock", title: string, summary: string, to: Assignee): Promise<Task> {
  const made = (await create(ctx, clean({ kind, title: cut(title, 200), summary, assigned: to, parentTaskId: t.id, recordId: t.recordId })) as { task: { id: string } }).task;
  await dependenciesAdd(ctx, { taskId: t.id, dependsOnId: made.id });
  return getTask(ctx, made.id);
}

export async function ask(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = workTask(ctx, input.taskId);
  const question = text(input.question);
  if (!question) raise(ctx, "validation.bad_input", "Write the question.", { errors: ["/question: required"] });
  if (t.state !== "todo" && t.state !== "doing") notYourTurn(ctx, t, "asking");
  if (!holds(t, "assigned", whoIs(ctx))) raise(ctx, "validation.precondition_failed", "Only the person this step belongs to can do that.", { reason: "wrong_actor", action: "ask" });
  const to: Assignee | undefined = input.to ? (input.to as Assignee) : fallbackPerson(t);
  if (!to) raise(ctx, "validation.precondition_failed", "Say who to ask: this task has no person to put a question to.", { reason: "nobody_to_ask" });
  // the same question asked again while it is open is the same question
  const open = allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'answer' AND c.state NOT IN ('done', 'canceled') AND c.summary = ?", t.id, question)[0];
  if (open) return { task: out(ctx, t), answerTaskId: open.id };
  const child = await openChild(ctx, t, "answer", question.split("\n")[0]!, question, to);
  const fresh = getTask(ctx, t.id);
  const asked = json<Array<{ taskId: string; question: string }>>(fresh.workingNotes[NOTE.asked], []);
  fresh.workingNotes = { ...fresh.workingNotes, [NOTE.asked]: JSON.stringify([...asked, { taskId: child.id, question: cut(question, 500) }].slice(-20)) };
  touch(ctx, ctx.db, fresh);
  await syncThread(ctx, fresh);
  await line(ctx, fresh, "ask", `Question for ${to.kind === "person" ? "a person" : to.kind}: ${question}`);
  return { task: out(ctx, fresh), answerTaskId: child.id };
}

export async function block(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = workTask(ctx, input.taskId);
  const reason = text(input.reason);
  if (!reason) raise(ctx, "validation.bad_input", "Say what is in the way.", { errors: ["/reason: required"] });
  if (t.state !== "todo" && t.state !== "doing") notYourTurn(ctx, t, "reporting a block");
  if (!holds(t, "assigned", whoIs(ctx))) raise(ctx, "validation.precondition_failed", "Only the person this step belongs to can do that.", { reason: "wrong_actor", action: "block" });
  const named = json<Assignee | null>(t.workingNotes[NOTE.escalateTo], null);
  const to = named && typeof named.id === "string" ? named : fallbackPerson(t);
  if (!to) raise(ctx, "validation.precondition_failed", "This task has nobody to escalate to.", { reason: "nobody_to_escalate" });
  const open = allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'unblock' AND c.state NOT IN ('done', 'canceled')", t.id)[0];
  if (open) return { task: out(ctx, t), unblockTaskId: open.id };
  const child = await openChild(ctx, t, "unblock", `Blocked: ${reason.split("\n")[0]}`, reason, to);
  const fresh = getTask(ctx, t.id);
  await syncThread(ctx, fresh);
  await line(ctx, fresh, "block", `Blocked: ${reason}`);
  return { task: out(ctx, fresh), unblockTaskId: child.id };
}

// ---- tasks.review ----

export async function review(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = workTask(ctx, input.taskId);
  if (t.state !== "in_review") notYourTurn(ctx, t, "reviewing");
  const verdict = input.verdict;
  if (verdict === "approve") {
    const to = afterReview(t);
    const checked = checkMove(ctx, t, to, { note: text(input.note) || undefined });
    delete t.workingNotes[NOTE.fixes];
    commitMove(ctx, t, to, checked);
    await line(ctx, t, "review", to === "done" ? "Reviewed: looks good. The task is done." : "Reviewed: looks good. It goes to approval.");
    return { task: out(ctx, t), next: to === "done" ? "done" : "approval" };
  }
  if (verdict !== "send_back") raise(ctx, "validation.bad_input", "The verdict is approve or send_back.", { errors: ["/verdict: approve or send_back"] });
  const fixes = (Array.isArray(input.fixes) ? input.fixes : []).map(text).filter((f) => f !== "");
  if (fixes.length === 0) raise(ctx, "validation.precondition_failed", "Send it back with numbered fixes: say exactly what to change.", { reason: "fixes_required" });
  // an agent reviewer that has sent the work back as often as the Space allows hands the decision to a person, who is not held to the limit
  const policy = readPolicy(ctx.db);
  if (ctx.principal.kind !== "person" && t.reviewLoops >= policy.reviewLoopLimit && holds(t, "reviewer", whoIs(ctx))) {
    const person = fallbackPerson(t);
    if (!person) raise(ctx, "validation.precondition_failed", `Work was sent back ${t.reviewLoops} times already. A person decides now.`, { reason: "review_loop_limit", limit: policy.reviewLoopLimit });
    const from = t.reviewer ?? null;
    t.reviewer = person;
    t.workingNotes = { ...t.workingNotes, [NOTE.fixes]: JSON.stringify(fixes) };
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.assigned", t, { slot: "reviewer", to: person, from }, { type: "assigned", by: ctx.principal.id, note: "review loop limit" });
    await syncThread(ctx, t);
    await line(ctx, t, "review", `Sent back ${t.reviewLoops} times already, so a person decides. Open fixes:\n${numbered(fixes)}`);
    return { task: out(ctx, t), next: "person" };
  }
  const note = numbered(fixes);
  const checked = checkMove(ctx, t, "doing", { note });
  t.workingNotes = { ...t.workingNotes, [NOTE.fixes]: JSON.stringify(fixes) };
  commitMove(ctx, t, "doing", checked);
  await line(ctx, t, "review", `Sent back with fixes:\n${note}`);
  return { task: out(ctx, t), next: "fixes" };
}

// ---- tasks.decide ----

export async function decide(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = workTask(ctx, input.taskId);
  if (t.state !== "awaiting_approval") notYourTurn(ctx, t, "deciding");
  const verdict = input.verdict;
  const reason = text(input.reason);
  if (verdict !== "approve" && verdict !== "reject") raise(ctx, "validation.bad_input", "The verdict is approve or reject.", { errors: ["/verdict: approve or reject"] });
  if (verdict === "reject" && !reason) raise(ctx, "validation.precondition_failed", "Say why you reject it, so the work can be fixed.", { reason: "reason_required" });
  const to: TaskState = verdict === "approve" ? "done" : "doing";
  const checked = checkMove(ctx, t, to, { note: reason || undefined });
  if (verdict === "reject") t.workingNotes = { ...t.workingNotes, [NOTE.fixes]: JSON.stringify([reason]) };
  else delete t.workingNotes[NOTE.fixes];
  commitMove(ctx, t, to, checked);
  await line(ctx, t, "decide", verdict === "approve" ? `Approved.${reason ? ` ${reason}` : ""}` : `Not approved: ${reason}`);
  return { task: out(ctx, t), next: verdict === "approve" ? "done" : "fixes" };
}

