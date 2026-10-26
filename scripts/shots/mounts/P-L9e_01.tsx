// Mount for P-L9e_01: the Files tree and list over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?where=sales|proposals|recent|shared|trash|knowledge  ?sort=updated|size|kind  ?select=1 (two lines selected)  ?quicklook=1 (Quick Look on the first file)
// ?rows=10000 (the long list the scroll probe runs over)  ?menu=sort opens the sort menu on load. On a phone width the tree is a drawer, so only the list shows.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles, harbor, northwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import type { FilesState, SortKey, Where } from "../../../apps/app/src/places/files/tree/index.ts";

export const title = "Files";

const SORTS: readonly SortKey[] = ["name", "updated", "size", "kind"];

function whereOf(v: string | null): Where {
  if (v === "recent" || v === "shared" || v === "trash" || v === "knowledge") return { kind: v };
  if (v) return { kind: "folder", id: v.startsWith("fld_") ? v : `fld_${v}` };
  return { kind: "folder", id: "fld_sales" };
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const bulk = Math.min(20_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleFiles(space, { bulk }), [space, bulk]);
  const initial = useMemo<Partial<FilesState>>(() => {
    const sort = SORTS.find((x) => x === q.get("sort"));
    const where: Where = space === harbor && !q.get("where") ? { kind: "folder", id: "fld_hclients" } : whereOf(q.get("where"));
    const first = q.get("quicklook") === "1" ? "file:fil_deck" : null;
    return {
      where, ...(sort ? { sort, dir: sort === "updated" ? "desc" as const : "asc" as const } : {}),
      ...(q.get("select") === "1" ? { selection: ["file:fil_deck", "file:fil_logo"], anchor: "file:fil_deck" } : first ? { selection: [first], anchor: first } : {}), quickLook: first,
    };
  }, [q, space]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    if (q.get("menu") !== "sort") return;
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => g.document?.querySelector('[data-testid="files-sort"]')?.click?.(), 400);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <FilesDataProvider value={sample.data}>
      <FilesStateProvider initial={initial}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><FilesTree /></View>}
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

// The page reads its query after it is live (rule 25): read while rendering, the static export's pre-rendered page was swapped for the real one after hydrate, and that swap was the layout shift.
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
