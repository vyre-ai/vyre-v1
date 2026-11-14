// Mount for SUBAGENTS_01 (lane b-crew, F41 and F51): the subagents an agent's engine started, as the person who asked sees them and as another member of the chat sees them: the inline Crew block and the
// pane's Crew list, the same real components, the same moment (one done, one working). The reduced view is what engine.crew.status serves anyone who is not the asker (Helper N, state and clock).
import type { ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { CrewBlock } from "../../../apps/app/src/places/chats/session/CrewBlock.tsx";
import { CrewOverview } from "../../../apps/app/src/places/chats/crew/pane.tsx";
import { totalsOf } from "../../../apps/app/src/places/chats/crew/model.ts";
import type { CrewMember, CrewStatusOut } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "Subagents: the asker and another member";

const now = Date.now();
const row = (o: Partial<CrewMember> & { id: string; title: string; state: CrewMember["state"] }): CrewMember =>
  ({
    kind: "subagent",
    parentThreadId: "thr_0",
    agentId: "agt_dex",
    startedAt: now - 83_000,
    elapsedMs: 83_000,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    ...o,
  }) as CrewMember;

const ASKER: CrewMember[] = [
  row({
    id: "sub_a",
    title: "Test the terminal",
    state: "done",
    found: "The terminal works.",
    answer: "The terminal works. I ran echo and saw hello.",
    steps: ["Running a command"],
    elapsedMs: 41_000,
    endedAt: now - 42_000,
  }),
  row({
    id: "sub_b",
    title: "Test the browser",
    state: "working",
    step: "Reading page.html",
    steps: ["Reading page.html"],
  }),
];
const OTHER: CrewMember[] = [
  row({ id: "sub_a", title: "Helper 1", state: "done", elapsedMs: 41_000, endedAt: now - 42_000 }),
  row({ id: "sub_b", title: "Helper 2", state: "working" }),
];
const status = (m: CrewMember[]): CrewStatusOut => ({ members: m, totals: totalsOf(m) }) as CrewStatusOut;

function Side({ who, rows }: { who: string; rows: CrewMember[] }): ReactNode {
  return (
    <View style={{ flex: 1, minWidth: 0, padding: 16, gap: 14 }}>
      <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{who}</Text>
      <CrewBlock members={rows} totals={totalsOf(rows)} onPeek={() => undefined} onOpenPane={() => undefined} />
      <View style={{ borderRadius: 14, backgroundColor: "var(--raised)" as string, paddingVertical: 8 }}>
        <CrewOverview
          status={status(rows)}
          call={async () => ({})}
          threadId="thr_0"
          onPeek={() => undefined}
          onRefresh={() => undefined}
        />
      </View>
    </View>
  );
}

export default function Mount(): ReactNode {
  const phone = useWindowDimensions().width < 600;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View style={{ flexDirection: phone ? "column" : "row", gap: 8 }}>
        <View testID="as-asker" style={{ flex: 1 }}>
          <Side who="As the person who asked" rows={ASKER} />
        </View>
        <View testID="as-other" style={{ flex: 1 }}>
          <Side who="As another member of the chat" rows={OTHER} />
        </View>
      </View>
    </ScrollView>
  );
}
