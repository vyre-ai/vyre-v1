// Mount for P-L9d_01: the Records sidebar and table over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?type=clients|companies|...  ?view=vw_active (a saved view)  ?rows=100000 (the long table the table100k budget and the scroll probe run over)
// ?menu=filter|sort|group|fields|colour opens that header menu on load  ?group=status  ?sort=value  ?find=ri
// On a phone width the sidebar is a drawer, so only the table shows. Every control works against the sample replica.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { TableView } from "../../../apps/app/src/places/records/table/index.ts";
import type { TableViewState } from "../../../apps/app/src/places/records/table/index.ts";
import { createSampleRecords, harbor, northwind } from "../../../apps/app/src/places/records/table/sample.ts";

export const title = "Records";

const MENUS = ["filter", "sort", "group", "fields", "colour"] as const;

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const bulk = Math.min(200_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleRecords(space, { bulk }), [space, bulk]);
  const initial = useMemo(() => ({ ...(q.get("type") ? { type: q.get("type") as string } : {}), ...(q.get("view") ? { viewId: q.get("view") as string } : {}) }), [q]);
  const view = useMemo<Partial<TableViewState>>(() => ({
    ...(q.get("group") ? { group: q.get("group") as string } : {}),
    ...(q.get("sort") ? { sort: [{ field: q.get("sort") as string, dir: "asc" as const }] } : {}),
    ...(q.get("find") ? { find: q.get("find") as string } : {}),
  }), [q]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const menu = MENUS.find((m) => m === q.get("menu"));
    if (!menu) return;
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="records-${menu}"]`)?.click?.(), 500);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={initial}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><RecordsSidebar /></View>}
          <TableView view={view} />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}
