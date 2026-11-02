// A confirmation is a toast near the composer: it opens where you are working, not at the far top of the window (rule 1 of the chat system). One line, Undo when the action can be taken back.
// It sits over the main sheet and takes no room, so nothing under it moves.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StatusLine } from "./hub.ts";

export const TOAST_BOTTOM = 112;

export function Toast({ status, onUndo }: { status: StatusLine | null; onUndo: () => void }): ReactElement | null {
  if (status === null) return null;
  return (
    <View testID="toast" pointerEvents="box-none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={st.wrap}>
      <View style={st.toast} {...{ dataSet: { rise: "1" } }}>
        <Text numberOfLines={1} testID="toast-text" style={st.text}>{status.text}</Text>
        {status.undo ? <Pressable role="button" testID="toast-undo" aria-label="Undo" onPress={onUndo}><Text style={st.undo}>Undo</Text></Pressable> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: TOAST_BOTTOM, alignItems: "center", zIndex: 60 },
  toast: { flexDirection: "row", alignItems: "center", gap: 12, maxWidth: "90%" as unknown as number, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string },
  text: { flexShrink: 1, fontSize: 13, color: "var(--ink)" as string },
  undo: { fontSize: 13, fontWeight: "500", color: "var(--accent)" as string },
});
