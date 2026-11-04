// A reply thread beside the message it hangs off (audit Threads 2, 7, 8, 10). On a computer it fills the right column and the chat stays put; on a phone it is a full-screen sheet over the chat (agents reply in threads). The
// parent message sits on top (press it to go back to it in the chat), then the thread's own messages and composer. The control above it follows, mutes or leaves the thread. Escape closes it.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { ThreadSheet } from "../thread-replies/ThreadSheet.tsx";
import { useThreadExtras } from "../thread-replies/ThreadExtras.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import { Glyph } from "../conversation/parts.tsx";
import { useLive } from "./live.ts";
import { closesSide, followLabel, followMenu, followSaid, modeOf } from "./thread-side.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type ThreadsOut = CapMap["threads.list"]["out"];

export const THREAD_SIDE_W = 400;

export interface ThreadSideProps {
  rt: ShellRuntime;
  threadId: string;
  /** The thread's conversation, wired by the place. */
  data: ConversationData;
  /** A phone: a sheet over the chat instead of a column beside it. */
  narrow: boolean;
  onClose(): void;
  say(text: string): void;
}

export function ThreadSide({ rt, threadId, data, narrow, onClose, say }: ThreadSideProps): ReactElement {
  const thread = useLive<ThreadOut>(rt.screens, "chats.conversation", "thread", { threadId });
  const parent = thread.status === "ready" ? thread.data.thread.parentThreadId : undefined;
  // my standing in it is on its row among the threads of the chat it hangs under: the same live read the lines under the messages use
  const siblings = useLive<ThreadsOut>(rt.screens, "chats.right-pane", "threads", parent ? { threadId: parent } : null);
  const row = siblings.status === "ready" ? siblings.data.threads.find((t) => t.threadId === threadId) : undefined;
  const mode = modeOf(row);
  const menu = useMenu();

  useEffect(() => {
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void; removeEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void };
    if (narrow) return undefined;   // the sheet closes on Escape itself
    const onKey = (e: KeyboardEvent): void => { if (closesSide(e)) onClose(); };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, [narrow, onClose]);

  const set = (next: "follow" | "mute" | "leave"): void => {
    void Promise.resolve(rt.call("threads.follow", { threadId, mode: next })).then(() => say(followSaid(next)), () => say("Could not change that. Try again."));
  };
  const control = (
    <View style={st.bar}>
      <Pressable
        testID="thread-follow" accessibilityRole="button" accessibilityLabel={`${followLabel(mode)}. Follow, mute or leave this thread`}
        onPress={(e) => { const n = (e as unknown as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent; menu.show(followMenu(mode, set), n?.pageX ?? 8, (n?.pageY ?? 40) + 8, "context", { label: "Thread" }); }}
        style={({ hovered }: { hovered?: boolean }) => [st.follow, hovered === true && st.over]}
      >
        <Text style={[st.followText, mode === "mute" && st.mutedText]}>{followLabel(mode)}</Text>
        <Glyph name="chevd" size={12} />
      </Pressable>
      {row?.replyCount ? <Text style={st.count}>{`${row.replyCount} ${row.replyCount === 1 ? "reply" : "replies"}`}</Text> : null}
    </View>
  );
  // agents reply in threads: the empty line and "Also sent to the chat" (the chat's switch is in its More menu)
  const extras = useThreadExtras(rt, data, threadId, parent);
  const body = (
    <View testID="thread-side" style={st.body}>
      {control}
      <View style={st.conv}><Conversation key={threadId} data={extras.data} compact /></View>
      {menu.element}
    </View>
  );
  if (narrow) return <ThreadSheet title={extras.title} onClose={onClose}>{body}</ThreadSheet>;
  return (
    <SidePane paneKey="chats-thread-side" toggle={{ open: true, onPress: onClose }} title="Thread" tabs={[{ key: "thread", title: "Thread" }]} activeTab="thread" onCloseTab={onClose} defaultWidth={THREAD_SIDE_W}>
      {body}
    </SidePane>
  );
}

const st = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  conv: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  follow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 26, borderRadius: 6, borderWidth: 1, borderColor: "var(--line-2)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  followText: { fontSize: 12.5, color: "var(--ink)" as string, fontWeight: "500" },
  mutedText: { color: "var(--ink-3)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
});
