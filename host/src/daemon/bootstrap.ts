// Ruling 71: a fresh install has an empty log, so nobody exists. At first start the host makes the Space once: the Space itself, the owner's principal with the Owner role and a Manage
// grant, the Space resource owned by them, and membership of Everyone. It writes events only, so the access module folds them like any others (ruling 70). Nobody can sign in as the
// owner yet: the owner's client claims the Space with the one-time link (identity.claim_owner), which gives the principal an account.
import { randomBytes } from "node:crypto";
import type { LogClient } from "../../../kernel/src/log/index.ts";
import type { FoldableEvent } from "./access.ts";

const TRACE = "b007".repeat(8);
const EVERYONE = "grp_everyone";

export interface Bootstrapped { owner: string; events: Array<FoldableEvent & { seq: number }> }

/** The id of the owner a fresh Space starts with: the configured one, or a new person id. */
export const mintOwner = (configured: string | null): string => configured ?? `usr_${randomBytes(9).toString("hex")}`;

/**
 * Append the Space's first events when the log has none. Ids are fixed per Space, so a second call (a crash between two starts, two nodes racing) appends nothing twice.
 * Answers what was appended, or null when the Space already exists.
 */
export async function bootstrapSpace(log: Pick<LogClient, "appendResult" | "read">, o: { space: string; name: string; owner: string }): Promise<Bootstrapped | null> {
  if ((await log.read({ after: 0, limit: 1, type: "space.created" })).length > 0) return null;
  const at = (type: string, entity: string, entityId: string, payload: unknown, i: number) => ({
    id: `evt_boot_${i}_${o.space}`, type, sv: 1, trace_id: TRACE, actor: "svc_host", vis: "space" as const, entity, entity_id: entityId, payload,
  });
  const events = [
    at("space.created", "space", o.space, { id: o.space, name: o.name }, 0),
    at("principal.created", "principal", o.owner, { id: o.owner, kind: "person", status: "active", name: "Owner" }, 1),
    at("principal.role_set", "principal", o.owner, { holder: o.owner, role: "rol_owner" }, 2),
    at("resource.created", "resource", o.space, { id: o.space, type: "space", parent_id: null, label: 0, owner_id: o.owner, holds: 0 }, 3),
    at("grant.created", "grant", "gr_boot_owner", { id: "gr_boot_owner", subject_kind: "actor", subject_id: o.owner, resource_type: "space", resource_id: o.space, level: "manage", by: o.owner }, 4),
    at("group.member_added", "group", EVERYONE, { group: EVERYONE, member: o.owner }, 5),
  ];
  const stored: Bootstrapped["events"] = [];
  for (const e of events) {
    const r = await log.appendResult(e);
    if (!r.ok) throw new Error(`could not make the Space: ${r.message}`);
    stored.push({ type: r.event.type, payload: r.event.payload, seq: r.event.seq });
  }
  return { owner: o.owner, events: stored };
}
