// Mount for P-L9b_03c: the Chats list over Northwind (default) or Harbor Studio (?space=harbor): Needs you as one row with its requests, agents that wait on you, dim channels.
// The query is read after mount (the static export keeps the first frame's markup).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, harbor, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";

export const title = "Chats list";

export default function Mount(): ReactNode {
  const [space, setSpace] = useState(northwind);
  useEffect(() => {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
    if (new URLSearchParams(search).get("space") === "harbor") setSpace(harbor);
  }, []);
  const sample = useMemo(() => createSampleSidebar(space), [space]);
  const wide = useWindowDimensions().width >= 560;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ width: wide ? 272 : "100%", flexShrink: 0 }}><ChatsSidebar data={sample.data} window={{ start: 0, end: 500 }} /></View>
      {wide ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "var(--ink-4)" as string, fontSize: 13 }}>Pick a chat</Text></View> : null}
    </View>
  );
}
