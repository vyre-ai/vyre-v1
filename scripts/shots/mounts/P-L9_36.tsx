// Mount for P-L9_36: the whole shell on a phone: the bottom bar, no tab strip, the header with New and "...", lists as a name and one line. ?place=files|chats|records (default files);
// ?open=1 chooses a Files folder after the first draw so the body shows. The query is read after mount (rule 25).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { chatsPlace } from "../../../apps/app/src/shell/spaces/sample-chats.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { RecordsDataProvider, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { createSampleRecords, protoNorthwindSpace } from "../../../apps/app/src/places/records/table/sample.ts";
import { SidebarContent } from "../../../apps/app/src/shell/sidebar/index.ts";

export const title = "Phone layout of the shell";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}
type Doc = { querySelector(s: string): { click?: () => void } | null };

function FilesBody(): ReactNode {
  const sample = useMemo(() => createSampleFiles(undefined, { subjects: true }), []);
  return (
    <FilesDataProvider value={sample.data}>
      <FilesStateProvider>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function RecordsBody(): ReactNode {
  const sample = useMemo(() => createSampleRecords(protoNorthwindSpace, { bulk: 0 }), []);
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={{}}>
        <View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}><RecordViews /></View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

function Phone({ q }: { q: URLSearchParams }): ReactNode {
  const raw = q.get("place");
  const place = raw === "chats" || raw === "records" ? raw : "files";
  const open = q.get("open") === "1";
  const made = useMemo(() => {
    const skin = q.get("skin") ?? "paper";
    const g = globalThis as { document?: { documentElement?: RootLike } };
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go(place);
    return { hub, theme };
  }, [q, place]);
  useEffect(() => {
    if (!open || place !== "files") return undefined;
    const t = setTimeout(() => { (globalThis as { document?: Doc }).document?.querySelector('[data-testid="row-folder-fld_agents"]')?.click?.(); }, 500);
    return () => clearTimeout(t);
  }, [open, place]);
  const renderPlace = (ctx: PlaceContext): ReactNode => {
    if (ctx.place === "files") return <FilesBody key={ctx.spaceId} />;
    if (ctx.place === "records") return <RecordsBody key={ctx.spaceId} />;
    return place === "chats" ? chatsPlace(ctx) : samplePlace(ctx);
  };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} />
    </View>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (q === null) return <View style={{ flex: 1 }} />;
  return <Phone q={q} />;
}
