// The name sheet behind Files' New folder and Rename: one field, Enter or the button makes the change, a refusal stays on the sheet in a line. Short words; the detail is the title.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Btn } from "../../places/vault/layout/parts.tsx";
import { Sheet } from "../../places/vault/layout/Sheet.tsx";

export type Ask =
  | { kind: "folder"; scope: "personal" | "space"; parentId: string | null }
  | { kind: "rename"; entry: "file" | "folder"; id: string; current: string };

export function NamePrompt({ ask, onClose, onDone, make }: { ask: Ask; onClose(): void; onDone(line: string): void; make(name: string): Promise<string> }): ReactElement {
  const [name, setName] = useState(ask.kind === "rename" ? ask.current : "");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const ok = name.trim() !== "" && !busy;
  const go = (): void => {
    if (!ok) return;
    setBusy(true); setLine(null);
    make(name).then(onDone, (e: unknown) => { setLine(e instanceof Error && e.message ? e.message : "That did not work."); setBusy(false); });
  };
  return (
    <Sheet
      title={ask.kind === "folder" ? "New folder" : "Rename"} onClose={onClose} testID="files-name-sheet"
      footer={<><Btn label="Cancel" onPress={onClose} testID="files-name-cancel" /><View style={{ flex: 1 }} /><Btn label={ask.kind === "folder" ? "Create" : "Rename"} primary disabled={!ok} {...(!ok && !busy ? { why: "Give it a name" } : {})} onPress={go} testID="files-name-go" /></>}
    >
      <TextInput
        autoFocus selectTextOnFocus accessibilityLabel="Name" testID="files-name-input" value={name} onChangeText={setName} onSubmitEditing={go} editable={!busy}
        placeholder="Name" placeholderTextColor="var(--ink-4)" style={s.input}
      />
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="files-name-line">{line}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { height: 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, color: "var(--ink)" as string, fontSize: 13 },
  danger: { fontSize: 12, color: "var(--danger)" as string },
});
