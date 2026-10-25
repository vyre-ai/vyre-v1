// Mount for P-L9f_02: run history, the run chat and Failed runs over the Northwind sample Space (the prototype's "New lead follow-up"), or Harbor Studio with ?space=harbor.
// ?view=history (default: the Runs list of New lead follow-up with the failed run's chat in the side pane), chat-ok (a succeeded run), waiting (the invoice run waiting on Maya),
// undo (a succeeded run with Undo this run open), failed (Failed runs across Automations). On a phone the place shows one pane at a time.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RunsDataProvider } from "../../../apps/app/src/places/automations/runs/data.tsx";
import { FailedRuns } from "../../../apps/app/src/places/automations/runs/FailedRuns.tsx";
import { RunChat } from "../../../apps/app/src/places/automations/runs/RunChat.tsx";
import { RunHistory } from "../../../apps/app/src/places/automations/runs/RunHistory.tsx";
import { createSampleRuns, harbor, northwind } from "../../../apps/app/src/places/automations/runs/sample.ts";

export const title = "Runs";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const view = q.get("view") ?? "history";
  const sample = useMemo(() => createSampleRuns(space), [space]);
  const { width, height } = useWindowDimensions();
  const phone = width < 640;
  const harborView = space.id === "harbor";
  const subject = { type: "automation" as const, id: harborView ? "aut_h1" : view === "waiting" ? "aut_invoice" : "aut_lead" };
  const runId = harborView ? "rh3" : view === "chat-ok" || view === "undo" ? "rl3" : view === "waiting" ? "ri1" : "rl1";
  const history = <RunHistory subject={subject} currentVersion={harborView ? 2 : view === "waiting" ? 4 : 5} selectedRunId={runId} />;
  const chat = <RunChat runId={runId} initialUndo={q.get("undo") === "1"} />;
  return (
    <RunsDataProvider value={sample.data}>
      <View style={{ height, backgroundColor: "var(--win)" as string }}>
        {view === "failed" ? (
          <FailedRuns />
        ) : phone ? (
          view === "history" ? history : chat
        ) : (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ flex: 1, minWidth: 0 }}>{history}</View>
            <View style={{ width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string }}>{chat}</View>
          </View>
        )}
      </View>
    </RunsDataProvider>
  );
}
