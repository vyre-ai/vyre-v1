// The "Connector builder" grant: what an assistant needs to build a connector for its person. Agents never hold Owner or Admin, and connectors.manage belongs to those two (and Developer, which
// carries much more). So the grant is a custom role made on first use: the Member permissions plus connectors.manage, assignable to agents. One call makes it if it is missing and gives it to the agent.
import type { AccessCtx } from "../projections.ts";
import { changed, nid, raise, storeOf } from "../projections.ts";

export const BUILDER_ROLE = "Connector builder";
const PERM = "connectors.manage";

const callerOf = (ctx: AccessCtx): string => ctx.actingFor ?? ctx.principal.id;

/** Does this agent hold connectors.manage now, and may the caller give it. */
export async function builderStatus(ctx: AccessCtx, input: { agentId: string }): Promise<{ allowed: boolean; canGrant: boolean }> {
  const store = storeOf(ctx);
  const agent = store.principals.get(input.agentId);
  if (!agent || agent.kind !== "agent") raise(ctx.trace.traceId, "validation.not_found", "That agent does not exist.");
  return { allowed: store.permsExcept(agent.id, "").has(PERM), canGrant: store.permsExcept(callerOf(ctx), "").has("access.manage") };
}

/** Give the agent the Connector builder role, making the role when the Space has none. Giving it twice changes nothing. */
export async function builderGrant(ctx: AccessCtx, input: { agentId: string }): Promise<{ roleId: string; created: boolean }> {
  const store = storeOf(ctx);
  const agent = store.principals.get(input.agentId);
  if (!agent || agent.kind !== "agent") raise(ctx.trace.traceId, "validation.not_found", "That agent does not exist.");
  let role = [...store.roles.values()].find((r) => r.name === BUILDER_ROLE && !r.builtIn);
  let created = false;
  if (!role) {
    const member = store.roles.get("rol_member");
    const permissions = [...new Set([...(member?.permissions ?? []), PERM])].sort();
    role = { id: nid("rol"), name: BUILDER_ROLE, builtIn: false, clearance: "internal", assignableToAgents: true, permissions };
    store.roles.set(role.id, role);
    created = true;
    changed(ctx, store, "role");
  }
  const current = store.rolesOf(agent.id);
  if (!current.includes(role.id)) { store.setRoles(agent.id, [...current, role.id]); changed(ctx, store, "assignment"); }
  return { roleId: role.id, created };
}
