// A thread opens on the message it hangs off: the words it is about stay at the top, read from the parent chat. A parent the reader cannot see, or one deleted since, simply shows nothing.
// Pressing the box goes back to the message: the chat scrolls to it and marks it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface Parent { who: string; body: string }
type Call = (cap: string, input: unknown) => Promise<unknown>;

export function ThreadParent({ threadId, messageId, call, nameOf, onOpen }: { threadId?: string | undefined; messageId?: string | undefined; call: Call; nameOf(id: string): string; onOpen?: (() => void) | undefined }): ReactElement | null {
  const [parent, setParent] = useState<Parent | null>(null);
  useEffect(() => {
    if (!threadId || !messageId) return undefined;
    let live = true;
    void call("chat.message.get", { threadId, messageId }).then((o) => {
      const m = (o as { message?: { author?: { id?: string }; body?: string } } | null)?.message;
      if (live && m?.body) setParent({ who: m.author?.id ? nameOf(m.author.id) : "", body: m.body });
    }, () => undefined);
    return () => { live = false; };
  }, [threadId, messageId, call, nameOf]);
  if (!parent) return null;
  const words = (
    <>
      {parent.who ? <Text style={st.who}>{parent.who}</Text> : null}
      <Text style={st.body} numberOfLines={8}>{parent.body}</Text>
    </>
  );
  if (!onOpen) return <View style={st.gutter}><View testID="thread-parent" style={st.box} accessibilityRole="summary">{words}</View></View>;
  return (
    <View style={st.gutter}>
      <Pressable testID="thread-parent" accessibilityRole="link" accessibilityLabel="Back to the message" accessibilityHint="Scrolls the chat to the message this thread hangs off" onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.box, hovered === true && st.over]}>
        {words}
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  // the gutter keeps the box inside a narrow pane; the box keeps the chat's reading width in a wide one
  gutter: { paddingHorizontal: 16, marginTop: 8 },
  box: { padding: 12, gap: 4, borderRadius: 12, backgroundColor: "var(--raised)" as string, maxWidth: 660, alignSelf: "center", width: "100%" },
  over: { backgroundColor: "var(--hover)" as string },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  body: { fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string },
});
