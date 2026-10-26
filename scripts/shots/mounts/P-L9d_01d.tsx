// Mount for P-L9d_01d: the Records place as the prototype draws it, with the Starred group (stars.list over the sample replica), over the prototype's Northwind Space (Clients with the prototype's fields): the sidebar with every record type, and the table with
// the Table/Board switch, the filled New button and the footer aggregates. ?type=clients|projects|...  ?kind=table|board|gallery|list  ?menu=filter|sort|group|fields|colour opens that header menu on load
// ?group=status  ?space=harbor. On a phone width the sidebar is a drawer, so only the table shows.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { liveQuery } from "../../../client/src/index.ts";
import { StarredGroup } from "../../../apps/app/src/places/records/starred/index.ts";
import type { StarsOut } from "../../../apps/app/src/places/records/starred/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { createViewsSample } from "../../../apps/app/src/places/records/views-a/sample.ts";
import { PROTO_CLIENT_HIDDEN, protoHarborSpace, protoNorthwindSpace } from "../../../apps/app/src/places/records/table/sample.ts";
import type { TableViewState } from "../../../apps/app/src/places/records/table/index.ts";

export const title = "Records: last polish";

const MENUS = ["filter", "sort", "group", "fields", "colour", "kind"] as const;

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const space = q.get("space") === "harbor" ? protoHarborSpace : protoNorthwindSpace;
  const sample = useMemo(() => createViewsSample(space), [space]);
  // the prototype's Starred group: a client, a project and a meeting (stars.list over the sample replica)
  const stars = useMemo(() => {
    const out: StarsOut = { stars: [
      { resource: { type: "record", id: "cl_c1" }, title: "Elena Rivera", at: 3 },
      { resource: { type: "record", id: "projects_0" }, title: "Rivera engagement", at: 2 },
      { resource: { type: "record", id: "mt_1" }, title: "Consult \u00b7 Elena Rivera", at: 1 },
    ] };
    sample.replica.resolve("stars.list", () => out);
    return liveQuery(sample.replica, "stars.list", {});
  }, [sample]);
  const typeOf = (id: string): string | undefined => (id.startsWith("cl_") ? "clients" : id.startsWith("projects_") ? "projects" : id.startsWith("mt_") ? "meetings" : undefined);
  const initial = useMemo(() => ({ type: q.get("type") ?? "clients" }), [q]);
  const view = useMemo<Partial<TableViewState>>(() => ({
    ...(q.get("group") ? { group: q.get("group") as string } : {}),
    // the prototype's Northwind Clients open sorted by Client since, newest first, without their sealed and calculated fields
    ...(space === protoNorthwindSpace && (q.get("type") ?? "clients") === "clients" ? { sort: [{ field: "since", dir: "desc" as const }], hidden: PROTO_CLIENT_HIDDEN } : {}),
  }), [q, space]);
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
          {phone ? null : <View style={{ width: 240 }}><RecordsSidebar starred={<StarredGroup query={stars} typeOf={typeOf} onOpen={() => undefined} />} /></View>}
          <RecordViews kind={q.get("kind") ?? "table"} view={view} />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

// The page reads its query after it is live (the static export keeps the markup it was rendered with).
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
