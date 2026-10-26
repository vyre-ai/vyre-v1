// Mount for P-L9b_22: the real Chats place (ChatsMounted over the sample Space's runtime) inside the whole shell, so its sidebar is drawn by the shared place sidebar slot (title, collapse, search
// field, and on a phone the list before the chat). ?screen=chat (default, Acme intake open) or needs (the Needs you page). The query is read after mount (rule 25), so the first frame is empty
// and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import type { Shown } from "../../../apps/app/src/places/chats/mounts/route.ts";

export const title = "Chats in the shell";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
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
    hub.go("chats");
    const sample = createMountSample();
    const shown: Shown = query.get("screen") === "needs" ? step(START, { t: "needs", taskId: "n1" }) : step(START, { t: "chat", threadId: "c1" });
    return { hub, theme, sample, shown };
  }, [search]);
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "chats"
    ? <ChatsMounted key={ctx.spaceId} rt={made.sample.rt} initial={made.shown} window={{ start: 0, end: 500 }} />
    : samplePlace(ctx));
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
