// The mark on a thread message that was also put in the chat: "Also sent to the chat". The chat's own copy says where it came from (crew/also.tsx); this is the thread's side of the same fact.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../needsyou/parts.tsx";
import { ALSO_SENT } from "./model.ts";

export function AlsoSentMark({ messageId, mine = false }: { messageId: string; mine?: boolean }): ReactElement {
  return (
    <View testID={`also-sent-${messageId}`} accessibilityLabel={ALSO_SENT} style={[st.row, mine && st.mine]}>
      <Icon name="check" size={12} color="var(--ink-3)" />
      <Text style={st.text}>{ALSO_SENT}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, alignSelf: "flex-start" },
  mine: { alignSelf: "flex-end" },
  text: { fontSize: 12, color: "var(--ink-3)" as string },
});
