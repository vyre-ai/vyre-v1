// People and builders for the scheduler tests. Ids follow the contract's id format.
export const NOW = 1_760_000_000_000;   // 2025-10-09 08:53:20 UTC
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }
export const alice: Caller = { id: "usr_alice", kind: "person" };
export const bob: Caller = { id: "usr_bob", kind: "person" };
/** The host tick and the event consumer call as a service. */
export const host: Caller = { id: "svc_host", kind: "service" };

export const owner = { kind: "automation", id: "aut_a1b2c3" };
/** Input for scheduler.schedule with sensible defaults: every weekday at 09:00 in Karachi. */
export const newSchedule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  owner, cap: "automations.fire", input: { automationId: "aut_a1b2c3" }, when: { cron: "0 9 * * 1-5", tz: "Asia/Karachi" }, ...over,
});
