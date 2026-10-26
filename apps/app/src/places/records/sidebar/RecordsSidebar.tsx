// Records > sidebar (spec 3.4), drawn in the shell's shared place sidebar slot (P-L9d_22: the slot gives the title, the collapse button, the search field and the phone list): record types in their groups with row counts (Records first, a Sites group for site tables), the saved views of the open type, and Manage
// (Record types, Schema map). Every row is a ui/Row with a leading glyph and a trailing count; click opens; folded sections stay folded.
import { useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SidebarContent, matchRows } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveQuery } from "../../../../../../client/src/index.ts";
import { StarredGroup } from "../starred/index.ts";
import type { StarsOut } from "../starred/index.ts";
import { useOptionalRecordsData, useRecordsData, useScreenQuery } from "./data.tsx";
import { SCREENS, compact, effectiveType, sortedViews, typeGroups } from "./model.ts";
import { Glyph, TypeTile, typeHue, typeIcon } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { useRecordsState } from "./state.tsx";

type TypesOut = CapMap["schema.types.list"]["out"];
type ViewsOut = CapMap["views.list"]["out"];

function SideRow({ id, title, glyph, selected, trailing, onPress, tile }: { id: string; title: string; glyph: IconName; selected: boolean; trailing?: ReactElement | null; onPress: () => void; tile?: ReactElement | null }): ReactElement {
  return (
    <Row
      id={`nav:${id}`} title={title} selected={selected}
      leading={<View style={styles.glyph}>{tile ?? <Glyph name={glyph} size={16} />}</View>}
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

/** The stars of the person, as the runtime answers them (a runtime without them leaves the group out). Only starred records belong in the Records place. */
function StarredRecords({ match, slot }: { match: (title: string) => boolean; slot: SidebarSlotApi | undefined }): ReactElement {
  const data = useRecordsData();
  const { state, dispatch } = useRecordsState();
  const query = useMemo(() => (data.live as unknown as (cap: string, input: Record<string, unknown>) => LiveQuery<StarsOut>)("stars.list", { type: "record" }), [data]);
  return <StarredGroup query={query} typeOf={() => undefined} onOpen={(s) => { data.nav.openRecord(s.resource.id); slot?.openBody(); }} match={match} closed={state.closed.includes("starred")} onToggle={() => dispatch({ type: "section", key: "starred" })} />;
}

function Sidebar({ starred, query, slot }: { starred: ReactNode | undefined; query: string; slot: SidebarSlotApi | undefined }): ReactElement {
  const data = useRecordsData();
  const { state, dispatch } = useRecordsState();
  const types = useScreenQuery<TypesOut>(SCREENS.types, "types");
  const groups = typeGroups(types.status === "ready" ? types.data.types : []);
  const open = effectiveType(state, groups);
  const views = useScreenQuery<ViewsOut>(SCREENS.views, "views", open ? { type: open } : {});
  const allSaved = sortedViews(views.status === "ready" && open ? views.data.views : [], null);
  // The slot's search field: rows keep when every word of it is in their title, and a search opens every section it has a match in.
  const q = query.trim();
  const hit = (title: string): boolean => matchRows([{ title }], q).length > 0;
  const closed = (k: string): boolean => q === "" && state.closed.includes(k);
  const fold = (k: string) => (): void => dispatch({ type: "section", key: k });
  const choose = (): void => slot?.openBody();
  const saved = allSaved.filter((v) => hit(v.title));

  const sections: ReactElement[] = [];
  for (const g of groups) {
    const items = g.items.filter((t) => hit(t.label));
    if (items.length === 0) continue;
    sections.push(<SectionHead key={`h-${g.key}`} id={g.key} label={g.label} closed={closed(g.key)} onToggle={fold(g.key)} />);
    if (closed(g.key)) continue;
    for (const t of items) {
      sections.push(
        <SideRow
          key={t.key} id={`type:${t.key}`} title={t.label} glyph={typeIcon(t.icon)} tile={<TypeTile icon={typeIcon(t.icon)} hue={typeHue(t.key)} syncedFrom={t.syncedFrom} />} selected={open === t.key && state.viewId === null}
          trailing={<>{t.synced ? <Glyph name="sync" size={12} /> : null}<Text style={styles.count} testID={`count-${t.key}`}>{compact(t.count)}</Text></>}
          onPress={() => { dispatch({ type: "open", key: t.key }); choose(); }}
        />,
      );
    }
  }

  const viewRows: ReactElement[] = [];
  for (const v of saved) {
    viewRows.push(
      <SideRow
        key={v.viewId} id={`view:${v.viewId}`} title={v.title} glyph={v.shared ? "users" : "filter"} selected={state.viewId === v.viewId}
        onPress={() => { dispatch({ type: "open", key: v.type, viewId: v.viewId }); choose(); }}
      />,
    );
  }

  const manage: ReactElement[] = [];
  if (hit("Record types")) manage.push(<SideRow key="types" id="manage:types" title="Record types" glyph="table" selected={false} onPress={() => { data.nav.openRecordTypes(); choose(); }} />);
  if (hit("Schema map")) manage.push(<SideRow key="map" id="manage:map" title="Schema map" glyph="schema" selected={false} onPress={() => { data.nav.openSchemaMap(); choose(); }} />);

  return (
    <View style={styles.content} testID="records-sidebar" accessibilityLabel="Records sidebar">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="records-nav">
        {sections}
        {starred === undefined ? <StarredRecords match={hit} slot={slot} /> : starred}
        {saved.length > 0 ? <SectionHead id="views" label="Saved views" closed={closed("views")} onToggle={fold("views")} /> : null}
        {closed("views") ? null : viewRows}
        {manage.length > 0 ? <SectionHead id="manage" label="Manage" closed={closed("manage")} onToggle={fold("manage")} /> : null}
        {closed("manage") ? null : manage}
      </ScrollView>
    </View>
  );
}

/** The Records sidebar's content. `starred` replaces the Starred group (the shot mounts and tests pass their own); left out, it draws the person's starred records from the runtime.
 * `query` is the shared search field's text; `slot` lets the phone leave the list for the view when a row is chosen. */
export function RecordsSidebar({ starred, query = "", slot }: { starred?: ReactNode; query?: string; slot?: SidebarSlotApi | undefined } = {}): ReactElement {
  const data = useOptionalRecordsData();
  if (!data) return <SidebarLoading />;
  return <Sidebar starred={starred} query={query} slot={slot} />;
}

/** Put this inside the Records place: it registers the Records sidebar in the shell's shared slot, so it collapses, searches and lands on the phone like every place. */
export function RecordsSidebarSlot({ starred }: { starred?: ReactNode } = {}): ReactElement {
  return (
    <SidebarContent title="Records" searchPlaceholder="Search records">
      {(query, slot) => <RecordsSidebar query={query} slot={slot} {...(starred !== undefined ? { starred } : {})} />}
    </SidebarContent>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
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
