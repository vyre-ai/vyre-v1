// Mount for RUNVIEWS_01 (lane r42-subagents, 19 Nov 2026): the pieces around a delegated run on sample data in the runtime's shapes: the board, the lines between helpers with a dependency, the sleeping line, the token report, the
// Space's running-and-asleep list and the @name menu. The real components.
import { useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { ACTIVITY, BOARD, MESSAGES, NODES } from "../../../apps/app/src/places/chats/crew/run/fixtures.ts";
import {
  ActivityList,
  AtMenu,
  BoardView,
  DependencyLine,
  MessageLines,
  SleepLine,
  TokenReport,
} from "../../../apps/app/src/places/chats/crew/run/views.tsx";

export const title = "Around a run";

const when = (ts: number): string =>
  new Date(ts).toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
const Card = ({ label, children, id }: { label: string; children: ReactNode; id: string }): ReactNode => (
  <View testID={id} style={{ padding: 14, borderRadius: 14, backgroundColor: "var(--raised)" as string, gap: 6 }}>
    <Text style={{ fontSize: 11, color: "var(--ink-4)" as string }}>{label}</Text>
    {children}
  </View>
);

export default function Mount(): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="runviews-mount" style={{ padding: 16, gap: 12, maxWidth: 520 }}>
        <Card id="rv-lines" label="Under the tiles">
          <DependencyLine node={NODES[3]!} nodes={NODES} />
          <MessageLines messages={MESSAGES} nodes={NODES} />
        </Card>
        <Card id="rv-board" label="The board">
          <BoardView entries={BOARD} nodes={NODES} />
        </Card>
        <Card id="rv-report" label="Token report">
          <TokenReport nodes={NODES} open={open} onToggle={() => setOpen((o) => !o)} />
        </Card>
        <Card id="rv-sleep" label="Asleep">
          <SleepLine
            node={{ status: "waiting", wake: { kind: "process", label: "Until the export finishes", wokeCount: 3 } }}
            when={when}
            onOpen={() => undefined}
          />
        </Card>
        <Card id="rv-activity" label="Everything running or asleep">
          <ActivityList rows={ACTIVITY} when={when} onOpen={() => undefined} onNudge={() => undefined} />
        </Card>
        <Card id="rv-at" label="@name">
          <AtMenu nodes={NODES} query="" index={1} onPick={() => undefined} />
        </Card>
      </View>
    </ScrollView>
  );
}
