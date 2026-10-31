// ui/PeoplePicker: pick several people and agents from one list. A search field, the chosen ones as chips, then the matches as rows with their faces (an agent wears its library face,
// the assistant the Vyre mark, a person a marble). A press on a row toggles it; Enter in the field toggles the first match. The caller owns the selection.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { Row } from "../Row/index.tsx";
import { TextField } from "../TextField/index.tsx";
import { Tooltip } from "../Tooltip/index.tsx";

export interface PickEntry {
  id: string;
  name: string;
  kind: "person" | "agent";
  /** Muted text after the name: a role or "Agent". */
  sub?: string;
}

export interface PeoplePickerProps {
  entries: readonly PickEntry[];
  selected: readonly string[];
  onToggle(id: string): void;
  placeholder?: string;
  /** Rows shown before the list scrolls (default 5). */
  rows?: number;
  testID?: string;
}

const ROW = 32;

export function matching(entries: readonly PickEntry[], q: string): PickEntry[] {
  const w = q.trim().toLowerCase();
  return w === "" ? [...entries] : entries.filter((e) => e.name.toLowerCase().includes(w));
}

function Tick(): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, style: { display: "block", stroke: "var(--accent)", strokeWidth: 1.8, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } }, createElement("path", { d: "M3 8.5l3 3 7-7" }));
}

export function PeoplePicker({ entries, selected, onToggle, placeholder = "Search", rows = 5, testID = "people-picker" }: PeoplePickerProps): ReactElement {
  const [q, setQ] = useState("");
  const shown = matching(entries, q);
  const chosen = new Set(selected);
  const chips: ReactElement[] = [];
  for (const e of entries) {
    if (!chosen.has(e.id)) continue;
    chips.push(
      <Tooltip key={e.id} text={`Remove ${e.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${e.name}`} testID={`${testID}-chip-${e.id}`} onPress={() => onToggle(e.id)} style={({ hovered }: { hovered?: boolean }) => [s.chip, hovered === true && s.chipOver]}>
        <Avatar name={e.name} seedId={e.id} kind={e.kind} size={16} />
        <Text numberOfLines={1} style={s.chipText}>{e.name}</Text>
        <Text style={s.chipX}>x</Text>
      </Pressable>
      </Tooltip>,
    );
  }
  const list: ReactElement[] = [];
  for (const e of shown) {
    list.push(
      <View key={e.id} style={{ height: ROW }}>
        <Row
          id={`${testID}-${e.id}`} title={e.name} {...(e.sub ? { titleSuffix: e.sub } : {})} selected={chosen.has(e.id)} onPress={() => onToggle(e.id)}
          leading={<View style={s.face}><Avatar name={e.name} seedId={e.id} kind={e.kind} size={20} /></View>}
          trailing={chosen.has(e.id) ? <Tick /> : null}
        />
      </View>,
    );
  }
  return (
    <View testID={testID} style={s.root}>
      <TextField
        value={q} onChangeText={setQ} placeholder={placeholder} accessibilityLabel={placeholder} testID={`${testID}-search`} autoCapitalize="none" autoCorrect={false}
        onSubmitEditing={() => { const first = shown[0]; if (first && q.trim() !== "") { onToggle(first.id); setQ(""); } }}
      />
      {chips.length ? <View style={s.chips} testID={`${testID}-chips`}>{chips}</View> : null}
      <ScrollView style={{ maxHeight: ROW * rows }} keyboardShouldPersistTaps="handled" testID={`${testID}-list`}>
        {list.length ? list : <View style={s.none}><Text style={s.noneText}>No match</Text></View>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 4, paddingRight: 8, borderRadius: 13, backgroundColor: "var(--accent-wash)" as string, maxWidth: "100%" },
  chipOver: { opacity: 0.85 },
  chipText: { fontSize: 12.5, color: "var(--ink)" as string, flexShrink: 1 },
  chipX: { fontSize: 12, color: "var(--ink-3)" as string },
  face: { marginRight: 6, width: 20, height: 20 },
  none: { height: ROW, justifyContent: "center", paddingHorizontal: 8 },
  noneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
