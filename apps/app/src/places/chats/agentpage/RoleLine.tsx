// The role line under an agent's name (spec 2.6): it edits in place. Enter saves to `description` in agent.toml and the page offers Undo; Escape or leaving the field puts the old
// line back. A person who cannot change the agent sees it read-only, and a lock shows on hover and on keyboard focus with the reason.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../rightpane/parts.tsx";
import { LOCKED_NOTE, ROLE_MAX, roleToSave } from "./model.ts";

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function RoleLine({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (next: string) => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const save = (): void => {
    const next = roleToSave(draft, value);
    setEditing(false);
    if (next !== null) onSave(next);
  };
  if (editing && canEdit) {
    return (
      <TextInput
        autoFocus testID="role-input" accessibilityLabel="Role line" maxLength={ROLE_MAX} value={draft} onChangeText={setDraft} onBlur={() => setEditing(false)}
        onKeyPress={(e) => {
          const k = (e as unknown as { nativeEvent: { key: string } }).nativeEvent.key;
          if (k === "Enter") { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); save(); }
          else if (k === "Escape") setEditing(false);
        }}
        style={st.input}
      />
    );
  }
  const empty = value.trim() === "";
  const label = canEdit ? `Role line: ${empty ? "empty" : value}. Press to edit` : `Role line: ${value}. ${LOCKED_NOTE}`;
  return (
    <Pressable
      testID="role-line" accessibilityRole={canEdit ? "button" : "text"} accessibilityLabel={label}
      {...webProps({ title: canEdit ? "Edit the role line" : LOCKED_NOTE })}
      onPress={() => { if (canEdit) { setDraft(value); setEditing(true); } }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={[st.line, canEdit && (over || focus) && st.lineOver]}
    >
      <Text numberOfLines={2} style={[st.text, empty && st.empty]}>{empty ? (canEdit ? "Add a line: use me when…" : "No role line") : value}</Text>
      {!canEdit && (over || focus) ? <View testID="role-lock"><Icon name="lock" size={13} color="var(--ink-3)" /></View> : null}
      {canEdit && (over || focus) ? <View testID="role-edit-hint"><Icon name="edit" size={13} color="var(--ink-3)" /></View> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", maxWidth: "100%", minHeight: 26, paddingHorizontal: 6, marginLeft: -6, borderRadius: 7 },
  lineOver: { backgroundColor: "var(--hover)" as string },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string },
  empty: { color: "var(--ink-4)" as string },
  input: { height: 28, alignSelf: "stretch", maxWidth: 560, paddingHorizontal: 8, marginLeft: -2, borderRadius: 7, fontSize: 14, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
});
