// The Crew pane (owner, 4 Nov 2026, prototype p-crew): the shared side pane with its own Crew tab, no agent profile above it. It replaces whatever the right side showed while it is open and gives it back when it closes.
// The overview and the peek are the ones the Chats right pane also draws; here they sit directly under the pane's title bar.
import type { ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { useCrew } from "./context.tsx";
import { CrewOverview, CrewPeek } from "./pane.tsx";

export function CrewSide({ fallback, nameOf, openHelper, narrow }: { fallback: ReactElement | null; nameOf: (id: string) => string; openHelper: (threadId: string) => void; narrow: boolean }): ReactElement | null {
  const crew = useCrew();
  if (!crew || !crew.open || !crew.status || crew.status.members.length === 0 || !crew.call) return fallback;
  const sel = crew.selected !== null ? crew.status.members.find((m) => m.id === crew.selected) : undefined;
  return (
    <View testID="crew-side" style={narrow ? ({ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, backgroundColor: "var(--win)" } as object) : { minHeight: 0 }}>
      <SidePane paneKey="chats-crew" toggle={{ open: true, onPress: crew.close }} title="Crew" tabs={[{ key: "crew", title: "Crew" }]} activeTab="crew" onCloseTab={crew.close} defaultWidth={340}>
        <ScrollView style={{ flex: 1 }}>
          {sel
            ? <CrewPeek member={sel} call={crew.call} nameOfId={nameOf} onBack={() => crew.show(null)} onOpenChat={openHelper} onRefresh={crew.refresh} />
            : <CrewOverview status={crew.status} call={crew.call} threadId={crew.threadId} onPeek={(id) => crew.show(id)} onRefresh={crew.refresh} />}
        </ScrollView>
      </SidePane>
    </View>
  );
}
