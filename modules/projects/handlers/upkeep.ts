// Projects, what the project screen needs besides the plan (owner, 4 Nov 2026):
//  - projects.set: a manager's override of how the project stands, one value, audited; "Set by <name>" shows while it holds.
//  - projects.update.draft / projects.update.edit: the status update's draft, written from the project's facts on the asker's own AI account, then edited in place; Post (projects.post_update) sends it.
//  - projects.crew: the helpers and teammates working for the project with a live state, read from the crews of the project's chats.
//  - projects.for_channel: the project a channel belongs to.
import {
  HEALTHS, call, clean, codeOf, draftOf, emitP, ensure, loadTasks, me, membersOf, projectByChannel, raise, readRecord, saveDraft, saveHealth, tolerant, updateOf, visible, healthOf, projectRow, allows,
} from "../projections.ts";
import type { Health, In, ProjectsCtx } from "../projections.ts";
import { teammatesList } from "./teammates.ts";

// ---- how the project stands ----

export async function set(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  const health = input.health as Health | null | undefined;
  if (health !== null && health !== undefined && !HEALTHS.includes(health)) raise(ctx, "validation.bad_input", "Pick On track, At risk, Off track, On hold or Done.", { health });
  if (health === undefined) raise(ctx, "validation.bad_input", "Say how the project stands, or null to go back to the automatic reading.");
  const before = healthOf(ctx.db, p.projectId);
  const at = ctx.now();
  saveHealth(ctx.db, p.projectId, health === null ? null : { health, by: me(ctx), at });
  emitP(ctx, "project.health_set", p.projectId, { health: health ?? undefined, previous: before?.health, by: me(ctx) });
  return clean({ health: health ?? undefined, setBy: health === null ? undefined : me(ctx), at: health === null ? undefined : at });
}

// ---- the status update's draft ----

const FACTS_SYSTEM = "You write a project's weekly status update for the people on it: one short paragraph, plain words, no headings, no lists. Say where the project stands, what moved, what is late or waiting and what is next. Use only the facts you are given.";

async function usableAccount(ctx: ProjectsCtx): Promise<string> {
  const mine = await tolerant<{ accounts?: Array<{ ref: string; usable: boolean; kind: string }> }>(ctx, "engine.my_ai", {}, {});
  const ok = (mine.accounts ?? []).filter((a) => a.usable);
  const pick = ok.find((a) => a.kind === "subscription") ?? ok[0];
  if (!pick) raise(ctx, "validation.precondition_failed", "Connect an AI account to draft the update.", { reason: "no_ai_account" });
  return pick.ref;
}

/** What the draft is written from: the project's own facts, nothing else. */
export async function factsOf(ctx: ProjectsCtx, projectId: string): Promise<string> {
  const p = visible(ctx, projectId, "view");
  const [fields, tasks] = await Promise.all([readRecord(ctx, p), loadTasks(ctx, p).catch(() => [])]);
  const row = projectRow(ctx, p, fields, tasks);
  const now = ctx.now();
  const open = tasks.filter((t) => t.state !== "done" && t.state !== "canceled");
  const day = (ms: number | undefined): string => (ms === undefined ? "no date" : new Date(ms).toISOString().slice(0, 10));
  const lines = [
    `Project: ${row.title}`, `Status: ${row.status}`, ...(row.health ? [`Health set by a manager: ${row.health}`] : []),
    ...(typeof fields["goal"] === "string" && fields["goal"] ? [`Goal: ${fields["goal"]}`] : []),
    `Today: ${day(now)}`, `Open tasks: ${row.openTasks}, late: ${row.lateTasks}`, `People and agents: ${membersOf(ctx.db, p.projectId).length}`,
    ...open.slice(0, 12).map((t) => `- ${t.title} (${t.state}, due ${day(t.due)}${t.due !== undefined && t.due < now ? ", late" : ""})`),
    ...(updateOf(ctx.db, p.projectId) ? [`Last update: ${updateOf(ctx.db, p.projectId)!.text}`] : []),
  ];
  return lines.join("\n");
}

export async function updateDraft(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const accountRef = await usableAccount(ctx);
  const facts = await factsOf(ctx, p.projectId);
  let text = "";
  try {
    const out = await call<{ text?: string }>(ctx, "engine.complete", { accountRef, system: FACTS_SYSTEM, prompt: `Write this week's status update.\n\n${facts}` });
    text = (out.text ?? "").trim();
  } catch (e) { raise(ctx, "provider.unavailable" as never, "Your AI account could not draft the update just now. Try again.", { cause: codeOf(e) }); }
  if (!text) raise(ctx, "provider.unavailable" as never, "Your AI account sent nothing back. Try again.");
  const at = ctx.now();
  saveDraft(ctx.db, p.projectId, { text, by: me(ctx), at });
  emitP(ctx, "project.update_drafted", p.projectId, { by: me(ctx) });
  return { text, at, by: me(ctx) };
}

export async function updateEdit(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) raise(ctx, "validation.bad_input", "Write the update first.");
  const at = ctx.now();
  saveDraft(ctx.db, p.projectId, { text, by: me(ctx), at });
  emitP(ctx, "project.update_drafted", p.projectId, { by: me(ctx) });
  return { text, at, by: me(ctx) };
}

export const draftFor = (ctx: ProjectsCtx, projectId: string): { text: string; at: number; by: string } | undefined => draftOf(ctx.db, projectId);

// ---- the crew ----

type CrewJob = { jobId: string; threadId: string; leadThreadId: string; agentId: string; name?: string; title: string; state: string; startedAt: number; endedAt?: number };
export type CrewState = "working" | "done" | "needs_you" | "stopped";
/** The words a person reads: Working, Done or Needs you (a teammate waiting on them, one the server lost, one that failed). */
export function crewState(state: string): CrewState {
  if (state === "working") return "working";
  if (state === "done" || state === "merged") return "done";
  if (state === "waiting" || state === "lost" || state === "failed") return "needs_you";
  return "stopped";
}

export async function crew(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const threads: string[] = [];
  if (p.channelId) {
    const ch = await tolerant<{ channel?: { mainThreadId?: string } }>(ctx, "channels.get", { channelId: p.channelId }, {});
    if (ch.channel?.mainThreadId) threads.push(ch.channel.mainThreadId);
  }
  if (p.threadId && !threads.includes(p.threadId)) threads.push(p.threadId);
  const recent = p.threadId ? await tolerant<{ threads?: Array<{ threadId: string }> }>(ctx, "threads.list", { parentThreadId: p.threadId, limit: 8 }, {}) : {};
  for (const t of recent.threads ?? []) if (!threads.includes(t.threadId)) threads.push(t.threadId);
  const seen = new Set<string>();
  const jobs: CrewJob[] = [];
  for (const threadId of threads.slice(0, 10)) {
    const out = await tolerant<{ jobs?: CrewJob[] }>(ctx, "engine.crew.list", { threadId }, {});
    for (const j of out.jobs ?? []) if (!seen.has(j.jobId)) { seen.add(j.jobId); jobs.push(j); }
  }
  const rank = (s: CrewState): number => (s === "needs_you" ? 0 : s === "working" ? 1 : s === "done" ? 2 : 3);
  const helpers = jobs.map((j) => clean({ jobId: j.jobId, threadId: j.threadId, agentId: j.agentId, name: j.name, title: j.title, state: crewState(j.state), startedAt: j.startedAt, endedAt: j.endedAt }))
    .sort((a, b) => rank(a.state) - rank(b.state) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  const mates = (await teammatesList(ctx, { projectId: p.projectId }).catch(() => ({ teammates: [] }))) as { teammates: unknown[] };
  return { helpers, working: helpers.filter((h) => h.state === "working").length, needsYou: helpers.filter((h) => h.state === "needs_you").length, teammates: mates.teammates };
}

// ---- a channel's project ----

export async function forChannel(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = projectByChannel(ctx.db, input.channelId);
  // a project the caller cannot see is answered as no project
  if (!p || !allows(ctx, "view", p.projectId)) return {};
  return { projectId: p.projectId, recordId: p.recordId };
}
