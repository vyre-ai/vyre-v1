// Mount for P-L9_22: the shared place sidebar beside a place body, with the Home sidebar inside it. Query: ?collapsed=1 starts with the sidebar collapsed (the expand button shows).
import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { HomeSidebar, HomeSidebarProvider, SAMPLE_HOME_SIDEBAR } from "../../../apps/app/src/places/home/sidebar/index.ts";
import { SidebarBack, SidebarExpand, SidebarSlot, SidebarSlotProvider, useSidebarSlot } from "../../../apps/app/src/shell/sidebar/index.ts";

export const title = "Place sidebar";

function Body() {
  const slot = useSidebarSlot();
  const show = !(slot.compact && slot.view === "list");
  return (
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
      <SidebarSlot />
      <View style={{ flex: 1, minWidth: 0, display: show ? "flex" : "none" }}>
        <SidebarBack />
        <SidebarExpand />
        <View style={{ flex: 1, padding: 32 }}><Text style={{ color: "var(--ink-3)" as string, fontSize: 13 }}>The place body goes here.</Text></View>
        <HomeSidebar />
      </View>
    </View>
  );
}

export default function Mount() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const width = useWindowDimensions().width;
  if (q === null) return <View style={{ flex: 1 }} />;
  const start = q.get("collapsed") === "1";
  const store = { getItem: () => (start ? JSON.stringify({ v: 1, collapsed: true }) : null), setItem: () => undefined };
  return (
    <SidebarSlotProvider deviceId="d1" personId="p1" spaceId="northwind" place="home" epoch={1} compact={width > 0 && width < 700} storage={store}>
      <HomeSidebarProvider value={{ data: SAMPLE_HOME_SIDEBAR, go: () => undefined, selected: "home" }}>
        <Body />
      </HomeSidebarProvider>
    </SidebarSlotProvider>
  );
}
