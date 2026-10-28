// Console Audit log (spec 3.10, CONSOLE-SPEC 4): every change to access and every sensitive act, append-only. Search, a filter menu with checkmarks and counts, export, verify the chain,
// a virtual list of rows (click opens the entry in a side sheet; right-click offers real actions), the entry sheet with before and after and the trace.
import { useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useConsoleData, useScreenQuery } from "../../shell/data.tsx";
import { ago } from "../../shell/format.ts";
import { Glyph } from "../../shell/glyphs.tsx";
import { Empty, pointer } from "../../shell/ui.tsx";
import { CLASSES, NO_FILTER, classIcon, classLabel, isFiltered, rowTitle, snapshotLines, stateOf } from "./model.ts";
import type { AuditClass, AuditFilter, AuditRow } from "./model.ts";

type ListOut = CapMap["audit.list"]["out"];
type VerifyOut = CapMap["audit.verify"]["out"];
type ExportOut = CapMap["audit.export"]["out"];

export interface AuditProps {
  initialFilter?: AuditFilter;
  /** An entry open in the side sheet. */
  initialOpen?: string | null;
}

export function Audit({ initialFilter = NO_FILTER, initialOpen = null }: AuditProps): ReactElement {
  const data = useConsoleData();
  const [filter, setFilter] = useState<AuditFilter>(initialFilter);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [note, setNote] = useState<string | null>(null);
  const menu = useMenu();
  const filterBtn = useRef<unknown>(null);
  const list = useScreenQuery<ListOut>("audit.log", "rows", stateOf(filter));
  const all = useScreenQuery<ListOut>("audit.log", "rows", {});
  const rows = list.status === "ready" ? list.data.rows : [];
  const counts = useMemo(() => {
    const c = new Map<AuditClass, number>();
    if (all.status === "ready") for (const r of all.data.rows) c.set(r.class, (c.get(r.class) ?? 0) + 1);
    return c;
  }, [all]);
  const name = data.name;
  const now = data.clock().now;

  const anchor = (): { x: number; y: number } => {
    const box = (filterBtn.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    return { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 };
  };
  const filterEntries = (): MenuEntry[] => [
    { label: "All events", checked: filter.cls === null, count: all.status === "ready" ? all.data.rows.length : 0, onSelect: () => setFilter((f) => ({ ...f, cls: null })) },
    { separator: true },
    ...CLASSES.map((c) => ({ label: c.label, checked: filter.cls === c.id, count: counts.get(c.id) ?? 0, onSelect: () => setFilter((f) => ({ ...f, cls: c.id })) })),
  ];
  const rowMenu = (r: AuditRow): MenuEntry[] => [
    { label: "Open", onSelect: () => setOpen(r.id) },
    { label: "Show this trace", onSelect: () => setFilter((f) => ({ ...f, traceId: r.traceId })) },
    { label: `Only ${classLabel(r.class).toLowerCase()}`, onSelect: () => setFilter((f) => ({ ...f, cls: r.class })) },
    { label: "Copy the trace id", onSelect: () => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(r.traceId); setNote("Trace id copied"); } },
  ];

  const verify = async (): Promise<void> => {
    try {
      const v = (await data.call("audit.verify", {})) as VerifyOut;
      setNote(v.ok ? `Chain verified, ${v.checked.toLocaleString("en-US")} events` : `The chain breaks at event ${v.firstBadSeq ?? "unknown"}`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not verify"); }
  };
  const exportRows = async (): Promise<void> => {
    try {
      const s = stateOf(filter);
      const r = (await data.call("audit.export", { ...(s["class"] ? { class: s["class"] } : {}) })) as ExportOut;
      setNote(`Exported ${r.rows.toLocaleString("en-US")} events to a file in Files`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not export"); }
  };

  return (
    <View style={s.frame} testID="audit">
      <View style={s.main}>
        <View style={s.bar}>
          <View style={s.search}>
            <Glyph name="search" size={14} color="var(--ink-3)" />
            <TextInput accessibilityLabel="Search the audit log" testID="audit-search" value={filter.query} onChangeText={(t) => setFilter((f) => ({ ...f, query: t }))} placeholder="Search the audit log" placeholderTextColor="var(--ink-3)" style={s.input} />
          </View>
          <Pressable
            ref={(r) => { filterBtn.current = r; }}
            accessibilityRole="button" accessibilityLabel="Filter" testID="audit-filter"
            onPress={() => { const a = anchor(); menu.show(filterEntries(), a.x, a.y, "other", { label: "Audit filter" }); }}
            style={[s.ib, pointer, isFiltered(filter) && s.ibOn]}
          ><Glyph name="filter" size={15} color={isFiltered(filter) ? "var(--accent)" : "var(--ink-2)"} /></Pressable>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Verify the chain" testID="audit-verify" onPress={() => { void verify(); }} style={[s.btn, pointer]}><Glyph name="ok" size={14} color="var(--ink-2)" /><Text style={s.btnText}>Verify</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Export" testID="audit-export" onPress={() => { void exportRows(); }} style={[s.btn, pointer]}><Glyph name="download" size={14} color="var(--ink-2)" /><Text style={s.btnText}>Export</Text></Pressable>
        </View>
        {isFiltered(filter) ? (
          <View style={s.showing} testID="audit-showing">
            <Text style={s.showingText}>{filter.traceId ? "Showing one trace" : filter.cls ? `Showing ${classLabel(filter.cls).toLowerCase()}` : `Showing ${rows.length} events`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Show all" testID="audit-clear" onPress={() => setFilter(NO_FILTER)} style={pointer}><Text style={s.link}>Show all</Text></Pressable>
          </View>
        ) : null}
        {note ? <Text style={s.note} testID="audit-note" accessibilityLiveRegion="polite">{note}</Text> : null}
        <View style={s.listWrap}>
          {list.status !== "ready" ? <Text style={s.loading} accessibilityRole="progressbar">Loading</Text> : rows.length === 0 ? (
            <Empty testID="audit-none">No events match</Empty>
          ) : (
            <VirtualList<AuditRow>
              data={rows} rowHeight={44} keyOf={(r) => r.id}
              renderItem={(r) => (
                  <Row
                    id={r.id}
                    title={rowTitle(r, name)}
                    note={`${classLabel(r.class)}${r.resource ? `, ${r.resource.type.replace(/_/g, " ")}` : ""}`}
                    selected={open === r.id}
                    leading={<Avatar name={name(r.actor.id)} size={26} />}
                    trailing={<View style={s.trail}><Text style={s.time}>{ago(now, r.at)}</Text><Glyph name={classIcon(r.class)} size={14} color="var(--ink-3)" /></View>}
                    onPress={() => setOpen(r.id)}
                    trigger={menuTrigger((x, y) => menu.show(rowMenu(r), x, y, "context", { label: "Audit event" }))}
                  />
              )}
            />
          )}
        </View>
      </View>
      {open ? <EntrySheet id={open} onClose={() => setOpen(null)} onTrace={(t) => { setFilter((f) => ({ ...f, traceId: t })); setOpen(null); }} /> : null}
      {menu.element}
    </View>
  );
}

function EntrySheet({ id, onClose, onTrace }: { id: string; onClose: () => void; onTrace: (traceId: string) => void }): ReactElement {
  const data = useConsoleData();
  const q = useScreenQuery<CapMap["audit.get"]["out"]>("audit.entry", "row", { auditId: id });
  const r = q.status === "ready" ? q.data.row : null;
  const now = data.clock().now;
  return (
    <View style={s.sheet} testID="audit-entry" accessibilityLabel="Audit event">
      <View style={s.sheetHead}>
        <Text accessibilityRole="header" style={s.sheetTitle}>Event</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="audit-entry-close" onPress={onClose} style={[s.ib, pointer]}><Glyph name="x" size={13} color="var(--ink-2)" /></Pressable>
      </View>
      {r === null ? <Text style={s.loading} accessibilityRole="progressbar">Loading</Text> : (
        <View style={s.sheetBody}>
          <Line k="Who" v={data.name(r.actor.id)} />
          {r.onBehalfOf ? <Line k="On behalf of" v={data.name(r.onBehalfOf.id)} /> : null}
          <Line k="Did" v={rowTitle(r, data.name)} />
          <Line k="Kind" v={classLabel(r.class)} />
          <Line k="When" v={`${new Date(r.at).toISOString().replace("T", " ").slice(0, 16)} UTC, ${ago(now, r.at)}`} />
          {r.before !== undefined ? <Block title="Before" lines={snapshotLines(r.before)} /> : null}
          {r.after !== undefined ? <Block title="After" lines={snapshotLines(r.after)} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Show this trace" testID="audit-trace" onPress={() => onTrace(r.traceId)} style={pointer}><Text style={s.link}>Show everything in this trace</Text></Pressable>
        </View>
      )}
    </View>
  );
}

function Line({ k, v }: { k: string; v: string }): ReactElement {
  return <View style={s.line}><Text style={s.k}>{k}</Text><Text style={s.v}>{v}</Text></View>;
}
function Block({ title, lines }: { title: string; lines: string[] }): ReactElement {
  return (
    <View style={s.block} testID={`audit-${title.toLowerCase()}`}>
      <Text style={s.k}>{title}</Text>
      {lines.length === 0 ? <Text style={s.v}>Empty</Text> : <Text style={s.mono}>{lines.join("\n")}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 12 },
  search: { width: 260, height: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  input: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  ib: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  ibOn: { backgroundColor: "var(--accent-wash)" as string },
  btn: { height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 7 },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  showing: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10 },
  showingText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  note: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingBottom: 10 },
  listWrap: { flex: 1, minHeight: 240, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, padding: 4 },
  loading: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  trail: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  sheet: { width: 320, marginLeft: 14, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, paddingLeft: 14 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 32, marginBottom: 8 },
  sheetTitle: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  sheetBody: { gap: 10 },
  line: { gap: 2 },
  k: { fontSize: 11.5, color: "var(--ink-3)" as string },
  v: { fontSize: 13, color: "var(--ink)" as string },
  block: { gap: 3, padding: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  mono: { fontSize: 12, color: "var(--ink-2)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});
