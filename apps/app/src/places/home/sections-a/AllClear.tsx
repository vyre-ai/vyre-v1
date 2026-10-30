// One calm card in place of five empty sections: a tick and "All clear". It shows when Needs you, While you were away, Routines, Today and Starred all have nothing.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAllClear } from "./allclear.ts";
import { Glyph } from "./parts.tsx";

export function AllClear(): ReactElement | null {
  if (!useAllClear()) return null;
  return (
    <View testID="s-allclear" accessibilityRole="summary" accessibilityLabel="All clear" style={local.card}>
      <View style={local.tick}><Glyph name="done" size={20} color="var(--ok)" /></View>
      <Text style={local.text}>All clear</Text>
    </View>
  );
}

const local = StyleSheet.create({
  card: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 30, marginTop: 22, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  tick: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" as string },
  text: { fontSize: 14, fontWeight: "600", color: "var(--ink-2)" as string },
});
