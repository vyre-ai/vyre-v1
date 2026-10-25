// Mount for P-L9_14: the whole shell (title bar, rail with the Space tile, main tabs, the open place) over the Northwind sample Space, or Harbor Studio with
// ?space=harbor. Every control works: switch Space (the tile menu or Shift-Cmd-1..3), open tabs, the skin dropdown, the keys.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";

export const title = "Shell";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const g = globalThis as { location?: { search?: string }; document?: { documentElement?: RootLike } };
    const query = new URLSearchParams(g.location?.search ?? "");
    const openId = query.get("space") === "harbor" ? "hb" : "nw";
    const skin = query.get("skin") ?? "paper";
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    // every Space starts on the skin the screenshot asks for, so both skins can be compared
    const theme = createThemeController({ personId: "irfad", spaceId: openId, spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    return { hub: createSampleShell({ openId, theme }), theme };
  }, []);
  return (
    <View style={{ height }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={samplePlace} />
    </View>
  );
}
