// "Add a team" card (Personal Space, last step). Opens the existing Space entry where the person chooses this Mac or a Linux server. The words about a Mac that sleeps are on the
// card itself, in plain terms, before anything is started.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export const MAC_WARNING = "This Mac must be on and Vyre open for your team to connect. For always-on, install on a server.";

export function TeamBridgeCard({ onCreate, mac }: { onCreate(): void; /** the desktop app is on a Mac, where this Mac can host */ mac: boolean }): ReactElement {
  return (
    <View testID="team-bridge" style={s.col}>
      <Text style={s.line}>A Team Space has its own Vault and memory.</Text>
      {mac ? <Text testID="mac-warning" style={s.warn}>{MAC_WARNING}</Text> : null}
      <Pressable testID="team-create" accessibilityRole="button" onPress={onCreate} style={s.primary}><Text style={s.primaryText}>Create a Team Space</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  line: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  warn: { fontSize: 13.5, lineHeight: 19, color: "var(--ink)" as string, padding: 10, borderRadius: 8, backgroundColor: "var(--accent-wash)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
});
