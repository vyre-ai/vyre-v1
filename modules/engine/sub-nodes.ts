// The subagents a command-line engine starts, as nodes of the Run tree (r42-runtime slice 5): one node per subagent call, under the turn that made it or under the subagent that started it (nested), with its own words and its
// own use kept as events and its answer as the node's summary. Fed the same stream as the crew rows (crew-watch.ts); a call that fails is logged and never reaches the turn.
// DECISION: the node is made at the call, so a tile can say Starting at once; the task line (the first input of the call) names it; its result ends it. A subagent launched in the background has no answer yet: its node stays
// running until its own end (not read here: that comes later and ends it through the Run engine's task path).
import type { StreamEvent } from "./handlers/bridge.ts";
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

export function createSubNodes(h: {
  call: Call;
  log?: ((msg: string, attrs?: Record<string, unknown>) => void) | undefined;
  /** the node of a turn this process has seen: where the steps of the turn itself go */
  nodeFor?: ((turnId: string) => string | undefined) | undefined;
  /** an agent's name in words, for the row */
  nameOf?: ((agentId: string) => Promise<string | undefined>) | undefined;
}) {
  const names = new Map<string, string>(); // `${threadId}:${callId}` -> the tool's name, to put a touched file in its step
  const agentNames = new Map<string, string | undefined>();
  const ids = new Map<string, string>(); // `${threadId}:${callId}` -> node id
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
    })) as { node: { id: string } };
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
    } else if (e.phase === "input" && e.title !== true && typeof e.detail === "string" && e.detail !== "") {
      const n = names.get(key(e.threadId, e.id));
      if (n) await stepLine(e, n, e.detail);
    }
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

  async function stepLine(e: Step, tool: string, detail: string | undefined): Promise<void> {
    const owner = e.parent ? ids.get(key(e.threadId, e.parent)) : h.nodeFor?.(e.turnId);
    if (!owner) return;
    await h.call("runs.node.event", {
      runId: owner,
      type: "step",
      actor: e.agentId,
      payload: { icon: iconOf(tool), text: stepWords(tool, detail) },
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

  return {
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
}
export type SubNodes = ReturnType<typeof createSubNodes>;
