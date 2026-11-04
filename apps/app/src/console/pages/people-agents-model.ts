// People's own agents in the Console (owner ruling 4 Nov): an admin sees one summary row per person, never an agent's name or content. These are the words and the choices of that row.
import type { CapMap } from "../../../../../generated/types.ts";

export type PersonSummary = CapMap["agents.people_summary"]["out"]["people"][number];

/** The monthly caps an admin may choose from, in dollars; 0 is no cap. */
export const CAP_CHOICES: readonly number[] = [25, 50, 100, 200, 0];
export const micros = (dollars: number): number => dollars * 1_000_000;
export const dollars = (m: number): string => `$${Math.round(m / 1_000_000).toLocaleString("en-US")}`;

/** "Assistant + 2 private agents": what exists, counted, never named. */
export function whatLine(p: Pick<PersonSummary, "assistant" | "privateAgents">): string {
  const parts = [p.assistant ? "Assistant" : null, p.privateAgents > 0 ? `${p.privateAgents} private agent${p.privateAgents === 1 ? "" : "s"}` : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : "No agents";
}
/** The row's note: the count, the spend against the cap, and Paused when they are. */
export function summaryNote(p: PersonSummary): string {
  const spend = `${dollars(p.spendMonthMicros)} this month${p.capMicros ? ` of ${dollars(p.capMicros)}` : ", no cap"}`;
  return `${p.paused ? "Paused · " : ""}${whatLine(p)} · ${spend}`;
}
export const spendPct = (p: Pick<PersonSummary, "spendMonthMicros" | "capMicros">): number => (p.capMicros ? Math.min(100, (p.spendMonthMicros / p.capMicros) * 100) : 0);
export const capKey = (p: Pick<PersonSummary, "capMicros">): string => String(p.capMicros ? Math.round(p.capMicros / 1_000_000) : 0);
export const CAP_OPTIONS: readonly { key: string; title: string }[] = CAP_CHOICES.map((v) => ({ key: String(v), title: v ? `$${v}` : "No cap" }));
export const PAUSE_NOTE = (name: string): string => `Pause every agent of ${name}? ${name.split(" ")[0]} is told that an admin paused them. This is in the audit log.`;
export const PEOPLE_FOOT = "Each person's Assistant and the agents they keep private are never listed by name here, and admins cannot open, read or edit them. What an admin can do is the governance: the spend cap, and Pause all, which is audited and tells the person.";
