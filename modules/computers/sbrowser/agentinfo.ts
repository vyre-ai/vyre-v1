// Who an agent is, as the Space browser needs it (name and face for its start page, the kind and owner for where its downloads go): read from agents.get, remembered for a few minutes.
import type { CompCtx } from "../projections.ts";

export interface AgentInfo { name: string; face: string; kind: string; ownerId: string; folderId: string | null }
const cache = new Map<string, { at: number; info: AgentInfo | null }>();
const TTL_MS = 5 * 60_000;

export async function agentInfo(ctx: CompCtx, agentId: string): Promise<AgentInfo | null> {
  const key = `${ctx.space}|${agentId}`;
  const hit = cache.get(key);
  if (hit && ctx.now() - hit.at < TTL_MS) return hit.info;
  let info: AgentInfo | null = null;
  try {
    const a = ((await ctx.call("agents.get", { agentId })) as { agent?: { name?: string; face?: string; kind?: string; ownerId?: string; folderId?: string } }).agent;
    if (a) info = { name: a.name ?? "Agent", face: a.face ?? a.name ?? agentId, kind: a.kind ?? "agent", ownerId: a.ownerId ?? "", folderId: a.folderId ?? null };
  } catch { info = null; }
  cache.set(key, { at: ctx.now(), info });
  return info;
}
export const resetAgentInfo = (): void => cache.clear();
