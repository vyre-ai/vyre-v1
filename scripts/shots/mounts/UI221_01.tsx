// Mount for lane l-ui221: the real Chats sidebar, the thread-replies channel in the middle and its Thread pane on the right. ?part= as THREADREPLIES_01 (thread, long); ?name= renames the channel; ?dex=1 calls the lead agent Dex.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import Threads from "./THREADREPLIES_01.tsx";

export const title = "Three panes";

export default function Mount(): ReactNode {
  const phone = useWindowDimensions().width < 640;
  const data = useMemo(() => createSampleSidebar(northwind).data, []);
  if (phone) return <Threads />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View testID="real-sidebar" style={{ width: 272, minWidth: 272 }}><ChatsSidebar data={data} window={{ start: 0, end: 500 }} /></View>
      <View style={{ flex: 1, minWidth: 0 }}><Threads /></View>
    </View>
  );
}
