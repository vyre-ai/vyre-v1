// Room for agent workspaces (6 Nov). A workspace is run by the terminal module, which cannot import this one, so the daemon connects the two with host calls: the workspace manager asks
// `computers.workspace_claim` before it starts a container and `computers.workspace_release` when one stops or goes, and this module's starter starts a waiting workspace by itself when room opens
// (the daemon binds `bindWorkspaceStart` to the manager). The numbers are capacity.ts: a workspace holds back 64 MB of its 1 GB cap and counts for memory and disk, not for maxAgentComputers.
import { bindStarter, claimRoom, drainWaiting, releaseRoom, waitingNote } from "./capacity.ts";
import { ensure } from "./projections.ts";
import type { CompCtx } from "./projections.ts";

/** What names a workspace in the claim table: its container's name, so the same text is its claim key and its workspaceId. */
export const workspaceKey = (agentId: string): string => `vyre-ws-${agentId}`;

let startPort: ((agentId: string) => Promise<void>) | null = null;
/** The daemon's way to start a workspace (the terminal module's manager), bound once both modules are loaded. */
export function bindWorkspaceStart(f: ((agentId: string) => Promise<void>) | null): void { startPort = f; }

// a waiting workspace starts by itself when room opens
bindStarter("workspace", async (_ctx, key) => { await startPort?.(key.replace(/^vyre-ws-/, "")); });

export async function workspaceClaim(ctx: CompCtx, input: { agentId: string; nodeId?: string | null }): Promise<{ state: "running" | "waiting"; line?: string }> {
  ensure(ctx.db);
  return claimRoom(ctx, { kind: "workspace", key: workspaceKey(String(input.agentId)), nodeId: input.nodeId ?? null });
}

export async function workspaceRelease(ctx: CompCtx, input: { agentId: string }): Promise<{ released: true }> {
  ensure(ctx.db);
  releaseRoom(ctx, workspaceKey(String(input.agentId)));
  // room opened: the oldest waiting workload that now fits starts; this one's release never fails because another did not start
  try { await drainWaiting(ctx); } catch { ctx.log.warn("capacity: the waiting line could not be checked"); }
  return { released: true };
}

export async function workspaceWaiting(ctx: CompCtx, input: { agentId: string }): Promise<{ line: string | null }> {
  ensure(ctx.db);
  return { line: waitingNote(ctx.db, workspaceKey(String(input.agentId))) };
}
