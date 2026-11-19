// What a tile or a row reads about one piece of delegated work (lane r42-subagents, 19 Nov 2026). One shape for a subagent of the engine, a Vyre helper and a coder; the Run node of the runtime
// (DESIGN-r42-runtime.md, section 3) fills the same fields later. Until then `toRunView` adapts today's engine.crew.status member, and it is the ONLY place that knows the member's field names,
// so when the node lands a rename touches this file and nothing that draws.
import type { CrewMember, MemberState } from "./model.ts";
import { modelTag } from "./model.ts";

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
}

const kindOf = (m: CrewMember): RunKind =>
  m.kind === "subagent" ? "subagent" : m.kind === "teammate" ? "coder" : "helper";

/** Today's crew member as a RunView. */
export function toRunView(m: CrewMember): RunView {
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
  };
}
