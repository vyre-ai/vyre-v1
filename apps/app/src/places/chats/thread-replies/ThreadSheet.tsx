// A phone opens the thread as a full-screen sheet over the chat: a header with a back arrow, "Thread" and the chat's title, then the thread. It is drawn in the shared overlay layer so nothing in the chat covers it.
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { Icon } from "../needsyou/parts.tsx";
import { THREAD_TITLE } from "./model.ts";

export function ThreadSheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }): ReactElement {
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Overlay>
      <View testID="thread-sheet" accessibilityViewIsModal accessibilityLabel={THREAD_TITLE} style={st.sheet}>
        <View style={st.head}>
          <Pressable testID="thread-sheet-back" accessibilityRole="button" accessibilityLabel="Back to the chat" onPress={onClose} hitSlop={10} style={st.back}><Icon name="back" size={18} color="var(--ink)" /></Pressable>
          <View style={st.titles}>
            <Text style={st.title}>{THREAD_TITLE}</Text>
            {title !== "" ? <Text testID="thread-sheet-title" numberOfLines={1} style={st.sub}>{title}</Text> : null}
          </View>
        </View>
        <View style={st.body}>{children}</View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  sheet: { position: "fixed" as unknown as "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "var(--win)" as string, zIndex: 50 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  body: { flex: 1, minHeight: 0 },
});
