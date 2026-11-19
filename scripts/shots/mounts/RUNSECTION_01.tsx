// Mount for RUNSECTION_01 (lane r42-subagents, 19 Nov 2026): the Crew pane's two runtime sections as a person opens them, "What they know together" (board, lines between helpers, token report) and "Everything running or asleep",
// the real components over a fake runtime that answers in the shapes of manifests/runs.ts.
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { CrewOverview } from "../../../apps/app/src/places/chats/crew/pane.tsx";
import { totalsOf } from "../../../apps/app/src/places/chats/crew/model.ts";
import type { CrewMember, CrewStatusOut } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "Crew pane: Helpers, Board, Tokens";

const T0 = Date.now() - 60_000;
const spent = (i: number, o: number, c: number, u: number) => ({
  tokensIn: i,
  tokensOut: o,
  cacheRead: c,
  usdMicros: u,
});
const call = async (cap: string): Promise<unknown> => {
  if (cap === "runs.tree.find") return { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] };
  if (cap === "runs.tree.get")
    return {
      nodes: [
        {
          id: "run_r",
          rootRun: "run_r",
          kind: "subagent",
          name: "Research",
          status: "running",
          model: "claude-sonnet-5-5",
          spent: spent(14000, 1800, 5900, 52000),
          startedAt: T0,
        },
        {
          id: "run_n",
          rootRun: "run_r",
          parentRun: "run_r",
          kind: "helper",
          name: "Numbers",
          status: "succeeded",
          model: "gpt-6-codex",
          spent: spent(31000, 9000, 9600, 110000),
          startedAt: T0,
          endedAt: T0 + 20000,
        },
        {
          id: "run_c",
          rootRun: "run_r",
          parentRun: "run_r",
          kind: "helper",
          name: "Calendar",
          status: "succeeded",
          model: "glm-5.2",
          spent: spent(17000, 4000, 5300, 22000),
          startedAt: T0,
          endedAt: T0 + 15000,
        },
      ],
    };
  if (cap === "runs.board.list")
    return {
      entries: [
        {
          id: "b1",
          kind: "fact",
          text: "Harbor asks $4,180. Setup is included.",
          byRun: "run_c",
          evidence: ["Harbor Supply bid.pdf, page 2"],
          at: T0 + 8000,
        },
        {
          id: "b2",
          kind: "question",
          text: "The Calder sheet has no tax column. Which rate applies?",
          byRun: "run_n",
          at: T0 + 9000,
          answer: { byRun: "run_r", text: "8%, from the bid terms", at: T0 + 12000 },
        },
        {
          id: "b3",
          kind: "decision",
          text: "Compare on the cost over three years, not on price alone.",
          byRun: "run_r",
          at: T0 + 14000,
          evidence: [],
        },
      ],
    };
  if (cap === "runs.message.list")
    return {
      messages: [
        {
          id: "m1",
          fromRun: "run_n",
          toRun: "run_r",
          body: "Calder is $13,105 over three years, with the 8% tax.",
          at: T0 + 12000,
          seenAt: T0 + 13000,
        },
        {
          id: "m2",
          fromRun: "run_c",
          toRun: "run_r",
          body: "The dock is free the weeks of the 14th and the 28th.",
          at: T0 + 14000,
        },
      ],
    };
  if (cap === "runs.activity.list")
    return {
      rows: [
        {
          runId: "run_x2",
          rootRun: "run_x2",
          kind: "terminal",
          name: "Build the site",
          whoKind: "agent",
          status: "running",
          step: { icon: "term", text: "Running npm run build" },
          startedAt: T0,
          updatedAt: T0,
          usdMicros: 0,
        },
        {
          runId: "run_x5",
          rootRun: "run_x5",
          kind: "turn",
          name: "Send 12 invoices",
          whoKind: "agent",
          status: "waiting",
          wake: { kind: "person", label: "your answer" },
          need: { requestId: "tsk_9", what: "Mail send", why: "It would email 12 clients." },
          startedAt: T0,
          updatedAt: T0,
          usdMicros: 0,
        },
        {
          runId: "run_x3",
          rootRun: "run_x3",
          kind: "terminal",
          name: "Stock count export",
          whoKind: "agent",
          status: "waiting",
          wake: { kind: "process", label: "Until the export finishes", wokeCount: 3 },
          startedAt: T0,
          updatedAt: T0,
          usdMicros: 0,
        },
        {
          runId: "run_x4",
          rootRun: "run_x4",
          kind: "watcher",
          name: "New files in Bids",
          whoKind: "agent",
          status: "waiting",
          wake: { kind: "event", label: "Until a file lands in Bids", wokeCount: 2 },
          startedAt: T0,
          updatedAt: T0,
          usdMicros: 0,
        },
      ],
    };
  return {};
};

const row = (o: Partial<CrewMember> & { id: string; title: string; state: CrewMember["state"] }): CrewMember =>
  ({
    kind: "helper",
    parentThreadId: "thr_0",
    agentId: "agt_lead",
    startedAt: T0,
    elapsedMs: 40_000,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    ...o,
  }) as CrewMember;
const MEMBERS: CrewMember[] = [
  row({
    id: "thr_n",
    name: "Numbers",
    title: "Three-year cost",
    state: "done",
    found: "Harbor $12,540, Pine $12,660, Calder $13,105.",
    endedAt: T0 + 20_000,
    tokensIn: 31_000,
    tokensOut: 9_000,
    costMicros: 110_000,
  }),
  row({
    id: "thr_c",
    name: "Calendar",
    title: "Delivery dates",
    state: "done",
    found: "The dock is free the weeks of the 14th and 28th.",
    endedAt: T0 + 15_000,
    tokensIn: 17_000,
    tokensOut: 4_000,
    costMicros: 22_000,
  }),
  row({
    id: "thr_d",
    name: "Docs",
    title: "Summary page",
    state: "working",
    step: "Adding the bids table",
    tokensIn: 19_000,
    tokensOut: 3_000,
    costMicros: 90_000,
  }),
];
const status = { members: MEMBERS, totals: totalsOf(MEMBERS) } as CrewStatusOut;

export default function Mount(): ReactNode {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="runsection-mount" style={{ padding: 14, maxWidth: 460 }}>
        <CrewOverview
          status={status}
          call={call}
          threadId="thr_0"
          onPeek={() => undefined}
          onRefresh={() => undefined}
          onOpenThread={() => undefined}
        />
      </View>
    </ScrollView>
  );
}
