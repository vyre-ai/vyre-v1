// Mount for P-L9_32: the new-tab page over the whole shell (title bar, rail, tabs): the field, then Start, Chat with, Recent, Record types and Folders, as the prototype's launcher.
// A "+" tab is open on Home. ?skin= picks the skin, as in the shell mount.
import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { NewTabPage } from "../../../apps/app/src/shell/newtab/index.ts";
import { createSampleNewTab } from "../../../apps/app/src/shell/newtab/sample.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";

export const title = "New tab";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

const data = createSampleNewTab({ serverDelayMs: 30 }).data;

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
    hub.go("home");
    hub.newTab();
    return { hub, theme };
  }, []);
  return (
    <Fragment>
      <View style={{ height }}>
        <Shell hub={made.hub} theme={made.theme} renderPlace={samplePlace} renderNewTab={() => <NewTabPage data={data} />} />
      </View>
    </Fragment>
  );
}
