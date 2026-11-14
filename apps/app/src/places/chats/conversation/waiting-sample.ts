// The sample conversation with Intake working and a message of yours waiting behind it: the queue line's two cases (someone else's turn, your own). The test and the screenshot mount draw it.
import { SAMPLE_NOW, createSample } from "./sample.ts";
import type { ConversationData } from "./data.tsx";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";

/** The sample conversation, busy, with your message waiting and a turn of someone's (or your own) writing. */
export function waiting(own: boolean, count = 1): ConversationData {
  const s = createSample("busy");
  s.replica.put(
    "messages",
    Array.from({ length: count }, (_, i) => ({
      id: `q${i + 1}`,
      messageId: `q${i + 1}`,
      threadId: "c1",
      threadSeq: 99 + i,
      author: { kind: "person" as const, id: "usr_irfad" },
      kind: "text" as const,
      body: i === 0 ? "Also add the deposit to the summary" : `And one more thing, number ${i + 1}`,
      blocks: [],
      depth: 0,
      attachments: [],
      reactions: [],
      pinned: false,
      createdAt: SAMPLE_NOW - 60_000 + i * 1000,
    })),
  );
  const turns = [
    {
      turnId: "trn_1",
      threadId: "c1",
      agentId: "agt_intake",
      store: createStreamStore(),
      state: "writing" as const,
      startedAt: SAMPLE_NOW - 90_000,
      triggerId: "m6",
      asker: own ? "usr_irfad" : "usr_maya",
    },
  ];
  const live = {
    turnsOf: () => turns,
    subscribe: () => () => undefined,
    settle: () => undefined,
    seed: () => undefined,
    onGap: () => () => undefined,
  };
  const call = async (cap: string, input: unknown): Promise<unknown> =>
    cap === "engine.queue.list"
      ? { items: Array.from({ length: count }, (_, i) => ({ messageId: `q${i + 1}`, state: "queued" })) }
      : s.data.call(cap, input);
  return { ...s.data, call, live } as ConversationData;
}
