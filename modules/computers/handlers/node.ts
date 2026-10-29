// What the host asks of this module for a computer that joined the Space (host/src/routes/compute.ts): hand out its jobs, take its answers, and say whether a job's token may reach an agent's home.
// None of these is a capability: they are host calls, reachable only after the route has checked the node's credential, never from a session.
import { claimJobs, jobForToken, submitJob } from "../jobs.ts";
import { ensure } from "../projections.ts";
import type { CompCtx } from "../projections.ts";

/** The calls a node's home mirror may make as the agent. Anything else is refused, whatever the token. */
export const HOME_CAPS: ReadonlySet<string> = new Set([
  "files.list", "files.read", "files.upload_url", "files.write", "files.create", "files.delete", "files.folder.create", "agents.get", "agents.suggestion.propose", "tasks.create",
]);
/** Only a job that works on the home (waking, sleeping, syncing, a tool that changes files) may reach it. */
export const HOME_JOBS: ReadonlySet<string> = new Set(["start", "stop", "sync", "tool"]);

export async function nodeJobs(ctx: CompCtx, input: { nodeId: string; leaseMs?: number; running?: string[] }) {
  ensure(ctx.db);
  return { jobs: await claimJobs(ctx.db, String(input.nodeId), ctx.now(), { ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}), ...(input.running ? { running: input.running.filter((x) => typeof x === "string") } : {}) }) };
}

export async function nodeResult(ctx: CompCtx, input: { nodeId: string; jobId: string; ok: boolean; result?: unknown; error?: string }) {
  ensure(ctx.db);
  const outcome = input.ok ? { ok: true as const, result: input.result ?? null } : { ok: false as const, error: String(input.error ?? "The computer could not do that.") };
  return { status: submitJob(ctx.db, String(input.nodeId), String(input.jobId), outcome, ctx.now()) };
}

/** The agent a token may act as, for one computer and one allowed call; null when the token is not a live job of this node for this computer. */
export async function nodeHomeCheck(ctx: CompCtx, input: { nodeId: string; token: string; computerId: string; cap: string }): Promise<{ agentId: string } | null> {
  ensure(ctx.db);
  if (!HOME_CAPS.has(String(input.cap))) return null;
  const job = await jobForToken(ctx.db, String(input.nodeId), String(input.token), String(input.computerId), ctx.now());
  if (!job || !HOME_JOBS.has(job.kind)) return null;
  return { agentId: job.agentId };
}
