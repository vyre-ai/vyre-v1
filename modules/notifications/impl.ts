// Notifications module (lane L6). The host loads these handlers once the host/modules.json row is live (ARCH 12.4, ruling 25).
// setPushPort is the host's door for the APNs/FCM transport and the computer's idle time (call it at boot); the fanout consumer turns events that name a notification kind into rows.
import { handlers } from "./handlers/index.ts";
import { setPushPort } from "./handlers/push.ts";
import { send } from "./handlers/rules.ts";
import type { NotifCtx } from "./projections.ts";

export { handlers, setPushPort };

/** Where the host hands its half at boot (ruling 32): the push transport and the computer's idle time. The loader reads this export. */
export const hostSeams = { setPushPort };
export { KINDS, kindOf, withinHours } from "./projections.ts";
export { buildPush } from "./handlers/push.ts";
export type { PushMessage, PushPort } from "./handlers/push.ts";

type Assignee = { kind: string; id: string } | null | undefined;
interface Ev { name: string; subject?: string; payload: Record<string, unknown> }

/** Who an event is for and what it says, for the events whose manifest names a notification kind. Undefined means this event files nothing. */
export function plan(ctx: NotifCtx, e: Ev): Promise<Parameters<typeof send>[1] | undefined> | Parameters<typeof send>[1] | undefined {
  const p = e.payload;
  if (e.name === "task.requested") {
    const to = p.assigned as Assignee;
    if (!to || to.kind !== "person") return undefined;   // a group, role or agent holder is reached through tasks.delegate and Needs you, not a personal banner
    return { to: to.id, kind: "approval.requested", subject: { type: "task", id: String(p.taskId) }, title: String(p.title ?? ""), collapseKey: `approval.requested:${String(p.taskId)}` };
  }
  if (e.name === "task.assigned") {
    const to = p.to as Assignee;
    if (!to || to.kind !== "person" || p.slot !== "assigned") return undefined;
    return { to: to.id, kind: "task.assigned", subject: { type: "task", id: String(p.taskId) }, title: "a task", data: { from: ctx.principal.kind === "person" ? ctx.principal.id : "someone" } };
  }
  if (e.name === "run.failed") return { to: String(p.owner), kind: "run.failed", subject: { type: "run", id: String(p.runId) }, data: { name: p.kind, message: p.message }, runId: String(p.runId) };
  if (e.name === "member.joined") return { to: String(p.invitedBy), kind: "member.joined", data: { name: p.personId, space: ctx.space } };
  return undefined;
}

/** Async consumers by name: the events each one reads and what it does with one. */
export const consumers = {
  "notifications.fanout": {
    on: ["task.requested", "task.assigned", "run.failed", "member.joined"],
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> {
      const input = await plan(ctx, event);
      if (!input) return [];
      const r = await send(ctx, input);
      return r.notificationId ? [r.notificationId] : [];
    },
  },
};
