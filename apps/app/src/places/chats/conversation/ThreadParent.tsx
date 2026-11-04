// A thread opens on the message it hangs off: the words it is about stay at the top, read from the parent chat. A parent the reader cannot see, or one deleted since, simply shows nothing.
// Pressing the box goes back to the message: the chat scrolls to it and marks it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { chatWhen } from "../rightpane/model.ts";
import type { Clock } from "../rightpane/model.ts";

interface Parent { who: string; whoId: string; at?: number; body: string }
type Call = (cap: string, input: unknown) => Promise<unknown>;

export function ThreadParent({ threadId, messageId, call, nameOf, kindOf, clock, count, writing, onOpen }: { threadId?: string | undefined; messageId?: string | undefined; call: Call; nameOf(id: string): string; kindOf?: ((id: string) => "person" | "agent") | undefined; clock?: Clock | undefined; count?: number | undefined; /** Who is writing the first reply right now: the divider says so instead of "No replies yet". */ writing?: string | undefined; onOpen?: (() => void) | undefined }): ReactElement | null {
  const [parent, setParent] = useState<Parent | null>(null);
  useEffect(() => {
    if (!threadId || !messageId) return undefined;
    let live = true;
    void call("chat.message.get", { threadId, messageId }).then((o) => {
      const m = (o as { message?: { author?: { id?: string }; body?: string; createdAt?: number } } | null)?.message;
      if (live && m?.body) setParent({ who: m.author?.id ? nameOf(m.author.id) : "", whoId: m.author?.id ?? "", ...(m.createdAt !== undefined ? { at: m.createdAt } : {}), body: m.body });
    }, () => undefined);
    return () => { live = false; };
  }, [threadId, messageId, call, nameOf]);
  if (!parent) return null;
  // the root as a plain message row: face, name, time, then its words; under it a "N replies" divider leads into the replies
  const words = (
    <>
      <View style={st.head}>
        {parent.who ? <Face name={parent.who} seedId={parent.whoId} kind={kindOf?.(parent.whoId) ?? "person"} size={24} /> : null}
        {parent.who ? <Text style={st.who}>{parent.who}</Text> : null}
        {parent.at !== undefined && clock ? <Text style={st.at}>{chatWhen(parent.at, clock)}</Text> : null}
      </View>
      <Text style={st.body} numberOfLines={8}>{parent.body}</Text>
    </>
  );
  const divider = count !== undefined ? (
    <View testID="thread-replies-divider" style={st.divider}>
      <View style={st.rule} />
      <Text style={st.dividerText}>{count === 0 ? (writing ? `${writing} is writing` : "No replies yet") : `${count} ${count === 1 ? "reply" : "replies"}`}</Text>
      <View style={st.rule} />
    </View>
  ) : null;
  if (!onOpen) return <View style={st.gutter}><View testID="thread-parent" style={st.box} accessibilityRole="summary">{words}</View>{divider}</View>;
  return (
    <View style={st.gutter}>
      <Pressable testID="thread-parent" accessibilityRole="link" accessibilityLabel="Back to the message" accessibilityHint="Scrolls the chat to the message this thread hangs off" onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.box, hovered === true && st.over]}>
        {words}
      </Pressable>
      {divider}
    </View>
  );
}

const st = StyleSheet.create({
  // the gutter keeps the box inside a narrow pane; the box keeps the chat's reading width in a wide one
  gutter: { paddingHorizontal: 16, marginTop: 8 },
  box: { paddingVertical: 8, gap: 6, borderRadius: 8, maxWidth: 660, alignSelf: "center", width: "100%" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  at: { fontSize: 12, color: "var(--ink-3)" as string },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, maxWidth: 660, alignSelf: "center", width: "100%" },
  rule: { flex: 1, height: 1, backgroundColor: "var(--line)" as string },
  dividerText: { fontSize: 12, color: "var(--ink-3)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  body: { fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string },
});
