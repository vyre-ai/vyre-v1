// Mount for the r32-chat lane: a teammate's plain yes or no question, drawn the way the chat draws it (a quiet line with Yes and No, never an approval card), before and after it is answered.
// ?part=ask | answered | decided (a thread's parent message with the decision the thread reached)
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ApprovalCard } from "../../../apps/app/src/places/chats/conversation/approval.tsx";
import { ThreadParent } from "../../../apps/app/src/places/chats/conversation/ThreadParent.tsx";

export const title = "A teammate's plain question";

const part = (): string => new URLSearchParams(globalThis.location?.search ?? "").get("part") ?? "ask";
const changes = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) } as never;

const task = (state: string) => ({
  id: "tsk_1",
  kind: "approve",
  title: "Can Imran send the Northwind quote today?",
  state,
  blocks: [
    {
      type: "table",
      data: { cap: "", act: "", plain: true, ask: { what: "send the quote" }, text: "The price holds until Friday." },
    },
  ],
  actions: [],
});

export default function Mount(): ReactNode {
  const width = useWindowDimensions().width;
  const answered = part() === "answered";
  const data = {
    call: async (cap: string) => (cap === "tasks.get" ? { task: task(answered ? "done" : "awaiting_approval") } : {}),
    nav: { openBeside: () => undefined },
    threadId: "thr_1",
    changes,
    nameOf: (x: string) => x,
  } as never;
  if (part() === "decided")
    return (
      <View style={{ padding: 24, width: Math.min(width, 640), backgroundColor: "var(--win)" as string }}>
        <ThreadParent
          threadId="thr_1"
          messageId="m1"
          call={async () => ({
            message: {
              author: { id: "usr_sara" },
              body: "Which vendor should we use for the Northwind rollout?",
              createdAt: Date.UTC(2026, 10, 16, 9, 30),
            },
          })}
          nameOf={() => "Sara Malik"}
          clock={{ now: Date.UTC(2026, 10, 16, 10, 0), offsetMin: 0 }}
          count={4}
          decided="Go with Harbor"
        />
      </View>
    );
  return (
    <View style={{ padding: 24, width: Math.min(width, 640), backgroundColor: "var(--win)" as string }}>
      <ApprovalCard taskId="tsk_1" agent="Dex" agentId="agt_dex" data={data} />
    </View>
  );
}
