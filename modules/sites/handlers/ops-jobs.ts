// Scheduled jobs and workers of a site, for the app and for agents (r42-sites-run, slice 5). The supervisor (ops/supervisor.ts) does the running; these handlers write what a person or an agent asked for onto the rows it reads, through the state machines (ops/jobs.ts, ops/workers.ts).
//   jobs      a command that runs in the site's own image on a schedule, with a history: sites.jobs_list, job_create, job_update, job_delete, job_run, job_cancel, job_runs
//   workers   a process of the site's image that stays up, restarted with a growing wait and stopped for good after a crash loop: sites.services_list, service_add, service_restart, service_stop, service_remove
// Every call names the site and the job, run or service, and the job, run or service must belong to that site.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, mustSite, nid, optBool, optInt, optStr, rec, reqStr, str } from "./deploy.ts";
import { siteRunner } from "./route.ts";
import { describe as describeCron, next as nextRun, parseCron, validZone } from "../ops/cron.ts";
import { checkJob, runNow, step, words } from "../ops/jobs.ts";
import type { Job, Run } from "../ops/jobs.ts";
import { advance, fresh } from "../ops/workers.ts";
import type { ServiceKind } from "../ops/workers.ts";
import * as st from "../ops/store.ts";

const NAME_MAX = 60;
const DEFAULT_ZONE = "UTC";
const DEFAULT_TIMEOUT = 600;
const SERVICE_MAX = 10;
const JOB_MAX = 20;

function cleanName(ctx: Ctx, v: string): string {
  const n = v.trim();
  if (n === "" || n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n))
    fail(ctx, "validation.bad_input", `A name is 1 to ${NAME_MAX} characters.`, { field: "name" });
  return n;
}

function command(ctx: Ctx, v: string): string[] {
  const w = words(v);
  if (w === null)
    fail(ctx, "validation.bad_input", "That command has a quote that is never closed.", { field: "command" });
  return w;
}

function jobOf(ctx: Ctx, siteId: string, jobId: string): Job {
  const j = st.getJob(ctx.db, jobId);
  if (!j || j.siteId !== siteId) fail(ctx, "validation.not_found", "That job does not exist.");
  return j;
}

export interface RunOut {
  runId: string;
  jobId: string;
  state: string;
  at: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  note?: string;
  by: string;
}
const runOut = (r: Run): RunOut => ({
  runId: r.id,
  jobId: r.jobId,
  state: r.state,
  at: r.queuedAt,
  by: r.by,
  ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
  ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
  ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
  ...(r.note ? { note: r.note } : {}),
});

function jobRow(ctx: Ctx, j: Job): Record<string, unknown> {
  const runs = st.listRuns(ctx.db, j.id, 1);
  let nextAt: number | undefined;
  try {
    nextAt = j.enabled ? (nextRun(parseCron(j.schedule), ctx.now(), j.zone) ?? undefined) : undefined;
  } catch {
    nextAt = undefined;
  }
  return {
    jobId: j.id,
    siteId: j.siteId,
    name: j.name,
    schedule: j.schedule,
    when: describeCron(j.schedule),
    command: j.command.map((w) => (/[\s"']/.test(w) || w === "" ? JSON.stringify(w) : w)).join(" "),
    zone: j.zone,
    enabled: j.enabled,
    timeoutSec: j.timeoutSec,
    ...(nextAt !== undefined ? { nextAt } : {}),
    ...(runs[0] ? { last: runOut(runs[0]) } : {}),
  };
}

async function jobsList(ctx: Ctx, input: unknown): Promise<{ jobs: Record<string, unknown>[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  return { jobs: st.listJobs(ctx.db, str(site.id)).map((j) => jobRow(ctx, j)) };
}

async function jobCreate(ctx: Ctx, input: unknown): Promise<{ job: Record<string, unknown> }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  if (st.listJobs(ctx.db, siteId).length >= JOB_MAX)
    fail(ctx, "validation.precondition_failed", `A site has at most ${JOB_MAX} jobs.`);
  const j: Job = {
    id: nid(ctx, "job"),
    siteId,
    name: cleanName(ctx, reqStr(ctx, o, "name")),
    schedule: reqStr(ctx, o, "schedule").trim(),
    command: command(ctx, reqStr(ctx, o, "command")),
    zone: optStr(ctx, o, "zone") ?? DEFAULT_ZONE,
    enabled: true,
    timeoutSec: optInt(ctx, o, "timeoutSec") ?? DEFAULT_TIMEOUT,
    lastSlot: 0,
  };
  const bad = checkJob(j, validZone);
  if (bad) fail(ctx, "validation.bad_input", bad);
  st.insertJob(ctx.db, j, ctx.principal.id, ctx.now());
  return { job: jobRow(ctx, j) };
}

async function jobUpdate(ctx: Ctx, input: unknown): Promise<{ job: Record<string, unknown> }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const was = jobOf(ctx, str(site.id), reqStr(ctx, o, "jobId"));
  const cmd = optStr(ctx, o, "command");
  const name = optStr(ctx, o, "name");
  const on = optBool(ctx, o, "enabled");
  let j: Job = {
    ...was,
    ...(name !== undefined ? { name: cleanName(ctx, name) } : {}),
    ...(optStr(ctx, o, "schedule") !== undefined ? { schedule: (optStr(ctx, o, "schedule") as string).trim() } : {}),
    ...(cmd !== undefined ? { command: command(ctx, cmd) } : {}),
    ...(optStr(ctx, o, "zone") !== undefined ? { zone: optStr(ctx, o, "zone") as string } : {}),
    ...(optInt(ctx, o, "timeoutSec") !== undefined ? { timeoutSec: optInt(ctx, o, "timeoutSec") as number } : {}),
  };
  const bad = checkJob(j, validZone);
  if (bad) fail(ctx, "validation.bad_input", bad);
  // turning a job on again does not run what was missed while it was off; a new schedule starts from now
  if ((on === true && !was.enabled) || j.schedule !== was.schedule || j.zone !== was.zone)
    j = { ...j, lastSlot: ctx.now() - (ctx.now() % 60_000) };
  if (on !== undefined) j = { ...j, enabled: on };
  st.saveJob(ctx.db, j);
  return { job: jobRow(ctx, j) };
}

async function jobDelete(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const j = jobOf(ctx, str(site.id), reqStr(ctx, o, "jobId"));
  const r = siteRunner();
  for (const run of st.openRuns(ctx.db, j.siteId))
    if (run.jobId === j.id) {
      if (run.containerId) await r?.remove(run.containerId).catch(() => undefined);
      const s = step(run, { t: "cancel", at: ctx.now() }, j);
      if (s.ok) st.saveRun(ctx.db, s.run, run.state);
    }
  st.deleteJob(ctx.db, j.id, ctx.now());
  return { removed: true };
}

async function jobRun(ctx: Ctx, input: unknown): Promise<{ run: RunOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const j = jobOf(ctx, str(site.id), reqStr(ctx, o, "jobId"));
  const open = st.openRuns(ctx.db, j.siteId).filter((r) => r.jobId === j.id);
  const ok = runNow(j, open, ctx.now());
  if (!ok.ok) fail(ctx, "validation.precondition_failed", ok.why);
  const run: Run = {
    id: nid(ctx, "jrx"),
    jobId: j.id,
    state: "queued",
    slot: ok.slot,
    by: "person",
    queuedAt: ctx.now(),
  };
  st.insertRun(ctx.db, j.siteId, run);
  return { run: runOut(run) };
}

async function jobCancel(ctx: Ctx, input: unknown): Promise<{ run: RunOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const run = st.getRun(ctx.db, reqStr(ctx, o, "runId"));
  if (!run || run.siteId !== str(site.id)) fail(ctx, "validation.not_found", "That run does not exist.");
  const j = st.getJob(ctx.db, run.jobId);
  if (run.containerId)
    await siteRunner()
      ?.remove(run.containerId)
      .catch(() => undefined);
  const s = step(run, { t: "cancel", at: ctx.now() }, { timeoutSec: j?.timeoutSec ?? DEFAULT_TIMEOUT });
  if (!s.ok) fail(ctx, "validation.precondition_failed", "That run has already ended.");
  if (!s.same) st.saveRun(ctx.db, s.run, run.state);
  return { run: runOut(s.run) };
}

async function jobRuns(ctx: Ctx, input: unknown): Promise<{ runs: RunOut[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const j = jobOf(ctx, str(site.id), reqStr(ctx, o, "jobId"));
  const limit = optInt(ctx, o, "limit") ?? 20;
  if (limit < 1 || limit > 50)
    fail(ctx, "validation.bad_input", "A read is between 1 and 50 runs.", { field: "limit" });
  return { runs: st.listRuns(ctx.db, j.id, limit).map(runOut) };
}

// ---- workers

const serviceRow = (v: st.ServiceRow): Record<string, unknown> => ({
  serviceId: v.id,
  siteId: v.siteId,
  name: v.name,
  kind: v.kind,
  command: v.command.join(" "),
  state: v.state,
  ...(v.note ? { note: v.note } : {}),
  ...(v.startedAt !== undefined ? { startedAt: v.startedAt } : {}),
  ...(v.restartAt !== undefined ? { restartAt: v.restartAt } : {}),
});

function serviceOf(ctx: Ctx, siteId: string, id: string): st.ServiceRow {
  const v = st.getService(ctx.db, id);
  if (!v || v.siteId !== siteId) fail(ctx, "validation.not_found", "That worker does not exist.");
  return v;
}

async function servicesList(ctx: Ctx, input: unknown): Promise<{ services: Record<string, unknown>[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  return { services: st.listServices(ctx.db, str(site.id)).map(serviceRow) };
}

async function serviceAdd(ctx: Ctx, input: unknown): Promise<{ service: Record<string, unknown> }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  if (st.listServices(ctx.db, siteId).length >= SERVICE_MAX)
    fail(ctx, "validation.precondition_failed", `A site has at most ${SERVICE_MAX} workers.`);
  const cmd = command(ctx, reqStr(ctx, o, "command"));
  if (cmd.length === 0) fail(ctx, "validation.bad_input", "Give the command to run.", { field: "command" });
  const kind = (optStr(ctx, o, "kind") ?? "worker") as ServiceKind;
  if (kind !== "worker")
    fail(ctx, "validation.bad_input", "Only a worker can be added here: the web process is the site itself.", {
      field: "kind",
    });
  const id = nid(ctx, "wkr");
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  st.insertService(ctx.db, { id, siteId, name, kind, command: cmd, at: ctx.now() });
  const v = advance(fresh(id, siteId, name, kind), { t: "want", at: ctx.now() }).service;
  st.saveService(ctx.db, v);
  return { service: serviceRow(serviceOf(ctx, siteId, id)) };
}

async function serviceAct(
  ctx: Ctx,
  input: unknown,
  ev: "restart" | "stop",
): Promise<{ service: Record<string, unknown> }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const v = serviceOf(ctx, str(site.id), reqStr(ctx, o, "serviceId"));
  const out = advance(v, { t: ev, at: ctx.now() });
  // the container goes now; the supervisor starts the new one on its next tick
  if (v.containerId)
    await siteRunner()
      ?.remove(v.containerId)
      .catch(() => undefined);
  st.saveService(ctx.db, out.service, null);
  return { service: serviceRow(serviceOf(ctx, v.siteId, v.id)) };
}

async function serviceRemove(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const v = serviceOf(ctx, str(site.id), reqStr(ctx, o, "serviceId"));
  if (v.containerId)
    await siteRunner()
      ?.remove(v.containerId)
      .catch(() => undefined);
  st.deleteService(ctx.db, v.id, ctx.now());
  return { removed: true };
}

export const jobHandlers = {
  "sites.jobs_list": (ctx: Ctx, input: unknown) => jobsList(ctx, input),
  "sites.job_create": (ctx: Ctx, input: unknown) => jobCreate(ctx, input),
  "sites.job_update": (ctx: Ctx, input: unknown) => jobUpdate(ctx, input),
  "sites.job_delete": (ctx: Ctx, input: unknown) => jobDelete(ctx, input),
  "sites.job_run": (ctx: Ctx, input: unknown) => jobRun(ctx, input),
  "sites.job_cancel": (ctx: Ctx, input: unknown) => jobCancel(ctx, input),
  "sites.job_runs": (ctx: Ctx, input: unknown) => jobRuns(ctx, input),
  "sites.services_list": (ctx: Ctx, input: unknown) => servicesList(ctx, input),
  "sites.service_add": (ctx: Ctx, input: unknown) => serviceAdd(ctx, input),
  "sites.service_restart": (ctx: Ctx, input: unknown) => serviceAct(ctx, input, "restart"),
  "sites.service_stop": (ctx: Ctx, input: unknown) => serviceAct(ctx, input, "stop"),
  "sites.service_remove": (ctx: Ctx, input: unknown) => serviceRemove(ctx, input),
};
