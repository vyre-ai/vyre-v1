import { eraseTables, eraseWhere, tryAll, tryRun } from "../../lib/erase-agent.ts";
import type { EraseCtx, EraseIn, Footprint } from "../../lib/erase-agent.ts";
// Tasks module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
import { handlers } from "./handlers/index.ts";

export { handlers };
import { countNeedsYou } from "./handlers/state.ts";
import { resumeRunOf, settleFromSource } from "./handlers/resume.ts";
import { syncPolicy, syncTz } from "./projections.ts";
import { tick } from "./handlers/clock.ts";
import { onAgentDeleted, onPersonLeft } from "./handlers/departures.ts";
import { onChatGone, onGoalEnded, onParentFinished } from "./handlers/orphans.ts";
import { onEvidence } from "./handlers/evidence.ts";
import { lookDaily } from "./handlers/look.ts";
import { onCrewMerged, onRunStopped, onTaskChanged } from "./handlers/schedule.ts";
import type { TasksCtx } from "./projections.ts";
export { findStuck, mintApprovalToken, readApprovalToken, ACT_KEYS } from "./handlers/act.ts";
export { applyMove, checkMove, commitMove, planMove, submitTarget, afterReview } from "./handlers/state.ts";

/** What the Space switcher shows as Needs you on this person's tile (spaces.attention, P-L7_21): the same count as tasks.count_needs_you, asked for the person the host call runs as. */
export const hostCalls = {
  /** Delete for good (F77): a task that still names the agent in a slot is unassigned with one line of history; the agent's own history lines (their notes) and what it asked of people go. */
  "tasks.erase_agent": (ctx: EraseCtx, i: EraseIn): Footprint => {
    const named: NonNullable<Footprint["named"]> = [];
    for (const r of tryAll(
      ctx.db,
      `SELECT m.id AS id, c.title AS title, m.assigned AS assigned, m.reviewer AS reviewer, m.approver AS approver, m.taken_by AS taken_by FROM tasks_meta m JOIN tasks_core c ON c.id = m.id WHERE m.assigned LIKE ? OR m.reviewer LIKE ? OR m.approver LIKE ? OR m.taken_by = ?`,
      `%${i.agentId}%`,
      `%${i.agentId}%`,
      `%${i.agentId}%`,
      i.agentId,
    )) {
      named.push({ kind: "task", id: String(r["id"]), title: String(r["title"] ?? "") });
      if (i.dry === true) continue;
      const strip = (raw: unknown): string | null => {
        if (raw === null || raw === undefined) return null;
        const text = String(raw);
        try {
          const v = JSON.parse(text) as unknown;
          if (Array.isArray(v)) return JSON.stringify(v.filter((x) => (x as { id?: string })?.id !== i.agentId));
          return (v as { id?: string })?.id === i.agentId ? null : text;
        } catch {
          return text.includes(i.agentId) ? null : text;
        }
      };
      tryRun(
        ctx.db,
        `UPDATE tasks_meta SET assigned = ?, reviewer = ?, approver = ?, taken_by = CASE WHEN taken_by = ? THEN NULL ELSE taken_by END, updated_at = ? WHERE id = ?`,
        strip(r["assigned"]),
        strip(r["reviewer"]),
        strip(r["approver"]),
        i.agentId,
        ctx.now(),
        String(r["id"]),
      );
      tryRun(
        ctx.db,
        `INSERT INTO tasks_history (id, task_id, at, type, actor, note, event_id) VALUES (?, ?, ?, 'unassigned', 'system', ?, '')`,
        `thx_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`,
        String(r["id"]),
        "The agent that held this was deleted for good, so it needs someone.",
      );
    }
    if (i.dry !== true) {
      tryRun(ctx.db, `DELETE FROM tasks_history WHERE actor = ?`, i.agentId);
      tryRun(ctx.db, `UPDATE tasks_core SET handled_by = NULL WHERE handled_by = ?`, i.agentId);
    }
    return { named };
  },
  "tasks.attention": async (ctx: Parameters<typeof countNeedsYou>[0]): Promise<number> => {
    try {
      return Number(((await countNeedsYou(ctx, {} as never)) as { count?: number }).count ?? 0);
    } catch {
      return 0;
    }
  },
};

/** The clock (handlers/clock.ts): due days and times on each holder's own clock, snoozes that end, steps that sat too long. Once a minute. */
export const periodic = {
  /** The daily look at the unclear few (handlers/look.ts): one batched model call, proposals only. Checked hourly, runs at most once a day. */
  "tasks.look": { everyMs: 3_600_000, run: async (ctx: TasksCtx): Promise<unknown> => lookDaily(ctx) },
  "tasks.clock": { everyMs: 60_000, run: async (ctx: TasksCtx): Promise<unknown> => tick(ctx) },
};

/** A Run waiting on a task goes on when the task is Done or Canceled, whichever way it got there (handlers/resume.ts). */
export const consumers = {
  /** The Space's tasks.* settings, copied here from settings.changed: a module reads only its own tables. */
  "tasks.settings_sync": {
    on: ["settings.changed"],
    async run(ctx: TasksCtx, event: { payload: Record<string, unknown> }): Promise<string[]> {
      return syncPolicy(ctx.db, event.payload) || syncTz(ctx.db, event.payload) ? [String(event.payload["key"])] : [];
    },
  },
  /** Finishing a task starts what waited on it and tells a parent only what it has to hear (handlers/schedule.ts). */
  "tasks.schedule": {
    on: ["task.transitioned", "task.withdrawn", "task.deleted", "task.created"],
    run: (ctx: TasksCtx, event: Parameters<typeof onTaskChanged>[1]) => onTaskChanged(ctx, event),
  },
  "tasks.crew_merged": {
    on: ["crew.job_merged"],
    run: (ctx: TasksCtx, event: Parameters<typeof onCrewMerged>[1]) => onCrewMerged(ctx, event),
  },
  "tasks.run_stopped": {
    on: ["run.stopped", "run.failed"],
    run: (ctx: TasksCtx, event: Parameters<typeof onRunStopped>[1]) => onRunStopped(ctx, event),
  },
  "tasks.run_resume": {
    on: ["task.transitioned"],
    run: (ctx: TasksCtx, event: Parameters<typeof resumeRunOf>[1]) => resumeRunOf(ctx, event),
  },
  /** The source decided (a card in the chat, the access or key card): its tasks close, for everyone they were addressed to (handlers/resume.ts). */
  "tasks.source_settle": {
    on: [
      "block.answered",
      "block.withdrawn",
      "plan.approved",
      "plan.rejected",
      "access.granted",
      "access.declined",
      "vault.request_fulfilled",
      "vault.request_declined",
      "vault.request_canceled",
    ],
    run: (ctx: TasksCtx, event: Parameters<typeof settleFromSource>[1]) => settleFromSource(ctx, event),
  },
  /** The event that proves a task done arrived: a Vault item, a sent message, a meeting that ended, a connection (handlers/evidence.ts). */
  "tasks.evidence": {
    on: ["vault.item_created", "message.sent", "meeting.ended", "connection.created"],
    run: (ctx: TasksCtx, event: Parameters<typeof onEvidence>[1]) => onEvidence(ctx, event),
  },
  /** The ask's source is gone: its chat closed or erased, its parent finished (handlers/orphans.ts). */
  "tasks.orphans_chat": {
    on: ["thread.closed", "thread.deleted", "thread.erased"],
    run: (ctx: TasksCtx, event: Parameters<typeof onChatGone>[1]) => onChatGone(ctx, event),
  },
  "tasks.orphans_goal": {
    on: ["goal.ended"],
    run: (ctx: TasksCtx, event: Parameters<typeof onGoalEnded>[1]) => onGoalEnded(ctx, event),
  },
  "tasks.orphans_parent": {
    on: ["task.transitioned"],
    run: (ctx: TasksCtx, event: Parameters<typeof onParentFinished>[1]) => onParentFinished(ctx, event),
  },
  /** Nothing waits on someone who is gone: what they held moves on, with one line of history. */
  "tasks.person_left": {
    on: ["member.removed"],
    run: (ctx: TasksCtx, event: Parameters<typeof onPersonLeft>[1]) => onPersonLeft(ctx, event),
  },
  "tasks.agent_deleted": {
    on: ["agent.deleted"],
    run: (ctx: TasksCtx, event: Parameters<typeof onAgentDeleted>[1]) => onAgentDeleted(ctx, event),
  },
};
