// Mount for the tab rules in the real shell (lane l-chrome2a): Northwind's shell with its own hub and tab controller, tabs made the way the app makes them: a place opened twice, chats opened and
// named, and New chat pressed while a blank chat is open. The strip, the rail and the page are the app's.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";

export const title = "Tabs in the shell";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }

export default function Mount(): ReactNode {
  const skin = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("skin") ?? "paper";
  const made = useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ theme });
    hub.go("files");
    hub.go("chats");
    hub.go("chats");                                           // Chats again: still one Chats tab
    hub.go("chats", "subject=thread:thr_1");
    hub.retitle("chats:subject=thread:thr_1", "Renewal letter for the Rivera account");
    hub.go("chats", "subject=thread:thr_2");
    hub.retitle("chats:subject=thread:thr_2", "Intake call notes");
    hub.go("chats", "subject=thread:thr_3");
    hub.retitle("chats:subject=thread:thr_3", "New chat", true);
    hub.newTab();                                              // New chat while a blank chat is open: it goes to that tab, no second one
    hub.go("records");
    return { hub, theme };
  }, [skin]);
  return <View style={StyleSheet.absoluteFill}><Shell hub={made.hub} theme={made.theme} renderPlace={samplePlace} /></View>;
}
