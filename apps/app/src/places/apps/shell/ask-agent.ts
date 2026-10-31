// Which agent answers an Ask in the Apps editors. The one the person picked in this editor; else the one they picked last time; else a work agent that is awake (the first one, in the order the
// Space lists them); else the person's private assistant. Never "whichever sorts first": the assistant answers in the person's own chat, so a work agent is the default for an Ask about a design.
export interface AskPick { id: string; role?: string | undefined; status?: string | undefined }

export const isAssistant = (a: AskPick): boolean => a.role === "assistant";
const awake = (a: AskPick): boolean => a.status === undefined || a.status === "awake";

export function askAgentOf<T extends AskPick>(agents: readonly T[], pickedId: string | null | undefined, lastId?: string | null): T | null {
  return agents.find((a) => a.id === pickedId) ?? agents.find((a) => a.id === lastId) ?? agents.find((a) => !isAssistant(a) && awake(a)) ?? agents.find(isAssistant) ?? agents[0] ?? null;
}

const KEY = "vyre.apps.ask-agent";
/** The agent the person picked last (kept in this browser, per Space). */
export function readLastAskAgent(spaceKey: string): string | null {
  try { return (JSON.parse((globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) ?? "{}") as Record<string, string>)[spaceKey] ?? null; } catch { return null; }
}
export function writeLastAskAgent(spaceKey: string, agentId: string): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage; if (!ls) return;
    const all = JSON.parse(ls.getItem(KEY) ?? "{}") as Record<string, string>;
    ls.setItem(KEY, JSON.stringify({ ...all, [spaceKey]: agentId }));
  } catch { /* private window: the pick lasts until the editor closes */ }
}
