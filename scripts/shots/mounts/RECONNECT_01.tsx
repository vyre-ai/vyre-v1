// Mount for lane f-desktop (12 Nov): the top bar while the Space server is unreachable. ?part=before (what the app showed: nothing), after (Reconnecting…), waiting (with queued changes).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { TitleBar } from "../../../apps/app/src/shell/titlebar/TitleBar.tsx";

export const title = "Top bar while reconnecting";

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  const width = useWindowDimensions().width;
  useEffect(() => { setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "after"); }, []);
  if (!part) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--rail)" as string }}>
      <TitleBar title="Vyre, Northwind, Chats" online={part === "before"} waiting={part === "waiting" ? 2 : 0} onOpenWaiting={() => undefined} onSearch={() => undefined} compact={width < 640} />
      <View style={{ flex: 1, padding: 24, backgroundColor: "var(--win)" as string }}><Text style={{ color: "var(--ink-3)" as string, fontSize: 13 }}>The place under the bar.</Text></View>
    </View>
  );
}
