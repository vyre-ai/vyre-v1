// What every view of part A shares: the context a view is given (type, saved views, the kind switch), the state of the view being edited, and the header with its quiet buttons. Filter, Fields and
// the kind switch open the one ui/Menu with checkmarks and counts; nothing here is a row of chips.
import { useState } from "react";
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useOnline, useRecordsData } from "../sidebar/data.tsx";
import type { RecordsData } from "../sidebar/data.tsx";
import type { ViewRow } from "../sidebar/model.ts";
import { Glyph, HeadButton, pointOf, typeIcon } from "../sidebar/parts.tsx";
import { useRecordsState } from "../sidebar/state.tsx";
import { chosen, clearClauses, countSpec, isEdited, optionValue, optionsOf, setSort, sortable, toSaved, toggleHidden, toggleOption } from "../table/model.ts";
import { each, filterable, toggleable } from "./model.ts";
import type { FieldDef, TableViewState, TypeDef } from "./model.ts";

/** One kind of view in the switch: the packet's own kinds, or one a later part supplies. */
export interface KindDef { kind: string; label: string }

/** Everything a view is given: the type, its saved views, which is applied, the view it starts from, and the kind switch. */
export interface ViewCtx {
  type: string;
  def: TypeDef;
  views: readonly ViewRow[];
  saved: ViewRow | undefined;
  base: TableViewState;
  kind: string;
  kinds: readonly KindDef[];
  onKind: (kind: string) => void;
}

export interface ViewState {
  v: TableViewState;
  set: (next: TableViewState) => void;
  setV: Dispatch<SetStateAction<TableViewState>>;
  edited: boolean;
  finding: boolean;
  setFinding: (on: boolean) => void;
  save: (extra?: Record<string, unknown>) => void;
  reset: () => void;
  newRecord: (fields?: Record<string, unknown>) => void;
}

/** The view being edited on top of the saved one, and what its header can do with it. */
export function useViewState(ctx: ViewCtx): ViewState {
  const data = useRecordsData();
  const [v, setV] = useState<TableViewState>(ctx.base);
  const [finding, setFinding] = useState(ctx.base.find !== "");
  const edited = isEdited(v, ctx.base);
  return {
    v, setV, edited, finding, setFinding,
    set: (next) => setV(next),
    reset: () => setV(ctx.base),
    save: (extra = {}) => {
      const payload = toSaved(v);
      void data.call("views.save", { type: ctx.type, ...(ctx.saved ? { viewId: ctx.saved.viewId } : {}), kind: ctx.kind, title: ctx.saved?.title ?? `${ctx.def.plural} ${ctx.kinds.find((k) => k.kind === ctx.kind)?.label.toLowerCase() ?? ctx.kind}`, ...payload, config: { ...payload.config, ...extra }, idempotencyKey: `view-${ctx.type}-${Date.now()}` });
    },
    newRecord: (fields = {}) => newRecord(data, ctx.type, fields),
  };
}

/** Creates a record (with the fields it starts with) and opens it. */
export function newRecord(data: RecordsData, type: string, fields: Record<string, unknown>): void {
  void data.call("records.create", { type, fields, idempotencyKey: `new-${type}-${Date.now()}` }).then((out) => {
    const id = (out as { record?: { id?: string } } | undefined)?.record?.id;
    if (id) data.nav.openRecord(id);
  });
}

export interface HeadProps {
  ctx: ViewCtx;
  st: ViewState;
  /** The Board's lane field: shown as a "Lanes" button with the fields it can run on. */
  lanes?: { field: FieldDef | undefined; choices: readonly FieldDef[]; pick: (key: string) => void };
  /** Gallery and List can sort; a Board is in the order its lanes keep. */
  sort?: boolean;
  /** The fields the Fields menu can hide on a card or row; omitted for a view that shows none. */
  fields?: boolean;
  /** Buttons a later kind adds before the kind switch (the calendar's date field, the chart's measure). */
  extra?: ReactNode;
}

export function ViewHead({ ctx, st, lanes, sort = false, fields = true, extra }: HeadProps): ReactElement {
  const data = useRecordsData();
  const { state, dispatch } = useRecordsState();
  const menu = useMenu();
  const online = useOnline();
  const winW = useWindowDimensions().width;
  const slim = winW > 0 && winW < 720;
  const { def } = ctx;
  const { v, set } = st;

  const countOf = (field: FieldDef, key: string): number | null => {
    const probe: TableViewState = { ...v, clauses: [...v.clauses.filter((c) => c.field !== field.key), { field: field.key, op: "eq", value: optionValue(field, key) }] };
    const snap = data.live("records.counts", countSpec(ctx.type, probe, def.titleField)).getSnapshot();
    return snap.status === "ready" ? snap.data.count : null;
  };
  const filterEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const f of filterable(def).filter((x) => x.key !== lanes?.field?.key)) {
      if (out.length) out.push({ separator: true });
      out.push({ head: f.title });
      for (const o of optionsOf(f)) {
        const n = countOf(f, o.key);
        out.push({ label: n === null ? o.title : `${o.title} (${n})`, checked: chosen(v, f.key).includes(optionValue(f, o.key)), onSelect: () => set(toggleOption(v, f.key, optionValue(f, o.key))) });
      }
    }
    if (out.length === 0) out.push({ head: "Filter" }, { label: "No fields to filter by" });
    if (v.clauses.length > 0) out.push({ separator: true }, { label: "Clear filters", onSelect: () => set(clearClauses(v)) });
    return out;
  };
  const sortEntries = (): MenuEntry[] => {
    const cur = v.sort[0];
    return [
      { head: "Sort by" },
      ...each(def.fields.filter(sortable), (f): MenuEntry => ({ label: f.title, checked: cur?.field === f.key, onSelect: () => set(setSort(v, f.key, cur?.field === f.key && cur.dir === "asc" ? "desc" : "asc")) })),
      { separator: true },
      { label: "Ascending", checked: cur?.dir === "asc", onSelect: () => { if (cur) set(setSort(v, cur.field, "asc")); } },
      { label: "Descending", checked: cur?.dir === "desc", onSelect: () => { if (cur) set(setSort(v, cur.field, "desc")); } },
      { separator: true },
      { label: "Clear sort", onSelect: () => set({ ...v, sort: [] }) },
    ];
  };
  const fieldEntries = (): MenuEntry[] => [
    { head: "Fields on each card" },
    ...each(toggleable(def).filter((f) => f.key !== lanes?.field?.key), (f): MenuEntry => ({ label: f.title, checked: !v.hidden.includes(f.key), onSelect: () => set(toggleHidden(v, f.key)) })),
  ];
  const laneEntries = (): MenuEntry[] => [
    { head: "Lanes from" },
    ...each(lanes?.choices ?? [], (f): MenuEntry => ({ label: f.title, checked: lanes?.field?.key === f.key, onSelect: () => lanes?.pick(f.key) })),
  ];
  const kindEntries = (): MenuEntry[] => [{ head: "View as" }, ...each(ctx.kinds, (k): MenuEntry => ({ label: k.label, checked: ctx.kind === k.kind, onSelect: () => ctx.onKind(k.kind) }))];
  const viewEntries = (): MenuEntry[] => [
    { head: "Saved views" },
    { label: `All ${def.plural.toLowerCase()}`, checked: state.viewId === null, onSelect: () => dispatch({ type: "view", viewId: null }) },
    ...each(ctx.views, (sv): MenuEntry => ({ label: sv.title, checked: state.viewId === sv.viewId, onSelect: () => dispatch({ type: "view", viewId: sv.viewId }) })),
  ];

  const sortKey = v.sort[0];
  const laneField = lanes?.field;
  return (
    <View style={s.head} testID="records-head">
      <View style={s.crumb}>
        <Glyph name={typeIcon(def.icon)} size={18} color="var(--ink-2)" />
        <Text accessibilityRole="header" aria-level={1} style={s.h1} numberOfLines={1}>{def.plural}</Text>
        <Text style={s.slash}>/</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Saved views" testID="records-views" onPress={(e) => { const p = pointOf(e); menu.show(viewEntries(), p.x, p.y); }}
          style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.pickOver]}>
          <Text style={s.pickText}>{ctx.saved ? ctx.saved.title : `All ${def.plural.toLowerCase()}`}</Text>
          {st.edited ? <Text style={s.dirty}>{"·"}</Text> : null}
          <Glyph name="chevd" size={9} />
        </Pressable>
        {st.edited ? (
          <View style={s.modline} testID="records-edited">
            <Text style={s.modText}>Edited</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Save view" testID="records-save" onPress={() => st.save(laneField ? { lane: laneField.key } : {})}><Text style={s.modLink}>Save</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Reset view" testID="records-reset" onPress={st.reset}><Text style={s.modLink}>Reset</Text></Pressable>
          </View>
        ) : null}
      </View>
      <View style={s.grow} />
      {st.finding ? (
        <TextInput
          value={v.find} onChangeText={(t) => set({ ...v, find: t })} placeholder={`Find in ${def.plural.toLowerCase()}`} placeholderTextColor="var(--ink-3)" accessibilityLabel="Find" testID="records-find"
          autoFocus onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") { set({ ...v, find: "" }); st.setFinding(false); } }} style={s.find}
        />
      ) : <HeadButton icon="find" label="Find" bare testID="records-find-btn" onPress={() => st.setFinding(true)} />}
      <HeadButton icon="filter" label="Filter" detail={v.clauses.length ? String(v.clauses.length) : undefined} on={v.clauses.length > 0} bare={slim} testID="records-filter" onPress={(x, y) => menu.show(filterEntries(), x, y)} />
      {sort ? <HeadButton icon="sort" label="Sort" detail={sortKey ? def.fields.find((f) => f.key === sortKey.field)?.title : undefined} on={sortKey !== undefined} bare={slim} testID="records-sort" onPress={(x, y) => menu.show(sortEntries(), x, y)} /> : null}
      {lanes ? <HeadButton icon="group" label="Lanes" detail={laneField?.title} bare={slim} testID="records-lanes" onPress={(x, y) => menu.show(laneEntries(), x, y)} /> : null}
      {fields ? <HeadButton icon="eye" label="Fields" detail={v.hidden.length ? `${v.hidden.length} hidden` : undefined} bare={slim} testID="records-fields" onPress={(x, y) => menu.show(fieldEntries(), x, y)} /> : null}
      {extra}
      <Pressable
        accessibilityRole="button" accessibilityLabel={`View as, ${ctx.kinds.find((k) => k.kind === ctx.kind)?.label ?? ctx.kind}`} testID="records-kind"
        onPress={(e) => { const p = pointOf(e); menu.show(kindEntries(), p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.kind, hovered === true && s.pickOver]}
      >
        <Text style={s.kindText}>{ctx.kinds.find((k) => k.kind === ctx.kind)?.label ?? ctx.kind}</Text>
        <Glyph name="chevd" size={9} />
      </Pressable>
      <HeadButton icon="plus" label="New" bare={slim} testID="records-new" onPress={() => st.newRecord()} />
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="records-offline">Offline</Text>}
      {menu.element}
    </View>
  );
}

export const s = StyleSheet.create({
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  crumb: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  slash: { fontSize: 14, color: "var(--ink-4)" as string },
  pick: { height: 26, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6 },
  pickOver: { backgroundColor: "var(--hover)" as string },
  pickText: { fontSize: 13, color: "var(--ink-2)" as string },
  dirty: { fontSize: 16, lineHeight: 16, color: "var(--accent)" as string },
  modline: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 6 },
  modText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  modLink: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  grow: { flex: 1 },
  find: { width: 190, height: 26, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--sunk)" as string, fontSize: 13, color: "var(--ink)" as string },
  kind: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7 },
  kindText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, marginLeft: 8 },
});
