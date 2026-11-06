// Mount for lane l-shell221: the real Shell (rail, sidebar slot, main sheet, right outlet) over a generic place that uses the shell's primitives the way every place does: a SidebarContent and, when asked, a SidePane.
//   ?place=chats|records|files|vault|settings|console|automations (default chats)   ?pane=1 opens a side pane   ?nosidebar=1 a place without a sidebar
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
import type { PlaceId } from "../../../apps/app/src/shell/rail/kits.ts";

export const title = "Shell layout";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }

function Place({ ctx, sidebar, initialPane }: { ctx: PlaceContext; sidebar: boolean; initialPane: boolean }): ReactNode {
  const [pane, setPane] = useState(initialPane);
  useEffect(() => { (globalThis as { __pane?: (on: boolean) => void }).__pane = setPane; return () => { (globalThis as { __pane?: unknown }).__pane = undefined; }; }, []);
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
      <SidePane paneKey="shell221-pane" toggle={{ open: pane, onPress: () => setPane(false) }} title="Details" tabs={[{ key: "d", title: "Details" }]} activeTab="d" onCloseTab={() => setPane(false)}>
        <View style={{ padding: 16 }}><Text style={{ color: "var(--ink)" as string, fontSize: 14 }}>Side pane content</Text></View>
      </SidePane>
    </View>
  );
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
    return { hub, theme, sidebar: query.get("nosidebar") !== "1", pane: query.get("pane") === "1" };
  }, [search]);
  return <View style={{ height }}><Shell hub={made.hub} theme={made.theme} me={{ id: "usr_irfad", name: "Irfad Imtiaz" }} renderPlace={(ctx) => <Place ctx={ctx} sidebar={made.sidebar} initialPane={made.pane} />} /></View>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Inner search={search} />;
}
