// Mount for lane r41-automations (19 Nov 2026): the Journey Path page and the board card faces over the sample Spaces, one part at a time.
// ?part=path | path-where | path-test | face-simple | face-detail | face-visual. Exists only in the shots build; nothing here ships.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AutomationsList } from "../../../apps/app/src/places/automations/sidebar/AutomationsList.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { ConfigExtrasProvider } from "../../../apps/app/src/places/automations/config/data.tsx";
import { createConfigSample } from "../../../apps/app/src/places/automations/config/sample.ts";
import { northwind } from "../../../apps/app/src/places/automations/sidebar/sample.ts";
import { JourneyDesigner } from "../../../apps/app/src/places/automations/journeys/JourneyDesigner.tsx";
import {
  RecordsDataProvider,
  RecordsSidebar,
  RecordsStateProvider,
} from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import {
  createViewsSample,
  northwind as recordsNorthwind,
} from "../../../apps/app/src/places/records/views-a/sample.ts";

export const title = "Journeys: the Path page and the card faces";

function PathPage({ part }: { part: string }): ReactNode {
  const s = useMemo(() => createConfigSample(northwind), []);
  const data = useMemo(
    () => ({
      ...s.data,
      call: async (cap: string, input: unknown): Promise<unknown> => {
        if (cap === "records.query")
          return {
            rows: ["Harbor Co", "Northwind Foods", "Bluebird Studio"].map((n, i) => ({
              id: `rec_${i}`,
              fields: { name: n },
            })),
          };
        if (cap === "journeys.where")
          return {
            journeyId: "jrn_onboard",
            recordId: "rec_0",
            stage: "review",
            stageTitle: "Review",
            enteredAt: 0,
            hoursIn: 60,
            completed: false,
            limitHours: 48,
            overByHours: 12,
            path: [],
          };
        if (cap === "journeys.test_path") {
          const j = (await s.data.call("journeys.get", { journeyId: "jrn_onboard" })) as {
            journey: { stages: { key: string; automations: string[] }[] };
          };
          let n = 0;
          return {
            runs: j.journey.stages.flatMap((st) =>
              st.automations.map((a) =>
                ++n === 2
                  ? { stage: st.key, automationId: a, error: "It needs a mailbox." }
                  : { stage: st.key, automationId: a, runId: `run_t${n}` },
              ),
            ),
          };
        }
        return s.data.call(cap as never, input as never);
      },
    }),
    [s],
  );
  return (
    <AutomationsDataProvider value={data as never}>
      <ConfigExtrasProvider value={s.extras}>
        <View style={{ flex: 1, minHeight: 0 }}>
          <JourneyDesigner
            journeyId="jrn_onboard"
            initialTab="path"
            {...(part === "path-where" ? { pathStart: { recordId: "rec_0", name: "Harbor Co" } } : {})}
            {...(part === "path-test" ? { pathStart: { recordId: "rec_0", name: "Harbor Co", test: true } } : {})}
          />
        </View>
      </ConfigExtrasProvider>
    </AutomationsDataProvider>
  );
}

/** The Journey next to the Automations list, as the place lays it out: the list on the left with its Journeys, the page on the right. */
function PlacePage(): ReactNode {
  const s = useMemo(() => createConfigSample(northwind), []);
  return (
    <AutomationsDataProvider value={s.data}>
      <ConfigExtrasProvider value={s.extras}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            minHeight: 0,
            backgroundColor: "var(--rail)" as string,
            gap: 8,
            paddingRight: 8,
            paddingBottom: 8,
          }}
        >
          <View style={{ width: 256, backgroundColor: "var(--side)" as string, borderRadius: 12, padding: 8 }}>
            <AutomationsList selectedId="jrn_onboard" query="" onChoose={() => undefined} />
          </View>
          <View
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              backgroundColor: "var(--win)" as string,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <JourneyDesigner journeyId="jrn_onboard" initialTab="path" canDesign />
          </View>
        </View>
      </ConfigExtrasProvider>
    </AutomationsDataProvider>
  );
}

function FacePage({ preset }: { preset: "simple" | "detail" | "visual" }): ReactNode {
  const sample = useMemo(() => {
    const space = {
      ...recordsNorthwind,
      types: recordsNorthwind.types.map((t) =>
        t.key === "projects" ? ({ ...t, card: { preset, fields: ["lead", "budget", "due"] } } as typeof t) : t,
      ),
    };
    return createViewsSample(space, {});
  }, [preset]);
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={{ type: "projects" }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: 240 }}>
            <RecordsSidebar />
          </View>
          <RecordViews kind="board" />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    setPart(
      new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
        "path",
    );
  }, []);
  if (!part) return null;
  if (part === "place-journey") return <PlacePage />;
  if (part.startsWith("face-")) return <FacePage preset={part.slice(5) as "simple" | "detail" | "visual"} />;
  return <PathPage part={part} />;
}
