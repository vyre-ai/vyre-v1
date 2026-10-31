// New record type and Rename record type: one small sheet. A name (singular), its plural (derived, editable) and an icon; the key is made from the name and never asked.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { Glyph, typeIcon } from "../sidebar/parts.tsx";
import { createTypeOps, pluralOf, renameTypeOps, TYPE_ICONS } from "./model.ts";
import type { Call } from "./model.ts";
import { useSchemaChange } from "./useChange.ts";

export interface TypeSheetProps {
  call: Call;
  /** Keys in use, so a new name that makes the same key gets the next free one. */
  takenKeys: readonly string[];
  /** Renaming this type; left out, a new type is made. */
  rename?: { key: string; title: string; plural: string; icon: string };
  onClose(): void;
  /** The key of the type that was made or renamed. */
  onDone(key: string): void;
}

export function TypeSheet({ call, takenKeys, rename, onClose, onDone }: TypeSheetProps): ReactElement {
  const [name, setName] = useState(rename?.title ?? "");
  const [plural, setPlural] = useState(rename?.plural ?? "");
  const [pluralEdited, setPluralEdited] = useState(rename !== undefined);
  const [icon, setIcon] = useState(rename?.icon ?? "table");
  const made = useMemo(() => createTypeOps({ name, plural: pluralEdited ? plural : pluralOf(name), icon, takenKeys }), [name, plural, pluralEdited, icon, takenKeys]);
  const change = useSchemaChange(call);
  const ready = name.trim() !== "" && (rename !== undefined || made.key !== "");
  const save = (): void => {
    if (!ready || change.busy) return;
    const ops = rename ? renameTypeOps(rename.key, name, pluralEdited ? plural : pluralOf(name)) : made.ops;
    void change.run(ops).then((ok) => { if (ok) { onDone(rename ? rename.key : made.key); onClose(); } });
  };
  return (
    <Dialog
      title={rename ? "Rename record type" : "New record type"} onClose={onClose} testID="type-sheet" width={420}
      actions={[{ label: "Cancel", onPress: onClose, testID: "type-sheet-cancel" }, { label: rename ? "Save" : "Create", primary: true, disabled: !ready || change.busy, onPress: save, testID: "type-sheet-save" }]}
    >
      <View style={s.body}>
        <Text style={s.label}>Name</Text>
        <TextField value={name} onChangeText={(t) => { setName(t); change.clearError(); }} placeholder="Client" accessibilityLabel="Record type name" testID="type-sheet-name" autoFocus onSubmitEditing={save} />
        <Text style={s.label}>Plural</Text>
        <TextField value={pluralEdited ? plural : pluralOf(name)} onChangeText={(t) => { setPlural(t); setPluralEdited(true); }} placeholder="Clients" accessibilityLabel="Plural name" testID="type-sheet-plural" onSubmitEditing={save} />
        {rename ? null : (
          <>
            <Text style={s.label}>Icon</Text>
            <View style={s.icons} accessibilityRole="radiogroup">
              {TYPE_ICONS.map((i) => (
                <Pressable key={i} accessibilityRole="radio" accessibilityLabel={i} accessibilityState={{ selected: icon === i }} testID={`type-icon-${i}`} onPress={() => setIcon(i)} style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.iconOver, icon === i && s.iconOn]}>
                  <Glyph name={typeIcon(i)} size={16} color={icon === i ? "var(--accent)" : "var(--ink-2)"} />
                </Pressable>
              ))}
            </View>
          </>
        )}
        {change.error ? <Text style={s.error} accessibilityRole="alert" testID="type-sheet-error">{change.error}</Text> : null}
      </View>
    </Dialog>
  );
}

const s = StyleSheet.create({
  body: { gap: 6 },
  label: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, marginTop: 6 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  icon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  iconOver: { backgroundColor: "var(--hover)" as string },
  iconOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 6 },
});
