// The one agent-facing call for site operations (r42-sites-run): sites.ops, an action and an `id` and the other fields as `args`. The actions and their args are in the sites skill, not in the tool's schema, because
// every tool's schema is paid for in every model's context. It dispatches to the same handlers the app's calls use, so the rules (ownership of the job, run, worker or backup, the lock, the safety backup) are
// written once. Restoring or deleting a backup needs manage on the site, and an agent's restore is held at the Gate.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, mustSite, rec, reqStr, str } from "./deploy.ts";
import { backupHandlers } from "./ops-backups.ts";
import { jobHandlers } from "./ops-jobs.ts";
import { opsHandlers } from "./ops.ts";

type H = (ctx: Ctx, input: unknown) => Promise<unknown>;
interface Action {
  h: H;
  /** the field of the underlying call the `id` fills */
  id?: string;
  manage?: boolean;
}
const j = jobHandlers as unknown as Record<string, H>;
const b = backupHandlers as unknown as Record<string, H>;
const o = opsHandlers as unknown as Record<string, H>;

export const ACTIONS: Readonly<Record<string, Action>> = {
  logs: { h: o["sites.logs_read"] as H },
  metrics: { h: o["sites.metrics"] as H },
  jobs: { h: j["sites.jobs_list"] as H },
  job_create: { h: j["sites.job_create"] as H },
  job_update: { h: j["sites.job_update"] as H, id: "jobId" },
  job_delete: { h: j["sites.job_delete"] as H, id: "jobId" },
  job_run: { h: j["sites.job_run"] as H, id: "jobId" },
  job_cancel: { h: j["sites.job_cancel"] as H, id: "runId" },
  job_runs: { h: j["sites.job_runs"] as H, id: "jobId" },
  worker_add: { h: j["sites.service_add"] as H },
  worker_restart: { h: j["sites.service_restart"] as H, id: "serviceId" },
  worker_stop: { h: j["sites.service_stop"] as H, id: "serviceId" },
  worker_remove: { h: j["sites.service_remove"] as H, id: "serviceId" },
  backups: { h: b["sites.backups_list"] as H },
  backup_create: { h: b["sites.backup_create"] as H },
  backup_delete: { h: b["sites.backup_delete"] as H, id: "backupId", manage: true },
  backup_pin: { h: b["sites.backup_pin"] as H, id: "backupId" },
  backup_download: { h: b["sites.backup_download"] as H, id: "backupId" },
  backup_restore: { h: b["sites.backup_restore"] as H, id: "backupId", manage: true },
};

async function ops(ctx: Ctx, input: unknown): Promise<{ result: unknown }> {
  const i = rec(ctx, input);
  const siteId = reqStr(ctx, i, "siteId");
  const name = reqStr(ctx, i, "action");
  const a = ACTIONS[name];
  if (!a) fail(ctx, "validation.bad_input", `Pick one of: ${Object.keys(ACTIONS).join(", ")}.`, { field: "action" });
  const args = i["args"] === undefined ? {} : rec(ctx, i["args"]);
  if (a.manage) {
    const site = mustSite(ctx, siteId);
    if (ctx.authorize({ perm: "sites.deploy", level: "manage" }, { type: "site", id: str(site.id) }).effect !== "allow")
      fail(ctx, "permission.no_grant", `You need to manage this site to ${name.replace("_", " ")}.`);
  }
  const call = { ...args, siteId, ...(i["id"] !== undefined && a.id ? { [a.id]: i["id"] } : {}) };
  return { result: await a.h(ctx, call) };
}

export const toolHandlers = { "sites.ops": (ctx: Ctx, input: unknown) => ops(ctx, input) };
