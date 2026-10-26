// The quiet line a place shows when its hash names an item that is not there (or that you may not open). Not an error screen: the place around it keeps working.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

export function NotFound({ what }: { what: string }): ReactElement {
  return (
    <View testID="hash-not-found" accessibilityRole="alert" style={st.box}>
      <Text style={st.line}>{`That ${what} isn't here. It may have been deleted, or you may not have access to it.`}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  line: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
});
