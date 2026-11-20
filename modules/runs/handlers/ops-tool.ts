// The one agent-facing call for looking at and steering agent work (r42-runtime): runs_ops, an action, an `id` and the other fields as `args`. The actions and their args are in the runs skill, not in the tool's schema,
// because every tool's schema is paid for in every model's context. It dispatches to the same handlers the app's calls use, so the rules (who may see a tree, who speaks for a node, who may stop it, the spend permission,
// the owner-or-manager rule of Save and Run again) are written once. Saving work as an agent is held at the Gate for an agent (runs.ops_gate).
import { raise } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";
import { activityList, boardAnswerCap, boardListCap, boardPutCap, budgetSet, eventsList } from "./node.ts";
import { messageListCap, messageSendCap, nodeControl, nodeFind, nodeGet, treeFind, treeGet } from "./node.ts";
import { compare, rerun, saveAsAgent } from "./rerun.ts";

type In = Record<string, unknown>;
type H = (ctx: RunsCtx, input: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Kind = "string" | "int" | "bool" | "strings";
interface Action {
  h: H;
  /** what `id` is, and the field of the underlying call it fills */
  id?: { as: string; shape: "run" | "thread" };
  /** args that must be there, and the others that may be, with what each is */
  need?: Readonly<Record<string, Kind>>;
  may?: Readonly<Record<string, Kind>>;
  /** the sentence a wrong first call is answered with: the exact shape, so the next call goes through */
  shape: string;
}

export const ACTIONS: Readonly<Record<string, Action>> = {
  tree: { h: treeGet, id: { as: "runId", shape: "run" }, shape: "{action:'tree', id:<run id>}" },
  tree_find: {
    h: treeFind,
    id: { as: "threadId", shape: "thread" },
    may: { active: "bool", limit: "int" },
    shape: "{action:'tree_find', id:<chat thread id>, args:{active?, limit?}}",
  },
  node: { h: nodeGet, id: { as: "runId", shape: "run" }, shape: "{action:'node', id:<run id>}" },
  node_find: {
    h: nodeFind,
    may: { threadIds: "strings", keys: "strings" },
    shape: "{action:'node_find', args:{threadIds?:[thread ids], keys?:[idempotency keys]}}",
  },
  compare: { h: compare, id: { as: "runId", shape: "run" }, shape: "{action:'compare', id:<run id>}" },
  events: {
    h: eventsList,
    id: { as: "runId", shape: "run" },
    may: { since: "int", limit: "int", only: "string" },
    shape: "{action:'events', id:<run id>, args:{since?, limit?, only?}}",
  },
  messages: {
    h: messageListCap,
    id: { as: "runId", shape: "run" },
    may: { tree: "bool" },
    shape: "{action:'messages', id:<run id>, args:{tree?}}",
  },
  activity: {
    h: activityList,
    may: { scope: "string", limit: "int" },
    shape: "{action:'activity', args:{scope?:'mine'|'all', limit?}}",
  },
  board: {
    h: boardListCap,
    id: { as: "runId", shape: "run" },
    may: { all: "bool" },
    shape: "{action:'board', id:<run id>, args:{all?}}",
  },
  message_send: {
    h: messageSendCap,
    id: { as: "runId", shape: "run" },
    need: { to: "string", body: "string" },
    may: { key: "string" },
    shape: "{action:'message_send', id:<run id of the node that sends>, args:{to:<run id>, body, key?}}",
  },
  board_put: {
    h: boardPutCap,
    id: { as: "runId", shape: "run" },
    need: { kind: "string", text: "string" },
    may: { topic: "string", evidence: "strings" },
    shape:
      "{action:'board_put', id:<run id of the node that writes>, args:{kind:'fact'|'decision'|'question', text, topic?, evidence?:[...]}}",
  },
  board_answer: {
    h: boardAnswerCap,
    id: { as: "runId", shape: "run" },
    need: { entryId: "string", text: "string" },
    shape: "{action:'board_answer', id:<run id of the tree>, args:{entryId, text}}",
  },
  control: {
    h: nodeControl,
    id: { as: "runId", shape: "run" },
    need: { action: "string" },
    may: { reason: "string", subtree: "bool" },
    shape: "{action:'control', id:<run id>, args:{action:'pause'|'resume'|'stop', reason?, subtree?}}",
  },
  rerun: {
    h: rerun,
    id: { as: "runId", shape: "run" },
    may: { goal: "string", instructions: "string", model: "string" },
    shape: "{action:'rerun', id:<finished helper's run id>, args:{goal?, instructions?, model?}} (change at least one)",
  },
  budget: {
    h: budgetSet,
    id: { as: "runId", shape: "run" },
    may: { usdMicros: "int", tokens: "int", clear: "bool" },
    shape: "{action:'budget', id:<run id>, args:{usdMicros?, tokens?, clear?}}",
  },
  save_as_agent: {
    h: saveAsAgent,
    id: { as: "runId", shape: "run" },
    may: { name: "string", role: "string", instructions: "string", sharing: "string" },
    shape:
      "{action:'save_as_agent', id:<finished run id>, args:{name?, role?, instructions?, sharing?:'me'|'everyone'}}",
  },
};

const ID_SHAPE = { run: /^run_[a-z0-9]+$/, thread: /^thr_[a-z0-9]+$/ } as const;
const isKind = (v: unknown, k: Kind): boolean =>
  k === "string"
    ? typeof v === "string" && v !== ""
    : k === "int"
      ? Number.isInteger(v)
      : k === "bool"
        ? typeof v === "boolean"
        : Array.isArray(v) && v.every((x) => typeof x === "string");

async function ops(ctx: RunsCtx, input: unknown): Promise<{ result: unknown }> {
  const i = (input !== null && typeof input === "object" ? input : {}) as In;
  const name = typeof i["action"] === "string" ? i["action"] : "";
  const a = ACTIONS[name];
  if (!a)
    raise(ctx, "validation.bad_input", `Pick one of: ${Object.keys(ACTIONS).join(", ")}.`, {
      field: "action",
    });
  const args = (i["args"] !== null && typeof i["args"] === "object" ? i["args"] : {}) as In;
  const bad = (what: string, field: string): never =>
    raise(ctx, "validation.bad_input", `${name} needs ${a!.shape}. ${what}.`, { field });
  if (a!.id) {
    const id = i["id"];
    if (typeof id !== "string" || !ID_SHAPE[a!.id.shape].test(id))
      bad(
        `\`id\` is the ${a!.id.shape === "run" ? "run" : "chat thread"} id (${a!.id.shape === "run" ? "run_..." : "thr_..."})`,
        "id",
      );
  }
  const call: In = {};
  if (a!.id) call[a!.id.as] = i["id"];
  const missing: string[] = [];
  for (const [k, kind] of Object.entries(a!.need ?? {})) {
    if (!isKind(args[k], kind)) missing.push(k);
    else call[k] = args[k];
  }
  if (missing.length > 0) bad(`Missing or wrong: ${missing.join(", ")}`, "args");
  for (const [k, kind] of Object.entries(a!.may ?? {})) {
    if (args[k] === undefined) continue;
    if (!isKind(args[k], kind)) bad(`${k} is the wrong kind of value`, "args");
    call[k] = args[k];
  }
  return { result: await a!.h(ctx, call) };
}

export const toolHandlers = { "runs.ops": (ctx: RunsCtx, input: unknown) => ops(ctx, input) };
