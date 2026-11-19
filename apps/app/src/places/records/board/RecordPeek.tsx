// A card opened where it was pressed: the shared side pane beside the board, on Details, with the Journey's path at the top (where the card is, how long it has been there against the stage's
// limit, what is done and what is ahead). Activity is the second tab. "Open the page" is the person asking for the full record in a tab of its own.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { Face, Glyph, typeIcon } from "../sidebar/parts.tsx";
import { cellText } from "../table/model.ts";
import { each, laneOfRow } from "../views-a/model.ts";
import type { Board } from "./ctx.ts";
import { daysIn, limitWords } from "./stats.ts";

const TABS = [
  { key: "details", title: "Details" },
  { key: "activity", title: "Activity" },
];

interface Entry {
  id: string;
  kind: string;
  at: number;
  actor: string;
  field?: string;
}

function Path({ board, id }: { board: Board; id: string }): ReactElement | null {
  const row = board.rows.current[id];
  if (!row || !board.ctx.journey) return null;
  const lanes = board.lanes.filter((l) => !l.none);
  const here = lanes.findIndex((l) => l.key === laneOfRow(board.field, row, board.lanes).key);
  const since = board.enteredAt(row);
  return (
    <View style={p.path} testID="peek-path">
      {each(lanes, (l, i) => {
        const info = board.stages[l.key];
        const note =
          i === here
            ? since === undefined
              ? "Here"
              : `Day ${daysIn(since, board.now)}${info?.limitHours !== undefined ? ` of ${limitWords(info.limitHours)}` : ""}`
            : i < here
              ? "Done"
              : "";
        return (
          <View key={l.key} style={p.step} testID={`peek-step-${l.key}`}>
            <View style={[p.dot, i < here && p.done, i === here && p.now]} />
            <Text style={[p.stepName, i > here && p.ahead, i === here && p.here]}>{l.title}</Text>
            <Text style={p.stepNote}>{note}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function RecordPeek({
  board,
  id,
  onClose,
}: {
  board: Board;
  id: string;
  onClose: () => void;
}): ReactElement | null {
  const [tab, setTab] = useState("details");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const row = board.rows.current[id];
  const { ctx } = board;
  useEffect(() => {
    setEntries(null);
    if (tab !== "activity") return;
    let on = true;
    board
      .call("records.activity", { type: ctx.type, recordId: id, limit: 30 })
      .then((o) => {
        if (on) setEntries((o as { entries: Entry[] }).entries);
      })
      .catch(() => {
        if (on) setEntries([]);
      });
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id]);
  if (!row) return null;
  const tf = ctx.def.fields.find((f) => f.key === ctx.def.titleField);
  const title = (tf ? cellText(tf, row.fields[tf.key], board.names) : "") || "Untitled";
  return (
    <SidePane
      paneKey="records-board-peek"
      toggle={{ open: true, onPress: onClose }}
      title={title}
      tabs={TABS}
      activeTab={tab}
      onSelectTab={setTab}
      defaultWidth={380}
      min={300}
    >
      <ScrollView style={p.body} contentContainerStyle={p.bodyIn} testID="board-peek">
        <View style={p.head} testID="peek-head">
          <Glyph name={typeIcon(ctx.def.icon)} size={16} color="var(--ink-3)" />
          <Text numberOfLines={2} style={p.headName} testID="peek-name">
            {title}
          </Text>
        </View>
        <Path board={board} id={id} />
        {tab === "details" ? (
          <View style={p.kv} testID="peek-details">
            {each(
              ctx.def.fields.filter((f) => f.key !== ctx.def.titleField),
              (f) => {
                const text = cellText(f, row.fields[f.key], board.names);
                return (
                  <View key={f.key} style={p.kvRow}>
                    <Text style={p.k}>{f.title}</Text>
                    <Text style={[p.v, text === "" && p.empty]}>{text === "" ? "None" : text}</Text>
                  </View>
                );
              },
            )}
            <Pressable
              accessibilityRole="button"
              testID="peek-open-page"
              onPress={() => board.openPage(id)}
              style={p.page}
            >
              <Text style={p.pageText}>Open the page</Text>
            </Pressable>
          </View>
        ) : (
          <View style={p.kv} testID="peek-activity">
            {entries === null ? (
              <Text style={p.empty}>Loading</Text>
            ) : entries.length === 0 ? (
              <Text style={p.empty}>Nothing yet</Text>
            ) : (
              each(entries, (e) => (
                <View key={e.id} style={p.act}>
                  <Face name={board.names(e.actor)} seedId={e.actor} size={18} />
                  <Text
                    style={p.v}
                  >{`${board.names(e.actor).split(" ")[0] ?? ""} ${e.kind === "stage" ? "moved it" : e.kind === "created" ? "made it" : e.field ? `changed ${e.field}` : e.kind}`}</Text>
                  <Text style={p.stepNote}>{`${daysIn(e.at, board.now)} d ago`}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SidePane>
  );
}

const p = StyleSheet.create({
  body: { flex: 1 },
  bodyIn: { padding: 16, gap: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headName: { flex: 1, fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  path: { gap: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 10, boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object,
  done: { backgroundColor: "var(--ok)" as string, boxShadow: "none" } as object,
  now: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
  stepName: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  ahead: { color: "var(--ink-3)" as string },
  here: { fontWeight: "600" },
  stepNote: { fontSize: 12, color: "var(--ink-3)" as string },
  kv: { gap: 10 },
  kvRow: { flexDirection: "row", gap: 12 },
  k: { width: 110, fontSize: 12.5, color: "var(--ink-3)" as string },
  v: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  empty: { fontSize: 13, color: "var(--ink-4)" as string },
  act: { flexDirection: "row", alignItems: "center", gap: 8 },
  page: {
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    boxShadow: "inset 0 0 0 1px var(--line-2)",
  } as object,
  pageText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
});
