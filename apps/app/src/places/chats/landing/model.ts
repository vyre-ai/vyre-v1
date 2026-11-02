// The first screen's rules, with no renderer: who a new chat starts with, what starts it, and what the lines under the composer say.
import type { CapMap } from "../../../../../../generated/types.ts";

export type NeedsOut = CapMap["tasks.needs_you"]["out"];
export type NeedItem = NeedsOut["items"][number];
export type RecentOut = CapMap["chat.recent"]["out"];

/** How many things that need you sit under the composer; the rest are "N more in Tasks". */
export const LANDING_NEEDS = 3;

export interface WithEntry { id: string; name: string; kind: "agent" | "assistant" | "person" }

/** What chat.start takes for the people and agents picked in With. Nobody picked is the Assistant: a new chat always has someone to answer. */
export function startInput(picked: readonly WithEntry[], assistantId: string): { agentIds: string[]; personId?: string } {
  const agentIds = picked.filter((w) => w.kind !== "person").map((w) => w.id);
  const person = picked.find((w) => w.kind === "person");
  if (agentIds.length === 0 && person === undefined) return { agentIds: [assistantId] };
  return { agentIds, ...(person ? { personId: person.id } : {}) };
}

export const moreLine = (total: number, shown: number): string | null => (total > shown ? `${total - shown} more in Tasks` : null);

export interface WorkingChat { threadId: string; title: string; agents: readonly string[] }

/** The chats with work moving, newest first. Starred or not, each counts once. */
export function workingChats(recent: RecentOut | undefined): WorkingChat[] {
  if (!recent) return [];
  const seen = new Set<string>();
  const out: WorkingChat[] = [];
  for (const g of [recent.starred, recent.today, recent.yesterday, recent.earlier]) {
    for (const i of g) {
      if (!i.working || seen.has(i.threadId)) continue;
      seen.add(i.threadId);
      out.push({ threadId: i.threadId, title: i.title, agents: i.agents });
    }
  }
  return out;
}

/** "3 working in Client portal launch". */
export function workingLine(w: WorkingChat): string {
  const n = Math.max(1, w.agents.length);
  return `${n} working in ${w.title}`;
}
