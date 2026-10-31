// Right pane > Activity: what happened to this record, newest first, from the log (records.activity): created, who changed which field, stage moves, links, Trash, sync pushes. One compact row each,
// the person's or agent's face at the left and how long ago at the right; the old and new value are in the tooltip, so a row never grows.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useLive, usePageData } from "../recordpage/data.tsx";
import { ago } from "../recordpage/model.ts";
import type { TypeDef } from "../recordpage/model.ts";
import { PaneEmpty } from "./Empty.tsx";
import { activityDetail, activityLine, kindOfId } from "./model.ts";
import type { Activity } from "./model.ts";

const PAGE = 50;

export function ActivityTab({ type, recordId, def }: { type: string; recordId: string; def: TypeDef }): ReactElement {
  const data = usePageData();
  const [limit, setLimit] = useState(PAGE);
  const q = useLive("records.activity", { type, recordId, limit });
  if (q.status !== "ready") return <Text style={s.quiet} testID="pane-activity-loading">Loading</Text>;
  const entries: readonly Activity[] = q.data.entries;
  if (entries.length === 0) return <PaneEmpty icon="activity" text="Nothing yet" testID="pane-activity-empty" />;
  const now = data.now();
  const rows: ReactElement[] = [];
  for (const e of entries) {
    const detail = activityDetail(e, def, data.nameOf);
    rows.push(
      <View key={e.id} style={s.row}>
        <Row
          id={`act:${e.id}`} title={activityLine(e, def, data.nameOf)}
          leading={<View style={s.face}><Avatar name={data.nameOf(e.actor)} seedId={e.actor} kind={kindOfId(e.actor)} size={20} /></View>}
          trailing={<Text style={s.when}>{ago(e.at, now)}</Text>}
          domProps={{ title: detail }}
        />
      </View>,
    );
  }
  return (
    <View testID="pane-activity">
      {rows}
      {q.data.next !== undefined ? <Text accessibilityRole="button" testID="activity-more" onPress={() => setLimit(limit + PAGE)} style={s.more}>Show more</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { height: 32, paddingHorizontal: 6 },
  face: { marginRight: 8, width: 20, height: 20 },
  when: { fontSize: 11.5, color: "var(--ink-3)" as string },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  more: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string, padding: 12, textAlign: "center" },
});
