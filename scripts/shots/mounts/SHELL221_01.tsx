// Mount for lane l-shell221: the real Shell (rail, sidebar slot, main sheet, right outlet) over a generic place that uses the shell's primitives the way every place does: a SidebarContent and, when asked, a SidePane.
//   ?place=chats|records|files|vault|settings|console|automations (default chats)   ?real=1 draws the real Vault, Settings and Console places in the shell instead of the generic place   ?pane=1 opens a side pane   ?nosidebar=1 a place without a sidebar
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { SidePane } from "../../../ui/src/SidePane/index.tsx";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SidebarContent } from "../../../apps/app/src/shell/sidebar/index.ts";
import { useMenu } from "../../../ui/src/Menu/index.tsx";
import type { PlaceId } from "../../../apps/app/src/shell/rail/kits.ts";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { consolePageFor } from "../../../apps/app/src/shell/providers/console.tsx";

export const title = "Shell layout";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }

function Place({ ctx, sidebar, initialPane }: { ctx: PlaceContext; sidebar: boolean; initialPane: boolean }): ReactNode {
  const [pane, setPane] = useState(initialPane);
  useEffect(() => { (globalThis as { __pane?: (on: boolean) => void }).__pane = setPane; return () => { (globalThis as { __pane?: unknown }).__pane = undefined; }; }, []);
  const { element, show } = useMenu();
  const name = ctx.place[0]!.toUpperCase() + ctx.place.slice(1);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {sidebar ? (
        <SidebarContent title={name} searchPlaceholder={`Search ${ctx.place}`}>
          {() => (
            <View style={{ padding: 10, gap: 4 }}>
              {["One", "Two", "Three", "Four"].map((n) => <Text key={n} style={{ color: "var(--ink)" as string, fontSize: 14, paddingVertical: 8, paddingHorizontal: 8 }}>{`${name} ${n}`}</Text>)}
            </View>
          )}
        </SidebarContent>
      ) : null}
      <View testID="place-main" style={{ flex: 1, minHeight: 0, alignItems: "center", paddingTop: 24 }}>
        <View testID="reading" style={{ width: "100%", maxWidth: 720, paddingHorizontal: 16, gap: 12 }}>
          <Text style={{ color: "var(--ink)" as string, fontSize: 22, fontWeight: "600" }}>{name}</Text>
          <Text style={{ color: "var(--ink-2)" as string, fontSize: 15 }}>The reading column is capped at 720 and centred inside main.</Text>
          <Pressable testID="open-pane" onPress={() => setPane(true)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", alignSelf: "flex-start", backgroundColor: "var(--accent-wash)" as string }}><Text style={{ color: "var(--accent)" as string, fontSize: 14 }}>Open the side pane</Text></Pressable>
        </View>
      </View>
      <Pressable testID="edge-menu" onPress={(e) => { const b = (e as unknown as { currentTarget: { getBoundingClientRect(): { left: number; bottom: number } } }).currentTarget.getBoundingClientRect(); show([{ label: "Rename", onSelect: () => undefined }, { label: "Duplicate a long label that needs room", onSelect: () => undefined }, { label: "Delete", onSelect: () => undefined }], b.left, b.bottom, "context", { label: "Edge menu" }); }} style={{ position: "absolute", top: 12, right: 12, height: 32, paddingHorizontal: 12, borderRadius: 12, justifyContent: "center", backgroundColor: "var(--hover)" as string }}><Text style={{ color: "var(--ink)" as string, fontSize: 14 }}>Menu</Text></Pressable>
      {element}
      <SidePane paneKey="shell221-pane" toggle={{ open: pane, onPress: () => setPane(false) }} title="Details" tabs={[{ key: "d", title: "Details" }]} activeTab="d" onCloseTab={() => setPane(false)}>
        <View style={{ padding: 16 }}><Text style={{ color: "var(--ink)" as string, fontSize: 14 }}>Side pane content</Text></View>
      </SidePane>
    </View>
  );
}

const vaultSample = createSampleVault(northwind);
const settingsSample = createSampleSettings();
const consoleSample = createSampleConsole();

function Real({ place, pane }: { place: string; pane: boolean }): ReactNode | null {
  if (place === "vault") return <View style={{ flex: 1, minHeight: 0 }}><Vault data={vaultSample.data} /></View>;
  if (place === "settings") return <SettingsDataProvider value={settingsSample.data}><View style={{ flex: 1, minHeight: 0 }}><SettingsPlace initialPage="profile" /></View></SettingsDataProvider>;
  if (place === "console") return <ConsoleDataProvider value={consoleSample.data}><View style={{ flex: 1, minHeight: 0 }}><ConsoleShell embedded initialPage="people" renderPage={(id, state) => consolePageFor(id, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
  void pane;
  return null;
}

function Inner({ search }: { search: string }): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const query = new URLSearchParams(search);
    const skin = query.get("skin") ?? "paper";
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go((query.get("place") ?? "chats") as PlaceId);
    return { hub, theme, sidebar: query.get("nosidebar") !== "1", pane: query.get("pane") === "1", real: query.get("real") === "1" };
  }, [search]);
  return <View style={{ height }}><Shell hub={made.hub} theme={made.theme} me={{ id: "usr_irfad", name: "Irfad Imtiaz" }} renderPlace={(ctx) => (made.real && Real({ place: ctx.place, pane: made.pane }) !== null ? <Real place={ctx.place} pane={made.pane} /> : <Place ctx={ctx} sidebar={made.sidebar} initialPane={made.pane} />)} /></View>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Inner search={search} />;
}
