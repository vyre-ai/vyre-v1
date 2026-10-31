// A stage's fields and gates in the designer's side pane: "Fields for this stage" (they form a group named after the stage on a record's page), "Must be filled to move here" and "Must be filled to
// move on". Each list picks from the Journey's record type or adds a field on the spot. Saved as made through the designer's own write, with Undo.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { Group, Lab, PickButton } from "../config/parts.tsx";
import type { Design } from "./data.ts";
import { FIELD_LISTS, NEW_FIELD_TYPES, addToList, fieldKeyFor, listOf, pickableFields, removeFromList } from "./model.ts";
import type { FieldList, Journey, Stage, TypeField } from "./model.ts";

async function readFields(call: (cap: string, input: unknown) => Promise<unknown>, type: string): Promise<TypeField[]> {
  const out = (await call("schema.describe", { type })) as { types?: { key: string; fields: TypeField[] }[] };
  return (out.types?.find((t) => t.key === type)?.fields ?? []).map((f) => ({ key: f.key, title: f.title, type: f.type }));
}

export function StageFields({ journey: j, stage: g, design: d, canDesign }: { journey: Journey; stage: Stage; design: Design; canDesign: boolean }): ReactElement {
  const data = useAutomationsData();
  const { element, show } = useMenu();
  const [fields, setFields] = useState<TypeField[]>([]);
  const [making, setMaking] = useState<FieldList | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("text");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((): void => { readFields(data.call, j.recordType).then(setFields, () => undefined); }, [data, j.recordType]);
  useEffect(load, [load]);
  const titleOf = (k: string): string => fields.find((f) => f.key === k)?.title ?? k;
  const pick = (list: FieldList, x: number, y: number): void => {
    const here = listOf(g, list);
    const choices = pickableFields(fields).filter((f) => !here.includes(f.key));
    const items: MenuEntry[] = each(choices, (f) => ({ label: f.title, onSelect: () => void d.design(addToList(j.stages, g.key, list, f.key), `Added ${f.title} to ${g.title}`) }));
    if (items.length) items.push({ separator: true });
    items.push({ label: "New field", onSelect: () => { setMaking(list); setName(""); setKind("text"); setError(null); } });
    show(items, x, y, "other", { label: "Add a field" });
  };
  const make = (list: FieldList): void => {
    const title = name.trim();
    const key = fieldKeyFor(title, fields.map((f) => f.key));
    if (!title || !key) return;
    const ops = [{ op: "field.add", type: j.recordType, field: key, def: { title, type: kind, required: false } }];
    void (async (): Promise<void> => {
      try {
        const preview = (await data.call("schema.diff", { ops })) as { problems: { message: string }[]; previewToken: string; items: { destructive: boolean; itemKey: string }[] };
        if (preview.problems.length > 0) { setError(preview.problems[0]!.message); return; }
        await data.call("schema.apply", { ops, previewToken: preview.previewToken, confirm: [], reason: `Field ${title} for ${g.title}`, idempotencyKey: `stage-field-${j.id}-${key}` });
      } catch (e) { setError(e instanceof Error && e.message ? e.message : "Could not add the field."); return; }
      setMaking(null); load();
      void d.design(addToList(j.stages, g.key, list, key), `Added ${title} to ${g.title}`);
    })();
  };
  const blocks: ReactElement[] = [];
  for (const L of FIELD_LISTS) {
    const keys = listOf(g, L.list);
    blocks.push(
      <View key={L.list} testID={`stage-list-${L.list}`}>
        <Lab>{L.label}</Lab>
        {keys.length === 0 ? <Text style={s.dim}>{L.empty}</Text> : (
          <Group>
            {keys.map((k) => (
              <Row key={k} id={`stage-${L.list}-${k}`} title={titleOf(k)} trailing={canDesign ? <TextButton label="Remove" testID={`remove-${L.list}-${k}`} onPress={() => void d.design(removeFromList(j.stages, g.key, L.list, k), `Removed ${titleOf(k)} from ${g.title}`)} /> : undefined} />
            ))}
          </Group>
        )}
        {canDesign ? (
          making === L.list ? (
            <View style={s.form} testID="stage-field-form">
              <TextField value={name} onChangeText={(t) => { setName(t); setError(null); }} placeholder="Field name" accessibilityLabel="Field name" testID="stage-field-name" autoFocus onSubmitEditing={() => make(L.list)} />
              <View style={s.chips} accessibilityRole="radiogroup">
                {NEW_FIELD_TYPES.map((t) => <TextButton key={t.key} label={t.title} primary={kind === t.key} testID={`stage-field-type-${t.key}`} onPress={() => setKind(t.key)} />)}
              </View>
              <View style={s.chips}>
                <TextButton label="Cancel" testID="stage-field-cancel" onPress={() => setMaking(null)} />
                <TextButton label="Add field" primary testID="stage-field-save" onPress={() => make(L.list)} />
              </View>
              {error ? <Text style={s.err} accessibilityRole="alert" testID="stage-field-error">{error}</Text> : null}
            </View>
          ) : <View style={s.add}><PickButton label={`Add to ${L.label}`} value="Add a field" empty testID={`add-${L.list}`} onPress={(x, y) => pick(L.list, x, y)} /></View>
        ) : null}
      </View>,
    );
  }
  return <View testID="stage-fields">{blocks}{element}</View>;
}

const s = StyleSheet.create({
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 4, paddingVertical: 4 },
  add: { alignItems: "flex-start", marginTop: 4 },
  form: { gap: 8, padding: 10, marginTop: 6, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
});
