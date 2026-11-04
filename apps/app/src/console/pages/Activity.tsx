// Console > Agents > Activity: every run in the Space (runs.list, scope all) under All, Active, Waiting and Failed and stopped, each with its status. A run opens to its steps (runs.get, runs.steps)
// with Stop for a run still going and Retry for one that ended badly. People's own agents are counted, never listed: the backend folds those runs out of this list, and the last section says how many ran.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ago } from "../shell/format.ts";
import { Group, Section, StatusLabel } from "../shell/ui.tsx";
import { Actions, Button, Note, ReadState, Segmented, useAction, useRead } from "./shared.tsx";

type Run = CapMap["runs.list"]["out"]["runs"][number];
type Status = Run["status"];

export type RunTab = "all" | "active" | "waiting" | "failed";
const ACTIVE: readonly Status[] = ["queued", "running", "waiting"];
const STATUS_WORD: Record<Status, string> = { queued: "Queued", running: "Running", waiting: "Waiting", succeeded: "Succeeded", failed: "Failed", stopped: "Stopped" };
const WAIT_WORD: Record<string, string> = { approval: "for approval", background: "for a background task", key: "for a key" };

/** Which tab a run counts under. */
export function inTab(run: Run, tab: RunTab): boolean {
  return tab === "all" || (tab === "active" && ACTIVE.includes(run.status)) || (tab === "waiting" && run.status === "waiting") || (tab === "failed" && (run.status === "failed" || run.status === "stopped"));
}
/** The status of a run in words: "Waiting for approval". */
export const statusWords = (run: Pick<Run, "status" | "waitReason">): string => `${STATUS_WORD[run.status]}${run.status === "waiting" && run.waitReason ? ` ${WAIT_WORD[run.waitReason] ?? ""}`.trimEnd() : ""}`;
/** The one line about people's own agents. The people are counted, never named. */
export function ownAgentsLine(runs: number, people: number): string {
  return `${runs} ${runs === 1 ? "run" : "runs"} today by ${people} ${people === 1 ? "person's" : "people's"} own agents`;
}
const kindWord = (kind: string): string => { const t = kind.replaceAll("_", " "); return `${t[0]!.toUpperCase()}${t.slice(1)}`; };

export function ActivityPage(): ReactElement {
  const data = useConsoleData();
  const list = useRead<CapMap["runs.list"]["out"]>("runs.list", { scope: "all", limit: 100 });
  const counts = useRead<CapMap["runs.people_counts"]["out"]>("runs.people_counts", {});
  const [tab, setTab] = useState<RunTab>("all");
  const [open, setOpen] = useState<string | null>(null);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const all = list.data.runs;
  const shown = all.filter((r) => inTab(r, tab));
  const n = (t: RunTab): number => all.filter((r) => inTab(r, t)).length;
  const own = counts.data?.people ?? [];
  const ownRuns = own.reduce((sum, p) => sum + p.runs, 0);
  const now = data.clock().now;
  return <View testID="console-activity">
    <Segmented value={tab} onChange={(key) => setTab(key as RunTab)} options={[{ key: "all", title: `All ${n("all")}` }, { key: "active", title: `Active ${n("active")}` }, { key: "waiting", title: `Waiting ${n("waiting")}` }, { key: "failed", title: `Failed and stopped ${n("failed")}` }]} />
    <Group testID="activity-runs">
      {shown.map((r) => <View key={r.id}>
        <Row id={`run-${r.id}`} title={r.name ?? kindWord(r.kind)} note={`${data.name(r.owner) === r.owner ? "Someone" : data.name(r.owner)} · ${ago(now, r.startedAt)}`} trailing={<StatusLabel status={statusWords(r)} />} onPress={() => setOpen(open === r.id ? null : r.id)} />
        {open === r.id ? <RunDetail run={r} onChanged={list.refresh} /> : null}
      </View>)}
      {shown.length === 0 ? <Row id="activity-none" title="No runs here" note="Runs from Space agents and automations show up as they start." /> : null}
    </Group>
    <Section title="People's own agents" testID="activity-own">
      <Group><Row id="activity-own-line" title={ownAgentsLine(ownRuns, own.length)} note="Their runs show to them in Home, under My work. Admins see the count, never the work." /></Group>
    </Section>
  </View>;
}

function RunDetail({ run, onChanged }: { run: Run; onChanged: () => void }): ReactElement {
  const detail = useRead<CapMap["runs.get"]["out"]>("runs.get", { runId: run.id });
  const steps = useRead<CapMap["runs.steps"]["out"]>("runs.steps", { runId: run.id, limit: 100 });
  const action = useAction(() => { onChanged(); detail.refresh(); steps.refresh(); });
  const status = run.status;
  const going = ACTIVE.includes(status);
  return <View testID={`run-detail-${run.id}`} style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
    {detail.data?.run.summary ? <Note>{detail.data.run.summary}</Note> : null}
    {steps.data ? (steps.data.steps.length
      ? steps.data.steps.map((st, i) => <Row key={`${st.step}-${st.attempt}-${i}`} id={`run-step-${run.id}-${i}`} title={st.step} note={`${kindWord(st.state)}${st.error ? ` · ${st.error.message}` : ""}`} />)
      : <Note>Not started</Note>) : <ReadState error={steps.error} retry={steps.refresh} />}
    <Actions>
      {going ? <Button label="Stop" testID={`run-stop-${run.id}`} danger disabled={action.busy} onPress={() => void action.run("runs.stop", { runId: run.id }, "Stopped.")} /> : <Button label="Retry" testID={`run-retry-${run.id}`} disabled={action.busy || status === "succeeded"} onPress={() => void action.run("runs.retry", { runId: run.id }, "Started again.")} />}
    </Actions>
    {action.note ? <Note>{action.note}</Note> : null}
  </View>;
}
