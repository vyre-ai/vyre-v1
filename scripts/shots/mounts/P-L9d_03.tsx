// Mount for P-L9d_03: the Records place with its Calendar, Timeline, Map and Charts over the Northwind sample Space (or Harbor Studio with ?space=harbor). Today is fixed at Oct 24, 2025.
// ?kind=calendar|timeline|map|charts  ?type=projects|tasks|clients|locations  ?menu=kind|dates|date|chart-group|chart-measure opens that header menu on load
// On a phone width the sidebar is a drawer, so only the view shows. Every control works against the sample replica; a moved bar changes its row and may propose a cascade.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { EXTRA_KINDS, TodayProvider } from "../../../apps/app/src/places/records/views-b/index.tsx";
import { TODAY, createBSample, createProtoSample, harborRich } from "../../../apps/app/src/places/records/views-b/sample.ts";
import type { BSample } from "../../../apps/app/src/places/records/views-b/sample.ts";
import { PROTO_TODAY } from "../../../apps/app/src/places/records/views-b/proto.ts";

export const title = "Records: Calendar, Timeline, Map and Charts";

// The prototype compares Calendar on Meetings and Timeline on Projects; Northwind is the shared fixtures' Space (Clients 1,240, Projects 270 ...), today Oct 24, 2026.
const DEFAULT_TYPE: Record<string, string> = { calendar: "meetings", timeline: "projects", map: "locations", charts: "projects" };

function Page({ q, northwind }: { q: URLSearchParams; northwind: BSample }): ReactNode {
  const harbor = q.get("space") === "harbor";
  const sample = useMemo(() => (harbor ? createBSample(harborRich) : northwind), [harbor, northwind]);
  const kind = q.get("kind") ?? "timeline";
  const initial = useMemo(() => ({ type: q.get("type") ?? DEFAULT_TYPE[kind] ?? "projects" }), [q, kind]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const menu = q.get("menu");
    if (!menu) return;
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="records-${menu}"]`)?.click?.(), 500);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <TodayProvider value={harbor ? TODAY : PROTO_TODAY}>
      <RecordsDataProvider value={sample.data}>
        <RecordsStateProvider initial={initial}>
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            {phone ? null : <View style={{ width: 240 }}><RecordsSidebar /></View>}
            <RecordViews kind={kind} extraKinds={EXTRA_KINDS} />
          </View>
        </RecordsStateProvider>
      </RecordsDataProvider>
    </TodayProvider>
  );
}

/** The query is read after the page is live (the static export keeps the markup it was rendered with), so the mount draws once the query is known. */
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  const [northwind, setNorthwind] = useState<BSample | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); void createProtoSample().then(setNorthwind); }, []);
  return q && northwind ? <Page q={q} northwind={northwind} /> : null;
}
