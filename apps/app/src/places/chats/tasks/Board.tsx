// The board: one column per status, each a virtual list, so a column of 5,000 cards mounts what fits. A drag goes through the same status path as every other door, so the same rules and the same refusals apply.
import { createElement, memo, useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { StatusDot, stateTitle } from "../../../../../../ui/src/TaskPage/StatusDot.tsx";
import type { TaskState } from "../../../../../../ui/src/TaskPage/model.ts";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { BOARD_STATES, cardHeight, dueLabel, holderOf } from "./model.ts";
import { gridStep } from "./keys.ts";
import { CARD_ATTR, useRoving } from "./roving.ts";
import type { TaskRow } from "./model.ts";
import { BatonMarks, FaceButton, LiveWords, useLiveTurn } from "./parts.tsx";
import type { RowEnv } from "./parts.tsx";
import { TimePop, useZones } from "../../../../../../ui/src/Time/index.tsx";

type Drag = { current: TaskRow | null };
type DragStart = { dataTransfer?: { setData(t: string, v: string): void; effectAllowed: string } };

const Card = memo(function Card({ row, env, drag, tab, onActive }: { row: TaskRow; env: RowEnv; drag: Drag; tab: boolean; onActive(id: string): void }): ReactElement {
  const turn = useLiveTurn(env.turns, row.workerThread ?? row.threadId);
  const h = holderOf(row) ?? row.assigned;
  const zones = useZones();
  const due = dueLabel(row.due, env.now, zones);
  const context = row.recordId ? env.project(row.recordId) : undefined;
  const card = <Pressable accessibilityRole="button" accessibilityLabel={row.title} testID={`task-card-${row.id}`} onPress={() => env.open(row.id)} onFocus={() => onActive(row.id)} {...(Platform.OS === "web" ? { focusable: true, dataSet: { [CARD_ATTR.slice(5)]: row.id }, tabIndex: tab ? 0 : -1 } : {})} {...menuTrigger((x, y) => env.menu(row, { x, y }))} style={({ hovered }: { hovered?: boolean }) => [st.card, hovered === true && st.cardOver]}>
    <Text numberOfLines={2} style={st.title}>{row.title}</Text>
    {turn ? <LiveWords turn={turn} turns={env.turns} name={env.nameOf(turn.agentId)} /> : context ? <Text numberOfLines={1} style={st.sub}>{context}</Text> : null}
    <View style={{ flex: 1 }} />
    <View style={st.foot}>
      <BatonMarks row={row} />
      {row.key && !row.reviewer && !row.approver ? <Text numberOfLines={1} style={st.key}>{row.key}</Text> : null}
      <View style={{ flex: 1 }} />
      {due.text ? <TimePop at={row.due as number}><Text numberOfLines={1} style={[st.due, due.late && st.late]}>{due.text}</Text></TimePop> : null}
      <FaceButton who={h} name={env.nameOf(h.id)} size={20} onPress={() => env.openProfile(h)} />
    </View>
  </Pressable>;
  if (Platform.OS !== "web") return <View style={st.cardWrap}>{card}</View>;
  // react-native-web keeps drag attributes off a View, so the card sits in a plain element
  return createElement("div", {
    draggable: true, "data-testid": `drag-${row.id}`, style: { height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: CARD_GAP },
    onDragStart: (e: DragStart) => { drag.current = row; if (e.dataTransfer) { e.dataTransfer.setData("text/plain", row.id); e.dataTransfer.effectAllowed = "move"; } },
    onDragEnd: () => { drag.current = null; },
  }, card);
});

function Column({ state, rows, env, drag, drop, window, tab, active, onActive }: { state: TaskState; rows: readonly TaskRow[]; env: RowEnv; drag: Drag; drop(state: TaskState): void; window?: VirtualWindow; tab: string | null; active: string | null; onActive(id: string): void }): ReactElement {
  const [over, setOver] = useState(false);
  const heightOf = useCallback((r: TaskRow): number => cardHeight(r, r.recordId ? env.project(r.recordId) !== undefined : false), [env]);
  const body = <View testID={`board-col-${state}`} style={[st.col, over && st.colOver]}>
    <View style={st.head}><StatusDot state={state} size={13} /><Text style={st.headText}>{stateTitle(state)}</Text><Text style={st.count}>{rows.length}</Text></View>
    <View style={{ flex: 1, minHeight: 0 }}>
      {/* ui-rows-lint: not a list (board cards, not rows) */}
      <VirtualList data={rows} rowHeight="measure" heightOf={heightOf} keyOf={(r) => r.id} renderItem={(r) => <Card row={r} env={env} drag={drag} tab={r.id === tab} onActive={onActive} />} reveal={active === null ? -1 : rows.findIndex((r) => r.id === active)} {...(window ? { window } : {})} />
    </View>
  </View>;
  if (Platform.OS !== "web") return body;
  return createElement("div", {
    "data-testid": `board-drop-${state}`, style: { display: "flex", flex: "1 1 0", minWidth: COL_MIN, maxWidth: COL_MAX },
    onDragOver: (e: { preventDefault(): void }) => { if (drag.current) { e.preventDefault(); if (!over) setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: { preventDefault(): void }) => { e.preventDefault(); setOver(false); drop(state); },
  }, body);
}

export function Board({ rows, doneRows, env, onDrop, window }: { rows: readonly TaskRow[]; doneRows: readonly TaskRow[]; env: RowEnv; onDrop(row: TaskRow, to: TaskState): void; window?: VirtualWindow }): ReactElement {
  const drag = useRef<TaskRow | null>(null);
  const cols = useMemo(() => {
    const by = new Map<string, TaskRow[]>(BOARD_STATES.map((s) => [s, []]));
    const seen = new Set<string>();
    for (const t of rows) { seen.add(t.id); by.get(t.state)?.push(t); }
    for (const t of doneRows) if (t.state === "done" && !seen.has(t.id)) by.get("done")?.push(t);
    return by;
  }, [rows, doneRows]);
  const drop = (state: TaskState): void => { const r = drag.current; drag.current = null; if (r && r.state !== state) onDrop(r, state); };
  // the keys: one card takes Tab, arrows move between cards, Enter opens, Space or S changes status, Esc lets go
  const order = useMemo(() => BOARD_STATES.map((s) => (cols.get(s) ?? []).map((r) => r.id)), [cols]);
  const byId = useMemo(() => { const m = new Map<string, TaskRow>(); for (const list of cols.values()) for (const r of list) m.set(r.id, r); return m; }, [cols]);
  const roving = useRoving({ cols: order, step: (at, dir) => gridStep(order, at, dir), open: (id) => env.open(id), status: (id, at) => { const r = byId.get(id); if (r) env.status(r, at); } });
  const lanes: ReactElement[] = [];
  for (const s of BOARD_STATES) lanes.push(<Column key={s} state={s} rows={cols.get(s) ?? []} env={env} drag={drag} drop={drop} tab={roving.tab} active={roving.active} onActive={roving.setActive} {...(window ? { window } : {})} />);
  const board = <ScrollView horizontal testID="tasks-board" style={{ flex: 1 }} contentContainerStyle={st.board}>{lanes}</ScrollView>;
  if (Platform.OS !== "web") return board;
  return createElement("div", { "data-testid": "tasks-board-keys", style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }, onKeyDownCapture: roving.onKeyDownCapture, onKeyUpCapture: roving.onKeyUpCapture }, board);
}

const CARD_GAP = 7, COL_MIN = 176, COL_MAX = 320;

const st = StyleSheet.create({
  board: { flexGrow: 1, flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  col: { flex: 1, minWidth: COL_MIN, maxWidth: COL_MAX, borderRadius: 16, padding: 8, backgroundColor: "var(--sunk)" as string },
  colOver: { backgroundColor: "var(--accent-wash)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 6 },
  headText: { fontSize: 13, color: "var(--ink)" as string },
  count: { marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" as string },
  cardWrap: { paddingBottom: CARD_GAP },
  card: { flex: 1, padding: 11, gap: 3, borderRadius: 13, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)", cursor: "grab" } as object,
  cardOver: { boxShadow: "var(--sh-pop)" } as object,
  title: { fontSize: 13.5, lineHeight: 18, color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 7, height: 20 },
  key: { flexShrink: 0, fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  due: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  late: { color: "var(--danger)" as string },
});
