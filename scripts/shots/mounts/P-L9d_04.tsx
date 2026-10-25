// Mount for P-L9d_04: a record page over the Northwind sample Space (or Harbor Studio with ?space=harbor). Elena Rivera (cl_0) opens by default.
// ?type=clients|projects  ?id=cl_0  ?map=1 (the relationship map)  ?tab=activity|comments|chat|files|memory|history (the right pane's tab)  ?pane=0 shuts the pane  ?all=1 shows empty fields
// ?edit=phone starts that field open with ?text=...  The page reads its query after it is live (the static export keeps the markup it was rendered with).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { RecordPage, RecordPageDataProvider } from "../../../apps/app/src/places/records/recordpage/index.ts";
import type { PaneKey, RecordPageStart } from "../../../apps/app/src/places/records/recordpage/index.ts";
import { createSamplePage, harbor, northwind } from "../../../apps/app/src/places/records/recordpage/sample.ts";

export const title = "Records: the record page";

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSamplePage(space), [space]);
  const start = useMemo<RecordPageStart>(() => ({
    ...(q.get("map") === "1" ? { map: true } : {}), ...(q.get("pane") === "0" ? { pane: false } : q.get("pane") === "1" ? { pane: true } : {}), ...(q.get("tab") ? { tab: q.get("tab") as PaneKey } : {}),
    ...(q.get("all") === "1" ? { all: true } : {}), ...(q.get("edit") ? { edit: { key: q.get("edit") as string, text: q.get("text") ?? "" } } : {}),
  }), [q]);
  return (
    <RecordPageDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}><RecordPage type={q.get("type") ?? "clients"} recordId={q.get("id") ?? "cl_0"} start={start} /></View>
    </RecordPageDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
