// Save as agent, re-run with a changed brief, and the two side by side (r42-runtime slice 7). All three are for the owner of the work or a manager of runs: a brief, a result and a cost are not for someone who only watches the chat.
//   save_as_agent  a finished node's brief, model and tools become a new agent, made by agents.create as the person who asks (its own permission; an agent asking needs the person's ok, which the Gate holds)
//   rerun          a finished helper is started again beside the first, with an edited brief; both are kept
//   compare        the first and every re-run side by side: brief, result, cost, time
import { raise } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";
import { canSee, mayManage } from "../projections.ts";
import { findNode, getNode, isTerminal, nodesOfThread, rearmDependents, startNode } from "../node.ts";
import type { Node } from "../node.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Brief = { goal?: string; instructions?: string };

const MAX_TEXT = 4000;

type RerunEntry = { seq: number; at: number; goal?: string; instructions?: string; model?: string; threadId?: string };
type SaveEntry = { seq: number; at: number; name?: string; instructions?: string };
type Origin = {
  rerunSeq?: number;
  reruns?: RerunEntry[];
  saveSeq?: number;
  saves?: SaveEntry[];
  [k: string]: unknown;
};
/**
 * Change a node's origin in one step, from what is stored NOW: the read and the write have no await between them, so two presses at once cannot lose each other's entry. The counters only go up, so a key made from one
 * is never made again (a list that is cut to its last entries does not reuse a number).
 */
function editOrigin<T>(ctx: RunsCtx, id: string, f: (o: Origin) => T): T {
  const o = { ...((getNode(ctx, id).origin as Origin | undefined) ?? {}) };
  const out = f(o);
  ctx.db.run("UPDATE runs_node SET origin_json = ?, updated_at = ? WHERE run_id = ?", JSON.stringify(o), ctx.now(), id);
  return out;
}
const cut = (s: string, n = MAX_TEXT): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The node, for someone who may see all of it (not a watcher): a brief and a result are not shown to one. */
function fullNode(ctx: RunsCtx, id: string, manage: boolean): Node {
  const n = getNode(ctx, id);
  const root = n.id === n.rootRun ? n : (findNode(ctx.db, n.rootRun) ?? n);
  if (!canSee(ctx, { id: root.id, owner: root.owner, startedBy: root.startedBy }))
    raise(ctx, "permission.not_found", "That run is not available.");
  if (manage && !mayManage(ctx, { id: n.id, owner: n.owner }))
    raise(ctx, "permission.role_lacks_permission", "Only the owner or someone who manages runs can do that.", {
      reason: "manage_required",
    });
  return n;
}

const finished = (ctx: RunsCtx, n: Node): void => {
  if (!isTerminal(n.status))
    raise(ctx, "validation.precondition_failed", "That work is still going. Wait for it to finish.", {
      reason: "not_finished",
    });
};

/** What the work was asked to do: the node's own brief, else for a helper the first message of its thread (what the agent told it). */
async function briefOf(ctx: RunsCtx, n: Node): Promise<Brief | undefined> {
  const b = n.brief as Brief | undefined;
  if (b && typeof b === "object" && (typeof b.goal === "string" || typeof b.instructions === "string"))
    return {
      ...(typeof b.goal === "string" ? { goal: b.goal } : {}),
      ...(typeof b.instructions === "string" ? { instructions: b.instructions } : {}),
    };
  if (n.threadId !== undefined && (n.kind === "helper" || n.kind === "crew")) {
    try {
      const r = (await ctx.call?.("chat.messages.list", { threadId: n.threadId, after: 0, limit: 1 })) as
        | { messages?: Array<{ body?: string }> }
        | undefined;
      const body = r?.messages?.[0]?.body;
      if (typeof body === "string" && body.trim() !== "")
        return { ...(n.name ? { goal: n.name } : {}), instructions: cut(body) };
    } catch {
      /* no first message to read */
    }
  }
  return undefined;
}

const textOf = (b: Brief): string => [b.goal, b.instructions].filter((x) => x && x.trim() !== "").join("\n\n");

/** A node's brief, model and tools become a new agent. */
export async function saveAsAgent(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = fullNode(ctx, input.runId, true);
  finished(ctx, n);
  const brief = await briefOf(ctx, n);
  // what the person edited in the Save form is what the agent is told; else the work's own brief
  const edited = typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (edited === "" && (!brief || textOf(brief).trim() === ""))
    raise(ctx, "validation.precondition_failed", "That work has no written brief to save.", { reason: "no_brief" });
  const name = String(input.name ?? "").trim() || (n.name ?? brief?.goal ?? "").slice(0, 60).trim();
  if (name === "") raise(ctx, "validation.bad_input", "Give the agent a name.");
  // the limits the helper's tools had when it began (recorded by the engine at its start). Only someone who manages the agent it ran as may carry them over: its allowed list is what it was given, so it is copied only for them, and
  // a person with fewer rights gets the default tools. What it was denied is always carried (it only narrows).
  const tools = (n.policy as { tools?: { allowed?: unknown; denied?: unknown } } | undefined)?.tools;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const mayCarry =
    n.whoId !== undefined &&
    ctx.authorize?.({ perm: null, level: "manage" }, { type: "agent", id: n.whoId }).effect === "allow";
  const carried = tools ? { allowed: mayCarry ? strs(tools.allowed) : [], denied: strs(tools.denied) } : undefined;
  const role = (input.role ? String(input.role) : (brief?.goal ?? n.name ?? "").split("\n")[0]!).trim().slice(0, 200);
  const wantText = cut(edited !== "" ? edited : textOf(brief!));
  // the same save again (the same name and words) is the one made already; another is another agent: the key is a number kept on the work that is never used twice, found by comparing what was kept, not by a mark of it
  const seq = editOrigin(ctx, n.id, (o) => {
    const saves = o.saves ?? [];
    const found = saves.find((x) => (x.name ?? "") === name && (x.instructions ?? "") === wantText);
    if (found) return found.seq;
    o.saveSeq = (o.saveSeq ?? 0) + 1;
    o.saves = [...saves, { seq: o.saveSeq, at: ctx.now(), name, instructions: wantText }].slice(-20);
    return o.saveSeq;
  });
  const made = (await ctx.call?.("agents.create", {
    name,
    ...(role !== "" ? { role } : {}),
    ...(n.model ? { model: n.model } : {}),
    instructions: wantText,
    idempotencyKey: `save:${n.id}:${seq}`,
    ...(carried ? { tools: carried } : {}),
    ...(input.sharing ? { sharing: input.sharing } : {}),
  })) as { agent?: unknown } | undefined;
  if (!made?.agent) raise(ctx, "internal.unexpected", "The agent was not made.");
  return {
    agent: made.agent,
    runId: n.id,
    toolsCarried: tools === undefined ? "default" : mayCarry ? "kept" : "narrowed",
  };
}

/** Start a finished helper again beside the first with an edited brief; the first stays as it was. */
export async function rerun(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = fullNode(ctx, input.runId, true);
  finished(ctx, n);
  if (n.kind !== "helper" || n.threadId === undefined)
    raise(ctx, "validation.precondition_failed", "Only a helper can be started again with another brief.", {
      reason: "not_a_helper",
    });
  const was = (await briefOf(ctx, n)) ?? {};
  const next: Brief = {
    ...(typeof input.goal === "string" && input.goal.trim() !== ""
      ? { goal: input.goal.trim() }
      : was.goal
        ? { goal: was.goal }
        : {}),
    ...(typeof input.instructions === "string" && input.instructions.trim() !== ""
      ? { instructions: input.instructions.trim() }
      : was.instructions
        ? { instructions: was.instructions }
        : {}),
  };
  if (textOf(next) === textOf(was) && (input.model === undefined || input.model === n.model))
    raise(ctx, "validation.bad_input", "Change the brief or the model, or there is nothing to compare.", {
      reason: "nothing_changed",
    });
  // the same press again (the same goal, instructions and model from the same work) is the one already started, not another: compared as they were kept. Reserved before anything is started, in one step, so two presses at once
  // find each other: the second takes the first's number, and the chat's own idempotency answers both with the one helper
  const model = input.model ?? n.model ?? "";
  const mine = editOrigin(ctx, n.id, (o) => {
    const list = o.reruns ?? [];
    const found = list.find(
      (r) =>
        (r.goal ?? "") === (next.goal ?? "") &&
        (r.instructions ?? "") === (next.instructions ?? "") &&
        (r.model ?? "") === model,
    );
    if (found) return found;
    o.rerunSeq = (o.rerunSeq ?? 0) + 1;
    const entry: RerunEntry = {
      seq: o.rerunSeq,
      at: ctx.now(),
      ...(next.goal !== undefined ? { goal: next.goal } : {}),
      ...(next.instructions !== undefined ? { instructions: next.instructions } : {}),
      model,
    };
    o.reruns = [...list, entry].slice(-20);
    return entry;
  });
  if (mine.threadId !== undefined) return { threadId: mine.threadId, rerunOf: n.id };
  const parent = n.parentRun === undefined ? undefined : findNode(ctx.db, n.parentRun);
  const parentThread = parent?.threadId;
  if (parentThread === undefined)
    raise(ctx, "validation.precondition_failed", "That helper has no chat to start the new one in.", {
      reason: "no_parent_chat",
    });
  const started = (await ctx.call?.("chat.helper.start", {
    threadId: parentThread,
    title: (next.goal ?? n.name ?? "Helper").split("\n")[0]!.slice(0, 120),
    instruction: next.instructions ?? next.goal ?? "",
    ...(n.whoId ? { agentId: n.whoId } : {}),
    ...((input.model ?? n.model) ? { model: input.model ?? n.model } : {}),
    idempotencyKey: `rerun:${n.id}:${mine.seq}`,
  })) as { helper?: { threadId?: string } } | undefined;
  const threadId = started?.helper?.threadId;
  if (!threadId) raise(ctx, "internal.unexpected", "The helper was not started.");
  // the link lives on the first node: the threads of what was started again from it, in order (the entry reserved above gets its thread)
  editOrigin(ctx, n.id, (o) => {
    const e = (o.reruns ?? []).find((r) => r.seq === mine.seq);
    if (e) e.threadId = threadId!;
  });
  // its node stands from now. A re-run's tools are those of the first one's agent (chat.helper.start is given that agent and no tools of its own, and this capability takes no tool input), so it has what the first had and no more;
  // the node also carries the first one's recorded policy (the limits its tools had), so a save from the re-run says the same
  const have = nodesOfThread(ctx.db, threadId!, false, 1)[0];
  const carried = { brief: next, policy: n.policy ?? null, origin: { rerunOf: n.id } };
  if (have) {
    ctx.db.run(
      "UPDATE runs_node SET brief_json = COALESCE(brief_json, ?), policy_json = COALESCE(policy_json, ?), origin_json = COALESCE(origin_json, ?) WHERE run_id = ?",
      JSON.stringify(carried.brief),
      carried.policy === null ? null : JSON.stringify(carried.policy),
      JSON.stringify(carried.origin),
      have.id,
    );
  } else {
    const mk = (parentRun?: string) =>
      startNode(ctx, {
        kind: "helper",
        owner: n.owner,
        threadId: threadId!,
        ...(parentRun ? { parentRun } : {}),
        ...(n.name ? { name: n.name } : {}),
        whoKind: n.whoKind,
        ...(n.whoId ? { whoId: n.whoId } : {}),
        ...(n.whoName ? { whoName: n.whoName } : {}),
        ...((input.model ?? n.model) ? { model: input.model ?? n.model } : {}),
        brief: carried.brief,
        ...(carried.policy === null ? {} : { policy: carried.policy }),
        origin: carried.origin,
        idemKey: `helper:${threadId}`,
      });
    let made: { node: Node };
    try {
      made = mk(n.parentRun);
    } catch {
      made = mk(); // the chat's turn has ended: it stands as work of its own
    }
    // a failed helper tried again: the helpers that failed only because of it go back to waiting, on this one
    if (n.status === "failed") rearmDependents(ctx, n.id, made.node.id);
  }
  return { threadId: threadId!, rerunOf: n.id };
}

interface Side {
  runId?: string;
  threadId?: string;
  status: string;
  brief?: Brief;
  result?: string;
  usdMicros: number;
  tokens: number;
  seconds?: number;
  model?: string;
}

async function lastWords(ctx: RunsCtx, n: Node): Promise<string | undefined> {
  if (typeof n.result === "string" && n.result !== "") return cut(n.result);
  if (n.result !== undefined && n.result !== null) return cut(JSON.stringify(n.result));
  if (n.summary) return cut(n.summary);
  if (n.threadId === undefined) return undefined;
  try {
    const r = (await ctx.call?.("chat.messages.list", { threadId: n.threadId, limit: 1 })) as
      | { messages?: Array<{ body?: string; threadSeq?: number }> }
      | undefined;
    const m = r?.messages?.[r.messages.length - 1];
    return m?.body && (m.threadSeq ?? 2) > 1 ? cut(m.body) : undefined;
  } catch {
    return undefined;
  }
}

async function sideOf(ctx: RunsCtx, n: Node): Promise<Side> {
  const brief = await briefOf(ctx, n);
  const result = await lastWords(ctx, n);
  return {
    runId: n.id,
    ...(n.threadId ? { threadId: n.threadId } : {}),
    status: n.status,
    ...(brief ? { brief } : {}),
    ...(result ? { result } : {}),
    usdMicros: n.spent.usdMicros,
    tokens: n.spent.tokensIn + n.spent.tokensOut,
    ...(n.endedAt !== undefined ? { seconds: Math.max(0, Math.round((n.endedAt - n.startedAt) / 1000)) } : {}),
    ...(n.model ? { model: n.model } : {}),
  };
}

/** The first and everything started again from it, side by side. A re-run that has not begun its first turn yet shows as starting. */
export async function compare(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = fullNode(ctx, input.runId, true);
  const reruns = ((n.origin as Origin | undefined)?.reruns ?? [])
    .filter((r): r is RerunEntry & { threadId: string } => r.threadId !== undefined)
    .slice(0, 20);
  const sides: Side[] = [await sideOf(ctx, n)];
  for (const r of reruns) {
    const m = nodesOfThread(ctx.db, r.threadId, false, 1)[0];
    sides.push(m ? await sideOf(ctx, m) : { threadId: r.threadId, status: "queued", usdMicros: 0, tokens: 0 });
  }
  return { sides };
}
