// The first screen's rules, with no renderer: who a new chat starts with, what starts it, and what the lines under the composer say.
import { isAssistantRow } from "../../../../../../lib/agent-kind.ts";
import type { AgentKindRow } from "../../../../../../lib/agent-kind.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export type NeedsOut = CapMap["tasks.needs_you"]["out"];
export type NeedItem = NeedsOut["items"][number];
export type RecentOut = CapMap["chat.recent"]["out"];

/** How many things that need you sit under the composer; the rest are "N more in Tasks". */
export const LANDING_NEEDS = 3;

export interface WithEntry { id: string; name: string; kind: "agent" | "assistant" | "person" }

/** What chat.start takes for the people and agents picked in With. Nobody picked is the Assistant: a new chat always has someone to answer. */
export function startInput(picked: readonly WithEntry[], assistantId: string): { agentIds: string[]; personId?: string } {
  // the Assistant picked before it existed carries the placeholder id: it is the real one now
  const agentIds = picked.filter((w) => w.kind !== "person").map((w) => (w.kind === "assistant" ? assistantId : w.id));
  const person = picked.find((w) => w.kind === "person");
  if (agentIds.length === 0 && person === undefined) return { agentIds: [assistantId] };
  return { agentIds, ...(person ? { personId: person.id } : {}) };
}

/**
 * The Assistant is made a moment after the account, so the id can still be the placeholder when a person sends at once. The first message waits for the real one and is never refused for it.
 * Null only if none appeared in about ten seconds.
 */
export async function realAssistant(id: string, call: (cap: string, input: unknown) => Promise<unknown> | unknown, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 40): Promise<string | null> {
  if (id !== "assistant") return id;
  for (let i = 0; i < tries; i++) {
    const out = await Promise.resolve(call("agents.list", {})).catch(() => null) as { agents?: (AgentKindRow & { agentId: string })[] } | null;
    const found = out?.agents?.find(isAssistantRow);
    if (found) return found.agentId;
    await wait(250);
  }
  return null;
}

/** What the composer says when the first message could not start a chat: plain words, the draft stays. */
export const startFailure = (e: unknown): string => (e instanceof Error && e.message === "no assistant yet" ? "Your Assistant is not ready yet. Try again in a moment." : "Could not start the chat.");

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
