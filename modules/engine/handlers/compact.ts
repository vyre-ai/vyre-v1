// engine.compact: the Compact button of the chat's model panel and /compact. The work is the runtime's compactor (modules/engine/compact.ts); this checks the chat, keeps "Keep this every time",
// refuses while the agent is answering (a compact would race the turn for the same engine session) and emits turn.compacted.
import { ensureRuntime, compactorOf } from "../runtime.ts";
import { open } from "./control.ts";
import { keepEvery, keepFor, setKeepEvery } from "../cli-sessions.ts";
import { actorOf, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import type { Compactor } from "../compact.ts";

/** `worker`: the runtime's compactor unless a test hands in its own. */
export async function compact(ctx: EngineCtx, input: { threadId: string; agentId?: string; keep?: string; always?: boolean }, worker?: Pick<Compactor, "run">) {
  await ensureRuntime(ctx);
  const engine = await open(ctx, input.threadId);
  const agents = engine.agents(input.threadId);
  const agentId = input.agentId ?? agents.find((a) => a.mode === "lead")?.id;
  if (agentId === undefined) raise(ctx, "validation.precondition_failed", "Nobody leads this conversation. Name the agent to compact.", { threadId: input.threadId });
  if (!agents.some((a) => a.id === agentId)) raise(ctx, "validation.not_found", "That agent is not in this conversation.", { agentId });
  if (engine.turns(input.threadId).some((t) => t.agentId === agentId && t.state === "running")) raise(ctx, "validation.precondition_failed", "The agent is still answering. Compact when it is done.", { agentId });
  const run = worker ?? compactorOf();
  if (!run) raise(ctx, "internal.unavailable", "The engine is not running on this host.");
  const by = actorOf(ctx);
  const now = input.keep?.trim() ?? "";
  // "Keep this every time": ticked with words keeps them for every compaction of this chat; ticked with none clears them; not ticked leaves them as they are
  const every = input.always === true ? setKeepEvery(ctx.db, input.threadId, now, by, ctx.now()) : keepEvery(ctx.db, input.threadId);
  const keep = keepFor(now, every);
  const r = await run.run({ threadId: input.threadId, agentId, asker: by, keep, traceId: ctx.trace.traceId });
  ctx.emit("turn.compacted", input.threadId, {
    threadId: input.threadId, agentId, engine: r.engine, how: r.how, kept: keep !== "", ...(r.context ? { used: r.context.used, window: r.context.window } : {}), by,
  });
  return { engine: r.engine, how: r.how, line: r.line, context: r.context, keepEvery: every, fellBack: r.fellBack };
}
