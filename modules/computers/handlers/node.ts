// What the host asks of this module for a computer that joined the Space (host/src/routes/compute.ts): hand out its jobs, take its answers, and say whether a job's token may reach an agent's home.
// None of these is a capability: they are host calls, reachable only after the route has checked the node's credential, never from a session.
import { claimJobs, jobForToken, submitJob } from "../jobs.ts";
import { computerBy, ensure, redeemTicket } from "../projections.ts";
import type { CompCtx } from "../projections.ts";

/** The calls a node's home mirror may make as the agent. Anything else is refused, whatever the token. */
export const HOME_CAPS: ReadonlySet<string> = new Set([
  "files.list", "files.read", "files.upload_url", "files.write", "files.create", "files.delete", "files.folder.create", "put_upload", "agents.get", "agents.suggestion.propose", "tasks.create", "made_files",
]);
/** Only a job that works on the home (waking, sleeping, syncing, a tool that changes files, a recording being saved into its folder) may reach it. */
export const HOME_JOBS: ReadonlySet<string> = new Set(["start", "stop", "sync", "tool", "saveRecording"]);

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

/**
 * A viewer's connection to the Space for a computer that lives on a node (host/src/routes/compute-stream.ts) spends its one-use ticket here. Null unless the ticket is live and was issued for this computer,
 * the computer is on a node and awake. Input is offered only to a take-over ticket whose person still holds the controls; a watch ticket never gets it. The node is whatever the register says, never what a caller names.
 */
export async function nodeStreamOpen(ctx: CompCtx, input: { ticket: string; computerId: string }): Promise<{ nodeId: string; personId: string; input: boolean } | null> {
  ensure(ctx.db);
  const who = await redeemTicket(ctx.db, String(input.ticket), ctx.now());
  if (!who || who.computerId !== String(input.computerId) || (who.kind !== "stream" && who.kind !== "takeover")) return null;
  const c = computerBy(ctx.db, who.computerId);
  if (!c?.nodeId || (c.state !== "working" && c.state !== "takeover")) return null;
  return { nodeId: c.nodeId, personId: who.personId, input: who.kind === "takeover" && c.state === "takeover" && c.takeoverBy === who.personId };
}

/** Is the person still at the controls of this computer? Asked before each input is passed on, so a give-back or a hand-over stops it at once. */
export async function nodeStreamInput(ctx: CompCtx, input: { computerId: string; personId: string }): Promise<boolean> {
  ensure(ctx.db);
  const c = computerBy(ctx.db, String(input.computerId));
  return !!c && c.state === "takeover" && c.takeoverBy === String(input.personId);
}

/** Is this token a live saveRecording job of this node for this computer? The only job whose video may go up the recording route. */
export async function nodeRecordingCheck(ctx: CompCtx, input: { nodeId: string; token: string; computerId: string }): Promise<boolean> {
  ensure(ctx.db);
  const job = await jobForToken(ctx.db, String(input.nodeId), String(input.token), String(input.computerId), ctx.now());
  return job?.kind === "saveRecording";
}
