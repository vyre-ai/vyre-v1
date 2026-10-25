// The Fields tab of a Journey (spec 2.12, prototype "viewFields"): the fields its record type inherits from the template it was made from, then its own. Rows are the shared Row with the
// field's icon leading and its type and, for an inherited field, the template mark trailing. Fields are managed in Records, so nothing here edits.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Glyph as CanvasGlyph } from "../canvas/icons.tsx";
import type { GlyphName } from "../canvas/icons.tsx";
import { each } from "../runs/each.ts";
import { useConfigExtras } from "../config/data.tsx";
import type { FieldEntry, FieldType } from "../config/data.tsx";
import { Group, Hint, Lab } from "../config/parts.tsx";

const TYPES: Record<FieldType, { label: string; glyph: GlyphName }> = {
  person: { label: "Person", glyph: "users" }, rel: { label: "Link to records", glyph: "hook" }, date: { label: "Date", glyph: "clock" }, choice: { label: "Choice", glyph: "sheet" },
  num: { label: "Number", glyph: "code" }, text: { label: "Text", glyph: "edit" }, check: { label: "Checkbox", glyph: "check" }, file: { label: "File", glyph: "folder" }, formula: { label: "Formula", glyph: "sparkle" },
};

function FieldRow({ f, id, inherited }: { f: FieldEntry; id: string; inherited?: string }): ReactElement {
  const ty = TYPES[f.type];
  return (
    <Row
      id={id} title={f.name}
      leading={<View style={s.lead}><CanvasGlyph name={ty.glyph} size={15} color="var(--ink-3)" /></View>}
      trailing={<View style={s.tr}><Text style={s.type}>{ty.label}</Text>{inherited ? <View accessibilityLabel={`Inherited from the ${inherited} template`}><CanvasGlyph name="record" size={13} color="var(--ink-4)" /></View> : null}</View>}
    />
  );
}

export function FieldsTab({ recordType }: { recordType: string }): ReactElement {
  const fields = useConfigExtras().recordFields?.(recordType);
  const template = fields?.template ?? "Projects";
  return (
    <View testID="journey-fields" accessibilityLabel="Journey fields">
      <Lab first>{`From the ${template} template`}</Lab>
      <Group testID="fields-inherited">{each(fields?.inherited ?? [], (f) => <FieldRow key={f.name} f={f} id={`field-${f.name}`} inherited={template} />)}</Group>
      <Lab>Its own</Lab>
      <Group testID="fields-own">
        {(fields?.own.length ?? 0) === 0 ? <View style={s.none}><Text style={s.noneText}>No fields of its own yet.</Text></View> : each(fields?.own ?? [], (f) => <FieldRow key={f.name} f={f} id={`own-${f.name}`} />)}
      </Group>
      <Hint>Fields are managed in the console.</Hint>
    </View>
  );
}

const s = StyleSheet.create({
  lead: { width: 22, alignItems: "center", marginRight: 6 },
  tr: { flexDirection: "row", alignItems: "center", gap: 10 },
  type: { fontSize: 12, color: "var(--ink-3)" as string },
  none: { paddingHorizontal: 12, paddingVertical: 10 },
  noneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
