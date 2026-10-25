// Mount for P-L9d_02: the Records place with its Board, Gallery and List over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?kind=board|gallery|list|table  ?type=projects|clients  ?view=vw_board (a saved view of that kind)  ?rows=2000 (more clients)  ?menu=kind|filter|fields|lanes|sort opens that header menu on load
// On a phone width the sidebar is a drawer, so only the view shows. Every control works against the sample replica; a dropped card changes its row.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { createViewsSample, harbor, northwind } from "../../../apps/app/src/places/records/views-a/sample.ts";

export const title = "Records: Board, Gallery and List";

const MENUS = ["kind", "filter", "fields", "lanes", "sort"] as const;

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const bulk = Math.min(200_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createViewsSample(space, { bulk }), [space, bulk]);
  const kind = q.get("kind") ?? "board";
  const initial = useMemo(() => ({ type: q.get("type") ?? "projects", ...(q.get("view") ? { viewId: q.get("view") as string } : {}) }), [q]);
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
          <RecordViews kind={kind} />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

/** The query is read after the page is live (the static export keeps the markup it was rendered with), so the mount draws once the query is known. */
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
