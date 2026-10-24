// People and task builders for the tasks tests. Ids follow the contract's id format.
import type { Assignee } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const DAY = 86_400_000;
export const alice: Assignee = { kind: "person", id: "usr_alice" };
export const bob: Assignee = { kind: "person", id: "usr_bob" };
export const cara: Assignee = { kind: "person", id: "usr_cara" };
export const owner: Assignee = { kind: "person", id: "usr_owner" };
export const bot: Assignee = { kind: "agent", id: "agt_bot" };
export const bot2: Assignee = { kind: "agent", id: "agt_bot2" };
export const finance: Assignee = { kind: "role", id: "rol_finance" };
export const support: Assignee = { kind: "group", id: "grp_support" };

/** The principal a call runs as. */
export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string; device?: string }
export const as = (a: Assignee, extra: Partial<Caller> = {}): Caller => ({ id: a.id, kind: a.kind === "agent" ? "agent" : "person", ...extra });

/** Input for tasks.create with sensible defaults. */
export function newTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Draft the engagement letter", assigned: alice, ...over };
}
