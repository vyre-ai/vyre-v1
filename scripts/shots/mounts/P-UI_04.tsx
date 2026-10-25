// Mount for P-UI_04: the shared AskButton in the header of an item page, the way the Vault item page of the prototype draws it
// (Ask split button, Edit, more). ?part=closed shows the control at rest; ?part=picker opens the agent picker (Suggested Intake, the assistant, the rest).
import { useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AskButton } from "../../../ui/src/AskButton/index.tsx";
import type { AskAgent, AskContext } from "../../../ui/src/AskButton/index.tsx";
import { memoryStorage } from "../../../ui/src/AskButton/logic.ts";
import { MenuIcon } from "../../../ui/src/Menu/index.tsx";

export const title = "Ask with an agent selector";

const AGENTS: AskAgent[] = [
  { id: "assistant", name: "Assistant", assistant: true },
  { id: "intake", name: "Intake" },
  { id: "scheduler", name: "Scheduler" },
  { id: "proofer", name: "Proofer" },
  { id: "billing", name: "Billing" },
  { id: "research", name: "Research" },
  { id: "docs", name: "Docs" },
  { id: "scout", name: "Scout" },
];

const CONTEXT: AskContext = { kind: "vault", id: "ghl", title: "GoHighLevel", access: "edit" };

export default function Mount() {
  const { part = "closed" } = useLocalSearchParams<{ part?: string }>();
  const window = useWindowDimensions();
  // The prototype's item page starts at x 684 on a desktop window; the real header lines up with it.
  const left = window.width > 700 ? 684 : 0;
  return (
    <View style={styles.page}>
      <View style={[styles.pane, { marginLeft: left }]}>
        <View style={styles.header}>
          <AskButton
            place="vault"
            context={CONTEXT}
            agents={AGENTS}
            suggested="intake"
            storage={memoryStorage()}
            startOpen={part === "picker"}
            onAsk={() => undefined}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Edit" style={styles.edit}>
            <MenuIcon icon="edit" color="var(--ink-2)" size={15} />
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="More" style={styles.more}>
            <MenuIcon icon="more" color="var(--ink-2)" size={16} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.badge}><Text style={styles.badgeText}>G</Text></View>
          <View>
            <Text style={styles.name}>GoHighLevel</Text>
            <Text style={styles.sub}>#Northwind_GHL  PIT</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string },
  pane: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, height: 54 },
  edit: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 10, borderRadius: 8 },
  editText: { color: "var(--ink)" as string, fontSize: 13, fontWeight: "500" },
  more: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  body: { flexDirection: "row", alignItems: "center", gap: 18, paddingTop: 24, paddingHorizontal: 24 },
  badge: { width: 64, height: 64, borderRadius: 14, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "var(--ink)" as string, fontSize: 26, fontWeight: "500" },
  name: { color: "var(--ink)" as string, fontSize: 26, fontWeight: "600" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, marginTop: 4 },
});
