// projects module entry (lane L3). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { planCascade, propose } from "./handlers/cascade.ts";

/** Host calls for the removal wizard (members.owned): the projects the person leads, and handing the lead to someone else through projects.members.set and .remove as the person doing the removal. */
const leads = (ctx: Ctx, person: string): { projectId: string }[] => { try { return ctx.db.all(`SELECT "projectId" FROM projects_member WHERE "principal" = ? AND "role" = 'lead'`, person) as { projectId: string }[]; } catch { return []; } };
export const hostCalls = {
  "projects.owned_by": (ctx: Ctx, i: { person: string }) => {
    const p = leads(ctx, i.person);
    return { projects: { count: p.length, sample: p.slice(0, 5).map((x) => ({ type: "project", id: x.projectId, title: x.projectId })), ids: p.slice(0, 500).map((x) => x.projectId) } };
  },
  "projects.reassign_owned": async (ctx: Ctx, i: { person: string; kind: string; action: string; to?: string }): Promise<number> => {
    if (i.kind !== "projects" || i.action !== "reassign" || !i.to) return 0;
    let n = 0;
    for (const p of leads(ctx, i.person)) {
      await ctx.call("projects.members.set", { projectId: p.projectId, principal: i.to, role: "lead", idempotencyKey: `own-${i.person}-${p.projectId}` });
      await ctx.call("projects.members.remove", { projectId: p.projectId, principal: i.person });
      n++;
    }
    return n;
  },
};
