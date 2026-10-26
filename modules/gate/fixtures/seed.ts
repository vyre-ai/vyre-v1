// People, rule helpers and the fake neighbours (tasks, runs, scheduler, access) the Gate calls. Ids follow the contract's id format.
export const NOW = 1_760_000_000_000;
export const HOUR = 3_600_000;
export const alice = { kind: "person" as const, id: "usr_alice" };
export const bob = { kind: "person" as const, id: "usr_bob" };
export const cara = { kind: "person" as const, id: "usr_cara" };
export const dana = { kind: "person" as const, id: "usr_dana" };
export const bot = { kind: "agent" as const, id: "agt_bot" };
export const bot2 = { kind: "agent" as const, id: "agt_bot2" };

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string; device?: string; run?: string; depth?: number; origin?: string }
export const as = (p: { kind: "person" | "agent"; id: string }, extra: Partial<Caller> = {}): Caller => ({ id: p.id, kind: p.kind, ...extra });

/** What the invoke pipeline hands gate.park for a held mail.send by an agent. */
export function parkInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const all: Record<string, unknown> = {
    capName: "mail.send", capVersion: 1, input: { to: ["client@example.com"], subject: "Retainer", body: "Dear Lee, here is the retainer." }, payloadHash: "ph_1", act: "send",
    principal: bot, actingFor: alice.id, decisionId: "dec_1", ...over,
  };
  for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k];   // a key set to undefined means "leave it out"
  return all;
}
