// Mount for P-L9f_02c: the Runs tab of an Automation as the prototype lays it out. The sidebar, the Automation header with its tab strip, the run list beside the step graph, and the run
// chat in the side pane under its own tab strip. ?view=failed (default: New lead follow-up with the failed run open) or waiting (Invoice reminders, a queued run and the run waiting on Maya).
// On a phone the place shows one pane at a time: the Runs tab, or the run chat with ?pane=run.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { SidePane } from "../../../ui/src/SidePane/index.tsx";
import { AutomationCanvas } from "../../../apps/app/src/places/automations/canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { runStates } from "../../../apps/app/src/places/automations/canvas/model.ts";
import { createConfigSample, northwind } from "../../../apps/app/src/places/automations/config/sample.ts";
import { RunsDataProvider } from "../../../apps/app/src/places/automations/runs/data.tsx";
import { RunChat } from "../../../apps/app/src/places/automations/runs/RunChat.tsx";
import { RunHistory } from "../../../apps/app/src/places/automations/runs/RunHistory.tsx";
import { createSampleRuns } from "../../../apps/app/src/places/automations/runs/sample.ts";
import { AutomationsSidebar } from "../../../apps/app/src/places/automations/sidebar/AutomationsSidebar.tsx";

export const title = "Runs tab";

const PANE_TABS = [
  { key: "details", title: "Details", icon: "panel" },
  { key: "settings", title: "Settings", icon: "gear" },
  { key: "alerts", title: "Alerts", icon: "bell" },
  { key: "runs", title: "Runs", icon: "history" },
  { key: "run", title: "Run", icon: "hourglass" },
] as const;

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const view = q.get("view") === "waiting" ? "waiting" : "failed";
  const config = useMemo(() => createConfigSample(northwind), []);
  const runs = useMemo(() => createSampleRuns(), []);
  const { width, height } = useWindowDimensions();
  const phone = width < 640;
  const [side, setSide] = useState(true);
  const autoId = view === "waiting" ? "aut_invoice" : "aut_lead";
  const runId = view === "waiting" ? "ri1" : "rl1";
  const states = useMemo(() => runStates(runs.replica.rows("steps").filter((s) => s["runId"] === runId).map((s) => ({ nodeId: String(s["step"]), status: String(s["state"]) }))), [runs, runId]);
  const history = <RunHistory subject={{ type: "automation", id: autoId }} currentVersion={view === "waiting" ? 4 : 5} selectedRunId={runId} />;
  const canvas = <AutomationCanvas automationId={autoId} initialTab="runs" tabBodies={{ runs: history }} run={{ id: runId, label: "this run", states }} paneOpen={side} onTogglePane={() => setSide(!side)} />;
  const chat = <RunChat runId={runId} />;
  return (
    <AutomationsDataProvider value={config.data}>
      <RunsDataProvider value={runs.data}>
        <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
          {phone ? (q.get("pane") === "run" ? chat : canvas) : (
            <>
              <AutomationsSidebar selectedId={autoId} initialTab="automations" shared={config.shared} reasons={config.space.reasons} />
              <View style={{ flex: 1, minWidth: 0 }}>{canvas}</View>
              {side ? (
                <SidePane paneKey="mount-P-L9f_02c" toggle={{ open: side, onPress: () => setSide(!side) }} tabs={PANE_TABS} activeTab="run" onSelectTab={() => undefined}>
                  {chat}
                </SidePane>
              ) : null}
            </>
          )}
        </View>
      </RunsDataProvider>
    </AutomationsDataProvider>
  );
}
