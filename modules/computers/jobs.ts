// Jobs for a computer that joined the Space (a node): the Space asks, the node does it once and answers once.
//   A call on an agent computer that lives on a node becomes a job row for that node. The node's poll claims queued jobs (a lease, a one-time token), runs each, and posts the answer; the answer is stored.
//   Never repeated: a retry after a lost reply reaches the node again (the lease ran out), and the node answers from the result it stored, without running the job. The Space takes the first answer
//   for a job and ignores later ones. A job whose lease runs out twice, or whose deadline passes, is failed; it is never handed to another node.
//   The job's token is what the node presents to reach the home of this job's computer (and nothing else): shown once at delivery, kept only as a hash, dead when the job ends.
import { mintId, rowsOf, sha256 } from "./projections.ts";
import type { Db, Row } from "./projections.ts";

/** Calls the Space may ask of a node. Anything else in a poll answer is ignored by the node. */
export const JOB_KINDS = ["create", "start", "stop", "remove", "probe", "configure", "takeover", "giveBack", "screenshot", "sessions", "signOut", "tool", "sync"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const LEASE_MS = 45_000;
export const MAX_ATTEMPTS = 2;
const GRACE_MS = 30_000;

const str = (v: unknown): string => String(v ?? "");
const num = (v: unknown): number => Number(v ?? 0);
const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export interface JobDelivery { jobId: string; computerId: string; agentId: string; kind: JobKind; input: unknown; token: string; deadline: number }

export function enqueueJob(db: Db, a: { nodeId: string; computerId: string; agentId: string; kind: JobKind; input: unknown; timeoutMs: number; now: number }): string {
  const jobId = mintId("job", a.now);
  db.run(
    "INSERT INTO computers_job (job_id, node_id, computer_id, agent_id, kind, input_json, state, attempts, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)",
    jobId, a.nodeId, a.computerId, a.agentId, a.kind, JSON.stringify(a.input ?? {}), a.now + a.timeoutMs, a.now,
  );
  return jobId;
}

/** Jobs whose time is up: a lease that ran out is tried once more, then failed; a deadline that passed fails the job. */
export function sweepJobs(db: Db, now: number): void {
  db.run("UPDATE computers_job SET state = 'failed', error = 'The computer did not answer in time.', done_at = ?, token_hash = NULL WHERE state IN ('queued', 'running') AND deadline < ?", now, now);
  db.run("UPDATE computers_job SET state = 'failed', error = 'The computer stopped answering.', done_at = ?, token_hash = NULL WHERE state = 'running' AND lease_until < ? AND attempts >= ?", now, now, MAX_ATTEMPTS);
  db.run("UPDATE computers_job SET state = 'queued', lease_until = NULL, token_hash = NULL WHERE state = 'running' AND lease_until < ? AND attempts < ?", now, MAX_ATTEMPTS);
}

/** A node that is still working on a job says so with every poll, and the job's lease moves out; a node that died stops saying it, and the lease runs out. */
export function extendLeases(db: Db, nodeId: string, jobIds: readonly string[], now: number, leaseMs = LEASE_MS): void {
  for (const id of jobIds.slice(0, 50)) db.run("UPDATE computers_job SET lease_until = ? WHERE job_id = ? AND node_id = ? AND state = 'running'", now + leaseMs, id, nodeId);
}

/** What the node asked for, claimed: each job is leased and gets a token that only this delivery knows. */
export async function claimJobs(db: Db, nodeId: string, now: number, o: { leaseMs?: number; limit?: number; running?: readonly string[] } = {}): Promise<JobDelivery[]> {
  if (o.running?.length) extendLeases(db, nodeId, o.running, now, o.leaseMs);
  sweepJobs(db, now);
  const rows = rowsOf(db, "SELECT * FROM computers_job WHERE node_id = ? AND state IN ('queued', 'running') ORDER BY created_at, job_id LIMIT ?", nodeId, o.limit ?? 5);
  const out: JobDelivery[] = [];
  for (const r of rows) {
    // a running job is handed out again only when its lease ran out (the sweep put it back to queued); one still leased is the node's to finish
    if (str(r["state"]) !== "queued") continue;
    const token = `vcj_${hex(24)}`;
    const changed = db.run(
      "UPDATE computers_job SET state = 'running', attempts = attempts + 1, lease_until = ?, token_hash = ? WHERE job_id = ? AND state = 'queued'",
      now + (o.leaseMs ?? LEASE_MS), await sha256(token), str(r["job_id"]),
    ).changes;
    if (changed !== 1) continue;
    let input: unknown = {};
    try { input = JSON.parse(str(r["input_json"])); } catch { input = {}; }
    out.push({ jobId: str(r["job_id"]), computerId: str(r["computer_id"]), agentId: str(r["agent_id"]), kind: str(r["kind"]) as JobKind, input, token, deadline: num(r["deadline"]) });
  }
  return out;
}

export type JobOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** The node's answer. The first one wins and is kept; a later one (a retry after a lost reply) changes nothing and gets the stored state back. */
export function submitJob(db: Db, nodeId: string, jobId: string, outcome: JobOutcome, now: number): "stored" | "already" | "unknown" {
  const r = rowsOf(db, "SELECT state, node_id FROM computers_job WHERE job_id = ?", jobId)[0];
  if (!r || str(r["node_id"]) !== nodeId) return "unknown";
  if (str(r["state"]) === "done" || str(r["state"]) === "failed") return "already";
  db.run(
    "UPDATE computers_job SET state = ?, result_json = ?, error = ?, done_at = ?, token_hash = NULL, lease_until = NULL WHERE job_id = ? AND state IN ('queued', 'running')",
    outcome.ok ? "done" : "failed", outcome.ok ? JSON.stringify(outcome.result ?? null) : null, outcome.ok ? null : outcome.error.slice(0, 500), now, jobId,
  );
  return "stored";
}

/** Wait for the job to end. Throws the node's own words when it failed. */
export async function awaitJob(db: Db, jobId: string, o: { now(): number; timeoutMs: number; pollMs?: number }): Promise<unknown> {
  const stop = Date.now() + o.timeoutMs + GRACE_MS;
  for (;;) {
    sweepJobs(db, o.now());
    const r = rowsOf(db, "SELECT state, result_json, error FROM computers_job WHERE job_id = ?", jobId)[0];
    if (!r) throw new Error("The job is gone.");
    if (str(r["state"]) === "done") { try { return JSON.parse(str(r["result_json"])); } catch { return null; } }
    if (str(r["state"]) === "failed") throw new Error(str(r["error"]) || "The computer could not do that.");
    if (Date.now() > stop) throw new Error("The computer did not answer in time.");
    await new Promise((res) => setTimeout(res, o.pollMs ?? 40));
  }
}

/** Does this token belong to a live job of this node for this computer? It is the whole of what a token proves. */
export async function jobForToken(db: Db, nodeId: string, token: string, computerId: string, now: number): Promise<{ jobId: string; agentId: string; kind: JobKind } | null> {
  if (!token.startsWith("vcj_")) return null;
  const r = rowsOf(db, "SELECT job_id, agent_id, kind, computer_id, node_id, state, lease_until FROM computers_job WHERE token_hash = ?", await sha256(token))[0];
  if (!r || str(r["state"]) !== "running" || str(r["node_id"]) !== nodeId || str(r["computer_id"]) !== computerId || num(r["lease_until"]) < now) return null;
  return { jobId: str(r["job_id"]), agentId: str(r["agent_id"]), kind: str(r["kind"]) as JobKind };
}

/** Delete finished jobs a day old: their answers were read long ago. */
export function purgeJobs(db: Db, now: number): void {
  db.run("DELETE FROM computers_job WHERE state IN ('done', 'failed') AND done_at < ?", now - 86_400_000);
}

export type { Row };
