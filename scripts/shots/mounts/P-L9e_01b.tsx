// Mount for P-L9e_01b (columns, breadcrumb, list/grid toggle): the same Files screen as P-L9e_01, with ?view=grid and ?where=root (the top of Files, as the prototype opens it).
// Mount for P-L9e_01: the Files tree and list over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?subjects=1 adds the Agents and Projects folders (P-L9e_01c).
// ?where=sales|proposals|recent|starred|shared|trash|knowledge  ?sort=updated|size|kind  ?select=1 (two lines selected)  ?quicklook=1 (Quick Look on the first file)
// ?rows=10000 (the long list the scroll probe runs over)  ?menu=sort opens the sort menu on load. On a phone width the tree is a drawer, so only the list shows.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles, harbor, northwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import type { FilesState, SortKey, Where } from "../../../apps/app/src/places/files/tree/index.ts";

export const title = "Files";

const SORTS: readonly SortKey[] = ["name", "updated", "by", "size", "kind"];

function whereOf(v: string | null): Where {
  if (v === "root") return { kind: "folder", id: null };
  if (v === "recent" || v === "starred" || v === "shared" || v === "trash" || v === "knowledge") return { kind: v };
  if (v) return { kind: "folder", id: v.startsWith("fld_") ? v : `fld_${v}` };
  return { kind: "folder", id: "fld_sales" };
}

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const bulk = Math.min(20_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleFiles(space, { bulk, subjects: q.get("subjects") === "1" }), [space, bulk]);
  const initial = useMemo<Partial<FilesState>>(() => {
    const sort = SORTS.find((x) => x === q.get("sort"));
    const where: Where = space === harbor && !q.get("where") ? { kind: "folder", id: "fld_h_clients" } : whereOf(q.get("where"));
    const first = q.get("quicklook") === "1" ? "file:fil_deck" : null;
    return {
      where, view: q.get("view") === "grid" ? "grid" as const : "list" as const, ...(sort ? { sort, dir: sort === "updated" ? "desc" as const : "asc" as const } : {}),
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
