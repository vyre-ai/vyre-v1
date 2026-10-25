// Mount for P-L9_19c: the shell opened on Home, with the real Home body in the place (greeting, Needs you with its action buttons, My work groups, Quick start, the Ask box)
// instead of the sample rows. ?space=harbor and ?space=personal open the other two seeds. Home is opened after mount, so the static export's markup never fixes the place.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { ShellHub } from "../../../apps/app/src/shell/spaces/hub.ts";
import { createSampleShell } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { homePlace } from "../../../apps/app/src/shell/spaces/sample-home.tsx";

export const title = "Shell on Home";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

const OPEN: Readonly<Record<string, string>> = { harbor: "hb", personal: "me" };

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  // the query and the shell are made after mount, never in the first render: the static export keeps its pre-rendered markup, so a first-render read would show a stale Space and place
  const [made, setMade] = useState<{ hub: ShellHub; theme: ReturnType<typeof createThemeController> } | null>(null);
  useEffect(() => {
    const g = globalThis as { location?: { search?: string }; document?: { documentElement?: RootLike } };
    const query = new URLSearchParams(g.location?.search ?? "");
    const openId = OPEN[query.get("space") ?? ""] ?? "nw";
    const skin = query.get("skin") ?? "paper";
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: openId, spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId, theme });
    hub.go("home");
    // the prototype opens on one Home tab: close the Kit's start tab (Chats) that the Space opened with
    const chats = hub.session().tabs.state().tabs.find((t) => t.place === "chats");
    if (chats !== undefined) hub.closeTab(chats.key);
    setMade({ hub, theme });
  }, []);
  if (made === null) return null;
  return (
    <View style={{ height }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={homePlace} />
    </View>
  );
}
