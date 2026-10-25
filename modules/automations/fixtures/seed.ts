// People and builders for the automations tests. Ids follow the contract's id format.
import type { Definition, Node } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }
export const alice: Caller = { id: "usr_alice", kind: "person" };
export const bob: Caller = { id: "usr_bob", kind: "person" };
export const admin: Caller = { id: "usr_admin", kind: "person" };
/** The trigger consumer and the executor call as a service. */
export const engine: Caller = { id: "svc_engine", kind: "service" };

export const node = (id: string, key: string, input: Record<string, unknown> = {}, over: Partial<Node> = {}): Node => ({ id, key, input, ...over });

/** A valid definition: a record change starts it, one step updates the record. */
export function goodDefinition(over: Partial<Definition> = {}): Definition {
  return {
    triggers: [{ key: "record_change", filter: { type: "contact", op: "updated" } }],
    nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" } })],
    ...over,
  };
}
export const create = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "Welcome new contacts", definition: goodDefinition(), ...over });
