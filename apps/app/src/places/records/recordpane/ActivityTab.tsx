// Right pane > Activity: what happened to this record, newest first, from the log (records.activity): created, who changed which field, stage moves, links, Trash, sync pushes. It is the shared Timeline: one line each,
// the person or agent as a face, the time at the right; the old and new value open under the line.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Timeline } from "../../../../../../ui/src/Timeline/index.tsx";
import { actionTimeline } from "../../../../../../lib/words/timeline.ts";
import { useLive, usePageData } from "../recordpage/data.tsx";
import type { TypeDef } from "../recordpage/model.ts";
import { PaneEmpty } from "./Empty.tsx";
import { activityDetail, activityLine } from "./model.ts";
import type { Activity } from "./model.ts";

const PAGE = 50;

export function ActivityTab({ type, recordId, def }: { type: string; recordId: string; def: TypeDef }): ReactElement {
  const data = usePageData();
  const [limit, setLimit] = useState(PAGE);
  const q = useLive("records.activity", { type, recordId, limit });
  if (q.status !== "ready")
    return (
      <Text style={s.quiet} testID="pane-activity-loading">
        Loading
      </Text>
    );
  const entries: readonly Activity[] = q.data.entries;
  if (entries.length === 0) return <PaneEmpty icon="activity" text="Nothing yet" testID="pane-activity-empty" />;
  const lines = entries.map((e) => {
    const d = activityDetail(e, def, data.nameOf).split("\n")[0]!;
    return {
      id: e.id,
      at: e.at,
      ...(e.actor === "" ? {} : { by: e.actor }),
      text: activityLine(e, def, data.nameOf),
      ...(e.field !== undefined ? { detail: d } : {}),
    };
  });
  return (
    <View testID="pane-activity">
      <Timeline entries={actionTimeline(lines)} nameOf={data.nameOf} now={data.now()} testID="record-timeline" />
      {q.data.next !== undefined ? (
        <Text accessibilityRole="button" testID="activity-more" onPress={() => setLimit(limit + PAGE)} style={s.more}>
          Show more
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  quiet: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  more: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string, padding: 12, textAlign: "center" },
});
