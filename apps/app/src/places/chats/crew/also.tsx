// "Also post to the chat" (prototype p-crew): under a thread's composer, one checkbox. Checked, the next message goes to the thread and a copy to the chat the thread hangs in, marked "Also sent to the chat from a
// thread", so the main chat reads the outcome and not the work. It resets after each send: the default is to stay in the thread.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function AlsoToChat({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): ReactElement {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel="Also post to the chat" testID="also-to-chat" onPress={() => onChange(!on)} style={st.row}>
      <View style={[st.box, on && st.boxOn]}>{on ? <Text style={st.tick}>✓</Text> : null}</View>
      <Text style={st.label}>Also post to the chat</Text>
    </Pressable>
  );
}

/** The line under a message that is a copy from a thread. */
export const FROM_THREAD_LINE = "Also sent to the chat from a thread";

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingVertical: 6 },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "var(--ink-4)" as string, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tick: { fontSize: 11, color: "var(--accent-ink)" as string, lineHeight: 12 },
  label: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
