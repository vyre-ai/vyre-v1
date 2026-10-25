// Mount for P-L9b_03: the Chats sidebar over the Northwind sample Space, or Harbor Studio with ?space=harbor, beside the (empty) conversation column. Every control works against
// the sample replica: new chat shows a row at once, star, mark read, approve, the filter menu, Cmd-1..9. All rows are drawn (no scroll window) so a screenshot shows the whole list.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, harbor, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";

export const title = "Chats sidebar";

export default function Mount(): ReactNode {
  const space = useMemo(() => {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
    return new URLSearchParams(search).get("space") === "harbor" ? harbor : northwind;
  }, []);
  const sample = useMemo(() => createSampleSidebar(space), [space]);
  const wide = useWindowDimensions().width >= 560;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ width: wide ? 272 : "100%", flexShrink: 0 }}><ChatsSidebar data={sample.data} window={{ start: 0, end: 500 }} /></View>
      {wide ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "var(--ink-4)" as string, fontSize: 13 }}>The conversation lands with P-L9b_04</Text></View> : null}
    </View>
  );
}
