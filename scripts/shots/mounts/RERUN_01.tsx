// Mount for RERUN_01 (lane r42-subagents, 19 Nov 2026): a finished helper with Save as an agent and Run again, and the Compare tab with a first run and one started again; the real CrewPeek.
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { CrewPeek } from "../../../apps/app/src/places/chats/crew/pane.tsx";
import type { CrewMember } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "Save as an agent, Run again, Compare";

const now = Date.now();
const MEMBER = {
  kind: "helper",
  id: "thr_h",
  runId: "run_h",
  parentThreadId: "thr_0",
  title: "Compare the bids",
  name: "Research",
  agentId: "agt_research",
  state: "done",
  found: "Harbor Supply fits best. It costs $260 more than Pine up front, but it is ready two weeks sooner.",
  startedAt: now - 83_000,
  endedAt: now - 20_000,
  elapsedMs: 63_000,
  tokensIn: 24_000,
  tokensOut: 2_600,
  costMicros: 52_000,
  model: "claude-sonnet-5-5",
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
  // the person who started it may manage it: the server says so, and the buttons show only then
  if (cap === "runs.node.get") return { node: { id: "run_h", can: { manage: true } } };
  if (cap === "engine.helper_models")
    return {
      accounts: [
        {
          ref: "acc_1",
          label: "Space Claude",
          provider: "claude",
          models: [
            { model: "claude-opus-5-5", available: true, tier: "strong" },
            { model: "claude-haiku-5-5", available: true, tier: "cheap" },
            { model: "claude-sonnet-5-5", available: true },
          ],
        },
      ],
    };
  if (cap === "runs.node.compare")
    return {
      sides: [
        {
          runId: "run_h",
          threadId: "thr_h",
          status: "succeeded",
          brief: { instructions: "Read the three supplier bids and say which fits best." },
          result: "Harbor Supply fits best. It costs $260 more than Pine up front, but it is ready two weeks sooner.",
          usdMicros: 52_000,
          tokens: 26_600,
          seconds: 63,
          model: "claude-sonnet-5-5",
        },
        {
          runId: "run_h2",
          threadId: "thr_h2",
          status: "succeeded",
          brief: { instructions: "Read the three supplier bids, include setup costs, and say which fits best." },
          result:
            "Harbor Supply fits best. It is $260 more than Pine up front and ready two weeks sooner. Pine's setup adds $300, so the gap is $40 in Pine's favour only if you do not need training.",
          usdMicros: 118_000,
          tokens: 41_200,
          seconds: 71,
          model: "claude-opus-5-5",
        },
      ],
    };
  return {};
};

export default function Mount(): ReactNode {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="rerun-mount" style={{ padding: 8, maxWidth: 460 }}>
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
