// New record type and Rename record type: one small sheet. A name (singular), its plural (derived, editable) and an icon; the key is made from the name and never asked.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { Glyph, typeIcon } from "../sidebar/parts.tsx";
import { createTypeOps, moreStarters, namesOf, renameTypeOps, shownStarters, suggestStarters, TYPE_ICONS } from "./model.ts";
import type { Call, ConnectType } from "./model.ts";
import { TextButton } from "./parts.tsx";
import { useSchemaChange } from "./useChange.ts";

export interface TypeSheetProps {
  call: Call;
  /** Keys in use, so a new name that makes the same key gets the next free one. */
  takenKeys: readonly string[];
  /** Renaming this type; left out, a new type is made. */
  rename?: { key: string; title: string; plural: string; icon: string };
  /** Types the new one can be connected to (Contacts first). Left out or empty: the sheet does not offer a link. */
  connectTo?: readonly ConnectType[];
  /** Ask Vyre to set it up: opens the assistant in the tab with this sheet's name as context. Left out where the place has none. */
  onAsk?(about: { name: string }): void;
  onClose(): void;
  /** The key of the type that was made or renamed. */
  onDone(key: string): void;
}

export function TypeSheet({ call, takenKeys, rename, connectTo = [], onAsk, onClose, onDone }: TypeSheetProps): ReactElement {
  const [name, setName] = useState(rename?.title ?? "");
  const [plural, setPlural] = useState(rename?.plural ?? "");
  const [pluralEdited, setPluralEdited] = useState(rename !== undefined);
  const [icon, setIcon] = useState(rename?.icon ?? "table");
  const [starters, setStarters] = useState<readonly string[]>([]);
  const [links, setLinks] = useState<readonly string[]>([]);
  // what the type is for picks its usual fields until the person picks for themselves
  const [touched, setTouched] = useState(false);
  const [more, setMore] = useState(false), [find, setFind] = useState("");
  const buyName = (t: string): void => {
    setName(t); change.clearError();
    if (!touched && rename === undefined) { const g = suggestStarters(t); setStarters(g.starters); setLinks(g.connect.filter((k) => connectTo.some((c) => c.key === k))); }
  };
  const flip = (list: readonly string[], k: string): string[] => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const change = useSchemaChange(call);
  const made = useMemo(
    () => createTypeOps({ name, plural: pluralEdited ? plural : "", icon, takenKeys, starters, connect: connectTo.filter((c) => links.includes(c.key)) }),
    [name, plural, pluralEdited, icon, takenKeys, starters, links, connectTo],
  );
  const ready = name.trim() !== "" && (rename !== undefined || made.key !== "");
  const save = (): void => {
    if (!ready || change.busy) return;
    const ops = rename ? renameTypeOps(rename.key, name, pluralEdited ? plural : "") : made.ops;
    void change.run(ops).then((ok) => { if (ok) { onDone(rename ? rename.key : made.key); onClose(); } });
  };
  return (
    <Dialog
      title={rename ? "Rename record type" : "New record type"} onClose={onClose} testID="type-sheet" width={420}
      actions={[{ label: "Cancel", onPress: onClose, testID: "type-sheet-cancel" }, { label: rename ? "Save" : "Create", primary: true, disabled: !ready || change.busy, onPress: save, testID: "type-sheet-save" }]}
    >
      <View style={s.body}>
        <Text style={s.label}>Name</Text>
        <TextField value={name} onChangeText={buyName} placeholder="Client" accessibilityLabel="Record type name" testID="type-sheet-name" autoFocus onSubmitEditing={save} />
        <Text style={s.label}>Plural</Text>
        <TextField value={pluralEdited ? plural : namesOf(name).plural} onChangeText={(t) => { setPlural(t); setPluralEdited(true); }} placeholder="Clients" accessibilityLabel="Plural name" testID="type-sheet-plural" onSubmitEditing={save} />
        {rename ? null : (
          <>
            <Text style={s.label}>Icon</Text>
            <View style={s.icons} accessibilityRole="radiogroup">
              {/* ui-rows-lint: not a list (icon picker swatches in a wrapping grid) */}
              {TYPE_ICONS.map((i) => (
                <Pressable key={i} accessibilityRole="radio" accessibilityLabel={i} accessibilityState={{ selected: icon === i }} testID={`type-icon-${i}`} onPress={() => setIcon(i)} style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.iconOver, icon === i && s.iconOn]}>
                  <Glyph name={typeIcon(i)} size={16} color={icon === i ? "var(--accent)" : "var(--ink-2)"} />
                </Pressable>
              ))}
            </View>
          </>
        )}
        {rename ? null : (
          <>
            <Text style={s.label}>Start with</Text>
            <View style={s.chips} testID="type-starters">
              {/* ui-rows-lint: not a list (toggle chips in a wrapping strip) */}
              {shownStarters(starters).map((f) => <TextButton key={f.key} label={f.title} selected={starters.includes(f.key)} testID={`type-starter-${f.key}`} onPress={() => { setTouched(true); setStarters((l) => flip(l, f.key)); }} />)}
              <TextButton label={more ? "Fewer" : "More"} testID="type-starters-more" onPress={() => setMore((m) => !m)} />
            </View>
            {more ? (
              <View style={s.more} testID="type-starters-extra">
                <TextField value={find} onChangeText={setFind} placeholder="Find a field type" accessibilityLabel="Find a field" testID="type-starters-find" />
                <View style={s.chips}>
                  {/* ui-rows-lint: not a list (toggle chips in a wrapping strip) */}
                  {moreStarters(starters, find).map((f) => <TextButton key={f.key} label={f.title} selected={starters.includes(f.key)} testID={`type-starter-${f.key}`} onPress={() => { setTouched(true); setStarters((l) => flip(l, f.key)); }} />)}
                </View>
              </View>
            ) : null}
            {connectTo.length > 0 ? (
              <>
                <Text style={s.label}>Connect it to</Text>
                <View style={s.chips} testID="type-connect">
                  {/* ui-rows-lint: not a list (toggle chips in a wrapping strip) */}
                  {connectTo.map((c) => <TextButton key={c.key} label={c.plural} selected={links.includes(c.key)} testID={`type-connect-${c.key}`} onPress={() => { setTouched(true); setLinks((l) => flip(l, c.key)); }} />)}
                </View>
              </>
            ) : null}
            {onAsk ? <View style={s.ask}><TextButton label="Ask Vyre to set it up" testID="type-sheet-ask" onPress={() => { onAsk({ name: name.trim() }); onClose(); }} /></View> : null}
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  more: { gap: 6, marginTop: 4 },
  ask: { alignItems: "flex-start", marginTop: 6 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  icon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  iconOver: { backgroundColor: "var(--hover)" as string },
  iconOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 6 },
});
