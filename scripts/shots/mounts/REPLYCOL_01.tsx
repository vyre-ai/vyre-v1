// Mount for chat-reply: the column as a person sees it after the reply lane's changes. ?part=
//   column (default)  a finished reply with a table and an open question, your message waiting behind a running turn (the note under it), and the live word
//   fold              a finished reply whose tool work folds into "Worked 8s, 2 steps", beside a reply still being written
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { SAMPLE_NOW, createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { ConversationData } from "../../../apps/app/src/places/chats/conversation/data.tsx";
import { createStreamStore } from "../../../ui/src/stream/index.ts";
import "../../../ui/src/stream/enable-diagrams.ts";

export const title = "Reply column";

const TABLE = [
  "Here is where the onboarding stands.",
  "",
  "| Step | Owner | Status |",
  "|---|---|---|",
  "| Order form | Maya | Sent |",
  "| Deposit | Omar | Waiting |",
  "| Project folder | Intake | Open |",
  "",
  "Which time should I book the kickoff?",
].join("\n");

function column(): ConversationData {
  const s = createSample("busy");
  const base = { threadId: "c1", kind: "text", depth: 0, attachments: [], reactions: [], pinned: false } as const;
  s.replica.put("messages", [
    {
      id: "rc1",
      messageId: "rc1",
      ...base,
      threadSeq: 97,
      author: { kind: "agent", id: "agt_intake" },
      body: TABLE,
      blocks: [
        {
          type: "question",
          v: 1,
          id: "rcq",
          state: "waiting",
          traceId: "tr_rcq",
          data: {
            prompt: "Which time should I book?\nTuesday has two openings and Thursday has one.",
            mode: "single",
            allowOther: true,
            options: [
              { key: "tue", label: "Tuesday 2:00", recommended: true },
              { key: "thu", label: "Thursday 10:00", detail: "Omar is out Tuesday" },
            ],
          },
        },
      ],
      createdAt: SAMPLE_NOW - 120_000,
    },
    {
      id: "rc2",
      messageId: "rc2",
      ...base,
      threadSeq: 99,
      author: { kind: "person", id: "usr_irfad" },
      body: "Also add the deposit to the summary",
      blocks: [],
      createdAt: SAMPLE_NOW - 60_000,
    },
  ]);
  const turns = [
    {
      turnId: "trn_1",
      threadId: "c1",
      agentId: "agt_intake",
      store: createStreamStore(),
      state: "writing" as const,
      startedAt: SAMPLE_NOW - 90_000,
      triggerId: "m6",
      asker: "usr_irfad",
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
    cap === "engine.queue.list" ? { items: [{ messageId: "rc2", state: "queued" }] } : s.data.call(cap, input);
  return { ...s.data, call, live } as ConversationData;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const fold = new URLSearchParams(search ?? "").get("part") === "fold";
  const data = useMemo(() => (fold ? createSample("streaming").data : column()), [fold]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Conversation data={data} />
    </View>
  );
}
