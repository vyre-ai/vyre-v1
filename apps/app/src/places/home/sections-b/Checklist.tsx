// Home > Get started: the first-run checklist (spec 3.1 flow 4). A raised card of rows, each a ui/Row with a check circle in its leading slot and one button in its trailing
// slot. The card shows "n of N" and goes away once every row is done or the person hides it. Data: home.checklist (screen home.checklist), live from the kept copy.
// A Personal Space keeps the same card without the project row. "Meet your assistant" waits (Locked) until an AI account is connected.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useScreenQuery } from "../sections-a/data.tsx";
import { isPersonal, useExtras } from "./data.tsx";
import { CHECKLIST_SCREEN, checklistProgress, checklistRows } from "./model.ts";
import type { ChecklistRow } from "./model.ts";
import { GoButton, Icon } from "./parts.tsx";

type Out = CapMap["home.checklist"]["out"];

function Circle({ done }: { done: boolean }): ReactElement {
  return <View style={[local.circle, done && local.circleDone]} testID={done ? "check-done" : "check-open"}>{done ? <Icon name="check" size={12} color="#fff" width={2} /> : null}</View>;
}

export function Checklist(): ReactElement | null {
  const extras = useExtras();
  const q = useScreenQuery<Out>(CHECKLIST_SCREEN, "checklist");
  if (q.status !== "ready" || !q.data.visible) return null;
  const rows = checklistRows(q.data, { spaceName: extras.space.name, personal: isPersonal(extras), aiConnected: extras.aiConnected });
  const { done, total } = checklistProgress(rows);
  const items: ReactElement[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: ChecklistRow = rows[i]!;
    items.push(
      <View key={r.key} style={[local.item, i > 0 && local.itemLine]} testID={`first-${r.key}`}>
        <Row
          id={`first-${r.key}`}
          title={r.title}
          note={r.note}
          leading={<View style={local.lead}><Circle done={r.done} /></View>}
          trailing={r.done ? null : r.locked ? <Text style={local.locked}>Locked</Text> : <GoButton label={r.action} testID={`first-go-${r.key}`} onPress={() => extras.go(r.key === "ai" ? "ai" : r.key)} />}
          {...(r.done || r.locked ? {} : { onPress: () => extras.go(r.key === "ai" ? "ai" : r.key) })}
        />
      </View>,
    );
  }
  return (
    <View testID="s-first" accessibilityLabel="Get started" style={local.card}>
      <View style={local.head}>
        <Text accessibilityRole="header" style={local.title}>Get started</Text>
        <Text style={local.n} testID="first-progress">{`${done} of ${total}`}</Text>
        <View style={local.grow} />
      </View>
      <View style={local.body} accessibilityRole="list">{items}</View>
    </View>
  );
}

const local = StyleSheet.create({
  card: { marginTop: -4, marginBottom: 22 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 24, marginBottom: 4 },
  title: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  n: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  grow: { flex: 1 },
  body: { borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  item: { paddingVertical: 4, paddingHorizontal: 6 },
  itemLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  lead: { width: 32, alignItems: "flex-start", justifyContent: "center" },
  circle: { width: 20, height: 20, borderRadius: 99, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  circleDone: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  locked: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
