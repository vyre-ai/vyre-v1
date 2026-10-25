// Records > calendar (spec 3.4, 2.9): a month of days with the records whose date field falls on each. Prev, Next and Today move the month; "+N more" opens the day's list; a chip opens its
// record; drag a chip to another day and its date field takes that day (a date and time field keeps its time). The date field is the first date field of the type, or the one picked in the
// Date menu and kept in the saved view. Records with no date are counted under the grid.
import { createElement, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import { Glyph, HeadButton } from "../sidebar/parts.tsx";
import { cellText } from "../table/model.ts";
import { badgeFieldOf, each } from "../views-a/model.ts";
import { ViewHead, useViewState } from "../views-a/view.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { dropRecord, moveError } from "./actions.ts";
import { useViewRows } from "./data.ts";
import { CELL_EVENTS, WEEKDAYS, addMonths, bucketByDay, dateFieldOf, dateFields, dayKey, dropOnDay, hueOfRow, monthGrid, monthTitle, msOf, startOfDay } from "./model.ts";
import type { RecordRow } from "./model.ts";
import { useToday } from "./today.tsx";

/** "9:30 AM" reads "9:30a" and "9:00 AM" reads "9a", as the prototype's chips do. */
export function shortTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2}) ?(AM|PM)$/i.exec(t.trim());
  if (!m) return t;
  return `${m[1]}${m[2] === "00" ? "" : `:${m[2]}`}${m[3]!.toLowerCase().slice(0, 1)}`;
}

export function CalendarView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<RecordRow | null>(null);
  const { def } = ctx;
  const field = dateFieldOf(def, "date", ctx.saved, picked);
  const { rows, count } = useViewRows(ctx.type, st.v, def.titleField);
  const names = data.nameOf;
  const tf = def.fields.find((f) => f.key === def.titleField);
  const badge = badgeFieldOf(def);

  const dateButton = field ? (
    <HeadButton icon="calendar" label="Date" detail={field.title} testID="records-date" onPress={(x, y) => menu.show([
      { head: "Place records by" },
      ...each(dateFields(def), (f) => ({ label: f.title, checked: f.key === field.key, onSelect: () => setPicked(f.key) })),
    ], x, y)} />
  ) : null;
  const head = <ViewHead ctx={ctx} st={st} fields={false} extra={dateButton} />;
  if (!field) {
    return <View style={c.main} testID="records-calendar">{head}<States kind="empty" title={`${def.plural} have no date field to place on a calendar.`} icon="records" /></View>;
  }

  const month = cursor ?? startOfDay(today);
  const grid = monthGrid(month);
  const by = bucketByDay(rows, field);
  const dated = rows.filter((r) => msOf(r.fields[field.key]) !== null).length;
  const todayKey = dayKey(today);
  const drop = (day: number): void => {
    const row = drag.current;
    drag.current = null;
    if (!row) return;
    setError(null);
    dropRecord(data, ctx.type, row, field, dropOnDay(field, row.fields[field.key], day)).catch((e: unknown) => setError(moveError(e)));
  };

  const chip = (r: RecordRow): ReactElement => {
    const title = (tf ? cellText(tf, r.fields[tf.key], names) : "") || "Untitled";
    const hue = hueOfRow(badge, r);
    const time = field.type === "datetime" ? shortTime(cellText(field, r.fields[field.key], names).split(", ").pop() ?? "") : "";
    const el = (
      <Pressable
        accessibilityRole="button" accessibilityLabel={title} testID={`ev-${r.id}`} onPress={() => data.nav.openRecord(r.id)}
        style={({ hovered }: { hovered?: boolean }) => [c.chip, { backgroundColor: `hsla(${hue}, 65%, 52%, ${hovered === true ? 0.26 : 0.16})` }]}
      >
        <Text numberOfLines={1} style={[c.chipText, { color: `hsl(${hue}, 55%, 36%)` }]}>{time ? `${time} ${title}` : title}</Text>
      </Pressable>
    );
    return Platform.OS === "web" ? createElement("div", { key: r.id, draggable: true, "data-testid": `drag-${r.id}`, onDragStart: () => { drag.current = r; }, onDragEnd: () => { drag.current = null; } }, el) : <View key={r.id}>{el}</View>;
  };

  const weeks: ReactElement[] = [];
  for (let w = 0; w < 6; w++) {
    const cells = each(grid.slice(w * 7, w * 7 + 7), (cell) => {
      const list = by.get(cell.key) ?? [];
      const all = open === cell.key;
      const shown = all ? list : list.slice(0, CELL_EVENTS);
      const body = (
        <View testID={`day-${cell.key}`} style={[c.day, !cell.inMonth && c.dayOut, cell.key === todayKey && c.dayToday]}>
          <View style={cell.key === todayKey ? c.todayDot : c.numBox}><Text style={[c.dayNum, cell.key === todayKey && c.dayNumToday]}>{cell.day}</Text></View>
          {each(shown, chip)}
          {list.length > shown.length ? (
            <Pressable accessibilityRole="button" testID={`more-${cell.key}`} onPress={() => setOpen(cell.key)}><Text style={c.more}>{`+${list.length - shown.length} more`}</Text></Pressable>
          ) : null}
        </View>
      );
      return Platform.OS === "web"
        ? createElement("div", { key: cell.key, style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }, onDragOver: (e: { preventDefault(): void }) => e.preventDefault(), onDrop: (e: { preventDefault(): void }) => { e.preventDefault(); drop(cell.ms); } }, body)
        : <View key={cell.key} style={{ flex: 1 }}>{body}</View>;
    });
    weeks.push(<View key={w} style={c.week}>{cells}</View>);
  }

  return (
    <View style={c.main} testID="records-calendar" accessibilityLabel={`${def.plural} calendar`}>
      {head}
      <View style={c.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" testID="cal-prev" onPress={() => setCursor(addMonths(month, -1))} style={c.nav}><Glyph name="chevd" size={12} color="var(--ink-2)" /></Pressable>
        <Text style={c.title} testID="cal-title" accessibilityRole="header">{monthTitle(month)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" testID="cal-next" onPress={() => setCursor(addMonths(month, 1))} style={[c.nav, c.navNext]}><Glyph name="chevd" size={12} color="var(--ink-2)" /></Pressable>
        <Pressable accessibilityRole="button" testID="cal-today" onPress={() => setCursor(null)} style={({ hovered }: { hovered?: boolean }) => [c.todayBtn, hovered === true && c.todayOver]}><Text style={c.todayText}>Today</Text></Pressable>
        {error ? <Text style={c.error} accessibilityRole="alert" testID="calendar-error">{error}</Text> : null}
      </View>
      <View style={c.dow}>{each(WEEKDAYS, (d) => <Text key={d} style={c.dowText}>{d}</Text>)}</View>
      <View style={c.grid} testID="cal-grid">{weeks}</View>
      <Text style={c.foot} testID="records-count">{`${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}${count > dated ? `, ${count - dated} with no ${field.title.toLowerCase()}` : ""}`}</Text>
      {menu.element}
    </View>
  );
}

const c = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  bar: { height: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14 },
  nav: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", transform: [{ rotate: "90deg" }] },
  navNext: { transform: [{ rotate: "-90deg" }] },
  title: { minWidth: 130, textAlign: "center", fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  todayBtn: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  todayOver: { backgroundColor: "var(--hover)" as string },
  todayText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  error: { marginLeft: 12, fontSize: 12.5, color: "var(--danger)" as string },
  dow: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: 4 },
  dowText: { flex: 1, fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string, paddingLeft: 8 },
  grid: { flex: 1, minHeight: 0, marginHorizontal: 14, borderTopWidth: 1, borderLeftWidth: 1, borderColor: "var(--line)" as string },
  week: { flex: 1, flexDirection: "row" },
  day: { flex: 1, minHeight: 72, padding: 4, gap: 3, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  dayOut: { backgroundColor: "var(--sunk)" as string, opacity: 0.8 },
  dayToday: { backgroundColor: "transparent" },
  dayNum: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"], paddingLeft: 2 },
  dayNumToday: { color: "var(--accent-ink)" as string, fontWeight: "600", paddingLeft: 0, textAlign: "center" },
  numBox: { alignSelf: "flex-start" },
  todayDot: { alignSelf: "flex-start", minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  chip: { height: 20, borderRadius: 5, paddingHorizontal: 6, justifyContent: "center" },
  chipText: { fontSize: 11.5, fontWeight: "500" },
  more: { fontSize: 11.5, color: "var(--ink-3)" as string, paddingLeft: 4 },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, textAlign: "center", paddingVertical: 8, fontVariant: ["tabular-nums"] },
});
