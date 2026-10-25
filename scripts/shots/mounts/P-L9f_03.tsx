// Mount for P-L9f_03: the config pane of an Automation (Settings, Alerts, Runs), the Promote sheet, and the Journey designer with its pane, over the Northwind sample Space, or Harbor Studio
// with ?space=harbor. ?view= settings (default: New lead follow-up, a Space Automation, with its canvas beside the pane), alerts, runs, personal (My morning briefing), promote (its sheet open),
// share (the Share sheet open), journey (Client onboarding), stage (a stage selected), task (a task selected), migrate (the move-records sheet), new (the New Journey sheet).
// On a phone the place shows one pane at a time.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AutomationCanvas } from "../../../apps/app/src/places/automations/canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { AutomationConfig } from "../../../apps/app/src/places/automations/config/AutomationConfig.tsx";
import { ConfigExtrasProvider } from "../../../apps/app/src/places/automations/config/data.tsx";
import { Overlay } from "../../../apps/app/src/places/automations/config/Overlay.tsx";
import { createConfigSample, harbor, northwind } from "../../../apps/app/src/places/automations/config/sample.ts";
import { JourneyDesigner } from "../../../apps/app/src/places/automations/journeys/JourneyDesigner.tsx";
import type { Selection } from "../../../apps/app/src/places/automations/journeys/JourneyDesigner.tsx";
import { JourneyNewSheet } from "../../../apps/app/src/places/automations/journeys/JourneyNewSheet.tsx";
import { JourneyPane } from "../../../apps/app/src/places/automations/journeys/JourneyPane.tsx";
import { MigrateSheet } from "../../../apps/app/src/places/automations/journeys/MigrateSheet.tsx";
import { useJourney } from "../../../apps/app/src/places/automations/journeys/data.ts";
import { AutomationsSidebar } from "../../../apps/app/src/places/automations/sidebar/AutomationsSidebar.tsx";

export const title = "Automation config and Journeys";

function Migrate({ id, onClose }: { id: string; onClose(): void }): ReactNode {
  const st = useJourney(id);
  return st.journey ? <Overlay label="Move records" onClose={onClose}><MigrateSheet journey={st.journey} onClose={onClose} /></Overlay> : null;
}

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const view = q.get("view") ?? "settings";
  const sample = useMemo(() => createConfigSample(space), [space]);
  const { width, height } = useWindowDimensions();
  const phone = width < 640;
  const harborView = space.id === "harbor";
  const [sel, setSel] = useState<Selection | null>(view === "stage" ? { stage: harborView ? "shoot" : "intake" } : view === "task" ? { stage: harborView ? "shoot" : "intake", task: harborView ? "h_plan" : "t_review" } : null);
  const journeyId = harborView ? "jrn_h" : "jrn_onboard";
  const autoId = view === "personal" || view === "promote" ? "aut_brief" : harborView ? "aut_h1" : "aut_lead";
  const journeyView = ["journey", "stage", "task", "migrate", "new"].includes(view);
  const tab = view === "alerts" ? "alerts" : view === "runs" ? "runs" : "settings";

  const sidebar = <AutomationsSidebar selectedId={journeyView ? null : autoId} initialTab={journeyView ? "journeys" : "automations"} shared={sample.shared} reasons={sample.space.reasons} />;
  const body = journeyView ? (
    <>
      <View style={{ flex: 1, minWidth: 0 }}><JourneyDesigner journeyId={journeyId} selection={sel} onSelect={setSel} canDesign={view !== "viewonly"} /></View>
      {sel ? <View style={{ width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string }}><JourneyPane journeyId={journeyId} selection={sel} /></View> : null}
    </>
  ) : (
    <>
      <View style={{ flex: 1, minWidth: 0 }}><AutomationCanvas automationId={autoId} /></View>
      <View style={{ width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string }}><AutomationConfig automationId={autoId} initialTab={tab} openPromote={view === "promote"} openShare={view === "share"} /></View>
    </>
  );
  return (
    <AutomationsDataProvider value={sample.data}>
      <ConfigExtrasProvider value={sample.extras}>
        <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
          {phone ? (journeyView ? (sel ? <JourneyPane journeyId={journeyId} selection={sel} /> : <JourneyDesigner journeyId={journeyId} selection={sel} onSelect={setSel} />) : <AutomationConfig automationId={autoId} initialTab={tab} openPromote={view === "promote"} openShare={view === "share"} />) : (<>{sidebar}{body}</>)}
        </View>
        {view === "migrate" ? <Migrate id={journeyId} onClose={() => undefined} /> : null}
        {view === "new" ? <Overlay label="New Journey type" onClose={() => undefined}><JourneyNewSheet onClose={() => undefined} initialName="Hire" initialSubject="person" initialStages="Posted, Screening, Interviews, Offer, Onboarding" /></Overlay> : null}
      </ConfigExtrasProvider>
    </AutomationsDataProvider>
  );
}
