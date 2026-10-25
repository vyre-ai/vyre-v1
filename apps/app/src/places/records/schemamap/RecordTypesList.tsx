// Record types (spec 3.4, screen records.types): every record type in the Space as one ui/Row, read only. The row says how many records and fields it has and where it comes from
// (Built in, Synced from an app, Site table); pressing it opens the type in Records. Structure is edited in the Console, so there is no New button; a quiet line says so.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { TYPES_SCREEN, useSchemaData, useSchemaQuery } from "./data.tsx";
import { Glyph } from "./icons.tsx";
import { MANAGED, fieldsWord, recordsWord, typeTag } from "./model.ts";
import { TypeGlyph, sx } from "./parts.tsx";

type ListOut = CapMap["schema.types.list"]["out"];

export function RecordTypesList(): ReactElement {
  const data = useSchemaData();
  const q = useSchemaQuery<ListOut>(TYPES_SCREEN, "types");
  const rows: ReactElement[] = [];
  if (q.status === "ready") {
    for (const t of q.data.types) {
      const tag = typeTag(t);
      if (rows.length > 0) rows.push(<View key={`rule-${t.key}`} style={s.rule} aria-hidden />);
      rows.push(
        <Row
          key={t.key}
          id={`type:${t.key}`}
          title={t.plural}
          note={`${recordsWord(t.rowCount)} · ${fieldsWord(t.fieldCount)}`}
          leading={<View style={s.lead}><TypeGlyph type={t.key} icon={t.icon} syncedFrom={t.syncedFrom} size={22} /></View>}
          trailing={(
            <View style={s.trail}>
              {tag ? (
                <View style={s.tagBox} testID={`type-source-${t.key}`}>
                  {tag.kind === "synced" ? <AppIcon brand={tag.app} size={14} /> : null}
                  <Text style={s.tag} testID={`type-tag-${t.key}`}>{tag.text}</Text>
                </View>
              ) : null}
              <Glyph name="chev" size={12} />
            </View>
          )}
          onPress={() => data.nav.openType(t.key)}
        />,
      );
    }
  }
  const skeleton: ReactElement[] = [];
  if (q.status === "loading") for (let i = 0; i < 5; i++) skeleton.push(<View key={i} style={s.sk}><View style={s.skTile} /><View style={[s.skBar, { width: `${44 - i * 5}%` }]} /></View>);
  return (
    <View style={s.page} testID="record-types">
      <View style={s.head} accessibilityRole="header">
        <Glyph name="table" size={15} color="var(--ink)" />
        <Text style={s.crumb}>Record types</Text>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <View style={s.wrap}>
          <Text accessibilityRole="header" aria-level={2} style={s.h2}>Record types</Text>
          <View style={s.card} accessibilityRole="list" testID="record-types-list">
            {skeleton}
            {rows}
            {q.status === "ready" && q.data.types.length === 0 ? <Text style={s.empty} testID="record-types-empty">No record types yet</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={MANAGED} onPress={() => data.nav.openConsole()} testID="record-types-console" style={s.note}>
            <Glyph name="lock" size={12} />
            <Text style={s.noteText}>{MANAGED}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0 },
  head: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  crumb: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  scroll: { flex: 1 },
  content: { paddingVertical: 26, paddingHorizontal: 36 },
  wrap: { width: "100%", maxWidth: 760, alignSelf: "center" },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.3, color: "var(--ink)" as string, marginBottom: 4 },
  card: sx({ marginTop: 12, borderRadius: 12, backgroundColor: "var(--raised)", overflow: "hidden", paddingVertical: 4, paddingHorizontal: 6, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" }),
  rule: { height: 1, marginHorizontal: 8, backgroundColor: "var(--line)" as string },
  tagBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  lead: { width: 30, alignItems: "flex-start", justifyContent: "center" },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { fontSize: 12, color: "var(--ink-3)" as string },
  empty: { padding: 18, fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, alignSelf: "flex-start" },
  noteText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  sk: { height: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  skTile: { width: 22, height: 22, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  skBar: { height: 10, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
