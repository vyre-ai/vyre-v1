// The thread, opened from the footer under a message. On a wide screen it is a tab in the shared side pane beside the chat; on a phone it is a full-screen sheet (ThreadSheet). The body is the thread as a
// chat: the asking message on top, the agent's replies (steps, crew rows and answer), the composer with "Also post to the chat", and the chat's switch at the foot. Messages that were also sent to the
// chat carry "Also sent to the chat".
import { useMemo } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CONVERSATION_SCREEN, Conversation } from "../conversation/Conversation.tsx";
import { ConversationDataProvider, useScreenQuery } from "../conversation/data.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import { EMPTY_THREAD, REPLY_PLACEHOLDER } from "./model.ts";
import { ThreadSwitch, useReplySwitch } from "./ThreadSwitch.tsx";
import { alsoSentIds } from "./also-sent.ts";

type MessagesOut = CapMap["chat.messages.list"]["out"];
type ThreadOut = CapMap["threads.get"]["out"];

/** What the thread's own chat reads: the same data as the chat it hangs in, aimed at the thread. Nothing of the chat's own position (the message it opened on, text waiting for its composer) comes along. */
export function threadData(data: ConversationData, threadId: string, extra: { tail?: ReactElement; alsoSent?: ReadonlySet<string> }): ConversationData {
  const { fill: _f, focus: _o, focusN: _n, head: _h, tail: _t, waitingLine: _w, activity: _a, placeholder: _p, alsoSent: _s, ...rest } = data;
  return { ...rest, threadId, placeholder: REPLY_PLACEHOLDER, ...(extra.tail ? { tail: extra.tail } : {}), ...(extra.alsoSent ? { alsoSent: extra.alsoSent } : {}) };
}

function Body({ data, threadId }: { data: ConversationData; threadId: string }): ReactElement {
  const mine = useScreenQuery<MessagesOut>(CONVERSATION_SCREEN, "messages", { threadId });
  const chat = useScreenQuery<MessagesOut>(CONVERSATION_SCREEN, "messages", { threadId: data.threadId });
  const empty = mine.status === "ready" && mine.data.messages.length === 0;
  const alsoSent = useMemo(() => (chat.status === "ready" ? alsoSentIds(chat.data.messages, threadId) : undefined), [chat, threadId]);
  const row = useScreenQuery<ThreadOut>(CONVERSATION_SCREEN, "thread", { threadId: data.threadId });
  const sw = useReplySwitch(data, data.threadId, row.status === "ready" ? row.data.thread.agentRepliesInThreads : undefined);
  const inner = useMemo(() => threadData(data, threadId, {
    ...(empty ? { tail: <View style={st.empty}><Text testID="thread-empty" style={st.emptyText}>{EMPTY_THREAD}</Text></View> } : {}),
    ...(alsoSent ? { alsoSent } : {}),
  }), [data, threadId, empty, alsoSent]);
  return (
    <View testID="thread-pane" style={st.root}>
      <View style={st.chat}><Conversation data={inner} compact /></View>
      {sw.on !== null ? <ThreadSwitch on={sw.on} onChange={sw.set} /> : null}
    </View>
  );
}

export function ThreadPane({ data, threadId }: { data: ConversationData; threadId: string }): ReactElement {
  return <ConversationDataProvider value={data}><Body data={data} threadId={threadId} /></ConversationDataProvider>;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  chat: { flex: 1, minHeight: 0 },
  empty: { paddingHorizontal: 16, paddingVertical: 24 },
  emptyText: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, textAlign: "center" },
});
