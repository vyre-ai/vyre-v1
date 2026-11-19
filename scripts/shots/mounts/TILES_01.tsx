// Mount for TILES_01 (lane r42-subagents, 19 Nov 2026): the crew block in a chat with several helpers at work, as tiles side by side (a wide column) and as rows (?view=rows, and any narrow column), the real
// CrewBlock with the members engine.crew.status serves. One is done, one works with its own steps, one waits for the person, one could not finish.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { CrewBlock } from "../../../apps/app/src/places/chats/session/CrewBlock.tsx";
import { totalsOf } from "../../../apps/app/src/places/chats/crew/model.ts";
import type { CrewMember } from "../../../apps/app/src/places/chats/crew/model.ts";

export const title = "Helpers side by side";

const now = Date.now();
const row = (o: Partial<CrewMember> & { id: string; title: string; state: CrewMember["state"] }): CrewMember =>
  ({
    kind: "subagent",
    parentThreadId: "thr_0",
    agentId: "agt_lead",
    startedAt: now - 9_000,
    elapsedMs: 9_000,
    tokensIn: 6_200,
    tokensOut: 900,
    costMicros: 20_000,
    ...o,
  }) as CrewMember;

const CREW: CrewMember[] = [
  row({
    id: "sub_a",
    runId: "run_r",
    title: "Compare the bids",
    state: "working",
    steps: ["Opening the first bid", "Reading the price table", "Checking what the bid leaves out"],
    step: "Checking what the bid leaves out",
    tokensIn: 8_400,
    costMicros: 24_000,
  }),
  row({
    id: "sub_b",
    kind: "helper",
    title: "Delivery dates",
    name: "Calendar",
    state: "needs_you",
    step: "Read the Deliveries calendar?",
    holdTaskId: "tsk_hold",
    model: "glm-5.2",
    tokensIn: 4_000,
    costMicros: 8_000,
  }),
  row({
    id: "sub_c",
    kind: "helper",
    title: "Three-year cost",
    name: "Numbers",
    state: "failed",
    found: "The Calder price sheet has no tax column.",
    elapsedMs: 7_000,
    endedAt: now - 2_000,
    costMicros: 50_000,
  }),
  row({
    id: "sub_d",
    runId: "run_d",
    kind: "helper",
    title: "Summary page",
    name: "Docs",
    state: "working",
    steps: ["Setting up the page", "Adding the bids table"],
    step: "Adding the bids table",
    tokensIn: 17_000,
    costMicros: 50_000,
  }),
  row({
    id: "sub_e",
    title: "Reading the sizes",
    state: "done",
    found: "All three fit the dock.",
    elapsedMs: 6_000,
    endedAt: now - 3_000,
    tokensIn: 3_000,
    costMicros: 9_000,
  }),
];

/** The held request as the Space serves it: an approval task that carries Allow and Deny, assigned to the person looking. */
const call = async (cap: string): Promise<unknown> =>
  cap === "tasks.get"
    ? {
        task: {
          id: "tsk_hold",
          kind: "approve",
          state: "awaiting_approval",
          createdBy: "agt_lead",
          assigned: { kind: "person", id: "usr_me" },
          actions: [
            { key: "approve", label: "Allow", note: "optional" },
            { key: "reject", label: "Deny", note: "required" },
          ],
        },
      }
    : {};

/** What the runtime knows of the two helpers: Docs starts after Research and looks stuck. */
const sp = { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0 };
const NODES = [
  {
    id: "run_r",
    kind: "subagent",
    name: "Research",
    status: "running",
    spent: sp,
    startedAt: 1,
    step: "Checking what the bid leaves out",
    stepIcon: "read",
  },
  {
    id: "run_d",
    kind: "helper",
    name: "Docs",
    status: "running",
    spent: sp,
    startedAt: 1,
    dependsOn: ["run_r"],
    step: "Adding the bids table",
    stepIcon: "edit",
    stuck: { since: 5, reason: "the same step four times" },
  },
];

export default function Mount(): ReactNode {
  const [view, setView] = useState<"auto" | "rows">("auto");
  useEffect(() => {
    if (new URLSearchParams(globalThis.location?.search ?? "").get("view") === "rows") setView("rows");
  }, []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="tiles-mount" style={{ padding: 20, maxWidth: 700 }}>
        <CrewBlock
          members={CREW}
          totals={totalsOf(CREW)}
          view={view}
          call={call}
          nodes={NODES}
          meId="usr_me"
          onPeek={() => undefined}
          onOpenPane={() => undefined}
          onStopAll={() => undefined}
          onRetry={() => undefined}
        />
      </View>
    </ScrollView>
  );
}
