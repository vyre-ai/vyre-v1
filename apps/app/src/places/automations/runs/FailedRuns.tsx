// Failed runs (spec 3.7, 2.13): every failed run of every Automation you may see that nobody retried, newest first. Each row names the Automation, what started the run, and why it failed;
// Open shows the run chat, Retry starts it again from the step that failed. A run waits here until it is retried. Same row, same menu and same keys as run history.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { FAILED, useRunsData, useScreenQuery } from "./data.tsx";
import { runMenu, useRunActions } from "./actions.tsx";
import { Glyph } from "./glyphs.tsx";
import { failedAcross, failedHeadline, runTitle } from "./model.ts";
import type { Run } from "./model.ts";
import { MainHead, moveRowFocus, webOnly } from "./parts.tsx";
import type { KeyEventLike } from "./parts.tsx";
import { RunRow } from "./RunRow.tsx";

type ListOut = CapMap["runs.list"]["out"];

export interface FailedRunsProps {
  /** mine: runs you own; all: every run you may manage. */
  scope?: "mine" | "all";
  selectedRunId?: string | null;
}

export function FailedRuns({ scope = "mine", selectedRunId = null }: FailedRunsProps): ReactElement {
  const data = useRunsData();
  const actions = useRunActions();
  const { element, show } = useMenu();
  const q = useScreenQuery<ListOut>(FAILED, "runs", { scope });
  const runs: readonly Run[] = q.status === "ready" ? q.data.runs : [];
  const now = data.clock().now;
  const { rows, automations } = useMemo(() => failedAcross(runs), [runs]);

  const subjectName = (r: Run): string => (r.subject ? data.name(r.subject.id) : "");
  const menu = (run: Run, x: number, y: number): void => show(runMenu(run, actions, data.nav, show, { x, y }, true), x, y, "context", { label: runTitle(run) });
  const onKey = (e: KeyEventLike & { currentTarget?: unknown; target?: unknown }): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (moveRowFocus(e.currentTarget, e.target, e.key === "ArrowDown" ? 1 : -1)) e.preventDefault?.(); }
  };

  return (
    <View testID="failed-runs" accessibilityLabel="Failed runs" style={f.frame} {...webOnly({ onKeyDown: onKey })}>
      <MainHead
        tile={<View aria-hidden style={f.tile}><Glyph name="warn" size={15} color="var(--danger)" /></View>}
        title="Failed runs" {...(q.status === "ready" ? { meta: failedHeadline(rows.length, automations) } : {})}
      />
      <View style={f.col}>
        {q.status === "loading" ? (
          <View testID="failed-runs-loading" style={{ paddingTop: 22 }}>{[0, 1, 2].map((i) => <View key={i} style={f.skRow} />)}</View>
        ) : rows.length === 0 ? (
          <View style={f.blank} testID="failed-runs-empty">
            <View aria-hidden style={f.big}><Glyph name="check" size={24} color="var(--ok)" /></View>
            <Text style={f.blankHead}>All clear</Text>
            <Text style={f.blankText}>Nothing failed. A failed run waits here until you retry it.</Text>
          </View>
        ) : (
          <VirtualList
            data={rows} rowHeight={44} keyOf={(r) => r.id}
            renderItem={(r) => {
              const run = r as Run;
              return (
                <RunRow
                  run={run} now={now} rowKey={run.id} selected={selectedRunId === run.id} open title={`${subjectName(run)} · ${runTitle(run)}`}
                  onOpen={(x) => data.nav.openRunSide(x.id)} onOpenMain={(x) => data.nav.openRun(x.id)} onRetry={(x) => void actions.retryStep(x)} onMenu={menu}
                />
              );
            }}
          />
        )}
      </View>
      {actions.note ? <Text style={f.note} accessibilityLiveRegion="polite" testID="run-note">{actions.note}</Text> : null}
      {element}
    </View>
  );
}

const f = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  col: { flex: 1, minHeight: 0, width: "100%", maxWidth: 820, alignSelf: "center", paddingHorizontal: 28, paddingTop: 22 },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--danger) 14%, transparent)" as string },
  skRow: { height: 32, marginBottom: 12, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  blank: { alignItems: "center", paddingTop: 60, gap: 10 },
  big: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  blankHead: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  blankText: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center", maxWidth: 360 },
  note: { fontSize: 12, color: "var(--ink-2)" as string, padding: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
