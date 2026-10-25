// Mount for P-L9b_02c: the real shell (title bar, rail, place sidebar, main tab strip) opened on Home with the shared Home body. ?space=personal (default) is the Personal Space page (Your Personal Space
// subtitle, Get started with four rows, no empty sections, Quick start above the Ask pill and composer docked at the foot); ?space=northwind and ?space=harbor open the team pages. Opened after mount.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { ShellHub } from "../../../apps/app/src/shell/spaces/hub.ts";
import { createSampleShell } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SamplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { homeVariantOf } from "../../../apps/app/src/shell/spaces/sample-home.tsx";
import Home from "../../../apps/app/src/places/home/index.tsx";
import { homeBSlots } from "../../../apps/app/src/places/home/sections-b/index.ts";
import { createSampleHomeB } from "../../../apps/app/src/places/home/sections-b/sample.ts";

export const title = "Shell on Home (Personal Space)";

/** The shared Home body for a Space; a Personal Space gets the personal page. */
function HomeBody({ spaceId }: { spaceId: string }): ReactNode {
  const variant = homeVariantOf(spaceId);
  const sample = useMemo(() => createSampleHomeB(variant), [variant]);
  const slots = useMemo(() => homeBSlots(sample.extras), [sample]);
  return <Home data={sample.data} top={slots.top} bottom={slots.bottom} personal={variant === "personal"} />;
}

function place(ctx: PlaceContext): ReactNode {
  if (ctx.place === "home") return <HomeBody key={ctx.spaceId} spaceId={ctx.spaceId} />;
  return <SamplePlace ctx={ctx} />;
}

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

const OPEN: Readonly<Record<string, string>> = { harbor: "hb", northwind: "nw", personal: "me" };

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  // the query and the shell are made after mount, never in the first render: the static export keeps its pre-rendered markup, so a first-render read would show a stale Space and place
  const [made, setMade] = useState<{ hub: ShellHub; theme: ReturnType<typeof createThemeController> } | null>(null);
  useEffect(() => {
    const g = globalThis as { location?: { search?: string }; document?: { documentElement?: RootLike } };
    const query = new URLSearchParams(g.location?.search ?? "");
    const openId = OPEN[query.get("space") ?? "personal"] ?? "me";
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
      <Shell hub={made.hub} theme={made.theme} renderPlace={place} />
    </View>
  );
}
