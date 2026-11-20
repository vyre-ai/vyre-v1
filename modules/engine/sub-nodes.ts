// The subagents a command-line engine starts, as nodes of the Run tree (r42-runtime slice 5): one node per subagent call, under the turn that made it or under the subagent that started it (nested), with its own words and its
// own use kept as events and its answer as the node's summary. Fed the same stream as the crew rows (crew-watch.ts); a call that fails is logged and never reaches the turn.
// DECISION: the node is made at the call, so a tile can say Starting at once; the task line (the first input of the call) names it; its result ends it. A subagent launched in the background has no answer yet: its node stays
// running until its own end (not read here: that comes later and ends it through the Run engine's task path).
import type { StreamEvent } from "./handlers/bridge.ts";
import { nameTag, nodeNoteBody } from "../../lib/helper-result.ts";
import { stepClass, stepWords } from "../../lib/plain-words.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
type Step = Extract<StreamEvent, { kind: "step" }>;
type Sub = Extract<StreamEvent, { kind: "sub" }>;
const SUBAGENT_CALL = /^(Agent|Task)$/;
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The icon a tile draws for a step: from the plain family of the tool. */
export function iconOf(
  tool: string,
): "read" | "web" | "term" | "edit" | "find" | "think" | "send" | "cal" | "wait" | "kid" {
  const c = stepClass(tool);
  if (c === "Read") return "read";
  if (c === "WebFetch" || c === "WebSearch") return "web";
  if (c === "Bash") return "term";
  if (c === "Edit") return "edit";
  if (c === "Agent") return "kid";
  if (c === "tool_search") return "find";
  const t = tool.replace(/^mcp__.+?__/, "");
  if (/calendar|event/i.test(t)) return "cal";
  if (/mail|message|send|post|sms/i.test(t)) return "send";
  return "think";
}

/** The one in use in this process: what the engine's control capabilities reach (a stop of one subagent). */
export interface SubControl {
  requestStop(nodeId: string, reason: string): boolean;
  bindTask(threadId: string, taskId: string, callId: string): void;
  gate(c: { threadId: string; subagent?: string }): Promise<{ block: string | null; notes: string[] }>;
}
let active: SubControl | null = null;
export const activeSubNodes = (): SubControl | null => active;

export function createSubNodes(h: {
  call: Call;
  log?: ((msg: string, attrs?: Record<string, unknown>) => void) | undefined;
  /** the node of a turn this process has seen: where the steps of the turn itself go */
  nodeFor?: ((turnId: string) => string | undefined) | undefined;
  /** an agent's name in words, for the row */
  nameOf?: ((agentId: string) => Promise<string | undefined>) | undefined;
}) {
  const taskCall = new Map<string, string>(); // `${threadId}:${taskId}` -> the Agent call that started it (the agent_id of its hooks is the task id)
  const stopAsked = new Map<string, string>(); // node id -> why its next call is refused
  const names = new Map<string, string>(); // `${threadId}:${callId}` -> the tool's name, to put a touched file in its step
  const agentNames = new Map<string, string | undefined>();
  const ids = new Map<string, string>(); // `${threadId}:${callId}` -> node id
  const attempts = new Map<string, number>(); // node id -> the attempt it was made with (a move names it)
  const chain = new Map<string, Promise<void>>(); // per thread: in order
  const key = (threadId: string, callId: string): string => `${threadId}:${callId}`;

  async function nodeOf(
    threadId: string,
    turnId: string,
    agentId: string,
    asker: string | undefined,
    callId: string,
    parent?: string,
  ): Promise<string | undefined> {
    const k = key(threadId, callId);
    const have = ids.get(k);
    if (have) return have;
    if (!asker) return undefined;
    const up = parent ? await nodeOf(threadId, turnId, agentId, asker, parent) : undefined;
    if (!agentNames.has(agentId)) agentNames.set(agentId, await h.nameOf?.(agentId).catch(() => undefined));
    const who = agentNames.get(agentId);
    const r = (await h.call("runs.node.start", {
      kind: "subagent",
      owner: asker,
      threadId,
      whoKind: "agent",
      whoId: agentId,
      ...(who ? { whoName: who } : {}),
      engine: "claude_code",
      ...(up ? { parentRun: up } : { parentThread: threadId }),
      idemKey: `sub:${threadId}:${callId}`,
      running: true,
    })) as { node: { id: string; attempt: number } };
    attempts.set(r.node.id, r.node.attempt);
    if (ids.size > 5000) ids.delete(ids.keys().next().value as string);
    ids.set(k, r.node.id);
    return r.node.id;
  }

  async function step(e: Step & { asker?: string }): Promise<void> {
    if (e.phase === "call" && typeof e.name === "string" && SUBAGENT_CALL.test(e.name)) {
      await nodeOf(e.threadId, e.turnId, e.agentId, e.asker, e.id, e.parent);
      return;
    }
    // what the agent, or the subagent that made the call, is on now: one plain line with its icon
    if (typeof e.name === "string" && e.phase === "call" && !SUBAGENT_CALL.test(e.name)) {
      names.set(key(e.threadId, e.id), e.name);
      if (names.size > 5000) names.delete(names.keys().next().value as string);
      await stepLine(e, e.name, undefined);
      await toolEvent(e, "call");
    } else if (e.phase === "input" && e.title !== true && typeof e.detail === "string" && e.detail !== "") {
      const n = names.get(key(e.threadId, e.id));
      if (n) await stepLine(e, n, e.detail);
    }
    // a call that has come back is no longer in flight (a long one is not stuck while it runs: node.ts detectStuck)
    if (e.phase === "result" && names.has(key(e.threadId, e.id))) await toolEvent(e, "result");
    const id = ids.get(key(e.threadId, e.id));
    if (!id) return;
    if (e.phase === "input" && e.title === true && typeof e.detail === "string" && e.detail !== "") {
      await h.call("runs.node.label", { runId: id, name: cut(e.detail, 120) });
      return;
    }
    if (e.phase === "result") {
      const answered = typeof e.result === "string" && e.result !== "";
      // a result that only says the work started (a helper left in the background) is not an end
      if (!answered && e.ok !== false && (e as { launched?: boolean }).launched !== false && e.result === undefined)
        return;
      await h.call("runs.node.move", {
        runId: id,
        attempt: attempts.get(id) ?? 1,
        to: e.ok === false ? "failed" : "succeeded",
        why: e.ok === false ? "failed" : "done",
        ...(answered ? { summary: cut(e.result as string, 600) } : {}),
        ...(e.ok === false
          ? {
              error: {
                code: "subagent_failed",
                message: answered ? cut(e.result as string, 300) : "It did not finish.",
              },
            }
          : {}),
      });
    }
  }

  async function toolEvent(e: Step, phase: "call" | "result"): Promise<void> {
    const owner = e.parent ? ids.get(key(e.threadId, e.parent)) : h.nodeFor?.(e.turnId);
    if (!owner) return;
    await h.call("runs.node.event", {
      runId: owner,
      type: "tool",
      key: `tool-${phase}:${e.id}`,
      actor: e.agentId,
      payload: { phase, id: e.id },
    });
  }

  async function stepLine(e: Step, tool: string, detail: string | undefined): Promise<void> {
    const owner = e.parent ? ids.get(key(e.threadId, e.parent)) : h.nodeFor?.(e.turnId);
    if (!owner) return;
    await h.call("runs.node.event", {
      runId: owner,
      type: "step",
      actor: e.agentId,
      payload: {
        icon: iconOf(tool),
        text: stepWords(tool, detail),
        // the tool and what it touched, stable: the same step again is the same string (only when the target is known: a call alone says too little)
        ...(detail ? { detail: `${tool.replace(/^mcp__.+?__/, "")}:${detail}`.slice(0, 200) } : {}),
      },
    });
  }

  async function sub(e: Sub & { asker?: string }): Promise<void> {
    const id = await nodeOf(e.threadId, e.turnId, e.agentId, e.asker, e.parent);
    if (!id) return;
    if (e.said !== undefined)
      await h.call("runs.node.event", {
        runId: id,
        type: "said",
        key: `said:${e.id}:${e.said.length}`,
        actor: e.agentId,
        payload: { text: e.said },
      });
    if (e.usage)
      await h.call("runs.node.event", {
        runId: id,
        type: "usage",
        key: `usage:${e.id}`,
        actor: e.agentId,
        payload: {
          tokensIn: e.usage.inputTokens,
          tokensOut: e.usage.outputTokens,
          ...(e.usage.cacheReadTokens ? { cacheRead: e.usage.cacheReadTokens } : {}),
          ...(e.usage.model ? { model: e.usage.model } : {}),
        },
      });
  }

  /** The node of a subagent from the agent_id its hook carries (the task id of the task line), if this process has seen it start. */
  const nodeOfTask = (threadId: string, taskId: string): string | undefined => {
    const call = taskCall.get(`${threadId}:${taskId}`);
    return call === undefined ? undefined : ids.get(key(threadId, call));
  };

  const api = {
    /** A task line named the call that started a subagent and its task id: its hooks say agent_id and mean that. */
    bindTask(threadId: string, taskId: string, callId: string): void {
      taskCall.set(`${threadId}:${taskId}`, callId);
      if (taskCall.size > 5000) taskCall.delete(taskCall.keys().next().value as string);
    },
    /** Ask a subagent to stop: its next call is refused with this reason. It has not stopped until it ends; the node ends then. Returns false when this process does not know it. */
    requestStop(nodeId: string, reason: string): boolean {
      for (const id of ids.values())
        if (id === nodeId) {
          stopAsked.set(nodeId, reason.slice(0, 200));
          return true;
        }
      return false;
    },
    /** What a call inside a subagent is told: refused if it was asked to stop; else the notes other nodes sent it, once, framed and signed with the real name of whoever sent them. */
    async gate(c: { threadId: string; subagent?: string }): Promise<{ block: string | null; notes: string[] }> {
      if (c.subagent === undefined) return { block: null, notes: [] };
      const id = nodeOfTask(c.threadId, c.subagent);
      if (id === undefined) return { block: null, notes: [] };
      const why = stopAsked.get(id);
      if (why !== undefined)
        return { block: `Stopped: ${why}. Finish what you are on and report in one line.`, notes: [] };
      const r = (await h.call("runs.message.take", { runId: id })) as {
        messages?: Array<{ body: string; fromName?: string }>;
      };
      return {
        block: null,
        notes: (r.messages ?? []).map((m) => nodeNoteBody(nameTag(m.fromName ?? "") || "A helper", m.body)),
      };
    },
    /** Feed one event of the turn's stream. Returns a promise that never rejects. */
    feed(e: StreamEvent & { asker?: string }): Promise<void> {
      if (e.kind !== "step" && e.kind !== "sub") return Promise.resolve();
      const prev = chain.get(e.threadId) ?? Promise.resolve();
      const next = prev
        .then(() => (e.kind === "step" ? step(e as Step & { asker?: string }) : sub(e as Sub & { asker?: string })))
        .catch((err: unknown) =>
          h.log?.("a subagent could not be kept in the run tree", {
            threadId: e.threadId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      chain.set(e.threadId, next);
      void next.then(() => {
        if (chain.get(e.threadId) === next) chain.delete(e.threadId);
      });
      return next;
    },
  };
  active = api;
  return api;
}
export type SubNodes = ReturnType<typeof createSubNodes>;
