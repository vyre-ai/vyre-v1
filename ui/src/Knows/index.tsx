// The Knows tab (MEMORY-RULES 9): what Vyre remembers in one place, with who said it, when, its state, and Source, Edit and Remove for people who may edit the place. It is shown in the side pane of every
// shared place; the screen that owns the place mounts it and gives it memory.place.list's rows with names. The host does the work behind each button.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { groupKnows, knowsMark, sourceChip } from "./model.ts";
import type { KnowsItem } from "./model.ts";

export interface KnowsProps {
  /** The place's name: "Rivera account". */
  place: string;
  items: readonly KnowsItem[];
  onSource: (item: KnowsItem) => void;
  onEdit: (item: KnowsItem, text: string) => void;
  onRemove: (item: KnowsItem) => void;
}

export function Knows({ place, items, onSource, onEdit, onRemove }: KnowsProps): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const groups = groupKnows(items);
  if (groups.length === 0) return <View testID="knows"><Text style={st.cap}>Nothing is remembered here yet.</Text></View>;
  return (
    <View testID="knows" style={st.root}>
      <Text style={st.head}>{`What Vyre remembers in ${place}`}</Text>
      <Text style={st.cap}>Only people who can open this place can read it.</Text>
      {groups.map((g) => (
        <View key={g.kind} testID={`knows-group-${g.kind}`}>
          <View style={st.label}><Text style={st.labelText}>{g.title}</Text><Text style={st.labelText}>{g.items.length}</Text></View>
          {g.items.map((i) => {
            const old = i.state === "replaced";
            const mine = editing === i.factId;
            return (
              <View key={i.factId} testID={`knows-row-${i.factId}`} style={st.row}>
                {mine ? (
                  <View>
                    <TextInput testID={`knows-edit-${i.factId}`} value={draft} onChangeText={setDraft} style={st.input} autoFocus />
                    <View style={st.acts}>
                      <Pressable accessibilityRole="button" testID={`knows-save-${i.factId}`} onPress={() => { const t = draft.trim(); setEditing(null); if (t !== "" && t !== i.text) onEdit(i, t); }}><Text style={st.btn}>Save</Text></Pressable>
                      <Pressable accessibilityRole="button" testID={`knows-cancel-${i.factId}`} onPress={() => setEditing(null)}><Text style={st.btn}>Cancel</Text></Pressable>
                    </View>
                  </View>
                ) : <Text style={[st.text, old && st.old]}>{i.text}</Text>}
                <Text style={st.mark}>{knowsMark(i)}</Text>
                {old && i.replacedBy ? <Text testID={`knows-replaced-${i.factId}`} style={st.replaced}>{`Replaced by: ${i.replacedBy}`}</Text> : null}
                <View style={st.acts}>
                  <Pressable accessibilityRole="button" testID={`knows-source-${i.factId}`} onPress={() => onSource(i)}><Text style={st.btn}>Source</Text></Pressable>
                  {i.canEdit && !old && !mine ? (
                    <>
                      <Pressable accessibilityRole="button" testID={`knows-editbtn-${i.factId}`} onPress={() => { setDraft(i.text); setEditing(i.factId); }}><Text style={st.btn}>Edit</Text></Pressable>
                      <Pressable accessibilityRole="button" testID={`knows-remove-${i.factId}`} onPress={() => onRemove(i)}><Text style={st.btn}>Remove</Text></Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The chip under an agent's answer that used a memory: who said it and when. Pressing it opens the source. */
export function SourceChip({ by, at, onPress }: { by: string; at: string; onPress?: () => void }): ReactElement {
  return <Pressable accessibilityRole="link" testID="source-chip" onPress={onPress}><Text style={st.chip}>{sourceChip(by, at)}</Text></Pressable>;
}

const st = StyleSheet.create({
  root: { gap: 2 },
  head: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 10, paddingTop: 8 },
  cap: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 10, paddingBottom: 6 },
  label: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingTop: 14, paddingBottom: 4 },
  labelText: { fontSize: 12, color: "var(--ink-3)" as string },
  row: { paddingHorizontal: 10, paddingVertical: 8, gap: 3 },
  text: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  old: { textDecorationLine: "line-through", color: "var(--ink-3)" as string },
  mark: { fontSize: 12, color: "var(--ink-3)" as string },
  replaced: { fontSize: 12, color: "var(--ink-3)" as string, borderRadius: 6, padding: 6, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  acts: { flexDirection: "row", gap: 12, paddingTop: 2 },
  btn: { fontSize: 12.5, color: "var(--ink-3)" as string },
  input: { fontSize: 14, color: "var(--ink)" as string, borderRadius: 6, padding: 6, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  chip: { fontSize: 12, color: "var(--accent)" as string },
});
