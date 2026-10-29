// The AI step (spec 2.12). One turn on the engine (engine.step_turn: the owner's own account for a Personal automation, a Space-shared key for a Space automation, optionally as an agent, no tools),
// then the step's own checks: an output schema the answer must match, and a reviewer or approver who must accept the answer before the Run goes on.
//   the answer   with an output schema the step asks for JSON and validates it; a mismatch fails the step by name and never passes the text on as if it were data.
//   a reviewer   the answer waits as a review task. The turn is kept by the attempt key, so waking the step reads the same answer and asks the model nothing again.
//   no secret    the prompt is the step's text and its mapped input. No key, handle or Vault value is added to it, and none comes back.
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { stepError } from "../projections.ts";
import type { StepCall, StepEnv, StepNode, StepResult } from "./control.ts";

type Rec = Record<string, unknown>;
const MAX_INPUT_CHARS = 100_000;
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

function promptOf(cfg: Rec, title: string): string {
  const prompt = text(cfg["prompt"]);
  if (!prompt) throw stepError("validation.bad_input", `The AI step "${title}" needs a prompt.`, false);
  const parts = [prompt];
  if (cfg["inputs"] !== undefined && cfg["inputs"] !== null) {
    let data = JSON.stringify(cfg["inputs"], null, 2);
    if (data.length > MAX_INPUT_CHARS) throw stepError("validation.too_large", `The input to the AI step "${title}" is over ${MAX_INPUT_CHARS} characters.`, false);
    parts.push(`Input data:\n${data}`);
    data = "";
  }
  if (cfg["outputSchema"] !== undefined && cfg["outputSchema"] !== null) {
    parts.push(`Answer with one JSON value only, no other text, that matches this JSON Schema:\n${JSON.stringify(cfg["outputSchema"])}`);
  }
  return parts.join("\n\n");
}

export async function aiStep(env: StepEnv, node: StepNode, input: Rec, call: StepCall): Promise<StepResult> {
  if (!env.ctx.call) throw stepError("internal.unavailable", "AI steps are not available right now.", true);
  const cfg: Rec = { ...(node.ai ?? {}), ...input };
  const title = typeof (node as { title?: unknown }).title === "string" ? String((node as { title?: unknown }).title) : node.id;
  const schema = rec(cfg["outputSchema"]) ? (cfg["outputSchema"] as JsonSchema) : undefined;
  const turn = (await env.ctx.call("engine.step_turn", {
    prompt: promptOf(cfg, title),
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
