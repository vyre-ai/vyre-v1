// What the thread beside a message adds when agents reply in threads (mounts/ThreadSide.tsx draws it): the chat's "Agents reply in threads" switch at the foot, a line when nothing has been said in the thread yet,
// and the "Also sent to the chat" mark on a message that was also put in the chat. Read live over the kept copy, as everything beside the chat is.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { useLive } from "../mounts/live.ts";
import { EMPTY_THREAD, REPLY_PLACEHOLDER, repliesOf } from "./model.ts";
import { useTurnsOf } from "./ThreadFooter.tsx";
import { ThreadSwitch, useReplySwitch } from "./ThreadSwitch.tsx";
import { alsoSentIds } from "./also-sent.ts";

type MessagesOut = CapMap["chat.messages.list"]["out"];
type ThreadOut = CapMap["threads.get"]["out"];

/** The thread's own conversation data, with the empty line and the also-sent set. The chat's own position (the message it opened on, text waiting for its composer) does not come along. */
export function threadData(data: ConversationData, extra: { empty: boolean; alsoSent?: ReadonlySet<string> | undefined }): ConversationData {
  const { tail: _t, placeholder: _p, alsoSent: _s, ...rest } = data;
  return {
    ...rest, placeholder: REPLY_PLACEHOLDER,
    ...(extra.empty ? { tail: <View style={st.empty}><Text testID="thread-empty" style={st.emptyText}>{EMPTY_THREAD}</Text></View> } : data.tail ? { tail: data.tail } : {}),
    ...(extra.alsoSent ? { alsoSent: extra.alsoSent } : {}),
  };
}

export function useThreadExtras(rt: { screens: ScreenHooks; call(cap: string, input: unknown): Promise<unknown> }, data: ConversationData, threadId: string, parentId: string | undefined, say: (text: string) => void): { data: ConversationData; foot: ReactElement | null; title: string } {
  const mine = useLive<MessagesOut>(rt.screens, "chats.conversation", "messages", { threadId });
  const chat = useLive<MessagesOut>(rt.screens, "chats.conversation", "messages", parentId ? { threadId: parentId } : null);
  const row = useLive<ThreadOut>(rt.screens, "chats.conversation", "thread", parentId ? { threadId: parentId } : null);
  const sw = useReplySwitch({ call: rt.call, toast: say }, parentId ?? "", row.status === "ready" ? repliesOf(row.data.thread) : undefined);
  // nothing saved yet, and nobody writing: an agent that is writing its first reply is not "no replies yet"
  const writing = useTurnsOf(data, threadId, false).some((t) => t.state === "writing");
  const empty = mine.status === "ready" && mine.data.messages.length === 0 && !writing;
  const alsoSent = useMemo(() => (chat.status === "ready" ? alsoSentIds(chat.data.messages, threadId) : undefined), [chat, threadId]);
  const out = useMemo(() => threadData(data, { empty, alsoSent }), [data, empty, alsoSent]);
  return { data: out, title: row.status === "ready" ? row.data.thread.title ?? "" : "", foot: parentId && sw.on !== null ? <ThreadSwitch on={sw.on} onChange={sw.set} /> : null };
}

const st = StyleSheet.create({
  empty: { paddingHorizontal: 16, paddingVertical: 24 },
  emptyText: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, textAlign: "center" },
});
