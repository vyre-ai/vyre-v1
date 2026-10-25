// Mount for P-L9f_01: the Automations sidebar and the Automation canvas over the Northwind sample Space (the prototype's "New lead follow-up"), or Harbor Studio with ?space=harbor.
// ?view=canvas (default), list (the sidebar alone), journeys (its Journeys tab) or panel (the canvas with a step panel open). On a phone the place shows one pane at a time.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AutomationCanvas } from "../../../apps/app/src/places/automations/canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { AutomationsSidebar } from "../../../apps/app/src/places/automations/sidebar/AutomationsSidebar.tsx";
import { createSampleAutomations, harbor, northwind } from "../../../apps/app/src/places/automations/sidebar/sample.ts";

export const title = "Automations";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const view = q.get("view") ?? "canvas";
  const sample = useMemo(() => createSampleAutomations(space), [space]);
  const { width, height } = useWindowDimensions();
  const phone = width < 640;
  const id = space.id === "harbor" ? "aut_h1" : "aut_lead";
  const sidebar = (
    <AutomationsSidebar selectedId={id} initialTab={view === "journeys" ? "journeys" : "automations"} shared={sample.shared} reasons={space.reasons} initialOpen={space.id === "harbor" ? ["space:agr_studio"] : []} />
  );
  const canvas = <AutomationCanvas automationId={id} initialSelected={space.id === "harbor" ? null : "mobile"} initialPanel={view === "panel"} />;
  return (
    <AutomationsDataProvider value={sample.data}>
      <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
        {phone ? (view === "list" || view === "journeys" ? <View style={{ flex: 1 }}>{sidebar}</View> : canvas) : (<>{sidebar}{canvas}</>)}
      </View>
    </AutomationsDataProvider>
  );
}
