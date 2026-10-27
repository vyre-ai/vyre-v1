// An agent is a principal of the Space the moment it is made (spec 4.5; the seeded Spaces do the same). The agents module emits `agent.created`; nothing in it can create an access principal, so without this
// the agent is unknown to `authorize`: every call the engine makes as that agent (reading the Vault for the asker's account, posting its reply) is refused as "not a member" (auth.unauthenticated).
// Like the resource registrar (resources.ts, P-H_16) this runs inside the invoke pipeline and adds to the same commit, so the agent is authorizable at once and the access module hears of it through the
// same events as for a seeded agent: principal.created, principal.role_set (the Member role) and an edit grant on the Space. The grant is the reach of the agent itself; an agent still acts for its asker, so the
// reach of a call is the intersection of the two (ARCH 4.5 rule 5).
// The agent is never above the person who made it: its role is Member only when its maker may edit the Space, else Guest, and its Space grant is the maker's own level (edit, view, or none).
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";

export interface PrincipalEvent { type: "principal.created" | "principal.role_set" | "grant.created"; entity: string; id: string; payload: Record<string, unknown> }
export interface PrincipalRegistrar {
  /** The access events to add to this commit for the agents the handler's events brought into being. `maker` is the person the call acts for. */
  register(a: { events: readonly Pick<EventEnvelope, "type" | "payload">[]; space: string; maker: string }): PrincipalEvent[];
}

/** The roles an agent may hold, as the seeded Spaces name them. */
export const AGENT_ROLE = "rol_member";
export const AGENT_ROLE_LOW = "rol_guest";
export type SpaceLevel = "edit" | "view" | "none";

/** Contract-valid, deterministic ids for grants synthesized from an agent birth. */
const grantId = (agentId: string, purpose: "space" | "home" | "owner"): string => `gnt_${agentId.slice(4)}${purpose}`;

export function createPrincipalRegistrar(deps: { exists(id: string): boolean; /** what the person may do on the Space itself */ levelOf(person: string, space: string): SpaceLevel }): PrincipalRegistrar {
  return {
    register(a) {
      const out: PrincipalEvent[] = [];
      const seen = new Set<string>();
      for (const ev of a.events) {
        if (ev.type !== "agent.created") continue;
        const p = ev.payload as { agentId?: unknown; name?: unknown; ownerId?: unknown; folderId?: unknown } | null;
        const id = typeof p?.agentId === "string" ? p.agentId : "";
        const owner = typeof p?.ownerId === "string" ? p.ownerId : "";
        if (!/^agt_[a-z0-9]+$/.test(id) || owner === "" || seen.has(id) || deps.exists(id)) continue;
        seen.add(id);
        const name = typeof p?.name === "string" && p.name !== "" ? p.name : id;
        const level = deps.levelOf(a.maker, a.space);
        out.push({ type: "principal.created", entity: "principal", id, payload: { id, kind: "agent", owner, status: "active", name } });
        out.push({ type: "principal.role_set", entity: "principal", id, payload: { holder: id, role: level === "edit" ? AGENT_ROLE : AGENT_ROLE_LOW } });
        if (level !== "none") {
          const gid = grantId(id, "space");
          out.push({ type: "grant.created", entity: "grant", id: gid, payload: { id: gid, subject_kind: "actor", subject_id: id, resource_type: "space", resource_id: a.space, level, by: a.maker } });
        }
        if (typeof p?.folderId === "string" && /^fld_[a-z0-9]+$/.test(p.folderId)) {
          const home = grantId(id, "home"), ownerGrant = grantId(id, "owner");
          out.push({ type: "grant.created", entity: "grant", id: home, payload: { id: home, subject_kind: "actor", subject_id: id, resource_type: "folder", resource_id: p.folderId, level: "edit", by: a.maker } });
          out.push({ type: "grant.created", entity: "grant", id: ownerGrant, payload: { id: ownerGrant, subject_kind: "actor", subject_id: owner, resource_type: "folder", resource_id: p.folderId, level: "manage", by: a.maker } });
        }
      }
      return out;
    },
  };
}
