// projects: teammates (owner ruling 20 Oct 2026). A teammate is an agent with a role on one project: made by asking any agent, with one yes; its home is the project, so it is not on the Agents page;
// the lead is the default participant in a new chat of the project. No new primitive: this reuses agents (made with projectId) and the project roles (projects.members).
import { applyRole, removeMember } from "./project.ts";
import { call, ensure, keyed, memberOf, membersOf, raise, remember, tolerant, visible } from "../projections.ts";
import type { ProjectsCtx } from "../projections.ts";

interface AgentView { agentId: string; name: string; role?: string; status: "awake" | "working" | "asleep" | "paused"; teammateOf?: string }
type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

async function rowFor(ctx: ProjectsCtx, projectId: string, principal: string, role: string) {
  const got = await tolerant<{ agent?: AgentView }>(ctx, "agents.get", { agentId: principal }, {});
  const a = got.agent;
  return { agentId: principal, name: a?.name ?? principal, role, ...(a?.role ? { roleLine: a.role } : {}), status: a?.status ?? "asleep", madeForProject: a?.teammateOf === projectId };
}

export async function teammatesList(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const members = membersOf(ctx.db, p.projectId).filter((m) => m.kind === "agent");
  const order = { lead: 0, member: 1, reviewer: 2, guest: 3 } as const;
  members.sort((a, b) => order[a.role] - order[b.role] || a.since - b.since);
  const teammates = [];
  for (const m of members) teammates.push(await rowFor(ctx, p.projectId, m.principal, m.role));
  const lead = teammates.find((t) => t.role === "lead");
  return { teammates, ...(lead ? { leadAgentId: lead.agentId } : {}) };
}

export async function teammatesCreate(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  const again = keyed<{ teammate: unknown }>(ctx.db, input.idempotencyKey, "projects.teammates.create");
  if (again) return again;
  const name = String(input.name ?? "").trim();
  if (name === "") raise(ctx, "validation.bad_input", "Give the teammate a name.");
  const made = await call<{ agent: { agentId: string } }>(ctx, "agents.create", {
    name, ...(typeof input.brief === "string" && input.brief.trim() !== "" ? { role: input.brief.trim().replace(/\s+/g, " ").slice(0, 200) } : {}), computer: false, projectId: p.projectId, idempotencyKey: `${input.idempotencyKey}:agent`,
  }, { idempotencyKey: `${input.idempotencyKey}:agent` });
  await applyRole(ctx, p, made.agent.agentId, input.role);
  const res = { teammate: await rowFor(ctx, p.projectId, made.agent.agentId, input.role) };
  remember(ctx.db, input.idempotencyKey, "projects.teammates.create", res);
  return res;
}

export async function teammatesRemove(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  const again = keyed<{ removed: boolean }>(ctx.db, input.idempotencyKey, "projects.teammates.remove");
  if (again) return again;
  const m = memberOf(ctx.db, p.projectId, input.agentId);
  if (!m || m.kind !== "agent") return { removed: false };
  await removeMember(ctx, p, m);
  const got = await tolerant<{ agent?: AgentView }>(ctx, "agents.get", { agentId: m.principal }, {});
  if (got.agent?.teammateOf === p.projectId) await call(ctx, "agents.delete", { agentId: m.principal });
  const res = { removed: true };
  remember(ctx.db, input.idempotencyKey, "projects.teammates.remove", res);
  return res;
}
