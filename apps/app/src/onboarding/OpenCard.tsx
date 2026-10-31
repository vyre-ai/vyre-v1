// A step whose real screen already exists elsewhere in Vyre (session import in Settings, Chrome in the Vault, folders in Files, a routine in Automations). The card says what the step
// does, opens that place, and lets the person tick the step when they are back.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FlowKind } from "./flow.ts";
import { StepTile } from "./StepGlyph.tsx";

export function OpenCard({ text, action, onOpen, onDone, step }: { text: string; action: string; onOpen(): void; onDone(): void; step?: { flow: FlowKind; key: string } }): ReactElement {
  return (
    <View testID="open-card" style={s.col}>
      <View style={s.head}>{step ? <StepTile flow={step.flow} k={step.key} size={40} /> : null}{text ? <Text style={s.line}>{text}</Text> : null}</View>
      <View style={s.row}>
        <Pressable testID="open-card-go" accessibilityRole="button" onPress={onOpen} style={s.primary}><Text style={s.primaryText}>{action}</Text></Pressable>
        <Pressable testID="open-card-done" accessibilityRole="button" onPress={onDone} style={s.ghost}><Text style={s.ghostText}>Done</Text></Pressable>
      </View>
    </View>
  );
}

/** Where each such step lives; the place ids are the shell rail's. */
export const OPEN_TARGETS: Partial<Record<string, { place: string; text: string; action: string }>> = {
  import_sessions: { place: "settings", text: "", action: "Open session import" },
  local_folders: { place: "files", text: "", action: "Open Files" },
  chrome: { place: "vault", text: "", action: "Open Browsers" },
  first_win: { place: "automations", text: "", action: "Open Automations" },
  meet_agents: { place: "chats", text: "", action: "Open Chats" },
  apps: { place: "settings", text: "", action: "Open Settings" },
  own_data: { place: "inbox", text: "", action: "Open Inbox" },
};

const s = StyleSheet.create({
  col: { gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  line: { flex: 1, fontSize: 15, lineHeight: 22, color: "var(--ink)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
});
