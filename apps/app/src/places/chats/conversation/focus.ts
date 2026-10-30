// Opening a chat on one message (a search result, the link a fork starts with). The page keeps the newest messages; a message from last month is not among them, so this reads a window of
// messages around it, which the page merges into what it holds and then scrolls to.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import type { Message } from "./model.ts";

/** Messages read before the one asked for, and the whole window. */
export const BEFORE = 30;
export const SPAN = 70;

export async function windowAround(data: Pick<ConversationData, "call" | "threadId">, messageId: string): Promise<Message[] | null> {
  let seq: number;
  try {
    seq = ((await data.call("chat.message.get", { threadId: data.threadId, messageId })) as CapMap["chat.message.get"]["out"]).message.threadSeq;
  } catch {
    return null;   // deleted, or not in a chat the person can read
  }
  const page = (await data.call("chat.messages.list", { threadId: data.threadId, after: Math.max(0, seq - BEFORE - 1), limit: SPAN })) as CapMap["chat.messages.list"]["out"];
  return page.messages;
}
