// A Markdown file edited in the viewer: the one Markdown editor (ui/RichEditor), saved by itself as new versions with Undo (the same rule as AGENT.md, review/useFileAutosave.ts). The row above it
// holds the Saved state with the version number, Undo, and the Styled and Markdown switch; the text is plain .md, the same text agents read.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MarkdownEditor, ViewSwitch } from "../../../../../../ui/src/RichEditor/index.tsx";
import type { MarkdownView } from "../../../../../../ui/src/RichEditor/index.tsx";
import { useFileAutosave } from "../review/useFileAutosave.ts";
import { statusWords } from "../review/AgentFileEditor.tsx";

export interface FileMarkdownEditorProps {
  call: (cap: string, input: unknown) => Promise<unknown>;
  fileId: string;
  name: string;
  /** The text the file has and its version. */
  text: string;
  version: number;
  /** The text the file holds after each save, so the page reads it after Edit is left. */
  onText?: (text: string) => void;
  say?: (e: unknown) => void;
  /** Where the editor opens (a mount, a test). */
  startView?: MarkdownView;
}

export function FileMarkdownEditor({ call, fileId, name, text, version, onText, startView = "styled" }: FileMarkdownEditorProps): ReactElement {
  const fa = useFileAutosave({ call, fileId, saved: text, version, reason: "Edited in the viewer" });
  const [view, setView] = useState<MarkdownView>(startView);
  useEffect(() => { onText?.(fa.base.text); }, [fa.base.text]);
  const status = fa.auto.status;
  return (
    <View testID="file-md-editor" style={st.wrap}>
      <View style={st.row}>
        <View style={st.grow} />
        <Text style={st.status} testID="file-md-status" accessibilityLiveRegion="polite">{statusWords({ status, version: fa.auto.version, error: fa.auto.error })}</Text>
        {fa.auto.undoTo !== null ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="file-md-undo" onPress={fa.undo} style={st.undo}><Text style={st.undoText}>Undo</Text></Pressable> : null}
        <ViewSwitch view={view} onView={setView} />
      </View>
      {fa.line ? <Text style={[st.line, fa.line.kind === "error" && st.err]} testID="file-md-line">{fa.line.text}</Text> : null}
      {status === "error" && fa.auto.error ? <Text style={[st.line, st.err]} testID="file-md-error">{fa.auto.error}</Text> : null}
      <MarkdownEditor value={fa.draft} onChange={fa.edit} view={view} onView={setView} toggle={false} label={`Text of ${name}`} onSave={fa.flush} testID="file-md-text" placeholder="Write" />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  grow: { flex: 1 },
  status: { fontSize: 12, color: "var(--ink-3)" as string },
  undo: { paddingHorizontal: 6, height: 22, justifyContent: "center", borderRadius: 5 },
  undoText: { fontSize: 12, color: "var(--accent)" as string },
  line: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 16, paddingVertical: 4 },
  err: { color: "var(--danger)" as string },
});
