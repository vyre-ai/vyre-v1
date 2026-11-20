// Mount for PEEKRESULT_01 (lane r42-subagents, 19 Nov 2026): a finished helper's result with Make a task, Save to Files and Add to a record, the real CrewPeek; the shoot script presses each one and shoots the sheet it opens.
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { CrewPeek } from "../../../apps/app/src/places/chats/crew/pane.tsx";
import type { CrewMember } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "A helper's result";

const now = Date.now();
const MEMBER = {
  kind: "helper",
  id: "thr_h",
  parentThreadId: "thr_0",
  title: "Compare the bids",
  name: "Research",
  agentId: "agt_research",
  state: "done",
  found:
    "Harbor Supply fits best. It costs $260 more than Pine up front, but it is ready two weeks sooner and setup is included.",
  startedAt: now - 83_000,
  endedAt: now - 20_000,
  elapsedMs: 63_000,
  tokensIn: 24_000,
  tokensOut: 2_600,
  costMicros: 52_000,
} as CrewMember;

const call = async (cap: string): Promise<unknown> => {
  if (cap === "chat.helper.notes")
    return {
      notes: [
        {
          messageId: "n1",
          who: "brief",
          authorId: "agt_lead",
          body: "Read the three supplier bids and say which fits best.",
        },
      ],
    };
  if (cap === "files.list")
    return {
      folders: [
        { folderId: "fld_bids", name: "Bids" },
        { folderId: "fld_sup", name: "Supplier review" },
        { folderId: "fld_notes", name: "Meeting notes" },
      ],
    };
  if (cap === "search.recent.list")
    return {
      hits: [
        { kind: "record", id: "rec_1", title: "Harbor Supply", recordType: "supplier", link: "x" },
        { kind: "record", id: "rec_2", title: "Pine Works", recordType: "supplier", link: "x" },
        { kind: "record", id: "rec_3", title: "Q4 dock schedule", recordType: "project", link: "x" },
      ],
    };
  return {};
};

export default function Mount(): ReactNode {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="peekresult-mount" style={{ padding: 8, maxWidth: 420 }}>
        <CrewPeek
          member={MEMBER}
          call={call}
          meId="usr_me"
          onBack={() => undefined}
          onOpenChat={() => undefined}
          onRefresh={() => undefined}
        />
      </View>
    </ScrollView>
  );
}
