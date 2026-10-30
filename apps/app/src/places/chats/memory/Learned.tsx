// Under the message that taught something: "Learned: Ian prefers updates on Fridays · Undo · Edit". Undo moves the fact to Trash and the line becomes "Moved to Trash. Restore", which brings
// it back; Edit turns the line into an input (Enter saves, Escape cancels) that corrects the fact and keeps the old wording in history. The lines come from the one read the thread makes
// (memory.learned for this thread), so a Forget in the Knows tab or in Files changes them too. Right-click a line for Edit, Open Page and Undo. A message that taught nothing draws nothing.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { each } from "../../files/memory/model.ts";
import { correctFact, restoreLearned, undoLearned } from "./actions.ts";
import type { LearnedRow } from "./model.ts";
import { LinkButton, webProps, ownMenu } from "./parts.tsx";
import { useThreadMemory } from "./thread.tsx";

export function LearnedLines({ messageId }: { messageId: string }): ReactElement | null {
  const thread = useThreadMemory();
  if (!thread) return null;
  const rows = thread.learnedFrom(messageId);
  if (rows.length === 0) return null;
  return <View testID={`learned-${messageId}`}>{each(rows, (r) => <LearnedLine key={r.factId} row={r} />)}</View>;
}

function LearnedLine({ row }: { row: LearnedRow & { current: boolean } }): ReactElement | null {
  const thread = useThreadMemory()!;
  const { memory } = thread;
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [err, setErr] = useState<string | null>(null);

  const undo = (): void => { setErr(null); void undoLearned(memory, row.factId).then(setErr); };
  const restore = (): void => { setErr(null); void restoreLearned(memory, row.factId).then(setErr); };
  const save = (): void => {
    const text = draft.trim();
    if (text === "" || text === row.text) { setEditing(false); return; }
    setErr(null);
    void correctFact(memory, row.factId, text).then((r) => {
      if (r.ok) { thread.supersede(row.factId, { ...row, factId: r.fact.factId, text: r.fact.text }); setEditing(false); } else setErr(r.error);
    });
  };

  if (!row.current) {
    return (
      <View testID={`learned-off-${row.factId}`} style={st.line}>
        <View style={[st.dot, st.dotOff]} />
        <Text style={[st.text, st.off]}>Moved to Trash.</Text>
        <LinkButton label="Restore" testID={`learned-restore-${row.factId}`} a11y={`Restore: ${row.text}`} onPress={restore} />
        {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
      </View>
    );
  }
  if (editing) {
    return (
      <View testID={`learned-edit-${row.factId}`} style={st.line}>
        <View style={st.dot} />
        <TextInput
          autoFocus selectTextOnFocus accessibilityLabel="Edit what was learned" testID={`learned-input-${row.factId}`} value={draft} onChangeText={setDraft} style={st.input}
          onKeyPress={(e) => {
            const k = (e as unknown as { nativeEvent: { key: string } }).nativeEvent.key;
            if (k === "Escape") { setEditing(false); setDraft(row.text); }
            else if (k === "Enter") { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); save(); }
          }}
        />
        <LinkButton label="Save" testID={`learned-save-${row.factId}`} onPress={save} />
        <LinkButton label="Cancel" quiet testID={`learned-cancel-${row.factId}`} onPress={() => { setEditing(false); setDraft(row.text); }} />
        {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
      </View>
    );
  }
  const items = (x: number, y: number): void => menu.show([
    { label: "Edit", onSelect: () => { setDraft(row.text); setEditing(true); } },
    ...(row.pageId ? [{ label: "Open Page", onSelect: () => memory.nav.openPage(row.pageId!) } as MenuEntry] : []),
    { separator: true },
    { label: "Undo", danger: true, onSelect: undo },
  ], x, y, "context", { label: "What was learned" });
  return (
    <View testID={`learned-line-${row.factId}`} accessibilityLabel={`Learned: ${row.text}`} {...webProps({ tabIndex: 0 })} {...ownMenu(items)} style={st.line}>
      <View style={st.dot} />
      <Text style={st.text}><Text style={st.bold}>Learned:</Text>{` ${row.subjectTitle ? `${row.subjectTitle}: ` : ""}${row.text}`}</Text>
      <Text style={st.sep}>·</Text>
      <LinkButton label="Undo" testID={`learned-undo-${row.factId}`} a11y={`Undo: ${row.text}`} onPress={undo} />
      <Text style={st.sep}>·</Text>
      <LinkButton label="Edit" testID={`learned-edit-btn-${row.factId}`} a11y={`Edit: ${row.text}`} onPress={() => { setDraft(row.text); setEditing(true); }} />
      {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 2, backgroundColor: "var(--ok)" as string },
  dotOff: { backgroundColor: "var(--ink-4)" as string },
  text: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  bold: { fontWeight: "600", color: "var(--ink-2)" as string },
  off: { color: "var(--ink-4)" as string },
  sep: { fontSize: 12.5, color: "var(--ink-4)" as string },
  input: { flexGrow: 1, flexBasis: 220, maxWidth: 360, height: 28, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 13, boxShadow: "inset 0 0 0 1px var(--line-2)", outlineStyle: "none" } as object,
  err: { width: "100%", fontSize: 12, color: "var(--danger)" as string },
});
