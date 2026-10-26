// People and builders for the runs tests. Ids follow the contract's id format.
export const NOW = 1_760_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** The principal a call runs as. */
export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string; device?: string; depth?: number }
export const alice: Caller = { id: "usr_alice", kind: "person" };
export const bob: Caller = { id: "usr_bob", kind: "person" };
export const admin: Caller = { id: "usr_admin", kind: "person" };
export const bot: Caller = { id: "agt_bot", kind: "agent", actingFor: "usr_alice" };
/** The engine, the Gate and other modules call the lifecycle capabilities as a service. */
export const engine: Caller = { id: "svc_engine", kind: "service" };

/** Input for runs.start with sensible defaults (the owner is alice). */
export function newRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "automation", name: "Welcome email", owner: alice.id, ...over };
}
