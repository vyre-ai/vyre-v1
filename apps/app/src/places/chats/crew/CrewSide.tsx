// The Crew pane (owner, 4 Nov 2026, prototype p-crew): the shared side pane with its own Crew tab, no agent profile above it. It replaces whatever the right side showed while it is open and gives it back when it closes.
// The overview and the peek are the ones the Chats right pane also draws; here they sit directly under the pane's title bar.
import type { ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { useCrew } from "./context.tsx";
import { CrewOverview } from "./pane.tsx";
import { HelperPane } from "../session/HelperPane.tsx";
import type { TerminalData } from "../terminal/data.ts";

export function CrewSide({ fallback, nameOf, openHelper, narrow, terminal }: { fallback: ReactElement | null; nameOf: (id: string) => string; openHelper: (threadId: string) => void; narrow: boolean; /** Where a helper's terminal tab opens; left out where the shell has no terminal */ terminal?: TerminalData }): ReactElement | null {
  const crew = useCrew();
  if (!crew || !crew.open || !crew.status || crew.status.members.length === 0 || !crew.call) return fallback;
  const sel = crew.selected !== null ? crew.status.members.find((m) => m.id === crew.selected) : undefined;
  const body = sel
    ? <HelperPane member={sel} call={crew.call} nameOfId={nameOf} {...(terminal ? { terminal } : {})} onBack={() => crew.show(null)} onOpenChat={(id) => { if (narrow) crew.close(); openHelper(id); }} onRefresh={crew.refresh} />
    : <CrewOverview status={crew.status} call={crew.call} threadId={crew.threadId} onPeek={(id) => crew.show(id)} onRefresh={crew.refresh} />;
  // on a phone the Crew pane is a screen of its own, the full width, with its own title bar and a close
  if (narrow) {
    return (
      <View testID="crew-side" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, backgroundColor: "var(--win)" } as object}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 44, paddingHorizontal: 14 }}>
          <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: "var(--ink)" as string }}>Crew</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Crew" testID="crew-side-close" onPress={crew.close} style={{ padding: 8 }}><Text style={{ fontSize: 16, color: "var(--ink-3)" as string }}>✕</Text></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }}>{body}</ScrollView>
      </View>
    );
  }
  return (
    <View testID="crew-side" style={{ minHeight: 0 }}>
      <SidePane paneKey="chats-crew" toggle={{ open: true, onPress: crew.close }} title="Crew" tabs={[{ key: "crew", title: "Crew" }]} activeTab="crew" onCloseTab={crew.close} defaultWidth={340}>
        <ScrollView style={{ flex: 1 }}>{body}</ScrollView>
      </SidePane>
    </View>
  );
}
