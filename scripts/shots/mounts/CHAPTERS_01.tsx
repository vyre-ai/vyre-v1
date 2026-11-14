// Mount for lane chat-chapters: a long chat (90 messages over a working day) laid out in chapters, with the rail on the right edge, and in its last chapter the Noted line and the open question that
// two people's facts make. The server's chapter list is stood in for by the call below; everything else is the real conversation.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Chapters";

const DAY = Date.UTC(2025, 9, 24, 9, 0);
const TOPICS: Array<[string, string]> = [
  ["Plan the portal", "Three milestones, Dana leads"],
  ["Documents", "Engagement letter drafted from the template"],
  ["Launch", ""],
];
const ASKS = [
  "Can you list what the portal needs before the review?",
  "Which intake form should the portal start with?",
  "Draft the first milestone and who owns it.",
  "What is still open on the client list?",
  "Move the review to the end of the week.",
];
const SAYS = [
  "The portal needs login, intake and a documents page.",
  "Start with the short intake form: eight fields.",
  "Milestone one is login and intake, owned by Dana.",
  "Two clients still have no email on file.",
  "Done. The review is on the calendar.",
];

export default function Mount(): ReactNode {
  const sample = useMemo(() => {
    const s = createSample("idle");
    const a = { kind: "agent" as const, id: "agt_intake" };
    const p = { kind: "person" as const, id: "usr_irfad" };
    const starts = [DAY, DAY + 4 * 3_600_000 + 4 * 60_000, DAY + 7 * 3_600_000 + 30 * 60_000];
    const rows = Array.from({ length: 90 }, (_, i) => {
      const chapter = Math.floor(i / 30);
      const n = i % 30;
      const person = n % 2 === 0;
      return {
        id: `c${i}`,
        messageId: `c${i}`,
        threadId: "c1",
        threadSeq: i + 1,
        author: person ? p : a,
        kind: person ? "text" : "agent",
        body:
          i === 45 ? "The zebra clause is in the contract." : person ? ASKS[(n / 2) % 5]! : SAYS[((n - 1) / 2) % 5]!,
        blocks: [],
        depth: 0,
        attachments: [],
        reactions: [],
        pinned: false,
        createdAt: starts[chapter]! + n * 90_000,
      };
    });
    const card = (id: string, seq: number, data: Record<string, unknown>) => ({
      ...rows[0]!,
      id,
      messageId: id,
      threadSeq: seq,
      author: a,
      kind: "system",
      body: "",
      createdAt: starts[2]! + 40 * 60_000 + seq * 1000,
      blocks: [{ type: "link_card", v: 1, id: `lc-${id}`, data }],
    });
    s.replica.put("messages", [
      ...rows,
      card("n1", 91, {
        icon: "fact",
        lead: "Noted: decision",
        title: "ship the portal on Friday",
        style: "noted",
        target: { type: "fact", id: "fct_1" },
        actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: "fct_1" } }],
      }),
      card("q1", 92, {
        icon: "fact",
        lead: "Open question",
        title: "Sara and Omar disagree",
        sub: "Which holds? Vyre will not guess.",
        style: "question",
        body: "Sara said Thursday on Monday.\nOmar said Friday today.",
        actions: [
          {
            key: "a",
            label: "Thursday",
            cap: "memory.question.resolve",
            input: { questionId: "qst_1", resolution: "keep_a" },
          },
          {
            key: "b",
            label: "Friday",
            cap: "memory.question.resolve",
            input: { questionId: "qst_1", resolution: "keep_b" },
          },
        ],
      }),
    ]);
    const chapters = TOPICS.map(([t, sum], k) => ({
      startSeq: k * 30 + 1,
      endSeq: k === 2 ? 92 : k * 30 + 30,
      startAt: starts[k]!,
      count: 30,
      current: k === 2,
      title: t,
      summary: sum,
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
