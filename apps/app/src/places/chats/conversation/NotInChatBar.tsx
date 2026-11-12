// One component for "Maya is not in this chat." with Add, in its two places (lead, 12 Nov 2026: one component, two places): the strip on top of the composer while the message is written,
// and the quiet line under the sent message after. The words, the Add right beside them and the close are the same; only where it sits differs.
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RADIUS } from "../../../../../../ui/src/tokens/calm.ts";
import { IconButton, TextButton } from "./parts.tsx";

export function NotInChatBar({ text, add, extra, onDismiss, place, testID, textTestID, addTestID }: {
  text: string;
  /** The Add beside the words; absent when this person may not add anyone here, or nobody can be added. */
  add?: { label: string; onPress: () => void; disabled?: boolean } | undefined;
  /** More ways to add (the strip's caret). */
  extra?: ReactNode;
  onDismiss?: (() => void) | undefined;
  /** "composer": the strip on top of the composer; "message": the quiet line under the sent message. */
  place: "composer" | "message";
  testID: string;
  textTestID: string;
  addTestID: string;
}): ReactElement {
  const strip = place === "composer";
  return (
    <View testID={testID} accessibilityRole={strip ? "alert" : undefined} style={strip ? s.strip : s.line}>
      <Text numberOfLines={strip ? 1 : undefined} testID={textTestID} style={strip ? s.stripText : s.lineText}>{text}</Text>
      <View style={s.btns}>
        {add ? <TextButton primary={strip} label={add.label} testID={addTestID} disabled={add.disabled === true} onPress={add.onPress} /> : null}
        {extra}
        {onDismiss ? <IconButton icon="x" label="Dismiss" size={20} testID={`${testID}-dismiss`} onPress={onDismiss} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 38, paddingLeft: 14, paddingRight: 6, marginHorizontal: 10, marginBottom: -1, borderTopLeftRadius: RADIUS, borderTopRightRadius: RADIUS, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  stripText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 2 },
  lineText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  btns: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
});
