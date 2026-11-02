// A step whose real screen already exists elsewhere in Vyre (session import in Settings, Chrome in the Vault, folders in Files, a routine in Automations). The card says what the step
// does, opens that place, and lets the person tick the step when they are back. In the onboarding screen the bar's Continue is that tick (the card hands it over), so the card has one
// button, the place to open.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FlowKind } from "./flow.ts";
import { StepTile } from "./StepGlyph.tsx";
import { CARD } from "./card-style.ts";

export function OpenCard({ text, action, onOpen, onDone, step, gate }: { text: string; action: string; onOpen(): void; onDone(): void; step?: { flow: FlowKind; key: string }; gate?(save: (() => Promise<boolean>) | null): void }): ReactElement {
  useEffect(() => {
    if (!gate) return undefined;
    gate(async () => true);
    return () => gate(null);
  }, [gate]);
  return (
    <View testID="open-card" style={s.col}>
      {text ? <View style={s.head}>{step ? <StepTile flow={step.flow} k={step.key} size={40} /> : null}<Text style={s.line}>{text}</Text></View> : null}
      <View style={s.row}>
        <Pressable testID="open-card-go" accessibilityRole="button" onPress={onOpen} style={gate ? s.ghost : s.primary}><Text style={gate ? s.ghostText : s.primaryText}>{action}</Text></Pressable>
        {gate ? null : <Pressable testID="open-card-done" accessibilityRole="button" onPress={onDone} style={s.ghost}><Text style={s.ghostText}>Done</Text></Pressable>}
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
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  ghost: CARD.ghost,
  ghostText: CARD.ghostText,
});
