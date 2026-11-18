// What the Automations place mounts beyond the canvas: the config directory (who can be picked), the runs data, run history on an automation, Failed runs, a run in Main or the side,
// and the Journey designer with its pane and the new Journey sheet. All of it reads the Space's runtime; nothing here invents a row.
import { RunsList } from "../../places/automations/screens/RunsList.tsx";
import { RunPage } from "../../places/automations/screens/RunPage.tsx";
import { ResizableColumn } from "../../../../../ui/src/SidePane/resize.tsx";
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { ConfigDirectory, ConfigExtras } from "../../places/automations/config/data.tsx";
import type { AutomationsNav } from "../../places/automations/canvas/data.tsx";
import { JourneyDesigner, JourneyNewSheet, JourneyPane } from "../../places/automations/journeys/index.ts";
import type { Selection } from "../../places/automations/journeys/index.ts";
import { FailedRuns, RunChat } from "../../places/automations/runs/index.ts";
import type { RunsData } from "../../places/automations/runs/index.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { nameOf } from "./misc-common.ts";
import { directoryFrom, useDirectory } from "./automations-directory.ts";

export { directoryFrom, useDirectory };

export function configExtras(
  directory: ConfigDirectory,
  nav: Pick<AutomationsNav, "openAutomation"> & {
    openRuns(id: string): void;
    openRecords?(recordType: string, stage?: string): void;
  },
): ConfigExtras {
  return {
    directory,
    ...(nav.openRecords ? { openRecords: nav.openRecords } : {}),
    openAutomation: nav.openAutomation,
    openRuns: nav.openRuns,
  };
}

export function runsData(
  rt: ShellRuntime,
  nav: {
    openAutomation(id: string, stepId?: string): void;
    openRun(id: string): void;
    openRunSide(id: string): void;
    openTaskSide?(id: string): void;
    ask(id: string, ctx?: Record<string, unknown>): void;
  },
): RunsData {
  return {
    screens: rt.screens,
    thread: (threadId) =>
      rt.screens.query("chats.conversation", "messages", { threadId }) as unknown as ReturnType<RunsData["thread"]>,
    call: rt.call,
    me: { id: rt.me.id, name: rt.me.name },
    name: nameOf(rt),
    nav,
    clock: () => ({ now: rt.clock().now }),
  };
}

/** The Runs tab of an automation: its run history, newest first, with the menu on every row. */
export function AutomationRuns({
  automationId,
}: {
  automationId: string;
  selectedRunId?: string | null;
}): ReactElement {
  return <RunsList automationId={automationId} />;
}

export function FailedView({ selectedRunId }: { selectedRunId: string | null }): ReactElement {
  return <FailedRuns scope="mine" selectedRunId={selectedRunId} />;
}

export function RunView({ runId }: { runId: string }): ReactElement {
  return <RunPage runId={runId} />;
}

/** The Journey designer with the pane of the stage or task chosen in it. */
export function JourneyView({ journeyId }: { journeyId: string }): ReactElement {
  const [selection, setSelection] = useState<Selection | null>(null);
  return (
    <View testID="journey-view" style={j.row}>
      <View style={j.main}>
        <JourneyDesigner key={journeyId} journeyId={journeyId} selection={selection} onSelect={setSelection} />
      </View>
      {selection ? (
        <ResizableColumn paneKey="journey-pane" defaultWidth={360} grow="left" min={280} style={j.pane as never}>
          <JourneyPane journeyId={journeyId} selection={selection} />
        </ResizableColumn>
      ) : null}
    </View>
  );
}

export function JourneyNewView({ onClose }: { onClose(): void }): ReactElement {
  return (
    <View style={j.sheet}>
      <JourneyNewSheet onClose={onClose} />
    </View>
  );
}

const j = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minWidth: 0 },
  main: { flex: 1, minWidth: 0 },
  pane: { width: 360, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  sheet: { flex: 1, padding: 24, alignItems: "flex-start" },
});
