// A step whose real screen already exists elsewhere in Vyre (session import in Settings, Chrome in the Vault, folders in Files, a routine in Automations). The card says what the step
// does, opens that place, and lets the person tick the step when they are back.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function OpenCard({ text, action, onOpen, onDone }: { text: string; action: string; onOpen(): void; onDone(): void }): ReactElement {
  return (
    <View testID="open-card" style={s.col}>
      <Text style={s.line}>{text}</Text>
      <View style={s.row}>
        <Pressable testID="open-card-go" accessibilityRole="button" onPress={onOpen} style={s.primary}><Text style={s.primaryText}>{action}</Text></Pressable>
        <Pressable testID="open-card-done" accessibilityRole="button" onPress={onDone} style={s.ghost}><Text style={s.ghostText}>Done</Text></Pressable>
      </View>
    </View>
  );
}

/** Where each such step lives; the place ids are the shell rail's. */
export const OPEN_TARGETS: Partial<Record<string, { place: string; text: string; action: string }>> = {
  import_sessions: { place: "settings", text: "Open Settings, Import sessions. Vyre lists the Claude Code and Codex sessions it finds on this computer and imports the ones you tick.", action: "Open session import" },
  local_folders: { place: "files", text: "Open Files and add a folder from this computer. It stays on this computer unless you share it.", action: "Open Files" },
  chrome: { place: "vault", text: "Open the Vault, Advanced, Browsers to install Vyre for Chrome. Chrome needs three clicks from you.", action: "Open Browsers" },
  first_win: { place: "automations", text: "Open Automations and start from a ready-made routine such as a morning summary.", action: "Open Automations" },
  meet_agents: { place: "chats", text: "Open Chats to see the team's agents and say hello to one.", action: "Open Chats" },
  apps: { place: "settings", text: "Open Settings to get the desktop app, the phone app and the Chrome extension.", action: "Open Settings" },
  own_data: { place: "inbox", text: "Your mail and calendar from your work account show in Inbox and Calendar. Only you can see them.", action: "Open Inbox" },
};

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  line: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
});
