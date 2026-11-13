// The first screen's rules, with no renderer: who a new chat starts with, what starts it, and what the lines under the composer say.
import { isAssistantRow } from "../../../../../../lib/agent-kind.ts";
import type { AgentKindRow } from "../../../../../../lib/agent-kind.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export type NeedsOut = CapMap["tasks.needs_you"]["out"];
export type NeedItem = NeedsOut["items"][number];
export type RecentOut = CapMap["chat.recent"]["out"];

/** How many things that need you sit under the composer; the rest are "N more in Tasks". */
export const LANDING_NEEDS = 3;

export interface WithEntry {
  id: string;
  name: string;
  kind: "agent" | "assistant" | "person";
}

/** What chat.start takes for the people and agents picked in With. Nobody picked is the Assistant: a new chat always has someone to answer. */
export function startInput(
  picked: readonly WithEntry[],
  assistantId: string,
): { agentIds: string[]; personId?: string } {
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
export async function realAssistant(
  id: string,
  call: (cap: string, input: unknown) => Promise<unknown> | unknown,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  tries = 40,
): Promise<string | null> {
  if (id !== "assistant") return id;
  for (let i = 0; i < tries; i++) {
    const out = (await Promise.resolve(call("agents.list", {})).catch(() => null)) as {
      agents?: (AgentKindRow & { agentId: string })[];
    } | null;
    const found = out?.agents?.find(isAssistantRow);
    if (found) return found.agentId;
    await wait(250);
  }
  return null;
}

/** What a new chat starts on besides who answers: the model, provider and effort. */
export interface StartChoice { model?: string; provider?: string; effort?: string }

/**
 * The input of chat.start for a first message, the one place it is made: the first screen's composer and the new tab's Enter both start a chat with it, so they cannot drift apart. A slash command or a send with
 * nothing in it carries no first message (its words wait in the chat's composer); files go in after the chat exists, so a message with files carries only its title.
 */
export function chatStartInput(s: { picked: readonly WithEntry[]; choice: StartChoice; text: string; title: string; hasFiles: boolean; slash: boolean; key: string }, assistantId: string): Record<string, unknown> {
  const c = s.choice;
  return {
    kind: "chat", ...startInput(s.picked, assistantId),
    ...(s.slash || s.title === "" ? {} : s.hasFiles ? { title: s.title } : { first: s.text, title: s.title }),
    ...(c.model ? { model: c.model } : {}), ...(c.provider ? { provider: c.provider } : {}), ...(c.effort ? { effort: c.effort } : {}),
    idempotencyKey: s.key,
  };
}

/** The model, provider and effort this person picked last, anywhere (engine.last_pick.get): what a new chat starts on without asking again. Null when there is none or it could not be read. */
export async function lastPick(call: (cap: string, input: unknown) => Promise<unknown> | unknown): Promise<{ model: string; provider?: string; effort?: string } | null> {
  const out = await Promise.resolve(call("engine.last_pick.get", {})).catch(() => null) as { model?: string; provider?: string; effort?: string } | null | undefined;
  return out?.model ? { model: out.model, ...(out.provider ? { provider: out.provider } : {}), ...(out.effort ? { effort: out.effort } : {}) } : null;
}

/** What the composer says when the first message could not start a chat: plain words, the draft stays. */
export const startFailure = (e: unknown): string =>
  e instanceof Error && e.message === "no assistant yet"
    ? "Your Assistant is not ready yet. Try again in a moment."
    : "Could not start the chat.";

export const moreLine = (total: number, shown: number): string | null =>
  total > shown ? `${total - shown} more in Tasks` : null;

export interface WorkingChat {
  threadId: string;
  title: string;
  agents: readonly string[];
}

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
