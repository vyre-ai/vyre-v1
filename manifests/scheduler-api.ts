// scheduler-api (lane L6): the typed face of the host scheduler (ctx.schedule) and the wait registry behind runs.wait_for (spec 2.12, 2.13;
// architecture 6.8, 7.7). Schedules fire a capability call as their owner; waits wake a thread, a Run step or a Journey when an event matches.
// DECISION: if-missed follows spec 2.12: per schedule 'skip' or 'run_once'; the default is run once if within the missed window (setting, 60 minutes), else skip
// with a note in the owner digest. scheduler.catch_up applies it after the server was down.
// DECISION: scheduler.schedule and scheduler.waits.* are system capabilities (no tool): agents schedule through routines (agents) and wait through runs.wait_for.
import { defineManifest, ev, health, read, setting, t, write } from "../packages/contracts/src/index.ts";
import { cron, id, pageIn, pageOut, resourceRef, runStarted } from "./_common.ts";

const scheduleId = t.id("sch");
const waitId = t.id("wat");
const ifMissed = t.enm("skip", "run_once");
const owner = t.obj({
  kind: t.enm("automation", "journey", "agent_routine", "gate", "task", "system", "goal"),
  id: t.str({ examples: ["aut_a1b2c3"] }),
});
const when = t.union(t.obj({ at: t.ts() }), t.obj({ cron, tz: t.str({ examples: ["Asia/Karachi"] }) }));
const wakeKind = t.enm("call", "routine", "watch", "goal", "baton");
const wakeScope = t.enm("private", "shared", "room");
const wakeOverlap = t.enm("skip", "coalesce");
const wakeQuiet = t.obj({ from: t.str({ examples: ["22:00"] }), to: t.str({ examples: ["08:00"] }) });
const scheduleRow = t.obj({
  id: scheduleId,
  owner,
  principal: t.str({ description: "The principal the call runs as" }),
  cap: t.str({ examples: ["automations.fire"] }),
  when,
  ifMissed,
  active: t.bool(),
  pausedReason: t.opt(t.str()),
  nextAt: t.opt(t.ts()),
  lastFiredAt: t.opt(t.ts()),
  createdAt: t.ts(),
  zone: t.opt(
    t.str({
      description: "The zone the wake keeps its clock in; absent follows the Space",
      examples: ["Asia/Karachi"],
    }),
  ),
  scope: t.opt(wakeScope),
  person: t.opt(id.user),
});
const waitOn = t.union(
  t.obj({ event: t.str(), filter: t.opt(t.json()) }),
  t.obj({ run: id.run }),
  t.obj({ at: t.ts() }),
);
const waitRow = t.obj({
  id: waitId,
  runId: id.run,
  on: waitOn,
  subject: t.opt(resourceRef),
  threadId: t.opt(id.thread),
  stepId: t.opt(t.str()),
  expiresAt: t.ts(),
  cancelsOn: t.arr(t.str()),
  state: t.enm("open", "matched", "expired", "canceled"),
  createdAt: t.ts(),
});
const status = { state: t.enm("healthy", "degraded", "down"), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };

export default defineManifest({
  id: "scheduler-api",
  title: "Scheduler",
  owner: "L6",
  events: [
    ev("schedule.created", "A schedule was created", {
      p: { scheduleId, owner, nextAt: t.opt(t.ts()) },
      subject: ["entity", "/scheduleId"],
    }),
    ev("schedule.canceled", "A schedule was canceled", {
      p: { scheduleId, owner, by: t.str() },
      subject: ["entity", "/scheduleId"],
    }),
    ev("schedule.fired", "A schedule fired its call", {
      p: { scheduleId, owner, runId: t.opt(id.run), scheduledFor: t.ts(), late: t.bool() },
      subject: ["entity", "/scheduleId"],
      retention: "run_logs",
    }),
    ev("schedule.missed", "A schedule was missed while the server was down and handled by its if-missed rule", {
      p: { scheduleId, owner, scheduledFor: t.ts(), handling: t.enm("ran_once", "skipped"), note: t.opt(t.str()) },
      subject: ["entity", "/scheduleId"],
      retention: "run_logs",
    }),
    ev("schedule.paused", "A schedule was paused, with the visible reason", {
      p: { scheduleId, owner, reason: t.str() },
      subject: ["entity", "/scheduleId"],
    }),
    ev("schedule.resumed", "A paused schedule resumed", {
      p: { scheduleId, owner },
      subject: ["entity", "/scheduleId"],
    }),
    ev("wait.registered", "A background wait was registered", {
      p: { waitId, runId: id.run, on: waitOn, expiresAt: t.ts() },
      subject: ["run", "/runId"],
      retention: "run_logs",
    }),
    ev("wait.matched", "A wait matched an event, a Run or a time and woke its thread", {
      p: { waitId, runId: id.run, matchedEventId: t.opt(id.event) },
      subject: ["run", "/runId"],
      retention: "run_logs",
    }),
    ev("wait.expired", "A wait reached its timeout", {
      p: { waitId, runId: id.run },
      subject: ["run", "/runId"],
      retention: "run_logs",
    }),
    ev(
      "wait.canceled",
      "A wait was canceled: its subject record was deleted or left the stage, or the Run was stopped",
      {
        p: { waitId, runId: id.run, reason: t.enm("subject_deleted", "left_stage", "stopped", "manual") },
        subject: ["run", "/runId"],
        retention: "run_logs",
      },
    ),
  ],
  capabilities: [
    write(
      "scheduler.schedule",
      "Schedule a capability call at a time or on a cron as a principal, with an if-missed rule",
      {
        in: {
          owner,
          cap: t.str({ examples: ["automations.fire"] }),
          input: t.json(),
          when,
          ifMissed: t.opt(ifMissed),
          principal: t.opt(t.str()),
          kind: t.opt(wakeKind),
          person: t.opt(id.user),
          agentId: t.opt(id.agent),
          scope: t.opt(wakeScope),
          roomId: t.opt(id.channel),
          zone: t.opt(t.str({ examples: ["Asia/Karachi"] })),
          quiet: t.opt(wakeQuiet),
          overlap: t.opt(wakeOverlap),
          answerWithinMin: t.opt(t.int({ minimum: 1 })),
          maxAttempts: t.opt(t.int({ minimum: 1, maximum: 10 })),
        },
        out: { scheduleId, nextAt: t.opt(t.ts()) },
        emits: ["schedule.created"],
        idem: "key",
      },
    ),
    write("scheduler.reschedule", "Change the time, cron or if-missed rule of a schedule", {
      in: { scheduleId, when: t.opt(when), ifMissed: t.opt(ifMissed) },
      out: { schedule: scheduleRow },
      tool: "automations",
    }),
    write("scheduler.cancel", "Cancel a schedule", {
      in: { scheduleId },
      out: { canceled: t.bool() },
      emits: ["schedule.canceled"],
      tool: "automations",
    }),
    write("scheduler.pause", "Pause a schedule with a visible reason", {
      in: { scheduleId, reason: t.str() },
      out: { schedule: scheduleRow },
      emits: ["schedule.paused"],
      tool: "automations",
    }),
    write("scheduler.resume", "Resume a paused schedule", {
      in: { scheduleId },
      out: { schedule: scheduleRow },
      emits: ["schedule.resumed"],
      tool: "automations",
    }),
    read("scheduler.list", "List schedules by owner, with next and last fire times", {
      in: { owner: t.opt(owner), active: t.opt(t.bool()), ...pageIn },
      out: { schedules: t.arr(scheduleRow), ...pageOut },
      tool: "automations",
      label: "filter",
    }),
    read("scheduler.get", "Read one schedule", {
      in: { scheduleId },
      out: { schedule: scheduleRow },
      tool: "automations",
    }),
    read("scheduler.next_times", "The next fire times of a cron or schedule, for the editor preview", {
      in: { cron, tz: t.str({ examples: ["Asia/Karachi"] }), count: t.opt(t.int({ minimum: 1, maximum: 20 })) },
      out: { times: t.arr(t.ts()) },
      tool: "automations",
    }),
    read(
      "scheduler.can_hold",
      "System: may this person hold scheduled work for this agent (a routine, a goal), and read its channel? Says why not, in reasons. Gives the answer a hand-over needs",
      {
        in: { person: id.user, agentId: id.agent, channelId: t.opt(id.channel) },
        out: {
          ok: t.bool(),
          reasons: t.arr(t.enm("not_in_space", "cannot_use_agent", "cannot_read_channel", "agent_missing")),
        },
        level: "member",
        errors: ["validation.bad_input"],
      },
    ),
    write(
      "scheduler.claim",
      "System: the engine claims a due fire of a wake. The one claim rule: only the writer whose conditional write changes the row goes on; a claim older than its lease is taken again",
      {
        in: { scheduleId, dueKey: t.str({ examples: ["1793696460000"] }), host: t.str({ examples: ["host_a"] }) },
        out: { claimed: t.bool(), fireId: t.opt(t.str()), attempt: t.opt(t.int()) },
        idem: "natural",
        errors: ["validation.not_found", "permission.no_grant"],
      },
    ),
    write(
      "scheduler.report",
      "System: the engine says how a claimed fire is going: running, waiting for a person, done, failed or stopped",
      {
        in: {
          fireId: t.str(),
          state: t.enm("running", "waiting", "done", "failed", "stopped"),
          runId: t.opt(id.run),
          note: t.opt(t.str()),
        },
        out: { ok: t.bool() },
        idem: "natural",
        errors: ["validation.not_found", "permission.no_grant"],
      },
    ),
    write("scheduler.fire", "Fire a due schedule: invoke its capability as its principal (called by the host tick)", {
      in: { scheduleId, scheduledFor: t.ts() },
      out: { runId: t.opt(id.run) },
      emits: ["schedule.fired"],
      idem: "natural",
    }),
    write(
      "scheduler.catch_up",
      "After downtime apply each schedule if-missed rule: run once if within the missed window, else skip with a note in the owner digest",
      {
        in: { since: t.ts() },
        out: { ranOnce: t.int(), skipped: t.int() },
        emits: ["schedule.missed", "schedule.fired"],
        idem: "natural",
      },
    ),
    write(
      "scheduler.waits.register",
      "Register a background wait on an event, a Run or a time with a timeout (default 30 days) and cancel conditions",
      {
        in: {
          runId: id.run,
          on: waitOn,
          timeout: t.opt(t.str({ examples: ["30d"] })),
          subject: t.opt(resourceRef),
          threadId: t.opt(id.thread),
          stepId: t.opt(t.str()),
          cancelsOn: t.opt(t.arr(t.str())),
        },
        out: { waitId, expiresAt: t.ts() },
        emits: ["wait.registered"],
        idem: "key",
      },
    ),
    write(
      "scheduler.waits.match",
      "Match an event against open waits by event type and filter hash and wake the thread, step or Journey (called by the event consumer)",
      {
        in: { eventId: id.event },
        out: { matched: t.int() },
        emits: ["wait.matched", "wait.canceled"],
        idem: "natural",
      },
    ),
    write("scheduler.waits.cancel", "Cancel a wait", {
      in: { waitId, reason: t.enm("subject_deleted", "left_stage", "stopped", "manual") },
      out: { canceled: t.bool() },
      emits: ["wait.canceled"],
    }),
    write("scheduler.waits.expire", "Expire waits past their timeout and wake their owners with a timeout result", {
      in: {},
      out: { expired: t.int() },
      emits: ["wait.expired"],
      idem: "natural",
    }),
    read("scheduler.waits.list", "List open waits by Run, subject or thread", {
      in: { runId: t.opt(id.run), subject: t.opt(resourceRef), threadId: t.opt(id.thread), ...pageIn },
      out: { waits: t.arr(waitRow), ...pageOut },
      tool: "automations",
      label: "filter",
    }),
    read("scheduler.missed", "Schedules missed in a period and what was done about each", {
      in: { since: t.ts() },
      out: {
        missed: t.arr(
          t.obj({
            scheduleId,
            owner,
            scheduledFor: t.ts(),
            handling: t.enm("ran_once", "skipped"),
            runId: t.opt(id.run),
          }),
        ),
      },
      tool: "automations",
    }),
    read("scheduler.status", "Cheap health probe of the scheduler: tick lag, due schedules, open waits", {
      in: {},
      out: { ...status, tickLagMs: t.int(), dueNow: t.int(), openWaits: t.int() },
    }),
    write("scheduler.run_now", "Fire a schedule once now without changing its cron", {
      in: { scheduleId },
      out: runStarted,
      run: { kind: "automation", stoppable: true },
      emits: ["schedule.fired"],
      tool: "automations",
    }),
  ],
  settings: [
    setting(
      "scheduler.missed_window_minutes",
      "space",
      "Automations",
      "Run a missed schedule once if it was missed by less than this many minutes",
      t.int({ minimum: 0, maximum: 1440 }),
      60,
    ),
    setting(
      "scheduler.default_wait_timeout",
      "space",
      "Automations",
      "Default timeout of a wait",
      t.str({ examples: ["30d"] }),
      "30d",
    ),
  ],
  health: [
    health(
      "scheduler",
      "Scheduler",
      "scheduler.status",
      "Restart the server from the Console; paused automations resume when the scheduler is healthy again.",
      { pauses: ["automations"], dependsOn: [] },
    ),
  ],
});
