// The Runs tab of the pane (spec 3.7): the ten latest runs of the Automation with the shared run row (status mark, what started it, how it went, the time), and a link to all of them in
// the main view. A failed run offers Retry on its row; the row menu is the run history's.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CONFIG, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { RunRow } from "../runs/RunRow.tsx";
import { handledIds, needsAttention } from "../runs/model.ts";
import type { Run } from "../runs/model.ts";
import { useConfigExtras } from "./data.tsx";
import { Lab } from "./parts.tsx";
import { useSaved } from "./saved.ts";

type RunsOut = CapMap["runs.list"]["out"];
const LATEST = 10;

export function RunsTab({ automationId, version }: { automationId: string; version?: number }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const saved = useSaved();
  const { element, show } = useMenu();
  const q = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, scope: "subject" });
  const runs: readonly Run[] = q.status === "ready" ? [...q.data.runs].sort((a, b) => b.startedAt - a.startedAt) : [];
  const handled = handledIds(runs);
  const now = data.clock().now;
  const latest = runs.slice(0, LATEST);

  const retry = (r: Run): void => { void saved.run("Retrying the run", () => data.call("automations.retry", { automationId, runId: r.id })); };
  const menu = (r: Run, x: number, y: number): void => show([
    { label: "Open to the Side", onSelect: () => data.nav.openRun(r.id) },
    ...(needsAttention(r, handled) ? [{ label: "Retry", onSelect: () => retry(r) }] : []),
    { label: "Copy Trace Id", onSelect: () => void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(r.traceId) },
  ], x, y, "context", { label: r.name ?? "Run" });

  return (
    <View testID="runs-tab" accessibilityLabel="Runs" style={t.body}>
      <Lab first>Latest runs</Lab>
      {q.status === "loading" ? <Text style={t.dim}>Loading</Text> : latest.length === 0 ? <Text testID="runs-empty" style={t.dim}>None yet.</Text> : (
        <View testID="runs-list">
          {each(latest, (r) => (
            <RunRow
              key={r.id} run={r} now={now} rowKey={r.id} open={needsAttention(r, handled)} {...(version !== undefined ? { currentVersion: version } : {})}
              onOpen={(x) => data.nav.openRun(x.id)} onRetry={retry} onMenu={menu}
            />
          ))}
        </View>
      )}
      <View style={t.more}><TextButton label="All runs in the main view" icon="open" primary={false} testID="all-runs" onPress={() => (extras.openRuns ? extras.openRuns(automationId) : latest[0] ? data.nav.openRun(latest[0].id) : undefined)} /></View>
      {saved.note ? <Text testID="saved-note" accessibilityLiveRegion="polite" style={[t.note, saved.note.failed && { color: "var(--danger)" as string }]}>{saved.note.text}</Text> : null}
      {element}
    </View>
  );
}

const t = StyleSheet.create({
  body: { paddingHorizontal: 8, paddingBottom: 24 },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
  more: { flexDirection: "row", marginTop: 8, paddingHorizontal: 8 },
  note: { fontSize: 12, color: "var(--ink-2)" as string, padding: 10 },
});
