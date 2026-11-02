// Mount for INBOXRAIL_01: Inbox is on the rail only once something flows in. ?view=before is the Northwind shell with nothing connected (no Inbox on the rail); ?view=after is the same
// shell a moment after the first mailbox connects (Inbox opens into its slot with its one-time tip); ?view=inbox is a saved Inbox tab with nothing connected (the connect tiles, not an
// empty Inbox); ?view=settings is Settings > Email and calendar (Northwind with mail, a calendar and a number; ?space=harbor with nothing yet, the connect tiles).
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SEED_DEFS } from "../../../apps/app/src/shell/spaces/model.ts";
import { INBOX_TIP } from "../../../apps/app/src/shell/rail/inbox-sources.ts";
import { ConnectChannel } from "../../../apps/app/src/places/inbox/connect/ConnectChannel.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, harbor, northwind } from "../../../apps/app/src/places/settings/sample.ts";

export const title = "Inbox on the rail";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function ShellView({ view, skin }: { view: string; skin: string }): ReactNode {
  const made = useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    // nothing flows into Inbox yet: the answer this device last saw
    const hub = createSampleShell({ theme, spaces: SEED_DEFS.map((d) => ({ ...d, inbox: false, counts: d.spaceId === "nw" ? { chats: 3 } : d.counts, dots: {} })) });
    if (view === "inbox") hub.go("inbox");
    return { hub, theme };
  }, [view, skin]);
  // the first mailbox connects: its change event says so, and Inbox joins the rail
  useEffect(() => {
    if (view !== "after") return undefined;
    const t = setTimeout(() => made.hub.setInbox(true, { tip: INBOX_TIP }), 60);
    return () => clearTimeout(t);
  }, [made, view]);
  const render = (ctx: PlaceContext): ReactNode => (ctx.place === "inbox" ? <View testID="inbox-place" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ConnectChannel /></View> : samplePlace(ctx));
  return <Shell hub={made.hub} theme={made.theme} renderPlace={render} />;
}

function SettingsView({ space }: { space: "northwind" | "harbor" }): ReactNode {
  const sample = useMemo(() => createSampleSettings(space === "harbor" ? harbor : northwind), [space]);
  return <SettingsDataProvider value={sample.data}><SettingsPlace initialPage="mail" /></SettingsDataProvider>;
}

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const view = q.get("view") ?? "before";
  const skin = q.get("skin") ?? "paper";
  return (
    // fills the page box: a window height read at render is 0 in the static first frame, and the default view hydrates onto it unchanged
    <View style={StyleSheet.absoluteFill}>
      {view === "settings" ? <SettingsView space={q.get("space") === "harbor" ? "harbor" : "northwind"} /> : <ShellView view={view} skin={skin} />}
    </View>
  );
}
