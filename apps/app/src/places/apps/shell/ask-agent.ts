// Which agent answers an Ask in the Apps editors: the one the person picked; otherwise the person's assistant (found by its role, never by where it sorts in the list); otherwise the first agent.
export interface AskPick { id: string; role?: string | undefined }

export const isAssistant = (a: AskPick): boolean => a.role === "assistant";

export function askAgentOf<T extends AskPick>(agents: readonly T[], pickedId: string | null | undefined): T | null {
  return agents.find((a) => a.id === pickedId) ?? agents.find(isAssistant) ?? agents[0] ?? null;
}
