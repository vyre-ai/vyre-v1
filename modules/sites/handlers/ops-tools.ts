// The three agent-facing calls for site operations (r42-sites-run): sites.jobs, sites.services and sites.backups, each one capability with an action. They dispatch to the same handlers the app's calls use, so the rules
// (ownership of the job, run, worker or backup, the lock, the safety backup) are written once. Restore and delete of a backup need manage on the site, as in the app, whatever the action's route.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, mustSite, rec, reqStr, str } from "./deploy.ts";
import { backupHandlers } from "./ops-backups.ts";
import { jobHandlers } from "./ops-jobs.ts";

type H = Record<string, (ctx: Ctx, input: unknown) => Promise<unknown>>;

function route(table: H, actions: Readonly<Record<string, string>>) {
  return async (ctx: Ctx, input: unknown, needManage: readonly string[] = []): Promise<unknown> => {
    const o = rec(ctx, input);
    const action = reqStr(ctx, o, "action");
    const cap = actions[action];
    const h = cap ? table[cap] : undefined;
    if (!h) fail(ctx, "validation.bad_input", `Pick one of: ${Object.keys(actions).join(", ")}.`, { field: "action" });
    if (needManage.includes(action)) {
      const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
      if (
        ctx.authorize({ perm: "sites.deploy", level: "manage" }, { type: "site", id: str(site.id) }).effect !== "allow"
      )
        fail(ctx, "permission.no_grant", `You need to manage this site to ${action} a backup.`);
    }
    const { action: _a, ...rest } = o;
    void _a;
    return h(ctx, rest);
  };
}

const jobs = route(jobHandlers as unknown as H, {
  list: "sites.jobs_list",
  create: "sites.job_create",
  update: "sites.job_update",
  delete: "sites.job_delete",
  run: "sites.job_run",
  cancel: "sites.job_cancel",
  runs: "sites.job_runs",
});
const services = route(jobHandlers as unknown as H, {
  list: "sites.services_list",
  add: "sites.service_add",
  restart: "sites.service_restart",
  stop: "sites.service_stop",
  remove: "sites.service_remove",
});
const backups = route(backupHandlers as unknown as H, {
  list: "sites.backups_list",
  create: "sites.backup_create",
  delete: "sites.backup_delete",
  pin: "sites.backup_pin",
  download: "sites.backup_download",
  restore: "sites.backup_restore",
});

export const toolHandlers = {
  "sites.jobs": (ctx: Ctx, input: unknown) => jobs(ctx, input),
  "sites.services": (ctx: Ctx, input: unknown) => services(ctx, input),
  "sites.backups": (ctx: Ctx, input: unknown) => backups(ctx, input, ["restore", "delete"]),
};
