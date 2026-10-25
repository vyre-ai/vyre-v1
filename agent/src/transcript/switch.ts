// Switch the engine of a thread mid-chat (engine.switch, spec 4.14, ARCH 6.9). The new engine starts from the HandoffContext: the rolling summary, the last turns and a pointer to the
// whole transcript. A model that ran the thread before and returns gets what was said while it was away instead. The switch writes the quiet line and the model_switch block; the
// engine module emits turn.engine_switched with the event payload returned here. Nothing in the hand-over is a provider message format: each driver turns the seed text into its own.
import { mintUuid } from "../../../lib/ids.ts";
import { refreshSummary } from "./compact.ts";
import type { Summarizer } from "./compact.ts";
import { HANDOFF, buildHandoff, renderHandoff } from "./handoff.ts";
import type { HandoffContext, Seed } from "./handoff.ts";
import type { Transcript } from "./store.ts";
import type { EngineRef } from "./types.ts";

const TITLE: Readonly<Record<string, string>> = {
  anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", xai: "xAI", opencode_go: "OpenCode Go", local: "a local model",
  claude_code: "Claude Code", codex: "Codex", grok: "Grok",
};
export const engineTitle = (driver: string): string => TITLE[driver] ?? driver;

export interface SwitchDeps {
  transcript: Transcript;
  summarize?: Summarizer;
  now?: () => number;
}

export interface SwitchRequest {
  threadId: string;
  agentId: string;
  from: EngineRef;
  to: EngineRef;
  /** Who asked for the switch. */
  by: string;
  pointer?: string;
  instruction?: string;
  /** Ids for the persisted block; minted when absent. */
  blockId?: string;
  traceId?: string;
}

export interface ModelSwitchBlock {
  type: "model_switch";
  v: 1;
  id: string;
  state: "done";
  traceId: string;
  data: {
    threadId: string;
    agentId: string;
    scope: "thread";
    from: { provider: string; model: string; effort?: string };
    to: { provider: string; model: string; effort?: string };
    reason?: string;
  };
}

export interface SwitchResult {
  /** The quiet line in the thread: "Switched to Codex, picked up from the summary and the last 20 turns". */
  quietLine: string;
  handoffTurns: number;
  /** True when the target engine ran this agent before: the hand-over carries what was said while it was away. */
  returning: boolean;
  context: HandoffContext;
  /** Goes in front of the new engine's first message. */
  seed: Seed;
  /** Payload of turn.engine_switched. */
  event: { threadId: string; agentId: string; from: string; to: string; handoffTurns: number; by: string };
  block: ModelSwitchBlock;
}

const compact = (e: EngineRef): { provider: string; model: string; effort?: string } => ({ provider: e.provider, model: e.model, ...(e.effort === undefined ? {} : { effort: e.effort }) });
const id = (prefix: string): string => `${prefix}_${mintUuid().replaceAll("-", "")}`;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function switchEngine(deps: SwitchDeps, req: SwitchRequest): Promise<SwitchResult> {
  const t = deps.transcript;
  const now = deps.now ?? Date.now;
  const atTurn = t.count(req.threadId);

  // A model that left earlier and comes back: the turn it left at is where the row that switched it away stopped.
  const left = t.switches(req.threadId).filter((r) => r.agentId === req.agentId && r.from.driver === req.to.driver && r.from.model === req.to.model).at(-1);
  const returning = left !== undefined;

  // The summary is brought up to date first (a cheap background turn, or the plain extract), so the new engine is not handed turns that were already summarised away.
  await refreshSummary(t, deps.summarize, { threadId: req.threadId, now, keep: HANDOFF.turns, every: 1 });

  const ctx = buildHandoff(t, {
    threadId: req.threadId,
    ...(req.pointer === undefined ? {} : { pointer: req.pointer }),
    ...(req.instruction === undefined ? {} : { instruction: req.instruction }),
    ...(returning && left ? { since: left.atTurn } : {}),
  });
  const seed = renderHandoff(ctx, { kind: returning ? "back" : "switch" });
  const n = ctx.lastTurns.length;

  const to = engineTitle(req.to.driver);
  const quietLine = returning
    ? `Switched back to ${to}, caught up on ${plural(n, "turn")} since it left`
    : n === 0 ? `Switched to ${to}`
      : ctx.summary ? `Switched to ${to}, picked up from the summary and the last ${plural(n, "turn")}`
        : `Switched to ${to}, picked up from the last ${plural(n, "turn")}`;

  t.recordSwitch({ threadId: req.threadId, agentId: req.agentId, at: now(), atTurn, from: req.from, to: req.to, handoffTurns: n, by: req.by });

  return {
    quietLine, handoffTurns: n, returning, context: ctx, seed,
    event: { threadId: req.threadId, agentId: req.agentId, from: req.from.driver, to: req.to.driver, handoffTurns: n, by: req.by },
    block: {
      type: "model_switch", v: 1, id: req.blockId ?? id("blk"), state: "done", traceId: req.traceId ?? mintUuid().replaceAll("-", ""),
      data: { threadId: req.threadId, agentId: req.agentId, scope: "thread", from: compact(req.from), to: compact(req.to), reason: quietLine },
    },
  };
}
