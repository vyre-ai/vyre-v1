// The timeline and the month: the same rows, by date. Fourteen days from three days back, a line per task in one virtual list, and a bar from its start to its due date. A project's plan adds the starts it keeps.
import { createElement, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph } from "../conversation/parts.tsx";
import { barOf, DAY, monthCells } from "./model.ts";
import type { TaskRow } from "./model.ts";
import type { RowEnv } from "./parts.tsx";
import { useLiveTurn } from "./parts.tsx";
import { rowStep } from "./keys.ts";
import { CARD_ATTR, useRoving } from "./roving.ts";

const DAYS = 14, BACK = 3;
// at phone width a week fits with the day labels readable: today is the second day, and the name column is narrow
const PHONE_DAYS = 7, PHONE_BACK = 1, PHONE_NAME = 108;
const ROW_H = 40;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BAR: Record<string, string> = { todo: "var(--line-2)", doing: "var(--accent)", in_review: "var(--accent)", awaiting_approval: "var(--warn)", done: "var(--ok)", canceled: "var(--line)" };

function Line({ row, env, first, tab, onActive, days, back, nameW }: { row: TaskRow; env: RowEnv; first: number; tab: boolean; onActive(id: string): void; days: number; back: number; nameW: number }): ReactElement {
  const turn = useLiveTurn(env.turns, row.workerThread ?? row.threadId);
  const bar = barOf(row, first, days);
  return <View testID={`timeline-row-${row.id}`} style={st.row}>
    <Pressable accessibilityRole="link" accessibilityLabel={row.title} onPress={() => env.open(row.id)} onFocus={() => onActive(row.id)} {...(Platform.OS === "web" ? { focusable: true, dataSet: { [CARD_ATTR.slice(5)]: row.id }, tabIndex: tab ? 0 : -1 } : {})} style={[st.name, { width: nameW }]}><Text numberOfLines={1} style={st.nameText}>{row.title}</Text></Pressable>
    <View style={st.track}>
      {bar ? <Pressable accessibilityRole="button" accessibilityLabel={`${row.title}, on the timeline`} onPress={() => env.open(row.id)} {...(Platform.OS === "web" ? { tabIndex: -1 } : {})} style={[st.bar, { left: `${bar.left * 100}%`, width: `${bar.width * 100}%`, backgroundColor: BAR[row.state] as string, opacity: turn ? 1 : 0.85 }]} /> : null}
      <View style={[st.today, { left: `${(back / days) * 100}%` }]} />
    </View>
  </View>;
}

export function Timeline({ rows, env, window }: { rows: readonly TaskRow[]; env: RowEnv; window?: VirtualWindow }): ReactElement {
  const [shift, setShift] = useState(0);
  const narrow = useWindowDimensions().width < 720;
  const days = narrow ? PHONE_DAYS : DAYS, back = narrow ? PHONE_BACK : BACK, nameW = narrow ? PHONE_NAME : 240;
  const today = Math.floor((env.now + env.offsetMin * 60_000) / DAY) * DAY - env.offsetMin * 60_000;
  const first = today + (shift - back) * DAY;
  const dated = useMemo(() => rows.filter((t) => t.due !== undefined || t.start !== undefined), [rows]);
  const order = useMemo(() => [dated.map((r) => r.id)], [dated]);
  const roving = useRoving({ cols: order, step: (at, dir) => rowStep(order[0]!, at, dir), open: (id) => env.open(id), status: (id, at) => { const r = dated.find((x) => x.id === id); if (r) env.status(r, at); } });
  const heads: ReactElement[] = [];
  for (let i = 0; i < days; i++) { const d = new Date(first + i * DAY + env.offsetMin * 60_000); const on = shift === 0 && i === back; heads.push(<Text key={i} style={[st.day, on && st.dayNow]}>{on ? "Today" : String(d.getUTCDate())}</Text>); }
  const body = <View testID="tasks-timeline" style={st.root}>
    <View style={st.bar0}>
      <View style={[st.name, { width: nameW }]}><View style={st.arrows}>
        <Pressable accessibilityRole="button" accessibilityLabel={narrow ? "A week back" : "Two weeks back"} onPress={() => setShift((n) => n - days)} style={st.arrow}><Glyph name="back" size={13} color="var(--ink-3)" /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to today" onPress={() => setShift(0)} style={st.arrow}><Text style={st.todayText}>Today</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={narrow ? "A week on" : "Two weeks on"} onPress={() => setShift((n) => n + days)} style={st.arrow}><Glyph name="chev" size={13} color="var(--ink-3)" /></Pressable>
      </View></View>
      <View style={st.days}>{heads}</View>
    </View>
    {dated.length === 0 ? <Text style={st.empty}>No task here has a date yet.</Text> : <View style={{ flex: 1, minHeight: 0 }}>
      {/* ui-rows-lint: not a list (a timeline: a name and a bar on a track per line) */}
      <VirtualList data={dated} rowHeight={ROW_H} keyOf={(r) => r.id} renderItem={(r) => <Line row={r} env={env} first={first} days={days} back={back} nameW={nameW} tab={r.id === roving.tab} onActive={roving.setActive} />} reveal={roving.active === null ? -1 : (order[0] ?? []).indexOf(roving.active)} {...(window ? { window } : {})} />
    </View>}
  </View>;
  if (Platform.OS !== "web") return body;
  return createElement("div", { "data-testid": "tasks-timeline-keys", style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }, onKeyDownCapture: roving.onKeyDownCapture, onKeyUpCapture: roving.onKeyUpCapture }, body);
}

export function CalendarView({ rows, env }: { rows: readonly TaskRow[]; env: RowEnv }): ReactElement {
  const start = new Date(env.now + env.offsetMin * 60_000);
  const [at, setAt] = useState({ year: start.getUTCFullYear(), month: start.getUTCMonth() });
  const menu = useMenu();
  const cells = useMemo(() => monthCells(rows, at, env.offsetMin), [rows, at, env.offsetMin]);
  const step = (n: number): void => setAt((c) => { const d = new Date(Date.UTC(c.year, c.month + n, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() }; });
  const weeks: ReactElement[] = [];
  for (let w = 0; w < 6; w++) {
    const days: ReactElement[] = [];
    for (const c of cells.slice(w * 7, w * 7 + 7)) {
      const lines: ReactElement[] = [];
      for (const t of c.rows.slice(0, 3)) lines.push(<Pressable key={t.id} accessibilityRole="link" accessibilityLabel={t.title} onPress={() => env.open(t.id)}><Text numberOfLines={1} style={st.chip}>{t.title}</Text></Pressable>);
      const more = c.rows.length - 3;
      days.push(<View key={c.date} testID={`calendar-day-${c.date}`} style={[st.cell, !c.inMonth && st.cellOut]}>
        <Text style={st.cellDay}>{c.day}</Text>{lines}
        {more > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`${more} more`} onPress={(e) => { const p = e as unknown as { clientX?: number; clientY?: number; nativeEvent?: { pageX?: number; pageY?: number } }; menu.show(c.rows.slice(3).map((t): MenuEntry => ({ label: t.title, onSelect: () => env.open(t.id) })), p.nativeEvent?.pageX ?? p.clientX ?? 8, p.nativeEvent?.pageY ?? p.clientY ?? 48, "other", { label: "Tasks" }); }}><Text style={st.more}>{`${more} more`}</Text></Pressable> : null}
      </View>);
    }
    weeks.push(<View key={w} style={st.week}>{days}</View>);
  }
  return <View testID="tasks-calendar" style={st.root}>
    <View style={st.calHead}>
      <Pressable accessibilityRole="button" accessibilityLabel="Last month" onPress={() => step(-1)} style={st.arrow}><Glyph name="back" size={13} color="var(--ink-3)" /></Pressable>
      <Text style={st.month}>{`${MONTHS[at.month]} ${at.year}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => step(1)} style={st.arrow}><Glyph name="chev" size={13} color="var(--ink-3)" /></Pressable>
    </View>
    <View style={{ flex: 1, minHeight: 0 }}>{weeks}</View>
    {menu.element}
  </View>;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, paddingHorizontal: 24, paddingBottom: 12 },
  bar0: { flexDirection: "row", alignItems: "center", height: 30 },
  row: { flexDirection: "row", alignItems: "center", height: ROW_H, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  name: { width: 240, paddingRight: 14, justifyContent: "center" },
  nameText: { fontSize: 13.5, color: "var(--ink)" as string },
  track: { flex: 1, height: ROW_H, justifyContent: "center" },
  bar: { position: "absolute", height: 14, borderRadius: 7 },
  today: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "var(--beacon)" as string, opacity: 0.5 },
  days: { flex: 1, flexDirection: "row" },
  day: { flex: 1, fontSize: 11.5, color: "var(--ink-3)" as string },
  dayNow: { color: "var(--beacon)" as string },
  arrows: { flexDirection: "row", alignItems: "center", gap: 2 },
  arrow: { minWidth: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7, paddingHorizontal: 4 },
  todayText: { fontSize: 12, color: "var(--ink-3)" as string },
  empty: { paddingTop: 60, textAlign: "center", fontSize: 13.5, color: "var(--ink-3)" as string },
  calHead: { flexDirection: "row", alignItems: "center", gap: 6, height: 34 },
  month: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  week: { flex: 1, flexDirection: "row", gap: 1, minHeight: 0 },
  cell: { flex: 1, minWidth: 0, padding: 5, gap: 2, overflow: "hidden", borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  cellOut: { opacity: 0.45 },
  cellDay: { fontSize: 11.5, color: "var(--ink-3)" as string },
  chip: { fontSize: 12, lineHeight: 16, color: "var(--ink)" as string },
  more: { fontSize: 11.5, color: "var(--ink-3)" as string },
});
