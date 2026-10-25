// Mount for P-L9d_07: the Schema map and the Record types list over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?part=map (default)  ?select=projects lights that type's links  ?expand=clients shows all of that card's fields.  ?part=types is the read-only Record types list.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { RecordTypesList, SchemaDataProvider, SchemaMap } from "../../../apps/app/src/places/records/schemamap/index.ts";
import { createSampleSchema, harbor, northwind } from "../../../apps/app/src/places/records/schemamap/sample.ts";

export const title = "Records: Schema map and Record types";

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const sample = useMemo(() => createSampleSchema(q.get("space") === "harbor" ? harbor : northwind, { withSynced: q.get("part") === "types" }), [q]);
  const select = q.get("select");
  const expand = q.get("expand");
  return (
    <SchemaDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}>
        {q.get("part") === "types" ? <RecordTypesList /> : <SchemaMap details={sample.details} selected={select} expanded={expand ? [expand] : []} />}
      </View>
    </SchemaDataProvider>
  );
}

/** The query is read after the page is live (the static export keeps the markup it was rendered with), so the mount draws once the query is known. */
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
