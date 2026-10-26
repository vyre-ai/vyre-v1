// Mount for P-L9_23: the two screens the real shell now opens, drawn over the whole shell (title bar, rail, tabs, the Files place) so placement and dimming can be compared with the prototype.
// ?part=cmdk is the Cmd-K sheet as it opens (empty query, Recent); ?part=newtab is the new-tab page (the same search inline in a "+" tab). ?skin= picks the skin, as in the shell mount.
// The search data is the Northwind sample in the shape the real SessionGate builds in cmdk/gate.ts.
import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { CmdK, NewTabSearch } from "../../../apps/app/src/shell/cmdk/index.ts";
import { createSampleData } from "../../../apps/app/src/shell/cmdk/sample.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";

export const title = "Cmd-K and new tab";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

const data = createSampleData({ serverDelayMs: 30 }).data;

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
    const part = query.get("part") ?? "cmdk";
    hub.go(part === "newtab" ? "home" : "files");
    if (part === "newtab") hub.newTab();
    return { hub, theme, part };
  }, []);
  return (
    <Fragment>
      <View style={{ height }}>
        <Shell hub={made.hub} theme={made.theme} renderPlace={samplePlace} renderNewTab={() => <NewTabSearch data={data} />} />
      </View>
      {made.part === "cmdk" ? <CmdK data={data} /> : null}
    </Fragment>
  );
}
