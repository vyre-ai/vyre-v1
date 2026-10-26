// Mount for P-L9d_22: the Records place inside the whole shell (the rail, the title bar, the shared place sidebar with the Records sidebar in it, the Clients table), over the Northwind sample Space
// (the prototype's Northwind data). The sidebar is drawn by the slot: its Records title, collapse button and Search records field, then the types, saved views and Manage. On a phone the sidebar is the
// list and the table opens when a type is chosen. The query is read after mount (rule 25).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { RecordsDataProvider, RecordsSidebarSlot, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { TableView } from "../../../apps/app/src/places/records/table/index.ts";
import { createSampleRecords, protoNorthwindSpace } from "../../../apps/app/src/places/records/table/sample.ts";

export const title = "Records in the shell";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function RecordsBody({ type }: { type: string | null }): ReactNode {
  const sample = useMemo(() => createSampleRecords(protoNorthwindSpace, {}), []);
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={type ? { type } : {}}>
        <View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <RecordsSidebarSlot />
          <TableView view={{ sort: [{ field: "since", dir: "desc" as const }] }} />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

function Inner({ search }: { search: string }): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const query = new URLSearchParams(search);
    const skin = query.get("skin") ?? "paper";
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go("records");
    return { hub, theme, type: query.get("type") };
  }, [search]);
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "records" ? <RecordsBody key={ctx.spaceId} type={made.type} /> : samplePlace(ctx));
  return (
    <View style={{ height }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} />
    </View>
  );
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Inner search={search} />;
}
