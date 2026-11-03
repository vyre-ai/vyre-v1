// The quiet line under a message with a thread: the faces of who replied, "3 replies", when the last one came. It reads bold while a reply in it is new to me; a press opens the thread
// beside the chat. Nothing moves or blinks: the line is drawn again only when the thread changes.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { replyWords } from "./replies.ts";
import type { ReplySummary } from "./replies.ts";
import type { Clock } from "../rightpane/model.ts";

export function ReplyLine({ s, clock, nameOf, onOpen, mine = false, testID }: { s: ReplySummary; clock: Clock; nameOf(id: string): string; onOpen(): void; mine?: boolean; testID: string }): ReactElement {
  const w = replyWords(s, clock);
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Open the thread: ${w.label}`} onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.line, mine && st.mine, hovered === true && st.over]}>
      <View style={st.faces}>
        {/* ui-rows-lint: not a list (the faces of who replied, at most three, inside one line) */}
        {s.people.map((p) => <Face key={p.id} name={nameOf(p.id)} seedId={p.id} kind={p.kind} size={16} />)}
      </View>
      <Text testID={`${testID}-count`} style={[st.count, w.bold && st.bold]}>{w.count}</Text>
      {w.when ? <Text style={st.when}>{w.when}</Text> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 4, paddingVertical: 3, paddingHorizontal: 6, marginLeft: -6, borderRadius: 6 },
  mine: { alignSelf: "flex-end", marginLeft: 0, marginRight: -6 },
  over: { backgroundColor: "var(--hover)" as string },
  faces: { flexDirection: "row", gap: 2 },
  count: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  bold: { fontWeight: "700" },
  when: { fontSize: 12, color: "var(--ink-3)" as string },
});
