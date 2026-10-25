// Lead and listen (ARCH 6.5, spec 2.5 and 4.13). Exactly one lead per thread; listeners cost nothing until invoked.
import { route } from "../../../lib/route.ts";
import type { RoutePolicy } from "../../../lib/route.ts";
import type { Author, EngineAgent, PreviewResult, ThreadKind } from "./types.ts";
import type { RouteMention } from "../../../lib/route.ts";

/** Default mode at creation: chat or Ask with an agent, or a thread an agent started, that agent leads. Channels and human threads: agents listen. */
export function defaultMode(kind: ThreadKind, opts: { startedByAgent?: boolean } = {}): "lead" | "listen" {
  if (opts.startedByAgent) return "lead";
  return kind === "chat" || kind === "ask" || kind === "run" || kind === "helper" ? "lead" : "listen";
}

/** Give a thread's agents their default modes, at most one lead (the first agent that qualifies). */
export function assignDefaults(kind: ThreadKind, agentIds: readonly string[], opts: { startedByAgent?: boolean } = {}): EngineAgent[] {
  const lead = defaultMode(kind, opts) === "lead" ? agentIds[0] : undefined;
  return agentIds.map((id) => ({ id, mode: id === lead ? "lead" : "listen" }));
}

/** engine.setMode: making an agent the lead demotes the current lead (the unique partial index); setting the lead to listen leaves the thread with none. */
export function withMode(agents: readonly EngineAgent[], agentId: string, mode: "lead" | "listen"): EngineAgent[] {
  if (!agents.some((a) => a.id === agentId)) throw new RangeError(`no agent ${agentId} in this thread`);
  return agents.map((a) => (a.id === agentId ? { ...a, mode } : mode === "lead" && a.mode === "lead" ? { ...a, mode: "listen" as const } : { ...a }));
}

/** The composer line, from the same route() the engine uses, so label and behaviour cannot disagree. */
export function preview(agents: readonly EngineAgent[], author: Author, mentions: readonly RouteMention[], depth: number | undefined, policy: RoutePolicy = {}): PreviewResult {
  const r = route({ agents }, { author, mentions, ...(depth === undefined ? {} : { depth }) }, policy);
  const name = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
  const names = r.responders.map(name);
  const line = names.length === 0 ? "" : `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`} will reply`;
  return { responders: r.responders, reason: r.reason, listeners: r.listeners, line };
}
