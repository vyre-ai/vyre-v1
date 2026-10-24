// Today's routines and the first-run checklist (spec 3.1 Layout; ARCH 7.1).
// DECISION: a routine's day is read from what exists, not recomputed: the routine Runs of today (runs.list kind routine since local midnight, matched to my routines by name) give running, done
//   and failed with their result line; the routine's cron gives the times still to come today (scheduler.next_times from now to local midnight) as scheduled. A time that passed with no
//   Run leaves no line: the scheduler's missed list (scheduler.missed) already tells the owner, and Home shows what exists.
// DECISION: the person's day is their profile time zone; the first-run checklist is the spaces onboarding steps, hidden once all five are done or the person dismissed it.
import { clean, emitChecklist, isDone, localDay, me, personTz, raise } from "../projections.ts";
import type { HomeCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Agent { agentId: string; ownerId: string }
interface Routine { routineId: string; agentId: string; title: string; cron: string; enabled: boolean }
interface RunRow { id: string; kind: string; name?: string; owner: string; status: string; startedAt: number; endedAt?: number; summary?: string; subject?: { type: string; id: string } }
type State = "scheduled" | "running" | "done" | "failed";
interface Line { agentId: string; routineId: string; title: string; at: number; state: State; runId?: string; resultLine?: string }

const stateOf = (status: string): State => (status === "succeeded" ? "done" : status === "failed" || status === "stopped" ? "failed" : "running");

export async function routinesToday(ctx: HomeCtx): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Routines are not available right now.");
  const now = ctx.now();
  const tz = await personTz(ctx);
  const day = localDay(now, tz);
  // routines belong to the person who set them, and agent.toml holds only its owner's schedules: the routines of agents I own
  const agents = (((await ctx.call("agents.list", { limit: 500 })) as { agents?: Agent[] } | null)?.agents ?? []).filter((a) => a.ownerId === me(ctx));
  const routines: Routine[] = [];
  for (const a of agents) {
    const r = (await ctx.call("agents.routines.list", { agentId: a.agentId })) as { routines?: Routine[] } | null;
    routines.push(...(r?.routines ?? []).filter((x) => x.enabled));
  }
  const runs = ((await ctx.call("runs.list", { scope: "mine", kinds: ["routine"], since: day.start, limit: 500 })) as { runs?: RunRow[] } | null)?.runs ?? [];
  const out: Line[] = [];
  for (const rt of routines) {
    const mine = runs.filter((r) => r.name === rt.title && r.startedAt >= day.start && (r.subject === undefined || r.subject.id === rt.agentId || r.subject.id === rt.routineId))
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const r of mine) {
      out.push(clean({ agentId: rt.agentId, routineId: rt.routineId, title: rt.title, at: r.startedAt, state: stateOf(r.status), runId: r.id, resultLine: r.summary }));
    }
    const times = ((await ctx.call("scheduler.next_times", { cron: rt.cron, tz, count: 20 })) as { times?: number[] } | null)?.times ?? [];
    for (const at of times) if (at < day.end) out.push({ agentId: rt.agentId, routineId: rt.routineId, title: rt.title, at, state: "scheduled" });
  }
  out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
  return { routines: out };
}

// ---- first-run checklist ----

const ORDER = ["photo_and_title", "connect_mailbox_and_calendar", "meet_assistant", "open_first_project", "import"] as const;
const FROM_SPACES: Record<string, (typeof ORDER)[number]> = {
  photo_title: "photo_and_title", connect_mailbox: "connect_mailbox_and_calendar", meet_assistant: "meet_assistant", first_project: "open_first_project", import: "import",
};
interface Steps { dismissed: boolean; steps: { key: string; title: string; done: boolean }[] }

async function steps(ctx: HomeCtx): Promise<Steps> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The checklist is not available right now.");
  const got = (await ctx.call("spaces.onboarding.get", {})) as Steps | null;
  return { dismissed: got?.dismissed ?? false, steps: got?.steps ?? [] };
}

export async function checklist(ctx: HomeCtx): Promise<unknown> {
  const s = await steps(ctx);
  const items = s.steps.filter((x) => FROM_SPACES[x.key]).map((x) => ({ key: FROM_SPACES[x.key]!, title: x.title, done: x.done }))
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return { visible: !s.dismissed && !isDone(items), items };
}

export async function dismissChecklist(ctx: HomeCtx, _input: In): Promise<unknown> {
  const s = await steps(ctx);
  if (s.dismissed) return { ok: true };   // already hidden: nothing more to say
  await ctx.call!("spaces.onboarding.dismiss", {});
  const done = s.steps.length > 0 && s.steps.every((x) => x.done);
  emitChecklist(ctx, me(ctx), done ? "done" : "dismissed");
  return { ok: true };
}
