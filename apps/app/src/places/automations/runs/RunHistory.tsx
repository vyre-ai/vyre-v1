// Run history (spec 3.7, 2.13): the runs of one Automation (or agent, site, or every run you may see), newest first under Today, Yesterday and Earlier. A failed run nobody retried
// waits at the top under Needs attention with Retry step and Copy trace id on its row. The filter is a quiet menu in the header. Every item is 44 px tall, so the list virtualises
// and nothing shifts while it loads. Click opens the run chat to the side, double click in Main; right-click, the More button and Shift-F10 open the row menu.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { HISTORY, useRunsData, useScreenQuery } from "./data.tsx";
import { pressPoint, runMenu, useRunActions } from "./actions.tsx";
import { FILTERS, daySections, ago, handledIds, matchesFilter, metaLine, needsAttention, runTitle } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FilterKey, Run } from "./model.ts";
import { IconButton, QuietButton, StatusMark, moveRowFocus, webOnly } from "./parts.tsx";
import type { KeyEventLike } from "./parts.tsx";
import { RunRow } from "./RunRow.tsx";
import { each } from "./each.ts";

type ListOut = CapMap["runs.list"]["out"];

export interface RunHistoryProps {
  /** The object whose runs these are; leave out for every run in `scope`. */
  subject?: { type: "automation" | "agent" | "site" | "campaign"; id: string };
  scope?: "mine" | "subject" | "all";
  /** The Automation's current version; runs on an older one show theirs. */
  currentVersion?: number;
  selectedRunId?: string | null;
  initialFilter?: FilterKey;
}

type Item = { k: "lab"; id: string; text: string } | { k: "att"; run: Run } | { k: "run"; run: Run };
const ITEM_HEIGHT = 44;
const keyOfItem = (it: Item): string => (it.k === "lab" ? it.id : it.run.id);

export function RunHistory({ subject, scope = subject ? "subject" : "mine", currentVersion, selectedRunId = null, initialFilter = "all" }: RunHistoryProps): ReactElement {
  const data = useRunsData();
  const actions = useRunActions();
  const { element, show } = useMenu();
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const q = useScreenQuery<ListOut>(HISTORY, "runs", { scope, ...(subject ? { subject } : {}) });
  const runs: readonly Run[] = q.status === "ready" ? q.data.runs : [];
  const now = data.clock().now;
  const handled = useMemo(() => handledIds(runs), [runs]);
  const shown = useMemo(() => runs.filter((r) => matchesFilter(r, filter)), [runs, filter]);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const bad = filter === "all" ? shown.filter((r) => needsAttention(r, handled)).sort((a, b) => b.startedAt - a.startedAt) : [];
    if (bad.length) { out.push({ k: "lab", id: "lab-attention", text: "Needs attention" }); for (const r of bad) out.push({ k: "att", run: r }); }
    for (const sec of daySections(shown.filter((r) => !bad.includes(r)), now)) {
      out.push({ k: "lab", id: `lab-${sec.group}`, text: sec.group });
      for (const r of sec.runs) out.push({ k: "run", run: r });
    }
    return out;
  }, [shown, handled, filter, now]);

  const menu = (run: Run, x: number, y: number): void => show(runMenu(run, actions, data.nav, show, { x, y }, needsAttention(run, handled)), x, y, "context", { label: runTitle(run) });
  const filterMenu = (x: number, y: number): void => show([{ head: "Show" }, ...each(FILTERS, (f) => ({ label: f.label, checked: f.key === filter, onSelect: () => setFilter(f.key) }))], x, y, "other");
  const def = FILTERS.find((f) => f.key === filter)!;

  const onKey = (e: KeyEventLike & { currentTarget?: unknown; target?: unknown }): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (moveRowFocus(e.currentTarget, e.target, e.key === "ArrowDown" ? 1 : -1)) e.preventDefault?.(); }
  };

  const render = (it: Item): ReactElement => {
    if (it.k === "lab") return <View style={h.lab}><Text accessibilityRole="header" style={h.labText}>{it.text}</Text></View>;
    if (it.k === "att") {
      const r = it.run;
      return (
        <View {...webOnly({ dataSet: { row: `att:${r.id}` } })} style={h.attWrap}>
          <Row
            id={`attention-${r.id}`} title={runTitle(r)} note={`${metaLine(r)} · ${ago(r.startedAt, now)}`} selected={selectedRunId === r.id}
            onPress={() => data.nav.openRunSide(r.id)}
            leading={<StatusMark status="failed" />}
          />
          <View style={h.acts}><QuietButton label="Retry step" icon="retry" tone="accent" testID={`retry-step-${r.id}`} onPress={() => void actions.retryStep(r)} /><QuietButton label="Copy trace id" testID={`copy-trace-${r.id}`} title={r.traceId} onPress={() => actions.copy(r.traceId, "the trace id")} /><QuietButton label="Skip step" testID={`skip-step-${r.id}`} onPress={() => void actions.skipStep(r)} /><QuietButton label="Stop" tone="danger" testID={`stop-${r.id}`} onPress={() => void actions.stop(r)} /></View>
        </View>
      );
    }
    return (
      <RunRow
        run={it.run} now={now} rowKey={it.run.id} selected={selectedRunId === it.run.id} open={needsAttention(it.run, handled)} {...(currentVersion !== undefined ? { currentVersion } : {})}
        onOpen={(r) => data.nav.openRunSide(r.id)} onOpenMain={(r) => data.nav.openRun(r.id)} onRetry={(r) => void actions.retryStep(r)} onMenu={menu}
      />
    );
  };

  return (
    <View testID="run-history" accessibilityLabel="Run history" style={h.frame} {...webOnly({ onKeyDown: onKey })}>
      <View style={h.head}>
        <Text accessibilityRole="header" style={h.title}>Runs</Text>
        <View style={{ flex: 1 }} />
        <IconButton icon="filter" label="Filter the runs" testID="run-filter" onPress={(e) => { const p = pressPoint(e); filterMenu(p.x, p.y); }} />
      </View>
      {filter !== "all" ? (
        <View style={h.showing} testID="run-showing">
          <Text style={h.showText}>Showing <Text style={h.showB}>{def.showing}</Text></Text>
          <Text style={h.dim}>·</Text>
          <QuietButton label="Show all" tone="accent" onPress={() => setFilter("all")} />
        </View>
      ) : null}
      <View style={{ flex: 1, minHeight: 0 }}>
        {q.status === "loading" ? (
          <View testID="run-history-loading" style={h.skeleton}>{each([0, 1, 2, 3, 4], (i) => <View key={i} style={h.skRow} />)}</View>
        ) : items.length === 0 ? (
          <View style={h.blank} testID="run-history-empty"><Text style={h.blankText}>{filter === "all" ? "No runs yet. Run a test to see one." : "Nothing matches."}</Text></View>
        ) : (
          <VirtualList data={items} rowHeight="measure" keyOf={keyOfItem} renderItem={render} />
        )}
      </View>
      {actions.note ? <Text style={h.note} accessibilityLiveRegion="polite" testID="run-note">{actions.note}</Text> : null}
      {element}
    </View>
  );
}

export const h = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, paddingHorizontal: 20, paddingTop: 18, backgroundColor: "var(--win)" as string },
  head: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 },
  title: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  lab: { height: ITEM_HEIGHT, justifyContent: "flex-end", paddingBottom: 6, paddingHorizontal: 2 },
  labText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2, paddingLeft: 38, paddingBottom: 6 },
  attWrap: { width: "100%" },
  showing: { height: 28, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, paddingHorizontal: 2 },
  showText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  showB: { fontWeight: "600", color: "var(--ink)" as string },
  dim: { color: "var(--ink-4)" as string },
  skeleton: { paddingTop: 4 },
  skRow: { height: 32, marginBottom: 12, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  blank: { flex: 1, alignItems: "center", justifyContent: "center", padding: 48 },
  blankText: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  note: { fontSize: 12, color: "var(--ink-2)" as string, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
