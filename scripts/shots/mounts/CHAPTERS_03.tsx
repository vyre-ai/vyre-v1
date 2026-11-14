// Mount for lane chat-chapters: a chat of 5,000 messages in 50 chapters of 100, to check that folded chapters keep the list light and the scroll where it was. The chapter list is stood in for.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Chapters, 5,000";

const DAY = Date.UTC(2025, 9, 24, 9, 0);
export default function Mount(): ReactNode {
  const sample = useMemo(() => {
    const s = createSample("idle");
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: `c${i}`,
      messageId: `c${i}`,
      threadId: "c1",
      threadSeq: i + 1,
      author: i % 2 === 0 ? { kind: "person" as const, id: "usr_irfad" } : { kind: "agent" as const, id: "agt_intake" },
      kind: i % 2 === 0 ? "text" : "agent",
      body: i % 2 === 0 ? `Question ${i + 1}` : `Answer ${i + 1} with a few more words.`,
      blocks: [],
      depth: 0,
      attachments: [],
      reactions: [],
      pinned: false,
      createdAt: DAY + i * 20_000,
    }));
    s.replica.put("messages", rows);
    const chapters = Array.from({ length: 50 }, (_, k) => ({
      startSeq: k * 100 + 1,
      startMsg: `c${k * 100}`,
      endSeq: k * 100 + 100,
      startAt: DAY + k * 100 * 20_000,
      count: 100,
      current: k === 49,
      title: `Part ${k + 1}`,
      summary: `What part ${k + 1} settled`,
      by: "model" as const,
    }));
    const base = s.data;
    return {
      ...s,
      data: {
        ...base,
        call: async (cap: string, input: unknown) =>
          cap === "chat.chapters" ? { chapters, wanted: 0 } : base.call(cap, input),
      },
    };
  }, []);
  return <Conversation data={sample.data} />;
}
