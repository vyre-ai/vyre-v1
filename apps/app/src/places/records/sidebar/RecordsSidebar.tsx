// Records > sidebar (spec 3.4): record types in their groups with row counts (Records first, a Sites group for site tables), the saved views of the open type, and Manage
// (Record types, Schema map). Every row is a ui/Row with a leading glyph and a trailing count; click opens; folded sections stay folded.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useOptionalRecordsData, useRecordsData, useScreenQuery } from "./data.tsx";
import { SCREENS, compact, effectiveType, sortedViews, typeGroups } from "./model.ts";
import { Glyph, typeIcon } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { useRecordsState } from "./state.tsx";

type TypesOut = CapMap["schema.types.list"]["out"];
type ViewsOut = CapMap["views.list"]["out"];

function SideRow({ id, title, glyph, selected, trailing, onPress }: { id: string; title: string; glyph: IconName; selected: boolean; trailing?: ReactElement | null; onPress: () => void }): ReactElement {
  return (
    <Row
      id={`nav:${id}`} title={title} selected={selected}
      leading={<View style={styles.glyph}><Glyph name={glyph} size={16} /></View>}
      trailing={<View style={styles.trail}>{trailing ?? null}</View>}
      onPress={onPress}
    />
  );
}

function SectionHead({ id, label, closed, onToggle }: { id: string; label: string; closed: boolean; onToggle: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !closed }} testID={`sec-${id}`} onPress={onToggle} style={({ hovered }: { hovered?: boolean }) => [styles.sec, hovered === true && styles.secOver]}>
      <View style={closed ? styles.chevShut : undefined}><Glyph name="chevd" size={10} /></View>
      <Text style={styles.secText}>{label}</Text>
    </Pressable>
  );
}

/** The frame before data arrives: rows of the real height, so nothing moves when the types land. */
export function SidebarLoading(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 9; i++) bars.push(<View key={i} style={styles.skRow}><View style={styles.skDot} /><View style={[styles.skBar, { width: `${38 + ((i * 17) % 40)}%` }]} /></View>);
  return <View style={styles.side} testID="records-sidebar-loading" accessibilityLabel="Loading">{bars}</View>;
}

function Sidebar(): ReactElement {
  const data = useRecordsData();
  const { state, dispatch } = useRecordsState();
  const types = useScreenQuery<TypesOut>(SCREENS.types, "types");
  const groups = typeGroups(types.status === "ready" ? types.data.types : []);
  const open = effectiveType(state, groups);
  const views = useScreenQuery<ViewsOut>(SCREENS.views, "views", open ? { type: open } : {});
  const saved = sortedViews(views.status === "ready" && open ? views.data.views : [], null);
  const closed = (k: string): boolean => state.closed.includes(k);
  const fold = (k: string) => (): void => dispatch({ type: "section", key: k });

  const sections: ReactElement[] = [];
  for (const g of groups) {
    sections.push(<SectionHead key={`h-${g.key}`} id={g.key} label={g.label} closed={closed(g.key)} onToggle={fold(g.key)} />);
    if (closed(g.key)) continue;
    for (const t of g.items) {
      sections.push(
        <SideRow
          key={t.key} id={`type:${t.key}`} title={t.label} glyph={typeIcon(t.icon)} selected={open === t.key && state.viewId === null}
          trailing={<>{t.synced ? <Glyph name="sync" size={12} /> : null}<Text style={styles.count} testID={`count-${t.key}`}>{compact(t.count)}</Text></>}
          onPress={() => dispatch({ type: "open", key: t.key })}
        />,
      );
    }
  }

  const viewRows: ReactElement[] = [];
  for (const v of saved) {
    viewRows.push(
      <SideRow
        key={v.viewId} id={`view:${v.viewId}`} title={v.title} glyph={v.shared ? "users" : "filter"} selected={state.viewId === v.viewId}
        onPress={() => dispatch({ type: "open", key: v.type, viewId: v.viewId })}
      />,
    );
  }

  return (
    <View style={styles.side} testID="records-sidebar" accessibilityLabel="Records sidebar">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="records-nav">
        {sections}
        {saved.length > 0 ? <SectionHead id="views" label="Saved views" closed={closed("views")} onToggle={fold("views")} /> : null}
        {closed("views") ? null : viewRows}
        <SectionHead id="manage" label="Manage" closed={closed("manage")} onToggle={fold("manage")} />
        {closed("manage") ? null : [
          <SideRow key="types" id="manage:types" title="Record types" glyph="table" selected={false} onPress={() => data.nav.openRecordTypes()} />,
          <SideRow key="map" id="manage:map" title="Schema map" glyph="schema" selected={false} onPress={() => data.nav.openSchemaMap()} />,
        ]}
      </ScrollView>
    </View>
  );
}

export function RecordsSidebar(): ReactElement {
  const data = useOptionalRecordsData();
  if (!data) return <SidebarLoading />;
  return <Sidebar />;
}

const styles = StyleSheet.create({
  side: { flex: 1, minWidth: 220, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 6, paddingBottom: 12 },
  glyph: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  sec: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, marginTop: 10, paddingHorizontal: 8, borderRadius: 6 },
  secOver: { backgroundColor: "var(--hover)" as string },
  secText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  chevShut: { transform: [{ rotate: "-90deg" }] },
  skRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 14 },
  skDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
