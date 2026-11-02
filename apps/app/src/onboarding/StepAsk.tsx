// The top of the Assistant chat under an onboarding step: one short line that says what to ask here, and one or two suggestions drawn like the composer's own attachment cards
// (rounded squares, never pills). A suggestion fills the composer; nothing is sent until the person sends it. It replaces the chat's empty state, so no placeholder words show.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StepAsk as Ask } from "./said.ts";

export function StepAsk({ ask, onPick }: { ask: Ask; onPick(text: string): void }): ReactElement {
  return (
    <View testID="step-ask" style={s.wrap}>
      <Text testID="step-ask-prompt" style={s.prompt}>{ask.prompt}</Text>
      <View style={s.line}>
        {/* ui-rows-lint: not a list (one or two suggestions side by side that fill the composer) */}
        {ask.suggestions.slice(0, 2).map((t, i) => (
          <Pressable key={t} testID={`step-ask-${i}`} accessibilityRole="button" accessibilityLabel={`Ask: ${t}`} onPress={() => onPick(t)} style={({ hovered }: { hovered?: boolean }) => [s.sug, hovered === true && s.sugOver]}>
            <Text style={s.sugText} numberOfLines={1}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, paddingTop: 14, paddingBottom: 6, paddingHorizontal: 16 },
  prompt: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  line: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sug: { maxWidth: "100%", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  sugOver: { backgroundColor: "var(--hover)" as string },
  sugText: { fontSize: 12.5, lineHeight: 18, color: "var(--ink)" as string },
});
