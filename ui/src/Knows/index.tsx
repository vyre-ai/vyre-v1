// The Knows tab (MEMORY-RULES 9): what Vyre remembers in one place, with who said it, when, its state, and Source, Edit and Remove for people who may edit the place. It is shown in the side pane of every
// shared place; the screen that owns the place mounts it and gives it memory.place.list's rows with names. The host does the work behind each button.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { groupKnows, knowsMark, linkedItems, openQuestions, sourceChip, spaceItems } from "./model.ts";
import type { KnowsItem } from "./model.ts";

export interface KnowsProps {
  /** The place's name: "Rivera account". */
  place: string;
  items: readonly KnowsItem[];
  /** Source: the host scrolls to the message (openMessage(item) gives its thread and message id). */
  onSource: (item: KnowsItem) => void;
  onEdit: (item: KnowsItem, text: string) => void;
  onRemove: (item: KnowsItem) => void;
  /** One of the two answers of an open question was picked: the host calls memory.question.resolve (keep_a or keep_b). */
  onAnswer?: (questionId: string, side: "a" | "b") => void;
}

export function Knows({ place, items, onSource, onEdit, onRemove, onAnswer }: KnowsProps): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const groups = groupKnows(items);
  const hov = ({ hovered }: { hovered?: boolean }): object[] => [st.sm, hovered === true && st.hover];
  const linked = linkedItems(items), space = spaceItems(items);
  if (groups.length === 0 && linked.length === 0 && space.length === 0) return <View testID="knows"><Text style={st.cap}>Nothing is remembered here yet.</Text></View>;
  return (
    <View testID="knows" style={st.root}>
      <Text style={st.head}>{`What Vyre remembers in ${place}`}</Text>
      <Text style={st.cap}>Only people who can open this place can read it.</Text>
      {groups.map((g) => (
        <View key={g.kind} testID={`knows-group-${g.kind}`}>
          <View style={st.label}><Text style={st.labelText}>{g.title}</Text><Text style={st.labelText}>{g.kind === "question" ? openQuestions(g.items).length + g.items.filter((i) => !i.questionId).length : g.items.length}</Text></View>
          {g.kind === "question" ? openQuestions(g.items).map((q) => (
            <View key={q.questionId} testID={`knows-question-${q.questionId}`} style={st.row}>
              <Text style={st.text}>{q.answers[0]!.text.replace(/\s+/g, " ")}</Text>
              <Text style={st.mark}>{"Open question \u00b7 Vyre will not guess"}</Text>
              <View style={st.acts}>
                {q.answers.map((a, n) => (
                  <Pressable key={a.factId} accessibilityRole="button" testID={`knows-answer-${q.questionId}-${a.qside}`} onPress={() => onAnswer?.(q.questionId, a.qside ?? "a")} style={({ hovered }: { hovered?: boolean }) => [st.ansBtn, n === 0 && st.ansPrimary, hovered === true && st.hover]}>
                    <Text style={[st.ansText, n === 0 && st.ansPrimaryText]}>{`${a.short ?? a.text} \u00b7 ${a.by.split(" ")[0]}, ${a.at}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )) : null}
          {g.items.filter((i) => g.kind !== "question" || !i.questionId).map((i) => {
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
                <View style={st.metaRow}>
                  <Text style={st.mark}>{knowsMark(i)}</Text>
                  {old && i.replacedBy ? <Text testID={`knows-replaced-${i.factId}`} style={st.replaced}>{`Replaced by: ${i.replacedBy}`}</Text> : null}
                </View>
                <View style={st.acts}>
                  <Pressable accessibilityRole="button" testID={`knows-source-${i.factId}`} onPress={() => onSource(i)} style={hov}><Text style={st.btn}>{"\u21a9 Source"}</Text></Pressable>
                  {i.canEdit && !old && !mine ? (
                    <>
                      <Pressable accessibilityRole="button" testID={`knows-editbtn-${i.factId}`} onPress={() => { setDraft(i.text); setEditing(i.factId); }} style={hov}><Text style={st.btn}>Edit</Text></Pressable>
                      <Pressable accessibilityRole="button" testID={`knows-remove-${i.factId}`} onPress={() => onRemove(i)} style={hov}><Text style={st.btn}>Remove</Text></Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
      {linked.length > 0 ? (
        <View testID="knows-linked">
          <View style={st.label}><Text style={st.labelText}>From linked places</Text><Text style={st.labelText}>{linked.length}</Text></View>
          {linked.map((i) => (
            <View key={i.factId} testID={`knows-row-${i.factId}`} style={st.row}>
              <Text style={st.text}>{i.text}</Text>
              <Text style={st.mark}>{`${i.from ?? "a linked place"} \u00b7 ${i.by} \u00b7 ${i.at}`}</Text>
              <View style={st.acts}><Pressable accessibilityRole="button" testID={`knows-source-${i.factId}`} onPress={() => onSource(i)} style={hov}><Text style={st.btn}>{"\u21a9 Source"}</Text></Pressable></View>
            </View>
          ))}
        </View>
      ) : null}
      {space.length > 0 ? (
        <View testID="knows-space">
          <View style={st.label}><Text style={st.labelText}>Space</Text><Text style={st.labelText}>{space.length}</Text></View>
          {space.map((i) => (
            <View key={i.factId} testID={`knows-row-${i.factId}`} style={st.row}>
              <Text style={st.text}>{i.text}</Text>
              <Text style={st.mark}>{`Marker in Space memory \u00b7 from ${i.from ?? "this place"} \u00b7 ${i.at}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The chip under an agent's answer that used a memory: who said it and when. Pressing it opens the source. */
export function SourceChip({ by, at, onPress }: { by: string; at: string; onPress?: () => void }): ReactElement {
  // the whole chip is the press target: it jumps to the message
  return (
    <Pressable accessibilityRole="link" testID="source-chip" onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.chipBox, hovered === true && st.hover]}>
      <Text style={st.chipIcon}>{"\u201c"}</Text>
      <Text style={st.chip}>{sourceChip(by, at)}</Text>
    </Pressable>
  );
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
  replaced: { fontSize: 11.5, color: "var(--ink-3)" as string, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  acts: { flexDirection: "row", gap: 12, paddingTop: 2 },
  btn: { fontSize: 12, color: "var(--ink-3)" as string },
  sm: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6 },
  hover: { backgroundColor: "var(--sunk)" as string },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  ansBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  ansPrimary: { backgroundColor: "var(--accent)" as string },
  ansText: { fontSize: 12.5, color: "var(--ink)" as string },
  ansPrimaryText: { color: "var(--on-accent, #fff)" as string },
  chipBox: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 8, borderRadius: 6, marginTop: 6, alignSelf: "flex-start", boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  chipIcon: { fontSize: 14, color: "var(--ink-3)" as string, lineHeight: 16 },
  input: { fontSize: 14, color: "var(--ink)" as string, borderRadius: 6, padding: 6, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  chip: { fontSize: 12, color: "var(--ink-3)" as string },
});
