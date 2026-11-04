// Notifications module (lane L6). The host loads these handlers once the host/modules.json row is live (ARCH 12.4, ruling 25).
// setPushPort is the host's door for the APNs/FCM transport and the computer's idle time (call it at boot); the fanout consumer turns events that name a notification kind into rows.
import { handlers } from "./handlers/index.ts";
import { setPushPort } from "./handlers/push.ts";
import { clearForSubject, send } from "./handlers/rules.ts";
import { readSettings, syncSetting } from "./handlers/deliver.ts";
import type { NotifCtx } from "./projections.ts";

export { handlers, setPushPort };

/** Where the host hands its half at boot (ruling 32): the push transport and the computer's idle time. The loader reads this export. */
export const hostSeams = { setPushPort };
export { KINDS, kindOf, withinHours } from "./projections.ts";
export { buildPush } from "./handlers/push.ts";
export type { PushMessage, PushPort } from "./handlers/push.ts";

type Assignee = { kind: string; id: string } | null | undefined;
interface Ev { name: string; subject?: string; payload: Record<string, unknown>; actor?: string }
type SendIn = Parameters<typeof send>[1];

/** The name a person reads for whoever acted: the server's one resolver, so someone's private agent reads "Irfad Imtiaz (Agent)", never a raw id. */
async function nameOf(ctx: NotifCtx, id: string | undefined): Promise<string> {
  if (!id || !ctx.call || id.startsWith("svc_")) return "Someone";
  const kind = id.startsWith("agt_") ? "agent" : id.startsWith("grp_") ? "group" : id.startsWith("rol_") ? "role" : "person";
  try {
    const n = ((await ctx.call("access.principals.get", { principal: { kind, id } })) as { principal?: { name?: unknown } } | null)?.principal?.name;
    return typeof n === "string" && n !== "" && n !== id ? n : "Someone";
  } catch { return "Someone"; }
}

/** The people a slot reaches: the person, or every person in the group or holding the role. Agents and automations are woken by the engine, not told. */
async function peopleOf(ctx: NotifCtx, a: Assignee): Promise<string[]> {
  if (!a) return [];
  if (a.kind === "person") return [a.id];
  if ((a.kind !== "group" && a.kind !== "role") || !ctx.call) return [];
  try {
    const members = a.kind === "group"
      ? ((await ctx.call("access.groups.get", { groupId: a.id })) as { group?: { members?: Array<{ kind?: string; id?: string }> } }).group?.members
      : ((await ctx.call("access.roles.get", { roleId: a.id })) as { holders?: Array<{ kind?: string; id?: string }> }).holders;
    return (members ?? []).filter((m) => m.kind === "person" && typeof m.id === "string").map((m) => m.id as string).slice(0, 100);
  } catch { return []; }
}

async function taskOf(ctx: NotifCtx, id: string): Promise<{ kind?: string; title?: string; createdBy?: string; assigned?: Assignee; workingNotes?: Record<string, string>; takenBy?: string } | undefined> {
  if (!ctx.call) return undefined;
  try { return ((await ctx.call("tasks.get", { taskId: id })) as { task?: Record<string, never> }).task; } catch { return undefined; }
}

const firstFix = (notes: Record<string, string> | undefined): string => { try { const f = JSON.parse(notes?.["fixes"] ?? "[]") as unknown; return Array.isArray(f) && typeof f[0] === "string" ? f[0] : "see the task"; } catch { return "see the task"; } };

/** Who a task event is for and what it says (lane l-tasks). Every person whose turn it is hears it once, by name; whoever acted never hears about their own move. */
async function planTask(ctx: NotifCtx, e: Ev): Promise<SendIn[]> {
  const p = e.payload;
  const taskId = String(p.taskId ?? "");
  const by = typeof p.by === "string" ? p.by : e.actor;
  const subject = { type: "task", id: taskId };
  const not = (ids: string[]): string[] => [...new Set(ids)].filter((id) => id !== by);
  if (e.name === "task.requested") {
    const to = not(await peopleOf(ctx, p.assigned as Assignee));
    if (to.length === 0) return [];
    const title = String(p.title ?? "");
    if (p.kind === "work") {
      const from = await nameOf(ctx, by);
      if (p.step === "work") {
        const t = await taskOf(ctx, taskId);
        return to.map((id) => ({ to: id, kind: "task.returned", subject, title, data: { from, note: firstFix(t?.workingNotes) }, collapseKey: `task.turn:${taskId}` }));
      }
      return to.map((id) => ({ to: id, kind: "task.turn", subject, title, data: { from, step: p.step === "approval" ? "approval" : "review" }, collapseKey: `task.turn:${taskId}` }));
    }
    // the words say what is asked: an answer, or something only this person can unblock, never "Approval needed"
    const kind = p.kind === "answer" ? "answer.requested" : p.kind === "unblock" ? "unblock.requested" : "approval.requested";
    return to.map((id) => ({ to: id, kind, subject, title, collapseKey: `${kind}:${taskId}` }));
  }
  if (e.name === "task.assigned") {
    const to = not(await peopleOf(ctx, p.to as Assignee));
    if (to.length === 0) return [];
    // a request made just now says so itself (task.requested): its holder is not told twice
    const t = p.from === null || typeof p.title !== "string" ? await taskOf(ctx, taskId) : undefined;
    if (p.from === null && t?.kind !== undefined && t.kind !== "work") return [];
    const what = p.slot === "reviewer" ? "asked you to review" : p.slot === "approver" ? "asked you to approve" : "gave you a task";
    const from = await nameOf(ctx, by);
    return to.map((id) => ({ to: id, kind: "task.assigned", subject, title: String(p.title ?? t?.title ?? "a task"), data: { from, what }, collapseKey: `task.assigned:${taskId}` }));
  }
  if (e.name === "task.completed") {
    const t = await taskOf(ctx, taskId);
    const creator = t?.createdBy;
    if (!creator || !creator.startsWith("usr_") || creator === by) return [];
    return [{ to: creator, kind: "task.finished", subject, title: t?.title ?? "a task", data: { from: await nameOf(ctx, by) } }];
  }
  if (e.name === "task.due") {
    const to = await peopleOf(ctx, p.holder as Assignee);
    return to.map((id) => ({ to: id, kind: "task.due", subject, title: String(p.title ?? ""), data: { when: p.at === "day" ? "Due today" : "Due now" }, collapseKey: `task.due:${taskId}` }));
  }
  if (e.name === "task.nudged") {
    const to = typeof p.notify === "string" && p.notify.startsWith("usr_") ? p.notify : "";
    if (to === "" || p.why === "idle_agent") return [];   // an agent that went quiet is the engine's to escalate, with an Unblock task
    return [{ to, kind: "approval.backstop", subject, title: String(p.title ?? ""), collapseKey: `approval.backstop:${taskId}` }];
  }
  return [];
}

/** Everyone who holds the Owner or Admin role: the people a machine alert is for. */
async function adminsOf(ctx: NotifCtx): Promise<string[]> {
  if (!ctx.call) return [];
  try {
    const roles = ((await ctx.call("access.roles.list", {})) as { roles?: Array<{ id: string; name: string; permissions?: string[] }> }).roles ?? [];
    const ids = roles.filter((r) => (r.permissions ?? []).includes("server.network") || r.name === "Owner" || r.name === "Admin").map((r) => r.id);
    const out = new Set<string>();
    for (const roleId of ids) for (const h of ((await ctx.call("access.roles.get", { roleId })) as { holders?: Array<{ kind?: string; id?: string }> }).holders ?? []) if (h.kind === "person" && typeof h.id === "string") out.add(h.id);
    return [...out].slice(0, 100);
  } catch { return []; }
}

const TASK_EVENTS: ReadonlySet<string> = new Set(["task.requested", "task.assigned", "task.completed", "task.due", "task.nudged"]);

/** Who an event is for and what it says, for the events whose manifest names a notification kind. Undefined means this event files nothing. */
export function plan(ctx: NotifCtx, e: Ev): Promise<SendIn | SendIn[] | undefined> | SendIn | SendIn[] | undefined {
  const p = e.payload;
  if (TASK_EVENTS.has(e.name)) return planTask(ctx, e);
  if (e.name === "machine.alert") {
    // one line for each admin; it collapses while the same alert lasts, and the machine page is where it opens
    return adminsOf(ctx).then((to) => to.map((id) => ({ to: id, kind: "machine.alert", subject: { type: "space", id: String(p.machineId ?? "") }, title: String(p.title ?? "A machine needs a look"), collapseKey: `machine.alert:${String(p.alertId ?? "")}` })));
  }
  if (e.name === "ci.paused") {
    // the monthly cap is reached: one line for each admin, once for the month
    return adminsOf(ctx).then((to) => to.map((id) => ({ to: id, kind: "ci.paused", subject: { type: "space", id: "ci" }, title: String(p.title ?? "CI paused"), collapseKey: `ci.paused:${String(p.month ?? "")}` })));
  }
  if (e.name === "run.succeeded" && p.kind === "routine" && ctx.call) {
    // Alerts: a routine that succeeded is told only to people who asked for successes too (failures always come through run.failed)
    return ctx.call("runs.get", { runId: p.runId }).then((r) => {
      const run = (r as { run?: { owner?: string; name?: string; summary?: string } }).run;
      if (!run?.owner || !readSettings(ctx.db, run.owner).routinesAll) return undefined;
      return { to: run.owner, kind: "agent.task_finished", subject: { type: "run", id: String(p.runId) }, title: run.name ?? run.summary ?? "a routine", data: { agent: "Your routine" }, runId: String(p.runId) };
    }, () => undefined);
  }
  if ((e.name === "access.granted" || e.name === "access.declined") && typeof p.requester === "string") {
    const r = p.resource as { type?: string } | undefined;
    return { to: p.requester, kind: "access.decided", title: r?.type ?? "this", data: { decision: e.name === "access.granted" ? "approved" : "declined" } };
  }
  if (e.name === "access.shared_with" && typeof p.to === "string") {
    // "Irfad shared Dex with you", with the line the sharer wrote, in the Inbox
    const r = p.resource as { type?: string; id?: string } | undefined;
    return { to: p.to, kind: "item.shared", ...(r?.type && r.id ? { subject: { type: r.type, id: r.id } } : {}), title: String(p.title ?? "something"), data: { from: String(p.byName ?? "Someone"), ...(typeof p.message === "string" && p.message ? { message: p.message } : {}) }, collapseKey: `item.shared:${r?.id ?? ""}:${p.to}` } as never;
  }
  if (e.name === "run.failed") return { to: String(p.owner), kind: "run.failed", subject: { type: "run", id: String(p.runId) }, data: { name: p.kind, message: p.message }, runId: String(p.runId) };
  if (e.name === "member.joined") {
    // the line names the person, never their id: the directory answers, and "A new member" stands in when it cannot
    const filed = (name: string, space: string) => ({ to: String(p.invitedBy), kind: "member.joined", title: name, data: { name, space } });
    const call = ctx.call;
    if (!call) return filed("A new member", "the Space");
    const who = call("access.principals.get", { principal: { kind: "person", id: String(p.personId) } }).then((r) => (r as { principal?: { name?: string } } | null)?.principal?.name, () => undefined);
    const where = call("spaces.get", {}).then((r) => (r as { space?: { name?: string } } | null)?.space?.name, () => undefined);
    return Promise.all([who, where]).then(([name, space]) => filed(name && !/^usr_/.test(name) ? name : "A new member", space || "the Space"));
  }
  return undefined;
}

/** Async consumers by name: the events each one reads and what it does with one. */
export const consumers = {
  "notifications.fanout": {
    on: ["task.requested", "task.assigned", "task.completed", "task.due", "task.nudged", "run.failed", "run.succeeded", "member.joined", "access.granted", "access.declined", "machine.alert", "access.shared_with", "ci.paused"],
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> {
      const planned = await plan(ctx, event);
      const out: string[] = [];
      for (const input of planned === undefined ? [] : Array.isArray(planned) ? planned : [planned]) {
        const r = await send(ctx, input);
        if (r.notificationId) out.push(r.notificationId);
      }
      return out;
    },
  },
  /** A request that closed is nothing to be told about any more: its notification stops counting, whoever decided it and wherever. */
  "notifications.task_closed": {
    on: ["task.transitioned", "task.withdrawn"],
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> {
      const to = event.payload.to;
      if (event.name === "task.transitioned" && to !== "done" && to !== "canceled") return [];
      const taskId = String(event.payload.taskId ?? "");
      return taskId ? clearForSubject(ctx, "task", taskId) : [];
    },
  },
  /** Keeps a copy of each person's notification settings from settings.changed, for the deliver path (P-CC_22b). */
  "notifications.settings_sync": {
    on: ["settings.changed"],
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> { return syncSetting(ctx.db, event.payload) ? [String(event.payload.key)] : []; },
  },
};
