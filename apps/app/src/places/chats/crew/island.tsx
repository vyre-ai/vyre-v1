// The Island above the composer (prototype p-crew): while helpers work, one small pill says so and wears their faces; it says "Needs you" in amber when one waits for a person. It reads the same crew status as the
// strip, the header chip and the pane, and pressing it opens the pane. It is gone when nobody is working.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { counts, nameOf, faceSeed } from "./model.ts";
import type { CrewStatusOut } from "./model.ts";

export function CrewIsland({ status, onPress }: { status: CrewStatusOut; onPress: () => void }): ReactElement | null {
  const c = counts(status.totals);
  if (c.active === 0) return null;
  const active = c.needsYou > 0 ? status.members.filter((m) => m.state === "needs_you") : status.members.filter((m) => m.state === "working");
  return (
    <View style={st.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.needsYou > 0 ? `${c.needsYou} helper needs you` : `${c.active} helpers working`} testID="crew-island" onPress={onPress} style={st.pill}>
        <View style={[st.dot, { backgroundColor: (c.needsYou > 0 ? "var(--warn)" : "var(--accent)") as string }]} />
        <Text testID="crew-island-text" numberOfLines={1} style={st.text}>{islandText(status)}</Text>
        {/* ui-rows-lint: not a list (the faces of the helpers at work, a decoration on one pill) */}
        <View style={st.faces}>{active.slice(0, 5).map((m) => <Avatar key={m.id} name={nameOf(m)} seedId={faceSeed(m)} kind="agent" size={20} />)}</View>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 13, color: "var(--ink)" as string },
  faces: { flexDirection: "row", gap: 4 },
});
