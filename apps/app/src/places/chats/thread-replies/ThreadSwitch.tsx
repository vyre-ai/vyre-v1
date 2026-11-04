// "Agents reply in threads": one switch for the chat, shown at the foot of a thread and in the chat's menu. On, an agent asked in the chat answers under that message; off, it answers in the chat.
// It reads the chat's own row and writes threads.set_agent_replies; the page changes with the row.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { SWITCH_NOTE, SWITCH_TITLE, switchToast } from "./model.ts";

type SetIn = CapMap["threads.set_agent_replies"]["in"];

/**
 * Whether agents reply in threads in this chat, and a way to change it. `row` is what the chat's own row says (threads.get, live): the page follows it. `null` when the row is not known yet or the chat has no
 * such choice. A press shows the new state at once and goes back if the write fails.
 */
export function useReplySwitch(data: Pick<ConversationData, "call" | "toast">, threadId: string, row: boolean | undefined): { on: boolean | null; set(on: boolean): void } {
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => { setMine(null); }, [row, threadId]);
  const on = mine ?? row ?? null;
  const set = useCallback((next: boolean): void => {
    setMine(next);
    const failed = (): void => { setMine(null); data.toast("Could not change that."); };
    try {
      void Promise.resolve(data.call("threads.set_agent_replies", { threadId, inThreads: next } satisfies SetIn)).then(() => data.toast(switchToast(next)), failed);
    } catch { failed(); }
  }, [data, threadId]);
  return { on, set };
}

export function ThreadSwitch({ on, onChange }: { on: boolean; onChange(on: boolean): void }): ReactElement {
  return (
    <View testID="thread-switch-row" style={st.row}>
      <View style={st.words}>
        <Text style={st.title}>{SWITCH_TITLE}</Text>
        <Text style={st.note}>{SWITCH_NOTE}</Text>
      </View>
      <Pressable testID="thread-switch" accessibilityRole="switch" accessibilityLabel={SWITCH_TITLE} aria-checked={on} onPress={() => onChange(!on)} style={[st.track, on && st.trackOn]}>
        <View style={[st.knob, on && st.knobOn]} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  words: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 13.5, color: "var(--ink)" as string },
  note: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  track: { width: 36, height: 20, borderRadius: 10, backgroundColor: "var(--ink-4)" as string, justifyContent: "center", paddingHorizontal: 2 },
  trackOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", alignSelf: "flex-start" },
  knobOn: { alignSelf: "flex-end" },
});
