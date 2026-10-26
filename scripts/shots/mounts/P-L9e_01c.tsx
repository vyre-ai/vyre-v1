// Mount for P-L9e_01c: the Files place inside the whole shell (the rail, the title bar, the shared place sidebar with the Files sidebar in it, the list), over the Northwind sample Space with the
// Agents, Projects, People and Channels folders. ?where=pj_rivera|starred|recent|shared|trash|knowledge|root (default the Rivera matter folder). The shell is opened on the Files place before it first draws, so the place and its sidebar mount once.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import type { FilesState, Where } from "../../../apps/app/src/places/files/tree/index.ts";
import { SidebarContent } from "../../../apps/app/src/shell/sidebar/index.ts";

export const title = "Files in the shell";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function whereOf(v: string | null): Where {
  if (v === "root") return { kind: "folder", id: null };
  if (v === "recent" || v === "starred" || v === "shared" || v === "trash" || v === "knowledge") return { kind: v };
  return { kind: "folder", id: v ? (v.startsWith("fld_") ? v : `fld_${v}`) : "fld_pj_rivera" };
}

function FilesBody({ initial }: { initial: Partial<FilesState> }): ReactNode {
  const sample = useMemo(() => createSampleFiles(undefined, { subjects: true }), []);
  return (
    <FilesDataProvider value={sample.data}>
      <FilesStateProvider initial={initial}>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const g = globalThis as { location?: { search?: string }; document?: { documentElement?: RootLike } };
    const query = new URLSearchParams(g.location?.search ?? "");
    const skin = query.get("skin") ?? "paper";
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go("files");
    return { hub, theme, initial: { where: whereOf(query.get("where")) } satisfies Partial<FilesState> };
  }, []);
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "files" ? <FilesBody key={ctx.spaceId} initial={made.initial} /> : samplePlace(ctx));
  return (
    <View style={{ height }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} />
    </View>
  );
}
