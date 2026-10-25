// Vault Edit sheet: one sheet for an item with the same Fields / .env switch as the card. In .env you edit the raw text and a line lists what will be added, changed or removed
// before you save. A value left as the mask is kept as stored (values are never loaded into the sheet). Secrets show as dots while you type a new one.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useScreenQuery, useVaultData } from "../layout/data.tsx";
import { Btn, Glyph, IconBtn, Mono } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { MASK, diffEnv, diffIsEmpty, diffWords, normalizeKey, patchAt, rowsToText, textToRows, updateFromText, withFlags } from "./env.ts";
import type { Field } from "./env.ts";
import { ITEM_SCREEN } from "./ItemEnv.tsx";

type GetOut = CapMap["vault.item.get"]["out"];

export interface EditSheetProps { itemId: string; onClose: () => void; onSaved: (text: string) => void; /** Opens in Fields with a new empty field, focused. */ addField?: boolean }

export function EditSheet({ itemId, onClose, onSaved, addField = false }: EditSheetProps): ReactElement | null {
  const got = useScreenQuery<GetOut>(ITEM_SCREEN, "item", { itemId });
  if (got.status !== "ready") return <Sheet title="Edit" onClose={onClose} testID="edit-sheet"><Text style={s.note}>Loading</Text></Sheet>;
  return <Body itemId={itemId} item={got.data} onClose={onClose} onSaved={onSaved} addField={addField} />;
}

function Body({ itemId, item: got, onClose, onSaved, addField }: { itemId: string; item: GetOut; onClose: () => void; onSaved: (text: string) => void; addField: boolean }): ReactElement {
  const data = useVaultData();
  const current: Field[] = useMemo(() => got.fields.map((f) => ({ key: f.key, value: "", secret: f.secret })), [got]);
  const [name, setName] = useState(got.item.name);
  const [view, setView] = useState<"env" | "fields">(addField ? "fields" : "env");
  const [rows, setRows] = useState<Field[]>(addField ? [...current, { key: "", value: "", secret: true }] : current);
  const [text, setText] = useState(() => rowsToText(current));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effective = view === "env" ? textToRows(text, current) : rows;
  const effectiveText = view === "env" ? text : rowsToText(rows);
  const diff = diffEnv(got.fields.map((f) => f.key), effectiveText);
  const renamed = name.trim() !== "" && name.trim() !== got.item.name;
  const nothing = diffIsEmpty(diff) && !renamed;

  const switchTo = (v: "env" | "fields"): void => {
    if (v === view) return;
    if (v === "fields") setRows(textToRows(text, current));
    else setText(rowsToText(rows));
    setView(v);
  };

  const save = async (): Promise<void> => {
    setSaving(true); setError(null);
    try {
      const up = updateFromText(current, effectiveText);
      // a typed secret flag on a changed or new row wins over the guess
      const flag = new Map<string, boolean>();
      for (const f of effective) flag.set(f.key, f.secret);
      const fieldsSet = withFlags(up.fieldsSet, flag);
      await data.call("vault.item.update", { itemId, ...(renamed ? { name: name.trim() } : {}), ...(fieldsSet.length ? { fieldsSet } : {}), ...(up.fieldsRemove.length ? { fieldsRemove: up.fieldsRemove } : {}) });
      onSaved(`Saved ${renamed ? name.trim() : got.item.name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error && /precondition|duplicate/.test(e.message) ? "Two fields have the same name. Rename one." : "Could not save. Your edits are still here.");
      setSaving(false);
    }
  };

  const rowLines: ReactElement[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    rowLines.push(
            <View key={i} style={s.rowLine} testID={`edit-row-${i}`}>
              <TextInput value={r.key} onChangeText={(v) => setRows(patchAt(rows, i, { key: normalizeKey(v) }))} accessibilityLabel="Field name" autoCapitalize="characters" autoFocus={addField && i === rows.length - 1} style={[s.input, s.keyIn]} />
              <TextInput
                value={r.value} placeholder={MASK} secureTextEntry={r.secret} onChangeText={(v) => setRows(patchAt(rows, i, { value: v }))}
                accessibilityLabel={`Value of ${r.key || "the field"}`} autoCapitalize="none" autoCorrect={false} style={[s.input, { flex: 1, minWidth: 0 }]}
              />
              <IconBtn icon={r.secret ? "lock" : "eye"} label={r.secret ? "Secret. Make it plain" : "Plain. Make it secret"} onPress={() => setRows(patchAt(rows, i, { secret: !r.secret }))} testID={`edit-secret-${i}`} />
              <IconBtn icon="x" label={`Remove ${r.key || "the field"}`} onPress={() => setRows(rows.filter((_, j) => j !== i))} testID={`edit-remove-${i}`} />
            </View>
    );
  }

  return (
    <Sheet
      title={`Edit ${got.item.name}`} onClose={onClose} testID="edit-sheet"
      footer={<>
        <Text style={s.diff} testID="edit-diff" accessibilityLiveRegion="polite">{renamed && diffIsEmpty(diff) ? `Rename to ${name.trim()}` : diffWords(diff)}</Text>
        <Btn label="Cancel" onPress={onClose} testID="edit-cancel" />
        <Btn label={saving ? "Saving" : "Save"} primary disabled={nothing || saving} onPress={() => { void save(); }} testID="edit-save" />
      </>}
    >
      <View style={s.field}>
        <Text style={s.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={s.input} testID="edit-name" />
      </View>
      <View style={s.seg} accessibilityRole="tablist">
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "fields" }} onPress={() => switchTo("fields")} style={[s.segBtn, view === "fields" && s.segOn]} testID="edit-mode-fields"><Text style={s.segText}>Fields</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "env" }} onPress={() => switchTo("env")} style={[s.segBtn, view === "env" && s.segOn]} testID="edit-mode-env"><Text style={s.segText}>.env</Text></Pressable>
      </View>
      {view === "env" ? (
        <View style={s.field}>
          <TextInput
            value={text} onChangeText={setText} multiline numberOfLines={8} autoCapitalize="none" autoCorrect={false} spellCheck={false} accessibilityLabel="Fields as .env"
            style={[s.input, s.area]} testID="edit-env"
          />
          <Text style={s.hint}>{`One KEY=value per line. ${MASK} keeps the stored value. Values you type are never shown again unless someone reveals them.`}</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {rowLines}
          <View style={{ alignSelf: "flex-start" }}><Btn label="Add field" icon="plus" onPress={() => setRows([...rows, { key: "", value: "", secret: true }])} testID="edit-add-field" /></View>
        </View>
      )}
      <View style={s.handleRow}><Glyph name="lock" size={11} /><Mono size={11.5} color="var(--ink-3)">{got.item.handle}</Mono></View>
      {error ? <Text style={s.error} accessibilityRole="alert" testID="edit-error">{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { fontSize: 13, color: "var(--ink-3)" as string },
  field: { gap: 6 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  input: { height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  area: { height: 180, paddingTop: 8, fontFamily: "var(--mono)" as string, fontSize: 13, lineHeight: 20 },
  keyIn: { width: 170, fontFamily: "var(--mono)" as string, fontSize: 12.5 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, alignSelf: "flex-start", backgroundColor: "var(--sel)" as string },
  segBtn: { height: 24, paddingHorizontal: 11, borderRadius: 6, justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" as string },
  segText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  handleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  diff: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
});
