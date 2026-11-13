// Notifications module (lane L6). The host loads these handlers once the host/modules.json row is live (ARCH 12.4, ruling 25).
// setPushPort is the host's door for the APNs/FCM transport and the computer's idle time (call it at boot); the fanout consumer turns events that name a notification kind into rows.
import { handlers } from "./handlers/index.ts";
import { pushPort, setPushPort } from "./handlers/push.ts";
import {
  clearForSubject,
  dayOf,
  resendKindEmail,
  send,
  sendOne,
  setTellAdmins,
  tellEmailGaveUp,
} from "./handlers/rules.ts";
import { readSettings, syncSetting } from "./handlers/deliver.ts";
import type { NotifCtx } from "./projections.ts";
import { registry } from "../../generated/registry.ts";

export { handlers, setPushPort };

/** Where the host hands its half at boot (ruling 32): the push transport and the computer's idle time. The loader reads this export. */
export const hostSeams = { setPushPort };
export { KINDS, kindOf, withinHours } from "./projections.ts";
export { buildPush } from "./handlers/push.ts";
export type { PushMessage, PushPort } from "./handlers/push.ts";

type Assignee = { kind: string; id: string } | null | undefined;
interface Ev {
  name: string;
  subject?: string;
  payload: Record<string, unknown>;
  actor?: string;
  /** the event's id (the host's HookEvent has one): the fanout remembers who it reached for it */ id?: string;
}
type SendIn = Parameters<typeof send>[1];

/** The name a person reads for whoever acted: the server's one resolver, so someone's private agent reads "Irfad Imtiaz (Agent)", never a raw id. */
async function nameOf(ctx: NotifCtx, id: string | undefined): Promise<string> {
  if (!id || !ctx.call || id.startsWith("svc_")) return "Someone";
  const kind = id.startsWith("agt_")
    ? "agent"
    : id.startsWith("grp_")
      ? "group"
      : id.startsWith("rol_")
        ? "role"
        : "person";
  try {
    const n = (
      (await ctx.call("access.principals.get", { principal: { kind, id } })) as {
        principal?: { name?: unknown };
      } | null
    )?.principal?.name;
    return typeof n === "string" && n !== "" && n !== id ? n : "Someone";
  } catch {
    return "Someone";
  }
}

/** The people a slot reaches: the person, or every person in the group or holding the role. Agents and automations are woken by the engine, not told. */
async function peopleOf(ctx: NotifCtx, a: Assignee): Promise<string[]> {
  if (!a) return [];
  if (a.kind === "person") return [a.id];
  if ((a.kind !== "group" && a.kind !== "role") || !ctx.call) return [];
  try {
    const members =
      a.kind === "group"
        ? (
            (await ctx.call("access.groups.get", { groupId: a.id })) as {
              group?: { members?: Array<{ kind?: string; id?: string }> };
            }
          ).group?.members
        : (
            (await ctx.call("access.roles.get", { roleId: a.id })) as {
              holders?: Array<{ kind?: string; id?: string }>;
            }
          ).holders;
    return (members ?? [])
      .filter((m) => m.kind === "person" && typeof m.id === "string")
      .map((m) => m.id as string)
      .slice(0, 100);
  } catch {
    return [];
  }
}

async function taskOf(
  ctx: NotifCtx,
  id: string,
): Promise<
  | {
      kind?: string;
      title?: string;
      createdBy?: string;
      assigned?: Assignee;
      workingNotes?: Record<string, string>;
      takenBy?: string;
    }
  | undefined
> {
  if (!ctx.call) return undefined;
  try {
    return ((await ctx.call("tasks.get", { taskId: id })) as { task?: Record<string, never> }).task;
  } catch {
    return undefined;
  }
}

const firstFix = (notes: Record<string, string> | undefined): string => {
  try {
    const f = JSON.parse(notes?.["fixes"] ?? "[]") as unknown;
    return Array.isArray(f) && typeof f[0] === "string" ? f[0] : "see the task";
  } catch {
    return "see the task";
  }
};

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
        return to.map((id) => ({
          to: id,
          kind: "task.returned",
          subject,
          title,
          data: { from, note: firstFix(t?.workingNotes) },
          collapseKey: `task.turn:${taskId}`,
        }));
      }
      return to.map((id) => ({
        to: id,
        kind: "task.turn",
        subject,
        title,
        data: { from, step: p.step === "approval" ? "approval" : "review" },
        collapseKey: `task.turn:${taskId}`,
      }));
    }
    // the words say what is asked: an answer, or something only this person can unblock, never "Approval needed"
    const kind =
      p.kind === "answer" ? "answer.requested" : p.kind === "unblock" ? "unblock.requested" : "approval.requested";
    return to.map((id) => ({ to: id, kind, subject, title, collapseKey: `${kind}:${taskId}` }));
  }
  if (e.name === "task.assigned") {
    const to = not(await peopleOf(ctx, p.to as Assignee));
    if (to.length === 0) return [];
    // a request made just now says so itself (task.requested): its holder is not told twice
    const t = p.from === null || typeof p.title !== "string" ? await taskOf(ctx, taskId) : undefined;
    if (p.from === null && t?.kind !== undefined && t.kind !== "work") return [];
    const what =
      p.slot === "reviewer"
        ? "asked you to review"
        : p.slot === "approver"
          ? "asked you to approve"
          : "gave you a task";
    const from = await nameOf(ctx, by);
    return to.map((id) => ({
      to: id,
      kind: "task.assigned",
      subject,
      title: String(p.title ?? t?.title ?? "a task"),
      data: { from, what },
      collapseKey: `task.assigned:${taskId}`,
    }));
  }
  if (e.name === "task.completed") {
    const t = await taskOf(ctx, taskId);
    const creator = t?.createdBy;
    if (!creator || !creator.startsWith("usr_") || creator === by) return [];
    return [
      {
        to: creator,
        kind: "task.finished",
        subject,
        title: t?.title ?? "a task",
        data: { from: await nameOf(ctx, by) },
      },
    ];
  }
  if (e.name === "task.due") {
    const to = await peopleOf(ctx, p.holder as Assignee);
    return to.map((id) => ({
      to: id,
      kind: "task.due",
      subject,
      title: String(p.title ?? ""),
      data: { when: p.at === "day" ? "Due today" : "Due now" },
      collapseKey: `task.due:${taskId}`,
    }));
  }
  if (e.name === "task.nudged") {
    const to = typeof p.notify === "string" && p.notify.startsWith("usr_") ? p.notify : "";
    if (to === "" || p.why === "idle_agent") return []; // an agent that went quiet is the engine's to escalate, with an Unblock task
    return [
      {
        to,
        kind: "approval.backstop",
        subject,
        title: String(p.title ?? ""),
        collapseKey: `approval.backstop:${taskId}`,
      },
    ];
  }
  return [];
}

/** A date in words, in UTC: 18 November 2026 (rules.ts, where the email copy uses it too). */
export { dayOf };

/** One line for each admin. */
function toAdmins(ctx: NotifCtx, line: Omit<SendIn, "to">): Promise<SendIn[]> {
  return adminsOf(ctx).then((to) => to.map((id) => ({ ...line, to: id }) as SendIn));
}
/** A health check's name, as the Console names it. */
const healthTitle = (key: string): string =>
  (registry.health as ReadonlyArray<{ key: string; title?: string }>).find((h) => h.key === key)?.title ??
  (key || "A service");
/** The events that file sync.attention, and what each names in its line. */
const SYNC_ATTENTION: Readonly<Record<string, (p: Record<string, unknown>) => string>> = {
  "connection.needs_reconnect": (p) => `the ${String(p.connector ?? "")} connection`.replace("the  ", "a "),
  "connector.publish_failed": (p) => `the ${String(p.key ?? "")} connector`.replace("the  ", "a "),
  "mount.failed": () => "a connected folder",
  "mount.conflict": (p) => (typeof p.name === "string" && p.name !== "" ? p.name : "a connected folder"),
  "source.mapping_failed": () => "a source",
  "source.link_pending": () => "a source",
  "sync.deletes_paused": (p) => `${String(p.type ?? "a record type")} sync`,
  "sync.push_failed": (p) => `${String(p.type ?? "a record type")} sync`,
  "sync.schema_changed": (p) => `${String(p.type ?? "a record type")} sync`,
  "sync.op_rejected": () => "your device",
};

/** Everyone who holds the Owner or Admin role: the people a machine alert is for. */
async function adminsOf(ctx: NotifCtx): Promise<string[]> {
  if (!ctx.call) return [];
  try {
    const roles =
      (
        (await ctx.call("access.roles.list", {})) as {
          roles?: Array<{ id: string; name: string; permissions?: string[] }>;
        }
      ).roles ?? [];
    const ids = roles
      .filter((r) => (r.permissions ?? []).includes("server.network") || r.name === "Owner" || r.name === "Admin")
      .map((r) => r.id);
    const out = new Set<string>();
    // one role that cannot be read (an id the reader refuses) leaves the others: before, one refusal emptied the whole list and no admin heard anything
    for (const roleId of ids) {
      let holders: Array<{ kind?: string; id?: string }> = [];
      try {
        holders =
          ((await ctx.call("access.roles.get", { roleId })) as { holders?: Array<{ kind?: string; id?: string }> })
            .holders ?? [];
      } catch (e) {
        ctx.log?.warn("notifications: role not readable", { roleId, error: (e as Error).message });
        continue;
      }
      for (const h of holders) if (h.kind === "person" && typeof h.id === "string") out.add(h.id);
    }
    // the Space's owner always hears it, read straight from the Space: an Owner role that cannot be read must not drop them
    await ownerOf(ctx).then((o) => {
      if (o) out.add(o);
    });
    return [...out].slice(0, 100);
  } catch (e) {
    ctx.log?.warn("notifications: roles not readable", { error: (e as Error).message });
    const o = await ownerOf(ctx);
    return o ? [o] : [];
  }
}
async function ownerOf(ctx: NotifCtx): Promise<string | null> {
  try {
    const o = ((await ctx.call?.("spaces.get", {})) as { space?: { owner?: unknown } } | undefined)?.space?.owner;
    return typeof o === "string" && o !== "" ? o : null;
  } catch (e) {
    ctx.log?.warn("notifications: the Space owner not readable", { error: (e as Error).message });
    return null;
  }
}
// a notice email that could not go is said to every admin through the line they already read (health.degraded, Console)
setTellAdmins(async (ctx, data, collapseKey) => {
  for (const line of await toAdmins(ctx, {
    kind: "health.degraded",
    subject: { type: "space", id: ctx.space },
    title: data.service,
    data,
    collapseKey,
  }))
    await sendOne(ctx, line);
});

const TASK_EVENTS: ReadonlySet<string> = new Set([
  "task.requested",
  "task.assigned",
  "task.completed",
  "task.due",
  "task.nudged",
]);

/** Who an event is for and what it says, for the events whose manifest names a notification kind. Undefined means this event files nothing. */
export function plan(ctx: NotifCtx, e: Ev): Promise<SendIn | SendIn[] | undefined> | SendIn | SendIn[] | undefined {
  const p = e.payload;
  if (TASK_EVENTS.has(e.name)) return planTask(ctx, e);
  if (e.name === "machine.alert") {
    // one line for each admin; it collapses while the same alert lasts, and the machine page is where it opens
    return adminsOf(ctx).then((to) =>
      to.map((id) => ({
        to: id,
        kind: "machine.alert",
        subject: { type: "space", id: String(p.machineId ?? "") },
        title: String(p.title ?? "A machine needs a look"),
        collapseKey: `machine.alert:${String(p.alertId ?? "")}`,
      })),
    );
  }
  if (e.name === "ci.blocked") {
    // CI cannot start machines (the runner download cannot be verified): one line for each admin, once a day
    return adminsOf(ctx).then((to) =>
      to.map((id) => ({
        to: id,
        kind: "ci.paused",
        subject: { type: "space", id: "ci" },
        title: String(p.title ?? "CI needs you"),
        collapseKey: `ci.blocked:${String(p.day ?? "")}`,
      })),
    );
  }
  if (e.name === "space.deletion_scheduled" || e.name === "space.deletion_cancelled") {
    // every Owner and Admin hears of it; the line carries the date and the way to cancel
    const scheduled = e.name === "space.deletion_scheduled";
    const title = scheduled
      ? `The Space is scheduled for deletion on ${dayOf(Number(p.at))}. Everything is removed then.`
      : "The scheduled deletion of the Space was cancelled.";
    return adminsOf(ctx).then((to) =>
      to.map((id) => ({
        to: id,
        kind: e.name,
        subject: { type: "space", id: ctx.space },
        title,
        collapseKey: `${e.name}:${String(p.at ?? p.by ?? "")}`,
      })),
    );
  }
  if (e.name === "ci.paused") {
    // the monthly cap is reached: one line for each admin, once for the month
    return adminsOf(ctx).then((to) =>
      to.map((id) => ({
        to: id,
        kind: "ci.paused",
        subject: { type: "space", id: "ci" },
        title: String(p.title ?? "CI paused"),
        collapseKey: `ci.paused:${String(p.month ?? "")}`,
      })),
    );
  }
  if (e.name === "hook.admin_asked") {
    // one line for each admin: who asked, and which hook stopped what
    return adminsOf(ctx).then((to) =>
      to
        .filter((id) => id !== p.by)
        .map((id) => ({
          to: id,
          kind: "hook.asked",
          subject: { type: "thread", id: String(p.threadId ?? "") },
          title:
            `${String(p.line ?? "A hook stopped something")}${typeof p.note === "string" && p.note !== "" ? `: ${p.note}` : ""}`.slice(
              0,
              200,
            ),
          collapseKey: `hook.asked:${String(p.hookId ?? "")}:${String(p.by ?? "")}`,
        })),
    );
  }
  // Something is down (f-wire, 12 Nov): a health check that turned degraded or down, a backup, an update or a certificate that failed reaches every admin; it collapses while the same thing stays down
  if (e.name === "health.changed") {
    if (p.to !== "degraded" && p.to !== "down") return undefined;
    const key = String(p.key ?? "");
    return toAdmins(ctx, {
      kind: "health.degraded",
      subject: { type: "space", id: ctx.space },
      title: healthTitle(key),
      data: { service: healthTitle(key), state: p.to === "down" ? "down" : "slow" },
      collapseKey: `health.degraded:${key}`,
    });
  }
  if (e.name === "backup.failed" || e.name === "update.failed" || e.name === "network.certificate_failed") {
    const service =
      e.name === "backup.failed"
        ? "The backup"
        : e.name === "update.failed"
          ? "The update"
          : `The certificate for ${String(p.host ?? "this Space")}`;
    return toAdmins(ctx, {
      kind: "health.degraded",
      subject: { type: "space", id: ctx.space },
      title: service,
      data: { service, state: "failing" },
      collapseKey: `health.degraded:${e.name}`,
    });
  }
  // an AI incident goes to the person who owns it, at once (an Interrupt that respects no hours)
  if (
    (e.name === "incident.opened" || e.name === "incident.assigned") &&
    typeof p.ownerId === "string" &&
    p.ownerId.startsWith("usr_")
  ) {
    const what = typeof p.kind === "string" && p.kind !== "" ? p.kind.replaceAll("_", " ") : "an AI incident";
    return {
      to: p.ownerId,
      kind: "incident.owned",
      title: what,
      collapseKey: `incident.owned:${String(p.incidentId ?? "")}`,
    } as never;
  }
  // A sync that needs a person: every admin hears it once per thing that needs them; a device's own rejected change goes to that device's person
  if (SYNC_ATTENTION[e.name]) {
    const device = SYNC_ATTENTION[e.name]!(p);
    const id = String(p.connectionId ?? p.mountId ?? p.sourceId ?? p.syncTypeId ?? p.key ?? "");
    if (e.name === "sync.op_rejected")
      return typeof p.personId === "string"
        ? {
            to: p.personId,
            kind: "sync.attention",
            title: device,
            data: { device },
            collapseKey: `sync.attention:${e.name}:${String(p.deviceId ?? "")}`,
          }
        : undefined;
    return toAdmins(ctx, {
      kind: "sync.attention",
      subject: { type: "space", id: ctx.space },
      title: device,
      data: { device },
      collapseKey: `sync.attention:${e.name}:${id}`,
    });
  }
  // a site build that failed: the person who started it hears it as a failed run (a system start has nobody to tell). A failed import needs nothing here: its own Run fails, and run.failed tells its owner
  if (e.name === "site.build_failed" && typeof e.actor === "string" && e.actor.startsWith("usr_")) {
    const name = "The site build";
    return {
      to: e.actor,
      kind: "run.failed",
      ...(typeof p.runId === "string" && p.runId !== ""
        ? { subject: { type: "run", id: p.runId }, runId: p.runId }
        : {}),
      data: { name, message: String(p.error ?? p.reason ?? "it stopped") },
    } as never;
  }
  if (e.name === "run.succeeded" && p.kind === "routine" && ctx.call) {
    // Alerts: a routine that succeeded is told only to people who asked for successes too (failures always come through run.failed)
    return ctx.call("runs.get", { runId: p.runId }).then(
      (r) => {
        const run = (r as { run?: { owner?: string; name?: string; summary?: string } }).run;
        if (!run?.owner || !readSettings(ctx.db, run.owner).routinesAll) return undefined;
        return {
          to: run.owner,
          kind: "agent.task_finished",
          subject: { type: "run", id: String(p.runId) },
          title: run.name ?? run.summary ?? "a routine",
          data: { agent: "Your routine" },
          runId: String(p.runId),
        };
      },
      () => undefined,
    );
  }
  if ((e.name === "access.granted" || e.name === "access.declined") && typeof p.requester === "string") {
    const r = p.resource as { type?: string } | undefined;
    return {
      to: p.requester,
      kind: "access.decided",
      title: r?.type ?? "this",
      data: { decision: e.name === "access.granted" ? "approved" : "declined" },
    };
  }
  if (e.name === "access.shared_with" && typeof p.to === "string") {
    // "Irfad shared Dex with you", with the line the sharer wrote, in the Inbox
    const r = p.resource as { type?: string; id?: string } | undefined;
    return {
      to: p.to,
      kind: "item.shared",
      ...(r?.type && r.id ? { subject: { type: r.type, id: r.id } } : {}),
      title: String(p.title ?? "something"),
      data: {
        from: String(p.byName ?? "Someone"),
        ...(typeof p.message === "string" && p.message ? { message: p.message } : {}),
      },
      collapseKey: `item.shared:${r?.id ?? ""}:${p.to}`,
    } as never;
  }
  if (e.name === "run.failed")
    return {
      to: String(p.owner),
      kind: "run.failed",
      subject: { type: "run", id: String(p.runId) },
      data: { name: p.kind, message: p.message },
      runId: String(p.runId),
    };
  if (e.name === "member.join_requested") {
    // someone opened the Request to join link and asked in: one line for each admin; it collapses while the same person's request waits
    const name = String(p.name ?? "").trim() || "Someone";
    const space = ctx.call
      ? ctx.call("spaces.get", {}).then(
          (r) => (r as { space?: { name?: string } } | null)?.space?.name,
          () => undefined,
        )
      : Promise.resolve(undefined);
    return Promise.all([adminsOf(ctx), space]).then(([to, sp]) =>
      to.map((id) => ({
        to: id,
        kind: "member.join_requested",
        subject: { type: "space", id: ctx.space },
        title: name,
        data: { name, space: sp || "the Space" },
        collapseKey: `member.join_requested:${String(p.requestId ?? "")}`,
      })),
    );
  }
  if (e.name === "member.joined") {
    // the line names the person, never their id: the directory answers, and "A new member" stands in when it cannot
    const filed = (name: string, space: string) => ({
      to: String(p.invitedBy),
      kind: "member.joined",
      title: name,
      data: { name, space },
    });
    const call = ctx.call;
    if (!call) return filed("A new member", "the Space");
    const who = call("access.principals.get", { principal: { kind: "person", id: String(p.personId) } }).then(
      (r) => (r as { principal?: { name?: string } } | null)?.principal?.name,
      () => undefined,
    );
    const where = call("spaces.get", {}).then(
      (r) => (r as { space?: { name?: string } } | null)?.space?.name,
      () => undefined,
    );
    return Promise.all([who, where]).then(([name, space]) =>
      filed(name && !/^usr_/.test(name) ? name : "A new member", space || "the Space"),
    );
  }
  return undefined;
}

/** How long the fanout remembers who it reached for an event (a redelivery after a stop or a crash comes at the next start). */
const FANOUT_KEEP_MS = 30 * 86_400_000;

/** Async consumers by name: the events each one reads and what it does with one. */
export const consumers = {
  "notifications.fanout": {
    on: [
      "task.requested",
      "task.assigned",
      "task.completed",
      "task.due",
      "task.nudged",
      "run.failed",
      "run.succeeded",
      "member.joined",
      "member.join_requested",
      "access.granted",
      "access.declined",
      "machine.alert",
      "access.shared_with",
      "space.deletion_scheduled",
      "space.deletion_cancelled",
      "ci.paused",
      "ci.blocked",
      "hook.admin_asked",
      "health.changed",
      "backup.failed",
      "update.failed",
      "network.certificate_failed",
      "incident.opened",
      "incident.assigned",
      "site.build_failed",
      "connection.needs_reconnect",
      "connector.publish_failed",
      "mount.failed",
      "mount.conflict",
      "source.mapping_failed",
      "source.link_pending",
      "sync.deletes_paused",
      "sync.push_failed",
      "sync.schema_changed",
      "sync.op_rejected",
    ],
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> {
      const planned = await plan(ctx, event);
      const out: string[] = [];
      if (event.id) {
        // a redelivery comes within minutes; a month is far past any
        ctx.db.run("DELETE FROM notifications_fanout_sent WHERE at < ?", ctx.now() - FANOUT_KEEP_MS);
        ctx.db.run("DELETE FROM notifications_fanout_email WHERE at < ?", ctx.now() - FANOUT_KEEP_MS);
      }
      // one dead mail server for the whole delivery: once a recipient's email has failed every try, the others are not tried again and again (rules.ts emailWithRetry)
      const mail = { down: false };
      let unsent = 0;
      for (const input of planned === undefined ? [] : Array.isArray(planned) ? planned : [planned]) {
        // The host hands a consumer the same event again after a crash or after a stop let it go mid-run (it is at least once). Each recipient is written down before it is sent to, and the
        // notification it got is written once the send answered:
        //   mark with a notification   reached: not sent again; an email that failed every try (notifications_fanout_email) is sent again, alone
        //   mark with none            cut off before the send answered: sent again, the kind's email included even when the row collapses into the one filed
        //   no mark                   not reached yet: sent
        // A send that throws takes its mark back. One mark covers the row and the push: a failed push is not tried again. An event with no id is not remembered.
        // A pending email is sent again by the next delivery of the same event, or by the periodic pass (retryPendingEmails, bounded).
        const target = `${input.to}|${input.kind}|${input.subject ? `${input.subject.type}:${input.subject.id}` : ""}|${input.collapseKey ?? ""}`;
        let redo = false;
        if (event.id) {
          const fresh =
            ctx.db.run(
              "INSERT OR IGNORE INTO notifications_fanout_sent (event_id, target, notification_id, at) VALUES (?, ?, NULL, ?)",
              event.id,
              target,
              ctx.now(),
            ).changes > 0;
          if (!fresh) {
            const had = (
              ctx.db.all(
                "SELECT notification_id FROM notifications_fanout_sent WHERE event_id = ? AND target = ?",
                event.id,
                target,
              )[0] as { notification_id?: string | null } | undefined
            )?.notification_id;
            if (had) {
              if (
                ctx.db.all(
                  "SELECT 1 AS x FROM notifications_fanout_email WHERE event_id = ? AND target = ?",
                  event.id,
                  target,
                ).length > 0
              ) {
                if (
                  (DELETION_KINDS.has(input.kind) && supersededFor(ctx, input.to, had)) ||
                  (await resendKindEmail(ctx, input.to, had, mail))
                )
                  ctx.db.run(
                    "DELETE FROM notifications_fanout_email WHERE event_id = ? AND target = ?",
                    event.id,
                    target,
                  );
                else unsent++;
              }
              out.push(had);
              continue;
            }
            redo = true;
          }
        }
        let r: Awaited<ReturnType<typeof sendOne>>;
        try {
          r = await sendOne(ctx, input, false, redo, mail);
        } catch (e) {
          if (event.id)
            ctx.db.run("DELETE FROM notifications_fanout_sent WHERE event_id = ? AND target = ?", event.id, target);
          throw e;
        }
        if (event.id && r.notificationId)
          ctx.db.run(
            "UPDATE notifications_fanout_sent SET notification_id = ? WHERE event_id = ? AND target = ?",
            r.notificationId,
            event.id,
            target,
          );
        if (event.id && r.emailFailed)
          ctx.db.run(
            "INSERT OR IGNORE INTO notifications_fanout_email (event_id, target, at) VALUES (?, ?, ?)",
            event.id,
            target,
            ctx.now(),
          );
        if (r.emailFailed) unsent++;
        if (r.notificationId) out.push(r.notificationId);
      }
      if (unsent > 0)
        ctx.log?.warn("the fanout could not send every email; the ones left are tried again by the periodic pass", {
          unsent,
        });
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
    async run(ctx: NotifCtx, event: Ev): Promise<string[]> {
      return syncSetting(ctx.db, event.payload) ? [String(event.payload.key)] : [];
    },
  },
};

const EMAIL_LOG_KEEP_MS = 90 * 86_400_000;
const DELETION_KINDS: ReadonlySet<string> = new Set(["space.deletion_scheduled", "space.deletion_cancelled"]);
/** A newer deletion notice of either kind for the person than this one: this one's email is old news. */
function supersededFor(ctx: NotifCtx, person: string, notificationId: string): boolean {
  return (
    ctx.db.all(
      `SELECT 1 AS x FROM notifications_items n, notifications_items o WHERE o.id = ? AND n.person = ? AND n.id <> o.id
    AND n.kind IN ('space.deletion_scheduled', 'space.deletion_cancelled') AND (n.at > o.at OR (n.at = o.at AND n.rowid > o.rowid))`,
      notificationId,
      person,
    ).length > 0
  );
}
/** How many times the periodic pass tries a pending email before it gives up and admins are told. */
export const EMAIL_RETRY_TRIES = 5;

/**
 * A Space deletion email that failed every try in its delivery (notifications_fanout_email) is tried again every ten minutes, up to EMAIL_RETRY_TRIES times; then it is given up and every admin's
 * Console names the person once ("Notice email to Bob is failing: a notice about deleting this Space could not be emailed."). A pending deletion email that a newer deletion notice superseded is dropped. A pass that finds the mail server down stops for this round.
 */
export async function retryPendingEmails(ctx: NotifCtx): Promise<{ sent: number; failed: number; gaveUp: number }> {
  const rows = ctx.db
    .all(`SELECT e.event_id AS eventId, e.target AS target, s.notification_id AS notificationId, COALESCE(t.tries, 0) AS tries
    FROM notifications_fanout_email e JOIN notifications_fanout_sent s ON s.event_id = e.event_id AND s.target = e.target
    LEFT JOIN notifications_email_tries t ON t.event_id = e.event_id AND t.target = e.target ORDER BY e.at LIMIT 50`) as Array<{
    eventId: string;
    target: string;
    notificationId: string | null;
    tries: number;
  }>;
  // the record of what became of each email (sent, or why not) keeps ninety days
  ctx.db.run("DELETE FROM notifications_email_log WHERE at < ?", ctx.now() - EMAIL_LOG_KEEP_MS);
  const mail = { down: false };
  const out = { sent: 0, failed: 0, gaveUp: 0 };
  const clear = (r: { eventId: string; target: string }): void => {
    ctx.db.run("DELETE FROM notifications_fanout_email WHERE event_id = ? AND target = ?", r.eventId, r.target);
    ctx.db.run("DELETE FROM notifications_email_tries WHERE event_id = ? AND target = ?", r.eventId, r.target);
  };
  for (const r of rows) {
    if (mail.down) break;
    const [person = "", kind = ""] = r.target.split("|");
    if (!r.notificationId || !person) {
      clear(r);
      continue;
    }
    if (DELETION_KINDS.has(kind) && supersededFor(ctx, person, r.notificationId)) {
      clear(r);
      continue;
    }
    if (Number(r.tries) >= EMAIL_RETRY_TRIES) {
      clear(r);
      out.gaveUp++;
      await pushPort()
        ?.gaveUp?.({ to: person, kind })
        .catch(() => undefined);
      await tellEmailGaveUp(ctx, person, kind);
      continue;
    }
    if (await resendKindEmail(ctx, person, r.notificationId, mail)) {
      clear(r);
      out.sent++;
      continue;
    }
    out.failed++;
    ctx.db.run(
      "INSERT INTO notifications_email_tries (event_id, target, tries, at) VALUES (?, ?, 1, ?) ON CONFLICT(event_id, target) DO UPDATE SET tries = tries + 1, at = excluded.at",
      r.eventId,
      r.target,
      ctx.now(),
    );
  }
  return out;
}

export const periodic = {
  "notifications.email_retry": {
    everyMs: 10 * 60_000,
    run: (ctx: NotifCtx): Promise<{ sent: number; failed: number; gaveUp: number }> => retryPendingEmails(ctx),
  },
};
