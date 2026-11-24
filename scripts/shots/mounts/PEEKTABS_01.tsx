// Mount for PEEKTABS_01 (lane r42-subagents, 19 Nov 2026): one helper opened in the Crew pane as a session: its name and state, the tabs (Transcript, Files, Details) and the tell-it box, the real CrewPeek.
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { CrewPeek } from "../../../apps/app/src/places/chats/crew/pane.tsx";
import type { CrewMember } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "A helper's session";

const now = Date.now();
const MEMBER = {
  kind: "helper",
  id: "thr_h",
  parentThreadId: "thr_0",
  title: "Fix the invoice date bug",
  name: "Ember",
  agentId: "agt_ember",
  state: "working",
  step: "Running the tests",
  startedAt: now - 83_000,
  elapsedMs: 83_000,
  tokensIn: 18_000,
  tokensOut: 2_400,
  costMicros: 61_000,
  model: "claude-sonnet-5-5",
  branch: "crew/ember-1",
  added: 38,
  deleted: 6,
  files: [
    { path: "modules/invoices/date.ts", added: 24, deleted: 6 },
    { path: "modules/invoices/date.test.ts", added: 14, deleted: 0 },
  ],
} as CrewMember;

const call = async (cap: string): Promise<unknown> => {
  if (cap === "chat.helper.notes")
    return {
      notes: [
        {
          messageId: "n1",
          who: "brief",
          authorId: "agt_lead",
          body: "The invoice date shows the day before in the evening. Find why and fix it, with a test.",
        },
      ],
    };
  if (cap === "chat.messages.list")
    return {
      messages: [
        {
          blocks: [
            {
              id: "s1",
              type: "step",
              v: 1,
              state: "done",
              data: { title: "Read the date code", sub: "modules/invoices/date.ts" },
            },
            { id: "s2", type: "step", v: 1, state: "done", data: { title: "Found the time zone cut" } },
            { id: "s3", type: "step", v: 1, state: "live", data: { title: "Running the tests" } },
          ],
        },
      ],
    };
  return {};
};

export default function Mount(): ReactNode {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="peek-mount" style={{ padding: 8, maxWidth: 420 }}>
        <CrewPeek
          member={MEMBER}
          call={call}
          onBack={() => undefined}
          onOpenChat={() => undefined}
          onRefresh={() => undefined}
        />
      </View>
    </ScrollView>
  );
}
