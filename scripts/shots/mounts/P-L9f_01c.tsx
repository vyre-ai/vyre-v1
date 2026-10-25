// Mount for P-L9f_01c: the Journeys tab of the Automations sidebar with Client onboarding open beside it as the Journey detail page (header with record count, Stages, Fields and Settings tabs,
// the records-per-stage bar, numbered stages with their tasks and automations), over the Northwind sample Space. ?tab=stages (default), fields or settings. On a phone the page takes the place of the list.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { ConfigExtrasProvider } from "../../../apps/app/src/places/automations/config/data.tsx";
import { createConfigSample, northwind } from "../../../apps/app/src/places/automations/config/sample.ts";
import { JourneyDesigner } from "../../../apps/app/src/places/automations/journeys/JourneyDesigner.tsx";
import type { DesignerTab } from "../../../apps/app/src/places/automations/journeys/JourneyDesigner.tsx";
import { AutomationsSidebar } from "../../../apps/app/src/places/automations/sidebar/AutomationsSidebar.tsx";

export const title = "Journey detail";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const tab = (["stages", "fields", "settings"].includes(q.get("tab") ?? "") ? q.get("tab") : "stages") as DesignerTab;
  const sample = useMemo(() => createConfigSample(northwind), []);
  const { width, height } = useWindowDimensions();
  const phone = width < 640;
  const designer = <View style={{ flex: 1, minWidth: 0 }}><JourneyDesigner journeyId="jrn_onboard" initialTab={tab} /></View>;
  return (
    <AutomationsDataProvider value={sample.data}>
      <ConfigExtrasProvider value={sample.extras}>
        <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
          {phone ? designer : (<><AutomationsSidebar selectedJourneyId="jrn_onboard" initialTab="journeys" shared={sample.shared} reasons={sample.space.reasons} />{designer}</>)}
        </View>
      </ConfigExtrasProvider>
    </AutomationsDataProvider>
  );
}
