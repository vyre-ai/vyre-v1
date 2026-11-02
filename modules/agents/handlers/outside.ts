// Outside agents: an app that signed in from outside Vyre is a normal agent that runs elsewhere. It has a face, a folder and a profile; it is owned by the person who allowed it, and at first only that person can use it, so a
// teammate's ask never runs on someone else's machine. Because it is not running all the time, a mention or a task waits here until it asks with agents_next.
//   connect   the agent an app becomes (called by mcp.oauth.allow, never by a client). The name is the app's own word, so one that could pass for Vyre, a person or a role gets marked; the face comes from the avatar library.
//   enqueue   a mention or a task for it (the engine and the task baton call this as the server). From the owner only.
//   next      the one call that takes work: the agent's own tool. The chat it names is where its work shows from then on.
//   seen      a tool call happened: Working for a minute, Awake for two, then Offline.
import { isHostService, isSystemCall } from "../../../lib/trust.ts";
import { MAX_NAME, NAME_BAD, agentBy, agentByName, ensure, mintId, nameKey, raise, tolerant } from "../projections.ts";
import type { AgentRec, AgentsCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const MAX_JOBS = 500;
const MAX_TEXT = 2000;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Words that would let an app pass for Vyre itself or for someone with authority in a chat. */
const RESERVED = new Set(["vyre", "assistant", "admin", "administrator", "owner", "system", "support", "security", "you"]);

/** The name an app gets: its own word, cut to what a name may hold. One that reads like Vyre, a role or a person here is marked, so a hostile client cannot sit in the sidebar as someone else. */
export async function outsideName(ctx: AgentsCtx, clientName: string): Promise<string> {
  const base = clientName.replace(new RegExp(NAME_BAD.source, "gu"), " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim().slice(0, MAX_NAME - 12).trim() || "Outside agent";
  const people = await tolerant<{ principals?: Array<{ name?: string }> }>(ctx, "access.principals.list", { kind: "person", limit: 500 }, {});
  const claims = RESERVED.has(nameKey(base)) || (people.principals ?? []).some((p) => typeof p.name === "string" && nameKey(p.name) === nameKey(base));
  const wanted = claims ? `${base} (outside)` : base;
  if (!agentByName(ctx.db, wanted)) return wanted;
  for (let n = 2; n < 100; n++) { const next = `${wanted} ${n}`; if (!agentByName(ctx.db, next)) return next; }
  return `${wanted} ${mintId("n", ctx.now()).slice(-6)}`;
}

/** A face from the avatar library: its seed. A client has no say in it. */
export const outsideFace = (ctx: AgentsCtx): string => `outside-${mintId("f", ctx.now()).slice(-10)}`;

export interface OutsideJob { jobId: string; kind: "mention" | "task" | "answer"; threadId?: string; taskId?: string; messageId?: string; from: string; title: string; text: string; queuedAt: number }
function jobOf(r: Row): OutsideJob {
  return {
    jobId: String(r["id"]), kind: String(r["kind"]) as OutsideJob["kind"], ...(r["threadId"] ? { threadId: String(r["threadId"]) } : {}), ...(r["taskId"] ? { taskId: String(r["taskId"]) } : {}), ...(r["messageId"] ? { messageId: String(r["messageId"]) } : {}),
    from: String(r["from"]), title: String(r["title"]), text: String(r["text"]), queuedAt: Number(r["queuedAt"]),
  };
}

export const isOutside = (a: Pick<AgentRec, "runtime">): boolean => a.runtime === "outside";

export function enqueue(ctx: AgentsCtx, input: { agentId: string; kind: "mention" | "task" | "answer"; threadId?: string; taskId?: string; messageId?: string; asker: string; title?: string; text?: string }) {
  if (!isSystemCall(ctx)) raise(ctx, "permission.no_grant", "Only the server puts work in this queue.");
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId);
  // owner only: a teammate's ask never runs on someone else's machine or on someone else's access
  if (!a || !isOutside(a) || a.ownerId !== input.asker) return { queued: false };
  if (Number((ctx.db.all("SELECT COUNT(*) AS n FROM agents_outside_jobs WHERE agentId = ? AND takenAt IS NULL", a.id) as Row[])[0]?.["n"] ?? 0) >= MAX_JOBS) return { queued: false };
  const now = ctx.now();
  const id = mintId("ojb", now);
  const dedupe = input.messageId ?? (input.taskId ? `task:${input.taskId}:${input.kind}` : null);
  const put = ctx.db.run(
    `INSERT OR IGNORE INTO agents_outside_jobs (id, agentId, kind, threadId, taskId, messageId, "from", title, text, dedupe, queuedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, a.id, input.kind, input.threadId ?? null, input.taskId ?? null, input.messageId ?? null, input.asker, clip(input.title ?? "", 200), clip(input.text ?? "", MAX_TEXT), dedupe, now,
  );
  if (put.changes !== 1) return { queued: false };
  ctx.emit("agent.job_queued", a.id, { agentId: a.id, jobId: id, kind: input.kind });
  return { queued: true };
}

export function next(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const a = ctx.principal.kind === "agent" ? agentBy(ctx.db, ctx.principal.id) : null;
  if (!a || !isOutside(a)) raise(ctx, "validation.precondition_failed", "Only an outside agent has a queue. Vyre wakes its own agents.");
  const rows = ctx.db.all("SELECT * FROM agents_outside_jobs WHERE agentId = ? AND takenAt IS NULL ORDER BY queuedAt, id LIMIT 2", a.id) as Row[];
  const first = rows[0];
  if (!first) return { job: null, waiting: 0 };
  const now = ctx.now();
  if (ctx.db.run("UPDATE agents_outside_jobs SET takenAt = ? WHERE id = ? AND takenAt IS NULL", now, first["id"]).changes !== 1) return { job: null, waiting: rows.length - 1 };
  const job = jobOf(first);
  ctx.emit("agent.job_taken", a.id, { agentId: a.id, jobId: job.jobId });
  const left = Number((ctx.db.all("SELECT COUNT(*) AS n FROM agents_outside_jobs WHERE agentId = ? AND takenAt IS NULL", a.id) as Row[])[0]?.["n"] ?? 0);
  return { job, waiting: left };
}

/** Only the person who allowed an outside agent can give it work. The answer says no more than that. */
export function usable(ctx: AgentsCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId);
  return { usable: !a || !isOutside(a) || isHostService(ctx.principal) || a.ownerId === (ctx.actingFor ?? ctx.principal.id) };
}

export function seen(ctx: AgentsCtx, input: { agentId: string }) {
  if (!isSystemCall(ctx)) raise(ctx, "permission.no_grant", "Only the server says that.");
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId);
  if (!a || !isOutside(a)) return { ok: false };
  const at = ctx.now();
  ctx.db.run("UPDATE agents_agent SET lastActiveAt = ? WHERE id = ?", at, a.id);
  ctx.emit("agent.seen", a.id, { agentId: a.id, at });
  return { ok: true };
}
