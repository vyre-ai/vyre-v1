// What the thread beside a message adds when agents reply in threads (mounts/ThreadSide.tsx draws it): the "Also sent to the chat" mark on a message that was also put in the chat, and the reply words in the
// composer. Read live over the kept copy, as everything beside the chat is. The chat's own switch is in its More menu.
import { useMemo } from "react";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { useLive } from "../mounts/live.ts";
import { REPLY_PLACEHOLDER } from "./model.ts";
import { alsoSentIds } from "./also-sent.ts";

type MessagesOut = CapMap["chat.messages.list"]["out"];
type ThreadOut = CapMap["threads.get"]["out"];

/** The thread's own conversation data, with the also-sent set and the reply words. The chat's own position (the message it opened on, text waiting for its composer) does not come along. */
export function threadData(data: ConversationData, extra: { alsoSent?: ReadonlySet<string> | undefined }): ConversationData {
  const { placeholder: _p, alsoSent: _s, ...rest } = data;
  return { ...rest, placeholder: REPLY_PLACEHOLDER, ...(extra.alsoSent ? { alsoSent: extra.alsoSent } : {}) };
}

export function useThreadExtras(rt: { screens: ScreenHooks }, data: ConversationData, threadId: string, parentId: string | undefined): { data: ConversationData; title: string } {
  const chat = useLive<MessagesOut>(rt.screens, "chats.conversation", "messages", parentId ? { threadId: parentId } : null);
  const row = useLive<ThreadOut>(rt.screens, "chats.conversation", "thread", parentId ? { threadId: parentId } : null);
  const alsoSent = useMemo(() => (chat.status === "ready" ? alsoSentIds(chat.data.messages, threadId) : undefined), [chat, threadId]);
  const out = useMemo(() => threadData(data, { alsoSent }), [data, alsoSent]);
  return { data: out, title: row.status === "ready" ? row.data.thread.title ?? "" : "" };
}
