// Mount for P-L9_07c: the version screen and the object page the way the prototype draws them.
// ?part=history shows the Viewing banner (Hide changes, Restore this version, Back to current) over a bare version diff with its unchanged lines, beside the HistoryTab with author faces.
// ?part=object shows Omar's page: a face, rows that open something end in a chevron, an AI account row with its menu, and the Owns list with agent faces.
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Avatar } from "../../../ui/src/Avatar/index.tsx";
import { DiffTab } from "../../../ui/src/DiffTab/index.tsx";
import type { DiffFile } from "../../../ui/src/DiffTab/index.tsx";
import { HistoryTab, VersionBanner } from "../../../ui/src/HistoryTab/index.tsx";
import type { HistoryVersion } from "../../../ui/src/HistoryTab/index.tsx";
import { MenuIcon, useMenu } from "../../../ui/src/Menu/index.tsx";
import { ObjectChevron, ObjectPage, ObjectSection } from "../../../ui/src/ObjectPage/index.tsx";
import type { ObjectAction, ObjectTab } from "../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../ui/src/Row/index.tsx";

export const title = "Version banner, unchanged lines and the object page";

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
        before: "8. Write the brief for the host (see Pointers) and hand it off.",
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



const OWNS: { id: string; name: string; note: string; kind: "agent" | "record" }[] = [
  { id: "scout", name: "Scout", note: "Agent", kind: "agent" },
  { id: "bookings", name: "Bookings", note: "Agent", kind: "agent" },
  { id: "projects", name: "Projects", note: "Record type", kind: "record" },
];

const ACCOUNTS = ["Space keys", "Their own account"];

function Mono({ children }: { children: string }) {
  return <Text style={styles.mono}>{children}</Text>;
}

function Dot({ tone }: { tone: "ok" | "warn" }) {
  return <View style={[styles.dot, tone === "ok" ? styles.dotOk : styles.dotWarn]} />;
}

function AccountRow() {
  const [account, setAccount] = useState(ACCOUNTS[0] ?? "");
  const { element, show } = useMenu();
  const open = (e: unknown): void => {
    const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } } | undefined)?.currentTarget?.getBoundingClientRect?.();
    show(ACCOUNTS.map((label) => ({ label, checked: label === account, onSelect: () => setAccount(label) })), box?.left ?? 0, (box?.bottom ?? 0) + 4, "context", { label: "AI account" });
  };
  return (
    <>
      <Row
        id="fact-AI account"
        title="AI account"
        trailing={
          <Pressable role="button" aria-label={`AI account: ${account}`} aria-haspopup="menu" testID="object-ai-account" onPress={open} style={styles.pick}>
            <Text style={styles.value}>{account}</Text>
            <MenuIcon icon='<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>' color="var(--ink-3)" size={12} />
          </Pressable>
        }
        onPress={() => undefined}
      />
      {element}
    </>
  );
}

function ObjectBody() {
  const owns = [];
  for (const o of OWNS) {
    owns.push(
      <Row
        key={o.id}
        id={`owns-${o.id}`}
        title={o.name}
        note={o.note}
        leading={o.kind === "agent" ? <Avatar name={o.name} kind="agent" size={28} /> : <View style={styles.tile}><MenuIcon icon="pane" color="var(--ink-3)" size={15} /></View>}
        trailing={<ObjectChevron />}
        onPress={() => undefined}
      />,
    );
  }
  return (
    <>
      <View style={styles.card}>
        <Row id="fact-Roles" title="Roles" trailing={<View style={styles.end}><Text style={styles.value}>Member</Text><ObjectChevron /></View>} onPress={() => undefined} />
        <Row id="fact-Groups" title="Groups" trailing={<View style={styles.end}><Text style={styles.value}>Everyone, Delivery</Text><ObjectChevron /></View>} onPress={() => undefined} />
        <Row id="fact-Clearance" title="Clearance" trailing={<View style={styles.end}><Dot tone="warn" /><Text style={styles.value}>Confidential</Text><Text style={styles.quiet}>Member</Text></View>} />
        <Row id="fact-Status" title="Status" trailing={<View style={styles.end}><Dot tone="ok" /><Text style={styles.value}>Active</Text></View>} />
        <Row id="fact-Last active" title="Last active" trailing={<Text style={styles.quiet}>Today</Text>} />
        <Row id="fact-Email" title="Email" trailing={<View style={styles.end}><Mono>omar@northwind.example</Mono><MenuIcon icon="copy" color="var(--ink-3)" size={14} /></View>} onPress={() => undefined} />
        <AccountRow />
      </View>
      <ObjectSection title="Owns" count={OWNS.length}>{owns}</ObjectSection>
    </>
  );
}

function History() {
  const phone = useWindowDimensions().width < 700;
  const [viewing, setViewing] = useState<string | null>("v4");
  const [changes, setChanges] = useState(true);
  const version = VERSIONS.find((v) => v.id === viewing) ?? null;
  const current = VERSIONS[0];
  const old = version !== null && current !== undefined && version.id !== current.id;
  return (
    <View style={styles.page}>
      {old && version !== null ? <VersionBanner version={version} showingChanges={changes} canRestore onToggleChanges={() => setChanges((c) => !c)} onRestore={() => setViewing(current?.id ?? null)} onBack={() => setViewing(current?.id ?? null)} /> : null}
      <View style={styles.row}>
        {phone ? null : (
          <View style={styles.main}>
            {changes || !old ? <DiffTab title="AGENT.md" layout="unified" wordMarks={false} bare files={FILES} comments={[]} selectedPath="AGENT.md" density="regular" /> : <View style={styles.plain}><Text style={styles.code}>{FILES[0]?.hunks[0]?.added ?? ""}</Text></View>}
          </View>
        )}
        <View style={[styles.side, phone && styles.sideFull]}>
          <HistoryTab resourceType="file" resourceId="file_agent_md" versions={VERSIONS} selectedVersionId={viewing} density={phone ? "compact" : "regular"} onSelect={(id) => { setViewing(id); setChanges(true); }} />
        </View>
      </View>
    </View>
  );
}

export default function Mount() {
  const { part = "history" } = useLocalSearchParams<{ part?: string }>();
  const phone = useWindowDimensions().width < 700;
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
          avatar={<Avatar name="Omar Haddad" kind="person" size={44} />}
          impacts={{ remove: "Removing Omar reassigns 3 owned things and ends 1 session." }}
        >
          <ObjectBody />
        </ObjectPage>
      </View>
    );
  }
  return <History />;
}

const MONO = Platform.OS === "web" ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : "Menlo";

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string },
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  plain: { padding: 14 },
  code: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 12.5, lineHeight: 20 },
  side: { width: 300, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  sideFull: { width: "100%", borderLeftWidth: 0 },
  card: { borderRadius: 10, boxShadow: "0 0 0 1px var(--line)" as string, backgroundColor: "var(--raised)" as string, padding: 4 },
  end: { flexDirection: "row", alignItems: "center", gap: 8 },
  pick: { flexDirection: "row", alignItems: "center", gap: 6 },
  value: { color: "var(--ink)" as string, fontSize: 13 },
  quiet: { color: "var(--ink-3)" as string, fontSize: 13 },
  mono: { color: "var(--ink-2)" as string, fontFamily: MONO, fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: "var(--ok)" as string },
  dotWarn: { backgroundColor: "var(--warn)" as string },
  tile: { width: 28, height: 28, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
});
