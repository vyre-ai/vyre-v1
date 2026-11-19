// The head of one column: the stage's name and its count against a WIP limit, the value total of its cards, the stage's time limit, how many cards are late, and a line when it is over its limit.
// A column's menu sets its WIP limit (kept with the view). A finish line is a narrow collapsed strip; pressing it opens it as a column.
import type { ReactElement } from "react";
import { createElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { dropProps } from "./Cell.tsx";
import { Glyph, pointOf } from "../sidebar/parts.tsx";
import { useLive } from "../sidebar/data.tsx";
import { hueOf } from "../table/model.ts";
import { laneCountSpec, laneSpec } from "../views-a/model.ts";
import type { FieldDef, Lane } from "../views-a/model.ts";
import type { Board } from "./ctx.ts";
import { symbolOf, totalText } from "./face.ts";
import { columnStats, limitWords } from "./stats.ts";
import type { StageInfo } from "./stats.ts";

/** The first money (else number) field of the type: the one a column totals. */
function valueFieldOf(board: Board): FieldDef | undefined {
  return board.ctx.def.fields.find((f) => f.type === "money") ?? board.ctx.def.fields.find((f) => f.type === "number");
}

export function ColumnHead({ board, lane, width }: { board: Board; lane: Lane; width: number }): ReactElement | null {
  const { ctx, st, field } = board;
  const info: StageInfo | undefined = board.stages[lane.key];
  const value = valueFieldOf(board);
  const n = useLive("records.counts", laneCountSpec(ctx.type, st.v, ctx.def.titleField, field, lane));
  // the cards the total and the late count are made from: the first 200 of the lane, with only the two fields they need
  const q = useLive("records.query", {
    ...laneSpec(ctx.type, st.v, ctx.def.titleField, field, lane, 200),
    fields: [ctx.def.titleField, ...(value ? [value.key] : [])],
  });
  const rows = q.status === "ready" ? q.data.rows : [];
  const count = n.status === "ready" ? n.data.count : rows.length;
  board.counts.current[lane.key] = count;
  if (lane.none && count === 0) return null;
  const stats = columnStats(
    info ?? { key: lane.key, title: lane.title },
    rows,
    count,
    value,
    board.enteredAt,
    board.now,
    board.late[lane.key],
  );
  const hue = lane.color && /^\d+$/.test(lane.color) ? Number(lane.color) : hueOf(lane.key || "none");
  const symbol = symbolOf(value && rows[0] ? rows[0].fields[value.key] : undefined);
  const final = info?.final === true;
  return (
    <View style={[h.col, { width }]} testID={`col-head-${lane.key || "none"}`}>
      <View style={h.r1}>
        <View style={[h.dot, { backgroundColor: lane.none ? "var(--ink-4)" : `hsl(${hue}, 55%, 52%)` }]} />
        <Text numberOfLines={1} style={h.title}>
          {lane.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${count} cards. Set a limit`}
          testID={`col-limit-button-${lane.key || "none"}`}
          disabled={lane.none}
          onPress={(e) => board.limitMenu(lane, pointOf(e))}
        >
          <Text style={[h.count, stats.overWip && h.over]} testID={`lane-count-${lane.key || "none"}`}>
            {info?.wip !== undefined ? stats.countText : count.toLocaleString("en-US")}
          </Text>
        </Pressable>
        <View style={h.sp} />
        {stats.total !== null ? (
          <Text style={h.total} testID={`col-total-${lane.key}`}>
            {`${totalText(stats.total, symbol)}${stats.partial ? "+" : ""}`}
          </Text>
        ) : null}
        {final ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Collapse ${lane.title}`}
            testID={`col-collapse-${lane.key}`}
            onPress={() => board.toggleFinish(lane.key)}
            style={h.x}
          >
            <Glyph name="cross" size={11} color="var(--ink-3)" />
          </Pressable>
        ) : null}
      </View>
      <View style={h.r2}>
        {info?.limitHours !== undefined ? (
          <View style={h.chip} testID={`col-limit-${lane.key}`}>
            <Glyph name="clock" size={12} color="var(--ink-3)" />
            <Text style={h.sub}>{limitWords(info.limitHours)}</Text>
          </View>
        ) : null}
        {stats.late > 0 ? (
          <Text style={[h.sub, h.late]} testID={`col-late-${lane.key}`}>{`${stats.late} late`}</Text>
        ) : null}
        {stats.overWip ? (
          <Text style={[h.sub, h.overText]} testID={`col-over-${lane.key}`}>
            Over its limit
          </Text>
        ) : info?.wip !== undefined ? (
          <Text style={h.sub}>{`Limit ${info.wip}`}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** A finish line, closed: a narrow strip with the name down its side and how many records are in it. Press it to open it as a column; it still takes drops. */
export function FinishStrip({ board, lane }: { board: Board; lane: Lane }): ReactElement {
  const { ctx, st, field } = board;
  const n = useLive("records.counts", laneCountSpec(ctx.type, st.v, ctx.def.titleField, field, lane));
  const count = n.status === "ready" ? n.data.count : 0;
  board.counts.current[lane.key] = count;
  const over = board.move.kind === "lifted" && board.move.over === lane.key;
  const strip = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lane.title}, ${count}. Open`}
      testID={`finish-${lane.key}`}
      onPress={() => board.toggleFinish(lane.key)}
      style={({ hovered }: { hovered?: boolean }) => [f.strip, (over || hovered === true) && f.on]}
    >
      <Glyph name={lane.title.toLowerCase().includes("lost") ? "cross" : "check"} size={16} color="var(--ink-2)" />
      <Text style={f.name}>{lane.title}</Text>
      <Text style={f.count} testID={`lane-count-${lane.key}`}>
        {count.toLocaleString("en-US")}
      </Text>
    </Pressable>
  );
  if (Platform.OS !== "web") return strip;
  return createElement("div", { "data-testid": `drop-${lane.key}`, ...dropProps(board, lane) }, strip);
}

const h = StyleSheet.create({
  col: { gap: 3, paddingHorizontal: 6, paddingTop: 2, paddingBottom: 8 },
  r1: { flexDirection: "row", alignItems: "center", gap: 8 },
  r2: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 16 },
  dot: { width: 8, height: 8, borderRadius: 8 },
  title: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  over: { color: "var(--danger)" as string, fontWeight: "600" },
  sp: { flex: 1 },
  total: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, fontVariant: ["tabular-nums"] },
  x: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 3 },
  sub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  late: { color: "var(--warn)" as string, fontWeight: "600" },
  overText: { color: "var(--danger)" as string, fontWeight: "600" },
});
const f = StyleSheet.create({
  strip: {
    width: 88,
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
    paddingVertical: 14,
  },
  on: { backgroundColor: "var(--accent-wash)" as string },
  name: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string, writingMode: "vertical-rl" } as object,
  count: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
});
