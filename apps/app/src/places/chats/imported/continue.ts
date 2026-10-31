// Continue here: sessions.continue makes (or returns the one already made) live Vyre chat that carries the archived transcript as its first context message. The archive is never written back.
export interface ContinueData {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The Space the archive lives in and the assistant that carries the transcript on. */
  spaceId: string;
  assistantId: string;
}

/** Continue the archive in a live chat and return its thread id. Asking again returns the same chat. */
export async function continueImported(data: ContinueData, conversationId: string): Promise<string> {
  const out = await data.call("sessions.continue", { conversationId, destinationSpaceId: data.spaceId, destinationScope: "personal", agentId: data.assistantId }) as { threadId?: string } | undefined;
  if (typeof out?.threadId !== "string" || out.threadId === "") throw new Error("The chat did not start. Try again.");
  return out.threadId;
}
