// Mount for P-L9d_03: the Records place with its Calendar, Timeline, Map and Charts over the Northwind sample Space (or Harbor Studio with ?space=harbor). Today is fixed at Oct 24, 2025.
// ?kind=calendar|timeline|map|charts  ?type=projects|tasks|clients|locations  ?menu=kind|dates|date|chart-group|chart-measure opens that header menu on load
// On a phone width the sidebar is a drawer, so only the view shows. Every control works against the sample replica; a moved bar changes its row and may propose a cascade.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { EXTRA_KINDS, TodayProvider } from "../../../apps/app/src/places/records/views-b/index.tsx";
import { TODAY, createBSample, harborRich, northRich } from "../../../apps/app/src/places/records/views-b/sample.ts";

export const title = "Records: Calendar, Timeline, Map and Charts";

const DEFAULT_TYPE: Record<string, string> = { calendar: "projects", timeline: "tasks", map: "locations", charts: "projects" };

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const space = q.get("space") === "harbor" ? harborRich : northRich;
  const sample = useMemo(() => createBSample(space), [space]);
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
    <TodayProvider value={TODAY}>
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
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
