// The compact card an agent posts while it works through a list: a title and a few rows, each done (a tick) or not (an open circle). Connector test results and the review before publish are this
// card, so the person reads a short list and not a paragraph. Rows are plain words from the agent; nothing here is a button, and nothing in a row is run.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";

export interface ChecklistRow { text: string; done: boolean }
export interface ChecklistData { title: string; rows: ChecklistRow[] }

/** The title and rows of a checklist block's data. Anything that is not a row is left out. */
export function checklistOf(data: unknown): ChecklistData {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const items = Array.isArray(d["items"]) ? d["items"] : [];
  const rows: ChecklistRow[] = [];
  for (const it of items) {
    const r = it as Record<string, unknown> | null;
    if (r && typeof r["text"] === "string" && r["text"].trim() !== "") rows.push({ text: r["text"], done: r["done"] === true });
  }
  return { title: typeof d["title"] === "string" ? d["title"] : "", rows };
}

export const isChecklist = (type: string): boolean => type === "checklist";

export function ChecklistCard({ id, data }: { id: string; data: unknown }): ReactElement {
  const { title, rows } = checklistOf(data);
  const done = rows.filter((r) => r.done).length;
  return (
    <View testID={`checklist-${id}`} accessibilityLabel={title || "Checklist"} style={s.card}>
      <View style={s.head}>
        <Text accessibilityRole="header" style={s.title} numberOfLines={1}>{title || "Checklist"}</Text>
        {rows.length > 0 ? <Text style={s.count} testID={`checklist-${id}-count`}>{`${done} of ${rows.length}`}</Text> : null}
      </View>
      {rows.map((r, i) => (
        <Row
          key={i} id={`${id}-${i}`} title={r.text}
          leading={<View style={[s.dot, r.done && s.dotDone]} accessibilityLabel={r.done ? "Done" : "Not done"}>{r.done ? <Text style={s.tick}>{"\u2713"}</Text> : null}</View>}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginVertical: 8, maxWidth: 560, width: "100%", borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  title: { flex: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 22 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  dotDone: { borderColor: "var(--ok)" as string, backgroundColor: "var(--ok)" as string },
  tick: { fontSize: 10, lineHeight: 12, fontWeight: "700", color: "#fff" },
  text: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  textOpen: { color: "var(--ink-2)" as string },
});
