// The AI step (spec 2.12). One turn on the engine (engine.step_turn: the owner's own account for a Personal automation, a Space-shared key for a Space automation, optionally as an agent, no tools),
// then the step's own checks: an output schema the answer must match, and a reviewer or approver who must accept the answer before the Run goes on.
//   the answer   with an output schema the step asks for JSON and validates it; a mismatch fails the step by name and never passes the text on as if it were data.
//   a reviewer   the answer waits as a review task. The turn is kept by the attempt key, so waking the step reads the same answer and asks the model nothing again.
//   two kinds    mode "answer" (the default, above) is one call, no tools, JSON out. Mode "task" is work: it creates a task assigned to the step's agent, with the brief, wakes the agent in the task's thread
//                with its tools, waits for the task to be Done and returns what was submitted. Its Reviewer and Approver are the task's own, and nudgeMinutes and escalateTo say when and to whom a stuck task goes.
//   the brief    the prompt is built by handlers/brief.ts: Goal, Context, Inputs, Deliverable, Done means, Rules, in that order. No key, handle or Vault value is added to it, and a secret-looking value in the data is hidden.
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { stepError } from "../projections.ts";
import { buildBrief, MAX_BRIEF_INPUT } from "./brief.ts";
import type { StepCall, StepEnv, StepNode, StepResult } from "./control.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** The first JSON value in an answer: the whole text, a fenced block, or the first balanced object or list. */
export function jsonIn(answer: string): { ok: true; value: unknown } | { ok: false } {
  const whole = answer.trim();
  const tries: string[] = [whole];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(whole);
  if (fence?.[1]) tries.push(fence[1].trim());
  for (const open of ["{", "["]) {
    const start = whole.indexOf(open);
    if (start < 0) continue;
    const close = open === "{" ? "}" : "]";
    for (let end = whole.lastIndexOf(close); end > start; end = whole.lastIndexOf(close, end - 1)) tries.push(whole.slice(start, end + 1));
  }
  for (const t of tries) {
    try { return { ok: true, value: JSON.parse(t) as unknown }; } catch { /* the next candidate */ }
  }
  return { ok: false };
}

/** The ids of the records the run has read: every object with a `rec_` id in the trigger payload and the earlier outputs. The Space's label rule is asked of these, not of a label the row claims. */
export function recordIdsIn(...sources: unknown[]): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || ids.size >= 200 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Rec;
    if (typeof o["id"] === "string" && /^rec_[a-z0-9]+$/.test(o["id"])) ids.add(o["id"]);
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const s of sources) walk(s, 0);
  return [...ids];
}

/** The brief the model is asked with (handlers/brief.ts): the step's goal, what the Run holds, the inputs, the deliverable, what done means. Built by code, in a fixed order. */
function promptOf(env: StepEnv, cfg: Rec, call: StepCall, title: string): string {
  const prompt = text(cfg["prompt"]);
  if (!prompt) throw stepError("validation.bad_input", `The AI step "${title}" needs a prompt.`, false);
  try {
    return buildBrief({
      kind: "answer", goal: prompt, automation: env.run.automation ?? env.run.label, trigger: call.trigger, outputs: call.outputs, also: [call.item],
      inputs: cfg["inputs"], schema: rec(cfg["outputSchema"]) ? (cfg["outputSchema"] as JsonSchema) : undefined, doneMeans: stringsOf(cfg["doneMeans"]), timeoutMinutes: typeof cfg["timeoutMinutes"] === "number" ? cfg["timeoutMinutes"] : undefined,
    });
  } catch (e) {
    if (e instanceof RangeError) throw stepError("validation.too_large", `The input to the AI step "${title}" is over ${MAX_BRIEF_INPUT} characters.`, false);
    throw e;
  }
}
const stringsOf = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : undefined);

export async function aiStep(env: StepEnv, node: StepNode, input: Rec, call: StepCall): Promise<StepResult> {
  if (!env.ctx.call) throw stepError("internal.unavailable", "AI steps are not available right now.", true);
  const cfg: Rec = { ...(node.ai ?? {}), ...input };
  const title = typeof (node as { title?: unknown }).title === "string" ? String((node as { title?: unknown }).title) : node.id;
  const schema = rec(cfg["outputSchema"]) ? (cfg["outputSchema"] as JsonSchema) : undefined;
  if (cfg["mode"] === "task") return taskStep(env, node, cfg, call, title);
  const turn = (await env.ctx.call("engine.step_turn", {
    prompt: promptOf(env, cfg, call, title),
    ...(text(cfg["agentId"]) ? { agentId: cfg["agentId"] } : {}),
    ...(text(cfg["keyId"]) ? { keyId: cfg["keyId"] } : {}),
    ...(text(cfg["backupKeyId"]) ? { backupKeyId: cfg["backupKeyId"] } : {}),
    ...(typeof cfg["timeoutMinutes"] === "number" ? { timeoutMinutes: cfg["timeoutMinutes"] } : {}),
    ...(recordIdsIn(call.outputs, call.trigger, call.item).length > 0 ? { recordIds: recordIdsIn(call.outputs, call.trigger, call.item) } : {}),
    runId: env.run.id, stepId: node.id, idempotencyKey: call.key,
  })) as { text?: string; keyUsed?: string; modelUsed?: string };
  const answer = typeof turn.text === "string" ? turn.text : "";
  let data: unknown;
  if (schema) {
    const found = jsonIn(answer);
    if (!found.ok) throw stepError("validation.bad_input", `The AI step "${title}" did not answer with JSON, so its output schema could not be checked.`, false);
    const problems = validate(schema, found.value);
    if (problems.length > 0) throw stepError("validation.bad_input", `The AI step "${title}" answered, but the answer does not match its output schema: ${problems.slice(0, 3).join("; ")}.`, false);
    data = found.value;
  }
  const output = { text: answer, ...(data !== undefined ? { data } : {}), keyUsed: turn.keyUsed ?? "", modelUsed: turn.modelUsed ?? "" };

  const reviewer = rec(cfg["reviewer"]) ? cfg["reviewer"] : undefined;
  const approver = rec(cfg["approver"]) ? cfg["approver"] : undefined;
  if (!reviewer && !approver) return { output };
  // the answer waits as a review task; the same key returns the same task, so a woken step finds it again
  const made = (await env.ctx.call("tasks.create", {
    kind: "review", title: `Review the answer of ${title}`, summary: answer.length > 400 ? `${answer.slice(0, 400)}...` : answer,
    assigned: reviewer ?? approver, ...(reviewer ? { reviewer } : {}), ...(approver ? { approver } : {}), source: { kind: "run", id: env.run.id }, idempotencyKey: `${call.key}:review`,
  })) as { task?: { id?: string } };
  const taskId = made?.task?.id;
  if (!taskId) throw stepError("internal.unexpected", "The review task was not created.", true);
  if (!call.resumed) return { wait: { reason: "approval", taskId, on: "a review", cancelOn: ["task.withdrawn"] } };
  const got = (await env.ctx.call("tasks.get", { taskId })) as { task?: { state?: string } };
  const state = got?.task?.state;
  if (state === "done") return { output };
  if (state === "doing" || state === "canceled") throw stepError("step.failed", `A reviewer did not accept the answer of the AI step "${title}".`, false);
  return { wait: { reason: "approval", taskId, on: "a review", cancelOn: ["task.withdrawn"] } };
}

// ---- the agent task kind ----

const assigneeOf = (v: unknown): { kind: string; id: string } | undefined => (rec(v) && text(v["kind"]) && text(v["id"]) ? { kind: String(v["kind"]), id: String(v["id"]) } : undefined);
const firstLine = (s: string, n: number): string => { const l = (s.split("\n").find((x) => x.trim() !== "") ?? s).trim(); return l.length <= n ? l : `${l.slice(0, n - 1)}...`; };
const soft = async (f: () => Promise<unknown>): Promise<void> => { try { await f(); } catch { /* the task goes on without it */ } };

/** The names of the people and agents the brief points at, so it says "Maya reviews" and not an id. A name that cannot be found is left out of the brief. */
async function namesOf(env: StepEnv, ids: Array<string | undefined>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const listed = (await env.ctx.call!("access.principals.list", { limit: 500 })) as { principals?: Array<{ id?: string; name?: string }> };
    for (const p of listed.principals ?? []) if (p.id && p.name && ids.includes(p.id)) out[p.id] = p.name;
  } catch { /* the brief names the seat instead */ }
  return out;
}

/**
 * An agent task. The task carries the brief, what done means and the schema its outputs must match as notes from the start, so the agent that is woken the moment it exists already has them.
 * The same step key finds the same task, so a woken step reads its result instead of making another.
 */
async function taskStep(env: StepEnv, node: StepNode, cfg: Rec, call: StepCall, title: string): Promise<StepResult> {
  const goal = text(cfg["prompt"]);
  if (!goal) throw stepError("validation.bad_input", `The AI step "${title}" needs a prompt.`, false);
  const agentId = text(cfg["agentId"]);
  const assigned = assigneeOf(cfg["assigned"]) ?? (agentId ? { kind: "agent", id: agentId } : undefined);
  if (!assigned) throw stepError("validation.precondition_failed", `The AI step "${title}" is a task and needs someone to do it. Pick an agent.`, false);
  const reviewer = assigneeOf(cfg["reviewer"]);
  const approver = assigneeOf(cfg["approver"]);
  const schema = rec(cfg["outputSchema"]) ? (cfg["outputSchema"] as JsonSchema) : undefined;
  const doneMeans = stringsOf(cfg["doneMeans"]);
  const escalateTo = assigneeOf(cfg["escalateTo"]);
  const minutes = typeof cfg["timeoutMinutes"] === "number" ? cfg["timeoutMinutes"] : undefined;
  const names = await namesOf(env, [reviewer?.id, approver?.id]);
  let brief: string;
  try {
    brief = buildBrief({
      kind: "task", goal, automation: env.run.automation ?? env.run.label, trigger: call.trigger, outputs: call.outputs, also: [call.item], inputs: cfg["inputs"], schema, doneMeans,
      reviewer: reviewer ? names[reviewer.id] ?? `The ${reviewer.kind === "agent" ? "reviewing agent" : "reviewer"}` : undefined, approver: approver ? names[approver.id] ?? `The ${approver.kind === "agent" ? "approving agent" : "approver"}` : undefined,
      timeoutMinutes: minutes,
    });
  } catch (e) {
    if (e instanceof RangeError) throw stepError("validation.too_large", `The input to the AI step "${title}" is over ${MAX_BRIEF_INPUT} characters.`, false);
    throw e;
  }
  const owner = env.ctx.principal.kind === "person" ? env.ctx.principal.id : undefined;
  const notes: Record<string, string> = {
    brief, ...(doneMeans && doneMeans.length > 0 ? { done_means: JSON.stringify(doneMeans) } : {}), ...(schema ? { output_schema: JSON.stringify(schema) } : {}),
    ...(typeof cfg["nudgeMinutes"] === "number" ? { "baton.nudge_minutes": String(cfg["nudgeMinutes"]) } : {}), ...(escalateTo ? { "baton.escalate_to": JSON.stringify(escalateTo) } : {}), ...(owner ? { "baton.owner": owner } : {}),
  };
  const made = (await env.ctx.call!("tasks.create", {
    kind: "work", title: firstLine(goal, 90), summary: firstLine(goal, 300), assigned, ...(reviewer ? { reviewer } : {}), ...(approver ? { approver } : {}),
    ...(minutes ? { due: env.ctx.now() + minutes * 60_000 } : {}), notes, source: { kind: "run", id: env.run.id }, idempotencyKey: `${call.key}:task`,
  })) as { task?: { id?: string; threadId?: string } };
  const taskId = made?.task?.id;
  if (!taskId) throw stepError("internal.unexpected", "The task for the AI step was not created.", true);
  const waiting: StepResult = { wait: { reason: "approval", taskId, on: "the agent's task", cancelOn: ["task.withdrawn"] } };
  if (!call.resumed) {
    // the brief is the first thing in the task's thread, and an unattended task works without asking first (anything that leaves Vyre is still held)
    const threadId = made?.task?.threadId;
    if (threadId) {
      await soft(() => env.ctx.call!("threads.set_mode", { threadId, mode: "auto", idempotencyKey: `${call.key}:mode` }));
      await soft(() => env.ctx.call!("chat.post", { threadId, body: brief, idempotencyKey: `${call.key}:brief` }));
    }
    return waiting;
  }
  const got = (await env.ctx.call!("tasks.get", { taskId })) as { task?: { state?: string; workingNotes?: Record<string, string> } };
  const state = got?.task?.state;
  if (state === "done") {
    const n = got?.task?.workingNotes ?? {};
    let outputs: unknown;
    try { outputs = n["outputs"] ? JSON.parse(n["outputs"]) : undefined; } catch { outputs = undefined; }
    const data = rec(outputs) && (schema || Object.keys(outputs).length > 0) ? outputs : undefined;
    return { output: { text: n["summary"] ?? "", ...(data !== undefined ? { data } : {}), keyUsed: "", modelUsed: "", taskId } };
  }
  if (state === "canceled") throw stepError("step.failed", `The task for the AI step "${title}" was canceled before it was finished.`, false);
  return waiting;
}
