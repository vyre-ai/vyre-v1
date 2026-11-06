// Mount for lane l-ui221: the thread-replies sample (the channel in the middle, its Thread pane on the right) with a 260 px stand-in for the Chats sidebar on the left, so the three-pane widths are the real ones. ?part= as THREADREPLIES_01 (thread, long).
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import Threads from "./THREADREPLIES_01.tsx";

export const title = "Three panes";

export default function Mount(): ReactNode {
  const phone = useWindowDimensions().width < 640;
  if (phone) return <Threads />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View testID="standin-sidebar" style={{ width: 260, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, padding: 16 }}><Text style={{ color: "var(--ink-3)" as string, fontSize: 12.5 }}>Sidebar</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}><Threads /></View>
    </View>
  );
}
