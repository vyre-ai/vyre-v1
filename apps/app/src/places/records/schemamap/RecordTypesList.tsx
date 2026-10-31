// Record types (spec 3.4, screen records.types): every record type in the Space as one ui/Row. The row says how many records and fields it has and where it comes from
// (Built in, Synced from an app, Site table); pressing it opens the type in Records. A person who may change structure also sees New record type and a "..." menu per row (Rename, Delete);
// a person who may not sees neither.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { TYPES_SCREEN, useSchemaData, useSchemaQuery, useTypeDetails } from "./data.tsx";
import { Glyph } from "./icons.tsx";
import { fieldsWord, recordsWord, typeTag } from "./model.ts";
import { TypeGlyph, sx } from "./parts.tsx";
import { FieldsPanel, TextButton, TypeDelete, TypeSheet, fieldLine, typeRowMenu, typeSections } from "../typeedit/index.ts";

type ListOut = CapMap["schema.types.list"]["out"];

type Sheet = { kind: "new" } | { kind: "fields"; t: ListOut["types"][number] } | { kind: "rename"; t: ListOut["types"][number] } | { kind: "delete"; t: ListOut["types"][number] };

const ownedBy = (g: { items: { key: string }[] }, rowKey: string): boolean => g.items.some((t) => rowKey === t.key || rowKey === `rule-${t.key}`);

/** Edit fields for a type without leaving the page: loads its details, then the same panel as the table's Fields button (without the per view checks). */
function TypeFields({ call, t, onClose }: { call: (cap: string, input: unknown) => Promise<unknown>; t: ListOut["types"][number]; onClose(): void }): ReactElement | null {
  const [d, setD] = useState<CapMap["schema.types.get"]["out"]["type"] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; void call("schema.types.get", { type: t.key }).then((o) => { if (live) setD((o as CapMap["schema.types.get"]["out"]).type); }, () => undefined); return () => { live = false; }; }, [call, t.key, n]);
  if (!d) return null;
  return <FieldsPanel key={`${d.version}`} call={async (cap, input) => { const out = await call(cap, input); if (cap === "schema.apply" || cap === "schema.restore_field") setN((x) => x + 1); return out; }} type={d} hidden={[]} onToggleHidden={() => undefined} viewToggles={false} onClose={onClose} />;
}

export function RecordTypesList(): ReactElement {
  const data = useSchemaData();
  const q = useSchemaQuery<ListOut>(TYPES_SCREEN, "types");
  const canEdit = data.canEdit === true;
  const menu = useMenu();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const more = (t: ListOut["types"][number]) => (e: unknown): void => {
    (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
    const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } } | undefined)?.currentTarget?.getBoundingClientRect?.();
    menu.show(typeRowMenu(t, { rename: () => setSheet({ kind: "rename", t }), fields: () => setSheet({ kind: "fields", t }), remove: () => setSheet({ kind: "delete", t }) }), box?.left ?? 0, (box?.bottom ?? 0) + 4, "other");
  };
  const listed = q.status === "ready" ? q.data.types : [];
  const sections = typeSections(listed);
  const details = useTypeDetails(sections.flatMap((g) => g.items.map((t) => t.key)));
  const rows: ReactElement[] = [];
  for (const g of sections) {
    rows.push(<Text key={`h-${g.key}`} style={s.sectionHead} accessibilityRole="header" aria-level={3} testID={`types-section-${g.key}`}>{g.label}</Text>);
    g.items.forEach((t, i) => {
      const tag = typeTag(t);
      const d = details.get(t.key);
      const line = d ? fieldLine(d.fields, d.titleField) : "";
      if (i > 0) rows.push(<View key={`rule-${t.key}`} style={s.rule} aria-hidden />);
      rows.push(
        <Row
          key={t.key}
          id={`type:${t.key}`}
          title={t.plural}
          note={`${recordsWord(t.rowCount)}${line ? ` · ${line}` : ` · ${fieldsWord(t.fieldCount)}`}`}
          leading={<View style={s.lead}><TypeGlyph type={t.key} icon={t.icon} syncedFrom={t.syncedFrom} size={22} /></View>}
          trailing={(
            <View style={s.trail}>
              {tag && tag.kind === "synced" ? (
                <View style={s.tagBox} testID={`type-source-${t.key}`}>
                  <AppIcon brand={tag.app} size={14} />
                  <Text style={s.tag} testID={`type-tag-${t.key}`}>{tag.text}</Text>
                </View>
              ) : null}
              {canEdit ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`More for ${t.plural}`} testID={`type-more-${t.key}`} onPress={more(t)} style={({ hovered }: { hovered?: boolean }) => [s.more, hovered === true && s.moreOver]}>
                  <Glyph name="more" size={14} />
                </Pressable>
              ) : <Glyph name="chev" size={12} />}
            </View>
          )}
          onPress={() => data.nav.openType(t.key)}
        />,
      );
    });
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
          <View style={s.titleRow}>
            <Text accessibilityRole="header" aria-level={2} style={s.h2}>Record types</Text>
            {canEdit ? <TextButton label="New record type" primary testID="record-types-new" onPress={() => setSheet({ kind: "new" })} /> : null}
          </View>
          <View style={s.cards} accessibilityRole="list" testID="record-types-list">
            {skeleton}
            {sections.map((g) => (
              <View key={g.key}>
                {rows.filter((r) => r.key === `h-${g.key}`)}
                <View style={s.card}>{rows.filter((r) => typeof r.key === "string" && r.key !== `h-${g.key}` && ownedBy(g, r.key))}</View>
              </View>
            ))}
            {q.status === "ready" && sections.length === 0 ? <Text style={s.empty} testID="record-types-empty">No record types yet</Text> : null}
          </View>
        </View>
      </ScrollView>
      {menu.element}
      {sheet?.kind === "new" ? <TypeSheet call={data.call} takenKeys={q.status === "ready" ? q.data.types.map((t) => t.key) : []} onClose={() => setSheet(null)} onDone={(key) => data.nav.openType(key)} /> : null}
      {sheet?.kind === "rename" ? <TypeSheet call={data.call} takenKeys={[]} rename={{ key: sheet.t.key, title: sheet.t.title, plural: sheet.t.plural, icon: sheet.t.icon }} onClose={() => setSheet(null)} onDone={() => undefined} /> : null}
      {sheet?.kind === "fields" ? <TypeFields call={data.call} t={sheet.t} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "delete" ? <TypeDelete call={data.call} type={sheet.t.key} title={sheet.t.title} onClose={() => setSheet(null)} onDone={() => undefined} /> : null}
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
  cards: { gap: 18, marginTop: 4 },
  sectionHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 2, paddingHorizontal: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  more: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  moreOver: { backgroundColor: "var(--hover)" as string },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.3, color: "var(--ink)" as string, marginBottom: 4 },
  card: sx({ marginTop: 6, borderRadius: 12, backgroundColor: "var(--raised)", overflow: "hidden", paddingVertical: 4, paddingHorizontal: 6, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" }),
  rule: { height: 1, marginHorizontal: 8, backgroundColor: "var(--line)" as string },
  tagBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  lead: { width: 30, alignItems: "flex-start", justifyContent: "center" },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { fontSize: 12, color: "var(--ink-3)" as string },
  empty: { padding: 18, fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  sk: { height: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  skTile: { width: 22, height: 22, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  skBar: { height: 10, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
