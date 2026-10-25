// Records > board (spec 3.4, 2.9): a type's records as lanes of cards, one lane per option of a status or choice field. Drag a card to another lane and its field changes: one records.update, and the
// card is in its new lane on the next frame. Without a pointer, Alt and the left or right arrow move the selected card, and its menu has Move to. Each lane asks the local copy for its own page of
// cards and its own cached count, so a lane of ten thousand cards draws forty and says ten thousand.
import { createElement, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useLive, useRecordsData } from "../sidebar/data.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { cellText, hueOf } from "../table/model.ts";
import { moveCard, moveError } from "./actions.ts";
import { cardFields, each, isLaneField, LANE_PAGE, LANE_W, laneCountSpec, laneFieldOf, lanesOf, laneSpec, neighbour } from "./model.ts";
import type { FieldDef, Lane, RecordRow } from "./model.ts";
import { Value } from "./parts.tsx";
import { ViewHead, useViewState } from "./view.tsx";
import type { ViewCtx, ViewState } from "./view.tsx";

const shadow = (v: string): ViewStyle => (Platform.OS === "web" ? ({ boxShadow: v } as ViewStyle) : {});

/** What the lanes share: the card being dragged, the selection, and the cards each lane drew (for the arrow keys). */
interface Board {
  ctx: ViewCtx;
  st: ViewState;
  field: FieldDef;
  lanes: readonly Lane[];
  selected: string | null;
  select: (id: string | null) => void;
  drag: { current: RecordRow | null };
  ids: { current: Record<string, string[]> };
  rows: { current: Record<string, RecordRow> };
  counts: { current: Record<string, number> };
  move: (row: RecordRow, to: Lane) => void;
  open: (id: string) => void;
}

// ---------------------------------------------------------------- one card

function Card({ row, board, lane }: { row: RecordRow; board: Board; lane: Lane }): ReactElement {
  const data = useRecordsData();
  const menu = useMenu();
  const { ctx, st, field, lanes } = board;
  const names = data.nameOf;
  const tf = ctx.def.fields.find((f) => f.key === ctx.def.titleField);
  const title = (tf ? cellText(tf, row.fields[tf.key], names) : "") || "Untitled";
  const shown = cardFields(ctx.def, st.v.hidden, field.key);
  const selected = board.selected === row.id;
  const entries = (): MenuEntry[] => [
    { label: "Open", onSelect: () => board.open(row.id) },
    { separator: true },
    { head: "Move to" },
    ...each(lanes.filter((l) => !l.none || lane.none || (board.counts.current[l.key] ?? 0) > 0), (l): MenuEntry => ({ label: l.title, checked: l.key === lane.key, onSelect: () => board.move(row, l) })),
  ];
  const trig = menuTrigger((x, y) => { board.select(row.id); menu.show(entries(), x, y); });
  const card = (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${title}, ${lane.title}`} accessibilityState={{ selected }} testID={`card-${row.id}`}
      onPress={() => { board.select(row.id); board.open(row.id); }} {...trig}
      style={({ hovered }: { hovered?: boolean }) => [c.card, shadow(hovered === true ? "var(--sh-2), inset 0 0 0 1px var(--line)" : "var(--sh-1), inset 0 0 0 1px var(--line)"), selected && c.cardOn]}
    >
      <Text numberOfLines={2} style={c.title}>{title}</Text>
      {shown.length > 0 ? (
        <View style={c.meta}>
          {each(shown, (f) => <Value key={f.key} field={f} row={row} names={names} />)}
        </View>
      ) : null}
    </Pressable>
  );
  const both = <>{card}{menu.element}</>;
  if (Platform.OS !== "web") return both;
  return createElement(
    "div",
    {
      draggable: true, "data-testid": `drag-${row.id}`,
      onDragStart: (e: { dataTransfer?: { setData(t: string, v: string): void; effectAllowed: string } }) => { board.drag.current = row; if (e.dataTransfer) { e.dataTransfer.setData("text/plain", row.id); e.dataTransfer.effectAllowed = "move"; } },
      onDragEnd: () => { board.drag.current = null; },
      style: { cursor: "grab" },
    },
    both,
  );
}

// ---------------------------------------------------------------- one lane

function LaneColumn({ board, lane }: { board: Board; lane: Lane }): ReactElement | null {
  const { ctx, st, field } = board;
  const [limit, setLimit] = useState(LANE_PAGE);
  const [over, setOver] = useState(false);
  const q = useLive("records.query", laneSpec(ctx.type, st.v, ctx.def.titleField, field, lane, limit));
  const n = useLive("records.counts", laneCountSpec(ctx.type, st.v, ctx.def.titleField, field, lane));
  const kept = useRef<RecordRow[]>([]);
  if (q.status === "ready") kept.current = q.data.rows;
  const rows = kept.current;
  const count = n.status === "ready" ? n.data.count : rows.length;
  board.ids.current[lane.key] = each(rows, (r) => r.id);
  board.counts.current[lane.key] = count;
  for (const r of rows) board.rows.current[r.id] = r;
  if (lane.none && count === 0) return null;
  const hue = lane.color && /^\d+$/.test(lane.color) ? Number(lane.color) : hueOf(lane.key || "none");
  const body = (
    <View testID={`lane-${lane.key || "none"}`} accessibilityLabel={`${lane.title}, ${count}`} style={[c.lane, over && c.laneOver]}>
      <View style={c.laneHead}>
        <View style={[c.dot, { backgroundColor: lane.none ? "var(--ink-4)" : `hsl(${hue}, 55%, 52%)` }]} />
        <Text numberOfLines={1} style={c.laneTitle}>{lane.title}</Text>
        <Text style={c.laneCount} testID={`lane-count-${lane.key || "none"}`}>{count.toLocaleString("en-US")}</Text>
      </View>
      <ScrollView style={c.laneBody} contentContainerStyle={c.laneCards}>
        {each(rows, (r) => <Card key={r.id} row={r} board={board} lane={lane} />)}
        {count > rows.length ? (
          <Pressable accessibilityRole="button" testID={`more-${lane.key || "none"}`} onPress={() => setLimit(limit + LANE_PAGE)} style={({ hovered }: { hovered?: boolean }) => [c.add, hovered === true && c.addOver]}>
            <Text style={c.addText}>{`Show ${Math.min(LANE_PAGE, count - rows.length)} more of ${(count - rows.length).toLocaleString("en-US")}`}</Text>
          </Pressable>
        ) : null}
        {count === 0 ? <Text style={c.none} testID={`empty-${lane.key || "none"}`}>No cards</Text> : null}
      </ScrollView>
      {lane.none ? null : (
        <Pressable
          accessibilityRole="button" accessibilityLabel={`New in ${lane.title}`} testID={`add-${lane.key}`}
          onPress={() => st.newRecord({ [field.key]: lane.key })} style={({ hovered }: { hovered?: boolean }) => [c.add, hovered === true && c.addOver]}
        >
          <Glyph name="plus" size={12} color="var(--ink-3)" />
          <Text style={c.addText}>New</Text>
        </Pressable>
      )}
    </View>
  );
  if (Platform.OS !== "web") return body;
  return createElement(
    "div",
    {
      "data-testid": `drop-${lane.key || "none"}`, style: { display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "100%" },
      onDragOver: (e: { preventDefault(): void; dataTransfer?: { dropEffect: string } }) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: { preventDefault(): void }) => { e.preventDefault(); setOver(false); const row = board.drag.current; board.drag.current = null; if (row) board.move(row, lane); },
    },
    body,
  );
}

// ---------------------------------------------------------------- the board

export function BoardView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<RecordRow | null>(null);
  const ids = useRef<Record<string, string[]>>({});
  const rows = useRef<Record<string, RecordRow>>({});
  const counts = useRef<Record<string, number>>({});
  const width = useWindowDimensions().width;
  const field = laneFieldOf(ctx.def, ctx.saved, picked);
  const head = <ViewHead ctx={ctx} st={st} lanes={{ field, choices: ctx.def.fields.filter(isLaneField), pick: setPicked }} />;
  if (!field) {
    return <View style={c.main} testID="records-board">{head}<States kind="empty" title={`${ctx.def.plural} have no status or choice field to make lanes from.`} icon="records" /></View>;
  }
  const lanes = lanesOf(field);
  const laneWidth = width > 0 && width < 720 ? Math.max(220, width - 56) : LANE_W;

  const move = (row: RecordRow, to: Lane): void => {
    setError(null);
    setSelected(row.id);
    moveCard(data, ctx.type, field, row, to).catch((e: unknown) => setError(moveError(e)));
  };
  const board: Board = { ctx, st, field, lanes, selected, select: setSelected, drag, ids, rows, counts, move, open: data.nav.openRecord };
  const shown = (l: Lane): boolean => !l.none || (counts.current[l.key] ?? 0) > 0;

  const laneOfSelected = (): { lane: Lane; at: number } | null => {
    if (!selected) return null;
    for (const l of lanes) {
      const at = (ids.current[l.key] ?? []).indexOf(selected);
      if (at >= 0) return { lane: l, at };
    }
    return null;
  };
  const onKeyDown = (ev: { key?: string; altKey?: boolean; preventDefault?: () => void }): void => {
    const here = laneOfSelected();
    const key = ev.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter") return;
    if (!here) {
      const first = lanes.find((l) => (ids.current[l.key] ?? []).length > 0);
      const id = first ? ids.current[first.key]?.[0] : undefined;
      if (id && key !== "Enter") { ev.preventDefault?.(); setSelected(id); }
      return;
    }
    const list = ids.current[here.lane.key] ?? [];
    if (key === "Enter") { ev.preventDefault?.(); if (selected) data.nav.openRecord(selected); return; }
    ev.preventDefault?.();
    if (key === "ArrowDown" || key === "ArrowUp") {
      const next = list[Math.max(0, Math.min(list.length - 1, here.at + (key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next);
      return;
    }
    const dir = key === "ArrowRight" ? 1 : -1;
    if (ev.altKey === true) {
      const to = neighbour(lanes, here.lane.key, dir, () => true);
      const row = selected ? rows.current[selected] : undefined;
      if (to && row) move(row, to);
      return;
    }
    let to = neighbour(lanes, here.lane.key, dir, shown);
    while (to && (ids.current[to.key] ?? []).length === 0) to = neighbour(lanes, to.key, dir, shown);
    const next = to ? (ids.current[to.key] ?? [])[Math.min(here.at, (ids.current[to.key] ?? []).length - 1)] : undefined;
    if (next) setSelected(next);
  };

  return (
    <View style={c.main} testID="records-board" accessibilityLabel={`${ctx.def.plural} board`}>
      {head}
      {error ? <Text style={c.error} accessibilityRole="alert" testID="board-error">{error}</Text> : null}
      <View style={c.sheet} {...({ onKeyDown } as object)}>
        <ScrollView horizontal style={c.lanes} contentContainerStyle={c.lanesIn} testID="board-lanes">
          {each(lanes, (l) => (
            <View key={l.key || "none"} style={{ width: laneWidth, maxHeight: "100%" }}><LaneColumn board={board} lane={l} /></View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const c = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  sheet: { flex: 1, minHeight: 0 },
  lanes: { flex: 1 },
  lanesIn: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, height: "100%" },
  lane: { borderRadius: 12, backgroundColor: "var(--sunk)" as string, maxHeight: "100%", minHeight: 96 },
  laneOver: { boxShadow: "inset 0 0 0 2px var(--accent-line)" } as object,
  laneHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 12 },
  dot: { width: 8, height: 8, borderRadius: 8 },
  laneTitle: { flexShrink: 1, fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  laneCount: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  laneBody: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  laneCards: { gap: 8, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 8 },
  card: { borderRadius: 10, backgroundColor: "var(--raised)" as string, paddingVertical: 10, paddingHorizontal: 11, gap: 8 },
  cardOn: { backgroundColor: "var(--sel)" as string },
  title: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: "var(--ink)" as string },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  add: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 8, marginBottom: 8, paddingHorizontal: 8, borderRadius: 7 },
  addOver: { backgroundColor: "var(--hover)" as string },
  addText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  none: { fontSize: 12, color: "var(--ink-4)" as string, paddingHorizontal: 6, paddingVertical: 4 },
  error: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 18, paddingVertical: 6 },
});
