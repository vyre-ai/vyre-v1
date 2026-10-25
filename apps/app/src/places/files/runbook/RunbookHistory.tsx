// A runbook's Runs (spec 2.16: every run is kept in History with who, where, when, exit and duration). One ui/Row per run, newest first: a dot (green exit 0, red otherwise, a spinner while
// it runs), "Block 2" or "Run all · stopped at block 2", then who, where, how it ended and how long it took; the time sits at the right. Pressing a row opens that run's output under it.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useRunbookData, useRunbookQuery } from "./data.tsx";
import { blockIds, fmtTime, isActive, newestFirst, outputText, parseRunnable, runDetail, runLabel, targetName } from "./model.ts";
import type { Parse, RunRow, TargetRow } from "./model.ts";
import { Dot, OutputPre, Spinner } from "./parts.tsx";

type Targets = CapMap["runbooks.targets"]["out"];
type RunsOut = CapMap["runbooks.runs.list"]["out"];
type GetOut = CapMap["runbooks.runs.get"]["out"];

/** The list of runs, given the runs. The viewer passes the ones it already has; History passes its own. */
export function RunsList({ runs, order, targets }: { runs: readonly RunRow[]; order: readonly string[]; targets: readonly TargetRow[] }): ReactElement {
  const data = useRunbookData();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const c = data.clock();
  const name = data.nameOf ?? ((x: string) => x);
  const rows: ReactElement[] = [];
  for (const r of newestFirst(runs)) {
    const where = targetName(r.target, targets);
    const dot = isActive(r.state) ? <Spinner size={12} /> : <Dot tone={r.exit === 0 || (r.exit === undefined && r.state === "succeeded") ? "ok" : "bad"} />;
    rows.push(
      <View key={r.runId}>
        <Row
          id={`run:${r.runId}`}
          title={runLabel(r, order)}
          note={`${name(r.by)} \u00b7 ${runDetail(r, where)}`}
          selected={open[r.runId] === true}
          leading={<View style={s.lead}>{dot}</View>}
          trailing={<Text style={s.time}>{fmtTime(r.at, c.now, c.offsetMin)}</Text>}
          onPress={() => setOpen((x) => ({ ...x, [r.runId]: !x[r.runId] }))}
        />
        {open[r.runId] === true ? <RunOutput runId={r.runId} /> : null}
      </View>,
    );
  }
  return <View accessibilityRole="list" testID="runbook-runs">{rows}</View>;
}

function RunOutput({ runId }: { runId: string }): ReactElement {
  const out = useRunbookQuery<GetOut>("output", { runId });
  const text = out.status === "ready" ? outputText(out.data.output) : "";
  return (
    <View style={s.out} testID={`run-output-${runId}`}>
      {out.status === "loading" ? <Text style={s.quiet}>Loading output</Text> : <OutputPre text={text} small />}
    </View>
  );
}

/** The History column of a runbook: its own queries, then the list. */
export function RunbookHistory({ fileId, text }: { fileId: string; text?: string }): ReactElement {
  const history = useRunbookQuery<RunsOut>("history", { fileId });
  const targets = useRunbookQuery<Targets>("targets");
  const blocks = useRunbookQuery<Parse>("blocks", { fileId });
  const order = blocks.status === "ready" ? blockIds(blocks.data.blocks) : text ? blockIds(parseRunnable(text)) : [];
  const runs = history.status === "ready" ? history.data.runs : [];
  return (
    <View testID="runbook-history">
      <Text accessibilityRole="header" style={s.head}>Runs</Text>
      {history.status === "ready" && runs.length === 0 ? <Text style={s.quiet} testID="runbook-runs-empty">Nothing has run yet</Text> : null}
      <RunsList runs={runs} order={order} targets={targets.status === "ready" ? targets.data.targets : []} />
    </View>
  );
}

const s = StyleSheet.create({
  head: { marginHorizontal: 8, marginTop: 14, marginBottom: 4, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  lead: { width: 22, alignItems: "flex-start", justifyContent: "center" },
  time: { fontSize: 12, color: "var(--ink-3)" as string },
  out: { marginHorizontal: 30, marginBottom: 6 },
  quiet: { marginHorizontal: 8, paddingVertical: 6, fontSize: 12.5, color: "var(--ink-3)" as string },
});
