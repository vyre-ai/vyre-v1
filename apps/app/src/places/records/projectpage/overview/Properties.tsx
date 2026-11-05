// The properties row of the Overview: the project's own facts (status, lead, dates, health) as read-only rows, then the fields of the Project record type. A field is edited in place (a pause or Enter
// saves it as an edit of the page, so it has a version and an Undo); "Add a property" fills a field of the type that is still empty.
import { useState } from "react";
import { currentZones, partsIn } from "../../../../../../../lib/zones.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useProjectPageData } from "../data.tsx";
import { propertyText, stageWord } from "./model.ts";
import type { Property } from "./model.ts";
import { TimePop } from "../../../../../../../ui/src/Time/index.tsx";

export interface Facts { status: string; lead?: string | undefined; start?: number | undefined; due?: number | undefined; health?: string | undefined }
const HEALTH: Readonly<Record<string, string>> = { on: "On track", risk: "At risk", off: "Off track", hold: "On hold", done: "Done" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 25", the day in the Space's zone. */
export const day = (ms: number | undefined): string => { if (ms === undefined) return ""; const p = partsIn(ms, currentZones().space); return `${MONTHS[p.month - 1]} ${p.day}`; };

function Field({ p, canEdit, onSet }: { p: Property; canEdit: boolean; onSet(key: string, text: string): void }): ReactElement {
  const [v, setV] = useState(propertyText(p));
  const [was, setWas] = useState(propertyText(p));
  const now = propertyText(p);
  if (now !== was) { setWas(now); setV(now); }
  if (!canEdit) return <Text style={s.val} testID={`prop-${p.key}`}>{v === "" ? "Empty" : v}</Text>;
  return (
    <TextInput accessibilityLabel={p.title} testID={`prop-${p.key}`} value={v} onChangeText={setV} placeholder="Empty" placeholderTextColor="var(--ink-4)" style={s.input}
      onBlur={() => { if (v !== now) onSet(p.key, v); }} onSubmitEditing={() => { if (v !== now) onSet(p.key, v); }} />
  );
}

export function PropertiesRow({ facts, props, canEdit, onSet, onAdd }: { facts: Facts | null; props: readonly Property[]; canEdit: boolean; onSet(key: string, text: string): void; onAdd(): void }): ReactElement {
  const d = useProjectPageData();
  const rows: { k: string; node: ReactElement }[] = [];
  if (facts) {
    rows.push({ k: "Status", node: <Text style={s.val} testID="prop-status">{stageWord(facts.status)}</Text> });
    if (facts.lead) rows.push({ k: "Lead", node: <Text style={s.val} testID="prop-lead">{d.nameOf(facts.lead)}</Text> });
    if (facts.start !== undefined || facts.due !== undefined) rows.push({ k: "Dates", node: <View testID="prop-dates-wrap" style={{ flexDirection: "row", gap: 4 }}>{facts.start !== undefined ? <TimePop at={facts.start}><Text style={s.val} testID="prop-dates">{day(facts.start)}</Text></TimePop> : null}{facts.start !== undefined && facts.due !== undefined ? <Text style={s.val}>to</Text> : null}{facts.due !== undefined ? <TimePop at={facts.due}><Text style={s.val} testID={facts.start === undefined ? "prop-dates" : "prop-dates-due"}>{day(facts.due)}</Text></TimePop> : null}</View> });
    if (facts.health) rows.push({ k: "Health", node: <Text style={s.val} testID="prop-health">{HEALTH[facts.health] ?? facts.health}</Text> });
  }
  // a page being read shows only the properties that have a value
  for (const p of props.filter((x) => canEdit || propertyText(x) !== "")) rows.push({ k: p.title, node: <Field p={p} canEdit={canEdit} onSet={onSet} /> });
  return (
    <View testID="overview-props" accessibilityLabel="Properties">
      <View style={s.grid}>
        {/* ui-rows-lint: not a list (a grid of labels and values) */}
        {rows.map((r) => <View key={r.k} style={s.row}><Text style={s.key}>{r.k}</Text><View style={s.cell}>{r.node}</View></View>)}
      </View>
      {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Add a property" testID="prop-add" onPress={onAdd} style={s.add}><Text style={s.addText}>+ Add a property</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 28 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, flexBasis: 250, flexGrow: 1 },
  key: { width: 96, fontSize: 12.5, color: "var(--ink-3)" as string },
  cell: { flex: 1, minWidth: 0 },
  val: { fontSize: 13.5, color: "var(--ink)" as string },
  input: { fontSize: 13.5, color: "var(--ink)" as string, paddingVertical: 2, paddingHorizontal: 4, marginHorizontal: -4, borderRadius: 4 },
  add: { alignSelf: "flex-start", height: 28, justifyContent: "center", paddingHorizontal: 6, marginTop: 2, borderRadius: 7 },
  addText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
