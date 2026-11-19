// What a tile or a row reads about one piece of delegated work (lane r42-subagents, 19 Nov 2026). One shape for a subagent of the engine, a Vyre helper and a coder; the Run node of the runtime
// (DESIGN-r42-runtime.md, section 3) fills the same fields later. Until then `toRunView` adapts today's engine.crew.status member, and it is the ONLY place that knows the member's field names,
// so when the node lands a rename touches this file and nothing that draws.
import type { CrewMember, MemberState } from "./model.ts";
import { modelTag } from "./model.ts";
import { dependencyLine, wakeCondition } from "./run/model.ts";
import type { RunNode } from "./run/model.ts";

export type RunKind = "subagent" | "helper" | "coder";

export interface RunView {
  id: string;
  kind: RunKind;
  /** The bold name: what it was asked, or its own name. */
  name: string;
  /** What it was asked, when that is not the same words as the name. */
  task: string;
  state: MemberState;
  /** Up to three live lines while it works (what it is on, newest last); the question while it needs you; the one line of what it found or what went wrong once it ended. */
  lines: readonly string[];
  tokens: number;
  costMicros: number;
  startedAt: number;
  endedAt?: number;
  elapsedMs: number;
  /** The model that really ran, short; empty when unknown. */
  model: string;
  /** The coder's branch, when there is one. */
  branch?: string;
  /** The kind of its current step (read, web, term, edit, find, think, send, cal, wait, kid), when the runtime says. */
  stepIcon?: string;
  /** What it sleeps on ("until the export finishes"), when the runtime says the node waits. */
  sleep?: string;
  /** The runtime's word that it looks stuck. */
  stuck?: string;
  /** "Starts when Numbers is done", only while something it waits for is not done. */
  dependsLine?: string;
  /** The held request (a Gate task) it waits on while it needs a person's yes: Allow and Deny answer it. */
  holdTaskId?: string;
  /** What it sleeps on, when it sleeps: the one line ("Until the build finishes"), when it wakes, how often it has woken. */
  wake?: { label: string; dueAt?: number; wokeCount: number };
  /** Tokens served from the run's cache, when known (the token report). */
  cacheRead?: number;
}

const kindOf = (m: CrewMember): RunKind =>
  m.kind === "subagent" ? "subagent" : m.kind === "teammate" ? "coder" : "helper";

/** Today's crew member as a RunView. */
export function toRunView(m: CrewMember, nodes?: readonly RunNode[]): RunView {
  // the node behind the member (the runtime's runId on a crew member), when it is known
  const node = m.runId !== undefined ? nodes?.find((n) => n.id === m.runId) : undefined;
  const name = m.name !== undefined && m.name !== "" ? m.name : m.title;
  const live = m.state === "working";
  const lines: string[] = live
    ? m.steps !== undefined && m.steps.length > 0
      ? m.steps.slice(-3)
      : m.step !== undefined
        ? [m.step]
        : []
    : m.state === "needs_you"
      ? m.step !== undefined
        ? [m.step]
        : []
      : m.found !== undefined
        ? [m.found]
        : [];
  return {
    id: m.id,
    kind: kindOf(m),
    name,
    task: name === m.title ? "" : m.title,
    state: m.state,
    lines,
    tokens: m.tokensIn + m.tokensOut,
    costMicros: m.costMicros,
    startedAt: m.startedAt,
    ...(m.endedAt !== undefined ? { endedAt: m.endedAt } : {}),
    elapsedMs: m.elapsedMs,
    model: modelTag(m),
    ...(m.branch !== undefined && m.branch !== "" ? { branch: m.branch } : {}),
    // what the runtime knows of this helper's node: the kind of its step, that it looks stuck, and what it waits for (only while it works)
    ...(node?.stepIcon !== undefined && live ? { stepIcon: node.stepIcon } : {}),
    ...(node?.stuck !== undefined && live ? { stuck: node.stuck.reason } : {}),
    ...(node?.status === "waiting" && node.wake && live && wakeCondition(node.wake, () => "") !== "" ? { sleep: wakeCondition(node.wake, () => "") } : {}),
    ...(node && nodes && live && dependencyLine(node, nodes) !== null
      ? { dependsLine: dependencyLine(node, nodes)! }
      : {}),
    ...(m.state === "needs_you" &&
    typeof (m as { holdTaskId?: unknown }).holdTaskId === "string" &&
    (m as { holdTaskId: string }).holdTaskId !== ""
      ? { holdTaskId: (m as { holdTaskId: string }).holdTaskId }
      : {}),
  };
}

/** The Run node as the runtime serves it (manifests/runs.ts nodeRow, 84176c17c): only the fields a tile reads, under the runtime's own names. */
export interface NodeLike {
  id: string;
  parentRun?: string;
  kind: string;
  name?: string;
  status: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
  model?: string;
  summary?: string;
  errorMessage?: string;
  stopReason?: string;
  spent: { tokensIn: number; tokensOut: number; cacheRead: number; usdMicros: number };
  wake?: { kind: string; label?: string; dueAt?: number; wokeCount?: number };
  startedAt: number;
  endedAt?: number;
}

const KIND: Record<string, RunKind> = { subagent: "subagent", helper: "helper", crew: "coder" };

/** One Run node as a RunView. Waiting is still working to a person (a calm line says what it waits on); paused is a hold that needs the person; succeeded is done. `step` is the node's last step line. */
export function toRunViewFromNode(n: NodeLike, step?: string, now: number = Date.now()): RunView {
  const state: MemberState =
    n.status === "succeeded"
      ? "done"
      : n.status === "failed"
        ? "failed"
        : n.status === "stopped"
          ? "stopped"
          : n.status === "paused"
            ? "needs_you"
            : "working";
  const sleeping = n.status === "waiting" && n.wake?.label !== undefined;
  const lines =
    state === "done"
      ? n.summary !== undefined
        ? [n.summary]
        : []
      : state === "failed"
        ? [n.errorMessage ?? n.summary ?? "Could not finish"]
        : state === "stopped"
          ? n.stopReason !== undefined
            ? [n.stopReason]
            : []
          : sleeping
            ? [`Asleep ${n.wake!.label!.charAt(0).toLowerCase()}${n.wake!.label!.slice(1)}`]
            : step !== undefined
              ? [step]
              : [];
  const end = n.endedAt;
  return {
    id: n.id,
    kind: KIND[n.kind] ?? "helper",
    name: n.name ?? "Helper",
    task: "",
    state,
    lines,
    tokens: n.spent.tokensIn + n.spent.tokensOut,
    costMicros: n.spent.usdMicros,
    startedAt: n.startedAt,
    ...(end !== undefined ? { endedAt: end } : {}),
    elapsedMs: Math.max(0, (end ?? now) - n.startedAt),
    model: n.model ?? "",
    ...(n.wake?.label !== undefined
      ? {
          wake: {
            label: n.wake.label,
            ...(n.wake.dueAt !== undefined ? { dueAt: n.wake.dueAt } : {}),
            wokeCount: n.wake.wokeCount ?? 0,
          },
        }
      : {}),
    cacheRead: n.spent.cacheRead,
  };
}
