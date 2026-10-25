// The fields pane of the Schema map (spec 3.4): selecting a type opens it on the right. A header with the type's glyph, its name and "N fields · N records", the field list with each
// field's kind, and the Add a field section. Read only: the map's structure is edited in the Console, so Add a field leads there instead of taking a name here.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { Glyph } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { fieldsWord, recordsWord } from "./model.ts";
import type { FieldRow } from "./model.ts";
import { TypeGlyph } from "./parts.tsx";

export interface FieldsPaneProps {
  type: string;
  /** What the type is called in the Space (Clients). */
  title: string;
  icon?: string | undefined;
  syncedFrom?: string | undefined;
  rowCount: number;
  rows: readonly FieldRow[];
  /** The field that names a record: it carries the Name tag. */
  titleField?: string | undefined;
  onClose(): void;
  onOpen(): void;
  onConsole(): void;
}

export function FieldsPane({ type, title, icon, syncedFrom, rowCount, rows, titleField, onClose, onOpen, onConsole }: FieldsPaneProps): ReactElement {
  const list: ReactElement[] = [];
  for (const f of rows) {
    list.push(
      <Row
        key={f.key}
        id={`field:${type}:${f.key}`}
        title={f.title}
        leading={<View style={s.gl}>{f.symbol ? <Text style={s.glText}>{f.symbol}</Text> : <Glyph name={f.icon as IconName} size={14} color="var(--ink-4)" />}</View>}
        trailing={(
          <View style={s.trail}>
            {f.key === titleField ? <Text style={s.name} testID={`pane-name-${f.key}`}>Name</Text> : null}
            <Text numberOfLines={1} style={[s.kind, f.kind === "relation" && s.kindRel]} testID={`pane-kind-${f.key}`}>{f.typeLabel}</Text>
          </View>
        )}
      />,
    );
  }
  return (
    <SidePane paneKey="records-schema" toggle={{ open: true, onPress: onClose }} title={title} defaultWidth={340}>
      <View style={s.root} testID="schema-fields-pane">
        <View style={s.head}>
          <TypeGlyph type={type} icon={icon} syncedFrom={syncedFrom} size={28} />
          <View style={s.headText}>
            <Text numberOfLines={1} style={s.title} testID="pane-type-title">{title}</Text>
            <Text style={s.sub} testID="pane-type-counts">{`${fieldsWord(rows.length)} · ${recordsWord(rowCount)}`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onOpen} testID="pane-open-type" style={({ hovered }: { hovered?: boolean }) => [s.open, hovered === true && s.openOver]}>
            <Glyph name="expand" size={14} color="var(--ink-2)" />
          </Pressable>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.body}>
          <Text accessibilityRole="header" aria-level={3} style={s.label}>Fields</Text>
          <View accessibilityRole="list" testID="pane-fields">{list}</View>
          <Text accessibilityRole="header" aria-level={3} style={[s.label, s.labelGap]}>Add a field</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Add a field in the Console" onPress={onConsole} testID="pane-add-field" style={({ hovered }: { hovered?: boolean }) => [s.add, hovered === true && s.openOver]}>
            <Glyph name="plus" size={14} color="var(--ink-2)" />
            <Text style={s.addText}>Add a field in the Console</Text>
          </Pressable>
          <Text style={s.note}>New fields go straight in. Changing a type or deleting a field shows a diff first.</Text>
        </ScrollView>
      </View>
    </SidePane>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 1 },
  open: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  openOver: { backgroundColor: "var(--hover)" as string },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 8, paddingBottom: 24 },
  label: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4 },
  labelGap: { marginTop: 18 },
  gl: { width: 22, alignItems: "center", justifyContent: "center" },
  glText: { fontSize: 11, fontWeight: "600", color: "var(--ink-4)" as string },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 11, color: "var(--ink-3)" as string },
  kind: { fontSize: 12, color: "var(--ink-3)" as string },
  kindRel: { color: "var(--accent)" as string },
  add: { height: 30, marginHorizontal: 0, paddingHorizontal: 8, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  addText: { fontSize: 13, color: "var(--ink-2)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingTop: 6 },
});
