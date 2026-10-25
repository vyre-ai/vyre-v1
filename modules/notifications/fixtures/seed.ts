// People and a clock for the notifications tests. NOW is a Thursday 10:00 UTC, inside the default working hours (Monday to Friday, 09:00 to 18:00 UTC).
export const NOW = Date.UTC(2025, 9, 9, 10, 0, 0);
export const HOUR = 3_600_000;
export const MIN = 60_000;
export const alice = { kind: "person" as const, id: "usr_alice" };
export const bob = { kind: "person" as const, id: "usr_bob" };
export const cara = { kind: "person" as const, id: "usr_cara" };
export const bot = { kind: "agent" as const, id: "agt_bot" };
export const bot2 = { kind: "agent" as const, id: "agt_bot2" };
export const svc = { kind: "service" as const, id: "svc_host" };

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string; device?: string; run?: string }
export const as = (p: { kind: "person" | "agent" | "service"; id: string }, extra: Partial<Caller> = {}): Caller => ({ id: p.id, kind: p.kind, ...extra });

/** A notifications.send input for a person; override any field. */
export function sendInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const all: Record<string, unknown> = { to: alice.id, kind: "dm", data: { from: "Bob" }, ...over };
  for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k];
  return all;
}
