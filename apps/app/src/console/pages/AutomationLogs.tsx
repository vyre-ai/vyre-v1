// Two Console pages that left the Automations place: the Event log (what the Space's event log recorded, with each event's run and Automation) and Automation usage (outcomes across every Automation). They draw the
// same views the Automations place had, on the same reads; the Console lists them only to a person the server lets read the audit log, so a member who types the address gets the Console's own no-access state.
import type { ReactElement, ReactNode } from "react";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import { SpaceAnalytics } from "../../places/automations/operations/AnalyticsView.tsx";
import { LiveEvents } from "../../places/automations/operations/EventsView.tsx";
import { automationsData } from "../../shell/providers/automations.tsx";
import { useOptionalShellRuntime } from "../../shell/providers/runtime.tsx";

function WithAutomations({ children }: { children: ReactNode }): ReactElement | null {
  const rt = useOptionalShellRuntime();
  if (!rt) return null;
  const data = automationsData(rt, {
    openAutomation: (id) => rt.open({ subject: { type: "automation", id } }),
    openJourney: (id) => rt.open({ subject: { type: "journey", id } }),
    openFailedRuns: () => rt.open({ screen: "automations" }),
    openRun: (runId) => rt.open({ subject: { type: "run", id: runId } }),
    ask: (id) => rt.open({ subject: { type: "automation", id } }),
    connect: () => rt.open({ screen: "automations" }),
  });
  return <AutomationsDataProvider value={data}>{children}</AutomationsDataProvider>;
}

export function EventLogPage(): ReactElement {
  return (
    <WithAutomations>
      <LiveEvents />
    </WithAutomations>
  );
}

export function AutomationUsagePage(): ReactElement {
  return (
    <WithAutomations>
      <SpaceAnalytics />
    </WithAutomations>
  );
}
