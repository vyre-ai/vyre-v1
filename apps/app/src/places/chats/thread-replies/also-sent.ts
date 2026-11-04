// Which messages of a thread were also sent to the chat: the chat holds a copy of each, a message with a from_thread block that names the thread and the message it came from.
interface Blocky { blocks?: ReadonlyArray<{ type: string; data?: unknown }> }

export function alsoSentIds(chatMessages: readonly Blocky[], threadId: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of chatMessages) {
    for (const b of m.blocks ?? []) {
      if (b.type !== "from_thread") continue;
      const d = b.data as { threadId?: unknown; messageId?: unknown } | null;
      if (d && d.threadId === threadId && typeof d.messageId === "string" && d.messageId !== "") out.add(d.messageId);
    }
  }
  return out;
}
