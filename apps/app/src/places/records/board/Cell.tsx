// One lane's cards (inside one swimlane band when the board has bands): its own page of cards from the local copy, drawn by window when the lane is long, a drop target that shows where the
// card will land, and a quick add at the foot.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { Glyph, pointOf } from "../sidebar/parts.tsx";
import { useLive } from "../sidebar/data.tsx";
import { LANE_PAGE, each, laneCountSpec, laneSpec } from "../views-a/model.ts";
import type { Clause, Lane, RecordRow } from "../views-a/model.ts";
import type { Board } from "./ctx.ts";
import { BIG_LANE, SLOT } from "./face.ts";
import { KCard } from "./KCard.tsx";
import { windowOf } from "./stats.ts";

/** The drop handlers of a lane, for whatever draws it: dragging over it lights it, letting go takes the move to it. */
export function dropProps(board: Board, lane: Lane): Record<string, unknown> {
  return {
    onDragOver: (e: { preventDefault(): void; dataTransfer?: { dropEffect: string } }) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      if (board.move.kind !== "lifted" || board.move.over !== lane.key) board.send({ t: "over", lane: lane.key });
    },
    onDragLeave: (e: { currentTarget?: { contains?: (n: unknown) => boolean }; relatedTarget?: unknown }) => {
      if (e.relatedTarget && e.currentTarget?.contains?.(e.relatedTarget)) return;
      board.send({ t: "over", lane: null });
    },
    onDrop: (e: { preventDefault(): void }) => {
      e.preventDefault();
      board.drag.current = null;
      // the machine takes the drop on this lane whatever the last dragover said
      board.send({ t: "over", lane: lane.key });
      board.send({ t: "drop" });
    },
  };
}

/** The key a cell keeps its cards under: the lane's, and the band's when there are bands. */
export const cellKey = (lane: Lane, swim: string | null): string =>
  swim === null ? lane.key : `${lane.key}\u0001${swim}`;

export function Cell({
  board,
  lane,
  width,
  swimKey,
  maxHeight,
}: {
  board: Board;
  lane: Lane;
  width: number;
  /** null: the board has no bands. "" is the band of cards with no value. */
  swimKey: string | null;
  maxHeight?: number;
}): ReactElement | null {
  const { ctx, st, field } = board;
  const [limit, setLimit] = useState(LANE_PAGE);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scroll, setScroll] = useState({ top: 0, h: SLOT[board.face.preset] * LANE_PAGE });
  const swimClause: Clause | null =
    board.swim && swimKey !== null
      ? swimKey === ""
        ? { field: board.swim.key, op: "empty" }
        : { field: board.swim.key, op: "eq", value: swimKey }
      : null;
  const q = useLive("records.query", laneSpec(ctx.type, st.v, ctx.def.titleField, field, lane, limit, swimClause));
  const n = useLive("records.counts", laneCountSpec(ctx.type, st.v, ctx.def.titleField, field, lane, swimClause));
  const kept = useRef<RecordRow[]>([]);
  if (q.status === "ready") kept.current = q.data.rows;
  const rows = kept.current;
  const failed = q.status === "loading" ? q.error : undefined;
  const count = n.status === "ready" ? n.data.count : rows.length;
  const key = cellKey(lane, swimKey);
  board.ids.current[key] = each(rows, (r) => r.id);
  for (const r of rows) {
    board.rows.current[r.id] = r;
    board.cellOf.current[r.id] = key;
  }
  if (swimKey === null) board.counts.current[lane.key] = count;
  if (lane.none && count === 0 && swimKey === null) return null;
  const over = board.move.kind === "lifted" && board.move.over === lane.key && board.move.from !== lane.key;
  const blocked = over && board.move.kind === "lifted" ? board.move.blocked : null;
  const big = count > BIG_LANE;
  const slot = SLOT[board.face.preset];
  const win = big ? windowOf(rows.length, slot, scroll.top, scroll.h) : null;
  // a long lane asks for more cards as the window nears the end of those loaded
  const wantMore = win !== null && win.to >= rows.length - 10 && rows.length < count && limit <= rows.length;
  useEffect(() => {
    if (wantMore) setLimit(rows.length + LANE_PAGE * 2);
  }, [wantMore, rows.length]);
  const drawn = win ? rows.slice(win.from, win.to) : rows;
  const tid = swimKey === null ? lane.key || "none" : `${lane.key || "none"}-${swimKey || "none"}`;
  const submit = (): void => {
    const t = name.trim();
    if (!t) return;
    setName("");
    setAdding(false);
    void board.quickAdd(lane, t, swimKey);
  };
  const body = (
    <View
      testID={`lane-${tid}`}
      accessibilityLabel={`${lane.title}, ${count}`}
      style={[c.lane, { width }, over && c.over, over && blocked ? c.blocked : null, maxHeight ? { maxHeight } : null]}
    >
      <ScrollView
        style={c.body}
        contentContainerStyle={c.cards}
        scrollEventThrottle={32}
        onScroll={(e) => {
          if (!big) return;
          const ne = e.nativeEvent as { contentOffset: { y: number }; layoutMeasurement: { height: number } };
          setScroll({ top: ne.contentOffset.y, h: ne.layoutMeasurement.height });
        }}
      >
        {win && win.before > 0 ? <View style={{ height: win.before }} /> : null}
        {each(drawn, (r) => (
          <KCard key={r.id} row={r} board={board} lane={lane} />
        ))}
        {win && win.after > 0 ? <View style={{ height: win.after }} /> : null}
        {over ? (
          <View style={c.place} testID={`place-${tid}`}>
            {blocked ? <Text style={c.placeText}>{blocked}</Text> : null}
          </View>
        ) : null}
        {failed && rows.length === 0 ? (
          <Text
            style={c.none}
            accessibilityRole="alert"
            testID={`lane-error-${tid}`}
          >{`Couldn't load these cards. ${failed.message}`}</Text>
        ) : null}
        {count > rows.length && !(failed && rows.length === 0) ? (
          <Pressable
            accessibilityRole="button"
            testID={`more-${tid}`}
            onPress={() => setLimit(limit + LANE_PAGE)}
            style={({ hovered }: { hovered?: boolean }) => [c.add, hovered === true && c.addOver]}
          >
            <Text
              style={c.addText}
            >{`Show ${Math.min(LANE_PAGE, count - rows.length)} more of ${(count - rows.length).toLocaleString("en-US")}`}</Text>
          </Pressable>
        ) : null}
        {count === 0 && !failed && !over ? (
          <Text style={c.none} testID={`empty-${tid}`}>
            No cards
          </Text>
        ) : null}
      </ScrollView>
      {lane.none ? null : adding ? (
        <View style={c.qi}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="Name, then Enter"
            autoFocus
            accessibilityLabel={`New in ${lane.title}`}
            testID={`quick-${tid}`}
            onSubmitEditing={submit}
            onBlur={() => {
              if (!name.trim()) setAdding(false);
            }}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`New in ${lane.title}`}
          testID={`add-${tid}`}
          onPress={(e) => {
            if (board.ctx.journey) board.addAt(lane, pointOf(e));
            else setAdding(true);
          }}
          style={({ hovered }: { hovered?: boolean }) => [c.add, hovered === true && c.addOver]}
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
      "data-testid": `drop-${tid}`,
      style: { display: "flex", flexDirection: "column", minHeight: 0, maxHeight: maxHeight ?? "100%", width },
      ...dropProps(board, lane),
    },
    body,
  );
}

const c = StyleSheet.create({
  lane: { borderRadius: 14, backgroundColor: "var(--sunk)" as string, maxHeight: "100%", minHeight: 96 },
  over: { boxShadow: "inset 0 0 0 2px var(--accent-line)", backgroundColor: "var(--accent-wash)" as string } as object,
  blocked: { boxShadow: "inset 0 0 0 1px var(--warn)", backgroundColor: "var(--sunk)" as string } as object,
  body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  cards: { gap: 8, padding: 4 },
  place: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "var(--accent)" as string,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  placeText: { fontSize: 12, color: "var(--ink-2)" as string },
  add: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 4,
    marginBottom: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  addOver: { backgroundColor: "var(--hover)" as string },
  addText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  qi: { padding: 4 },
  none: { fontSize: 12, color: "var(--ink-4)" as string, paddingHorizontal: 6, paddingVertical: 4 },
});
