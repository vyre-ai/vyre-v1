// CI runners module (lane l-ci-runners): a Space's GitHub Actions jobs run on throwaway cloud machines the Space pays for, with the Space's own cloud key.
// The github module turns a workflow_job webhook into workflow_job.queued and workflow_job.completed events; this module reads them (consumers), starts and deletes the machines, and sweeps every 2 minutes.
import type { Handler } from "../../host/src/invoke.ts";
import { costMonth, projectGet, runsGet, runsList } from "./handlers/read.ts";
import { intake, sweep } from "./handlers/runner.ts";
import type { JobIn } from "./handlers/runner.ts";
import { settingsGet, settingsSet } from "./handlers/settings.ts";
import { setCiHost } from "./projections.ts";
import type { CiCtx } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "ci.settings.get": (ctx) => settingsGet(ctx as unknown as CiCtx),
  "ci.settings.set": (ctx, i) => settingsSet(ctx as unknown as CiCtx, i as never),
  "ci.runs.list": (ctx, i) => runsList(ctx as unknown as CiCtx, i as never),
  "ci.runs.get": (ctx, i) => runsGet(ctx as unknown as CiCtx, i as never),
  "ci.cost.month": (ctx, i) => costMonth(ctx as unknown as CiCtx, i as never),
  "ci.project.get": (ctx, i) => projectGet(ctx as unknown as CiCtx, i as never),
};

interface JobEvent { name: string; payload: { repo: string; jobId: number; runId: number; name?: string; labels?: string[]; fork?: "no" | "yes" | "unknown"; conclusion?: string } }
const asJob = (e: JobEvent): JobIn => ({ action: e.name === "workflow_job.queued" ? "queued" : "completed", repo: e.payload.repo, jobId: e.payload.jobId, runId: e.payload.runId, name: e.payload.name, labels: e.payload.labels ?? [], fork: e.payload.fork, conclusion: e.payload.conclusion });

export const consumers = {
  /** A job is waiting for a runner, or ended: start or delete its machine. At least once, so each is safe to repeat (a job is one row). */
  "ci.workflow_job": {
    on: ["workflow_job.queued", "workflow_job.completed"],
    run: async (ctx: CiCtx, event: JobEvent): Promise<string[]> => [(await intake(ctx, asJob(event))).handled],
  },
};
export const projections = { inline: {}, consumers };

/** Every 2 minutes: the sweeper. */
export const periodic = {
  "ci.sweep": { everyMs: 120_000, run: async (ctx: CiCtx): Promise<string[]> => { const r = await sweep(ctx); return r.deleted || r.started ? [`deleted ${r.deleted}, started ${r.started}`] : []; } },
};

/** The host's half: the cloud key's Vault read and the provider's API (host/src/seams/ci.ts). */
export const hostSeams = { setCiHost };
