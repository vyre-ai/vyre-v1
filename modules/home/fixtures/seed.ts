// People and builders for the home tests. Ids follow the contract's id format.
export const NOW = 1_760_000_000_000;   // 2025-10-09 08:53:20 UTC
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }
export const alice: Caller = { id: "usr_alice", kind: "person" };
export const bob: Caller = { id: "usr_bob", kind: "person" };
/** The assistant writes the digest on a schedule, acting for the person. */
export const assistant: Caller = { id: "agt_assistant", kind: "agent", actingFor: alice.id };
export const host: Caller = { id: "svc_host", kind: "service" };

export const hex = (prefix: string, n: number): string => `${prefix}_${n.toString(16).padStart(32, "0")}`;
export const item = (kind: string, title: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ kind, title, line: `${title}.`, ...over });
export const newDigest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  person: alice.id, periodStart: NOW - 12 * HOUR, periodEnd: NOW, headline: ["Two decisions were made for you.", "The intake review finished.", "One approval can wait."],
  items: [item("routine", "Morning inbox", { at: NOW - HOUR })], builtBy: assistant.id, ...over,
});
