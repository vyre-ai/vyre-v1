// The engine's turns, mirrored into the Run tree (r42-runtime slice 1b). Every turn this engine runs is one node: a turn of a chat is kind `turn`, a turn of a helper's thread is kind `helper` under the turn that started it,
// a crew job's is `crew`. The node is made at the turn's first phase (idempotent by `turn:<turnId>`, so a missing "started" is made up by whichever phase comes first), moved at each phase, and the turn's tokens are
// written once as a usage event. Nothing here can stop or slow a turn: a call that fails is logged and the next phase repairs the node.
// DECISION: the mirror reads nothing the engine does not already hold (the turn row) except the thread's kind, title and parent, asked once per thread from threads.get and kept.
import { stepWords } from "../../lib/plain-words.ts";
import type { TurnRow } from "../../agent/src/turn-engine/types.ts";

export type Phase = "started" | "waiting" | "completed" | "failed" | "cancelled";
interface Extra {
  code?: string | undefined;
  message?: string | undefined;
  reason?: string | undefined;
  /** a parked turn: the approval task it waits on, or the Run it waits for */
  taskId?: string | undefined;
  runId?: string | undefined;
  /** the tool the held call was for, to say what it asks to do */
  tool?: string | undefined;
}
type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
export interface MirrorHost {
  call: Call;
  /** an agent's name in words, for the row */
  nameOf?: ((agentId: string) => Promise<string | undefined>) | undefined;
  log?: ((msg: string, attrs?: Record<string, unknown>) => void) | undefined;
}
interface ThreadFacts {
  kind: string;
  starter?: string;
  title?: string;
  parentThreadId?: string;
}

/** Which node kind a turn of this kind of thread is. */
export function nodeKindOf(threadKind: string): "turn" | "helper" | "crew" {
  if (threadKind === "helper") return "helper";
  if (threadKind === "crew") return "crew";
  return "turn";
}

/** What the mirror needs of a turn: a lost turn (a host that died under it) is not in the engine's rows, so it is known by these alone. */
export type TurnFacts = Pick<TurnRow, "id" | "threadId" | "agentId"> &
  Partial<Pick<TurnRow, "asker" | "model" | "tokensIn" | "tokensOut">>;

/** What a held call asks to do, in words: the plain line for a file, command or web step, else the tool's own name made readable ("Mail send"). */
function askWhat(tool: string): string {
  const w = stepWords(tool);
  if (w !== "Working") return w;
  const t = tool
    .replace(/^mcp__.+?__/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return t === "" ? "A step" : t.charAt(0).toUpperCase() + t.slice(1);
}

export function createNodeMirror(h: MirrorHost) {
  const facts = new Map<string, ThreadFacts | null>();
  const chain = new Map<string, Promise<void>>();
  const agentNames = new Map<string, string | undefined>();
  const nodeOf = new Map<string, string>(); // turn id to node id; a restart asks the start call again, which answers the same node

  async function threadFacts(threadId: string, asker: string): Promise<ThreadFacts | null> {
    if (facts.has(threadId)) return facts.get(threadId) ?? null;
    try {
      const r = (await h.call("threads.get", { threadId }, asker === "" ? undefined : asker)) as
        | { thread?: Record<string, unknown> }
        | undefined;
      const t = r?.thread ?? (r as Record<string, unknown> | undefined);
      const f: ThreadFacts | null = t
        ? {
            kind: typeof t["kind"] === "string" ? (t["kind"] as string) : "chat",
            ...(typeof t["starter"] === "string" ? { starter: t["starter"] as string } : {}),
            ...(typeof t["title"] === "string" ? { title: t["title"] as string } : {}),
            ...(typeof t["parentThreadId"] === "string" ? { parentThreadId: t["parentThreadId"] as string } : {}),
          }
        : null;
      if (facts.size > 2000) facts.delete(facts.keys().next().value as string);
      facts.set(threadId, f);
      return f;
    } catch {
      return null; // not cached: asked again at the next phase
    }
  }

  async function one(turn: TurnFacts, phase: Phase, extra: Extra): Promise<void> {
    const f = await threadFacts(turn.threadId, turn.asker ?? "");
    const asker = turn.asker ?? f?.starter;
    if (!asker) return; // no person to own it: nothing to show
    const kind = nodeKindOf(f?.kind ?? "chat");
    if (!agentNames.has(turn.agentId))
      agentNames.set(turn.agentId, await h.nameOf?.(turn.agentId).catch(() => undefined));
    const who = agentNames.get(turn.agentId);
    const started = (await h.call("runs.node.start", {
      kind,
      owner: asker,
      threadId: turn.threadId,
      whoKind: "agent",
      whoId: turn.agentId,
      ...(turn.model ? { model: turn.model } : {}),
      ...(who ? { whoName: who } : {}),
      ...(f?.title && kind !== "turn" ? { name: f.title } : {}),
      ...(kind !== "turn" && f?.parentThreadId ? { parentThread: f.parentThreadId } : {}),
      idemKey: `turn:${turn.id}`,
      running: true,
    })) as { node: { id: string; status: string } };
    const id = started.node.id;
    nodeOf.set(turn.id, id);
    if (phase === "started") return;
    if (phase === "waiting") {
      const wake = extra.runId
        ? { kind: "child", label: "what it is waiting for", on: { run: extra.runId } }
        : { kind: "person", label: "your answer", ...(extra.taskId ? { on: { task: extra.taskId } } : {}) };
      await h.call("runs.node.move", { runId: id, to: "waiting", why: "slept", wake });
      if (extra.taskId)
        await h.call("runs.node.event", {
          runId: id,
          type: "need",
          key: `need:${extra.taskId}`,
          payload: {
            requestId: extra.taskId,
            what: extra.tool ? askWhat(extra.tool) : "A step",
            why: "It needs your yes before it goes ahead.",
          },
        });
      return;
    }
    if (phase === "completed") {
      await h.call("runs.node.event", {
        runId: id,
        type: "usage",
        key: `turn:${turn.id}:usage`,
        actor: turn.agentId,
        payload: { tokensIn: turn.tokensIn ?? 0, tokensOut: turn.tokensOut ?? 0 },
      });
      await h.call("runs.node.move", { runId: id, to: "succeeded", why: "done" });
      return;
    }
    if (phase === "failed") {
      await h.call("runs.node.move", {
        runId: id,
        to: "failed",
        why: "failed",
        error: {
          code: extra.code ?? "turn_failed",
          message: (extra.message ?? "The turn did not finish.").slice(0, 500),
        },
      });
      return;
    }
    await h.call("runs.node.move", {
      runId: id,
      to: "stopped",
      why: "stopped",
      ...(extra.reason ? { stopReason: extra.reason } : {}),
    });
  }

  return {
    /** The node of a turn this process has seen, if any. */
    nodeFor: (turnId: string): string | undefined => nodeOf.get(turnId),
    /** Mirror one phase of a turn. Phases of one turn run in order; a failure is logged, never thrown. */
    turn(turn: TurnFacts, phase: Phase, extra: Extra = {}): Promise<void> {
      const prev = chain.get(turn.id) ?? Promise.resolve();
      const next = prev
        .then(() => one(turn, phase, extra))
        .catch((err: unknown) => {
          h.log?.("a turn could not be mirrored into the run tree", {
            turnId: turn.id,
            phase,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      chain.set(turn.id, next);
      if (phase !== "started" && phase !== "waiting")
        void next.then(() => {
          if (chain.get(turn.id) === next) chain.delete(turn.id);
          nodeOf.delete(turn.id);
        });
      return next;
    },
  };
}
export type NodeMirror = ReturnType<typeof createNodeMirror>;
