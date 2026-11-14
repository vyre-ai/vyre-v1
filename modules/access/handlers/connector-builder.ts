// The "Connector builder" grant: what an assistant needs to build a connector for its person. Agents never hold Owner or Admin, and connectors.manage belongs to those two (and Developer, which
// carries much more). So the grant is a custom role made on first use: the Member permissions plus connectors.manage, assignable to agents. One call makes it if it is missing and gives it to the agent.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessCtx } from "../projections.ts";
import { changed, nid, raise, storeOf } from "../projections.ts";

export const BUILDER_ROLE = "Connector builder";
const PERM = "connectors.manage";

const callerOf = (ctx: AccessCtx): string => ctx.actingFor ?? ctx.principal.id;

/**
 * May the agent, acting for the caller, use this Vault item, or can it be made so with one approval? Only a missing grant is that: the person who already may use the item shares it with the agent
 * (access.request, which an agent asks for itself). A label above the clearance of the agent or of the person is not: a grant does not lift a clearance (only a role with a higher one does).
 */
function reaches(
  ctx: AccessCtx,
  store: ReturnType<typeof storeOf>,
  agent: string,
  caller: string,
  itemId: string,
): boolean {
  const req = (principal: string, actingFor?: string) =>
    authorize(store.snapshot(), {
      principal,
      ...(actingFor !== undefined && actingFor !== principal ? { actingFor } : {}),
      action: { perm: null, level: "use" },
      resource: { type: "vault_item", id: itemId },
      now: ctx.now(),
    });
  const asAgent = req(agent, caller);
  if (asAgent.effect === "allow") return true;
  return asAgent.reason === "no_grant" && req(caller).effect === "allow";
}

/** Does this agent hold connectors.manage now, and may the caller give it. With an `itemId` it also says whether the agent, acting for the caller, may use that Vault item or can be given it with one approval: a grant does not lift a clearance (it is per subject: the agent, and the person it acts for), so an item labelled above the agent's
 *  clearance (a company key, anything Restricted) is not reachable through the assistant unless an admin gives it a role with a higher one. */
export async function builderStatus(
  ctx: AccessCtx,
  input: { agentId: string; itemId?: string },
): Promise<{ allowed: boolean; canGrant: boolean; reaches?: boolean }> {
  const store = storeOf(ctx);
  const agent = store.principals.get(input.agentId);
  if (!agent || agent.kind !== "agent") raise(ctx.trace.traceId, "validation.not_found", "That agent does not exist.");
  const caller = callerOf(ctx);
  return {
    allowed: store.permsExcept(agent.id, "").has(PERM),
    canGrant: store.permsExcept(caller, "").has("access.manage"),
    ...(input.itemId === undefined ? {} : { reaches: reaches(ctx, store, agent.id, caller, input.itemId) }),
  };
}

/** Give the agent the Connector builder role, making the role when the Space has none. Giving it twice changes nothing. */
export async function builderGrant(
  ctx: AccessCtx,
  input: { agentId: string },
): Promise<{ roleId: string; created: boolean }> {
  const store = storeOf(ctx);
  const agent = store.principals.get(input.agentId);
  if (!agent || agent.kind !== "agent") raise(ctx.trace.traceId, "validation.not_found", "That agent does not exist.");
  let role = [...store.roles.values()].find((r) => r.name === BUILDER_ROLE && !r.builtIn);
  let created = false;
  if (!role) {
    const member = store.roles.get("rol_member");
    const permissions = [...new Set([...(member?.permissions ?? []), PERM])].sort();
    role = {
      id: nid("rol"),
      name: BUILDER_ROLE,
      builtIn: false,
      clearance: "internal",
      assignableToAgents: true,
      permissions,
    };
    store.roles.set(role.id, role);
    created = true;
    changed(ctx, store, "role");
  }
  const current = store.rolesOf(agent.id);
  if (!current.includes(role.id)) {
    store.setRoles(agent.id, [...current, role.id]);
    changed(ctx, store, "assignment");
  }
  return { roleId: role.id, created };
}
