// Mount for P-L9_07. ?part=history shows the Files version screen: the DiffTab of a version beside the HistoryTab in the right pane.
// ?part=object shows an ObjectPage the way the Console draws a person: breadcrumb, header, tabs with counts and a body of rows.
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DiffTab } from "../../../ui/src/DiffTab/index.tsx";
import type { DiffFile } from "../../../ui/src/DiffTab/index.tsx";
import { HistoryTab } from "../../../ui/src/HistoryTab/index.tsx";
import type { HistoryVersion } from "../../../ui/src/HistoryTab/index.tsx";
import { ObjectPage } from "../../../ui/src/ObjectPage/index.tsx";
import type { ObjectAction, ObjectTab } from "../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../ui/src/Row/index.tsx";

export const title = "History, diff and the object page";

const VERSIONS: HistoryVersion[] = [
  { id: "v5", n: 5, who: "Lena Ortiz", why: "Follow up after two business days", at: "2026-10-22T11:00:00Z", runId: null, undoable: true },
  { id: "v4", n: 4, who: "Lena Ortiz", why: "Added the brief and checklist", at: "2026-10-20T11:00:00Z", runId: null, undoable: true },
  { id: "v3", n: 3, who: "Maya Chen", why: "Added how it works", at: "2026-10-17T09:30:00Z", runId: null, undoable: true },
  { id: "v2", n: 2, who: "Lena Ortiz", why: "Added what it does and what it never does", at: "2026-10-15T14:00:00Z", runId: null, undoable: true },
  { id: "v1", n: 1, who: "Lena Ortiz", why: "First version", at: "2026-10-14T10:00:00Z", runId: null, undoable: true },
];

const FILES: DiffFile[] = [
  {
    path: "AGENT.md",
    added: 1,
    removed: 1,
    body: "text",
    hunks: [
      {
        id: "h1",
        context: "Follow-up",
        removed: '9. If the client does not reply in three business days, send one follow-up. After that, mark "No response" and stop.',
        added: '9. If the client does not reply in two business days, send one follow-up. After that, mark "No response" and stop.',
      },
    ],
  },
];

const ACTIONS: ObjectAction[] = [
  { id: "change-roles", label: "Change roles", destructive: false },
  { id: "view-as", label: "View as", destructive: false },
  { id: "remove", label: "Remove", destructive: true },
];

const TABS: ObjectTab[] = [
  { id: "overview", label: "Overview", count: null },
  { id: "access", label: "Access", count: 12 },
  { id: "devices", label: "Devices", count: 1 },
  { id: "activity", label: "Activity", count: null },
];

const FACTS: [string, string][] = [
  ["Roles", "Member"],
  ["Groups", "Everyone, Delivery"],
  ["Clearance", "Confidential"],
  ["Status", "Active"],
  ["Last active", "Today"],
  ["Email", "omar@northwind.example"],
];

export default function Mount() {
  const { part = "history" } = useLocalSearchParams<{ part?: string }>();
  const window = useWindowDimensions();
  const phone = window.width < 700;
  if (part === "object") {
    return (
      <View style={styles.page}>
        <ObjectPage
          id="prs_omar"
          name="Omar Haddad"
          kind="Person"
          owner="Northwind"
          status="Active"
          subtitle="Person · omar@northwind.example"
          parent="People"
          actions={ACTIONS}
          tabs={TABS}
          activeTabId="overview"
          sheetOpen={false}
          density={phone ? "compact" : "regular"}
          avatar={<View style={styles.avatar}><Text style={styles.avatarText}>O</Text></View>}
          impacts={{ remove: "Removing Omar reassigns 3 owned things and ends 1 session." }}
        >
          <View style={styles.card}>
            {FACTS.map(([label, value]) => (
              <Row key={label} id={`fact-${label}`} title={label} trailing={<Text style={styles.value}>{value}</Text>} />
            ))}
          </View>
        </ObjectPage>
      </View>
    );
  }
  return (
    <View style={[styles.page, styles.row]}>
      {phone ? null : (
        <View style={styles.main}>
          <DiffTab title="AGENT.md" layout="unified" wordMarks files={FILES} comments={[]} selectedPath="AGENT.md" density="regular" />
        </View>
      )}
      <View style={[styles.side, phone && styles.sideFull]}>
        <Text style={styles.sideTitle}>History</Text>
        <HistoryTab resourceType="file" resourceId="file_agent_md" versions={VERSIONS} selectedVersionId="v4" density={phone ? "compact" : "regular"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string },
  row: { flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  side: { width: 300, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  sideFull: { width: "100%", borderLeftWidth: 0 },
  sideTitle: { color: "var(--ink)" as string, fontSize: 13, fontWeight: "600", paddingHorizontal: 14, height: 38, lineHeight: 38, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "var(--ink-2)" as string, fontSize: 18, fontWeight: "600" },
  card: { borderRadius: 10, boxShadow: "0 0 0 1px var(--line)" as string, backgroundColor: "var(--raised)" as string, padding: 4 },
  value: { color: "var(--ink-2)" as string, fontSize: 13 },
});
