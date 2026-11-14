// Mount for LESSONS_01 (lane b-lessons, owner finding F42, 14 Nov 2026): lessons are never printed under a reply. ?part=chat is a long chat in which every reply used the same two lessons (before: two
// "Used a lesson" lines under every reply; after: one quiet mark on each reply's meta row, the list opens where it is pressed); ?part=fresh is a chat that ends on the message that taught a lesson
// (the one quiet "Learned a lesson" line with Undo and See); ?part=chat also has that message folded into its mark once a reply has come. It uses only what the chat already has, so it draws the
// same chat on the code before the change.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { Row } from "../../../client/src/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createMemoryStore } from "../../../apps/app/src/places/chats/memory/data.tsx";
import {
  ASSISTANT,
  KNOW_THREAD,
  ME,
  MESSAGE_IDS,
  createChatMemorySample,
} from "../../../apps/app/src/places/chats/memory/sample.ts";

export const title = "Lessons out from under the replies";

const T = (h: number, m: number): number => Date.UTC(2025, 9, 24, h, m);
const L1 = "fct_les_looks";
const L2 = "fct_les_first";
const LESSONS = [
  {
    factId: L1,
    text: "Make it interactive and really good to look at and understand. Less text heavy and more interactive, and it should just look and feel awesome.",
    learnedAt: T(8, 0),
    sourceLink: `/chats/${KNOW_THREAD}#msg_L_p1`,
  },
  {
    factId: L2,
    text: "Show me your draft text here first. You are the team's automation agent, not mine.",
    learnedAt: T(8, 5),
    sourceLink: `/chats/${KNOW_THREAD}#msg_L_p0`,
  },
].map((l) => ({
  ...l,
  layer: "person",
  ownerRef: ME,
  agentId: ASSISTANT,
  kind: "lesson",
  status: "current",
  sourceKind: "chat",
  sourceRef: KNOW_THREAD,
  validFrom: T(8, 0),
  lowRisk: false,
  by: ME,
  byKind: "person",
  lesson: { how: "refuse", used: 6, scope: "you" },
}));

const ASKS = [
  "Can you test the terminal for me? Run a few commands and tell me what you see.",
  "Now check the disk, and say it in plain words.",
  "What is the difference between the user and the kernel here?",
  "Run it again with the second computer.",
  "Good. Does the helper show up in the list?",
  "Thanks. Tidy up what you started.",
];
const REPLIES = [
  "I ran four commands in the terminal. All four finished without errors, and the output is short enough to read at a glance.",
  "The disk has plenty of room: about 40 percent is used, and nothing grows fast.",
  "The kernel is the part that talks to the hardware. The user side is where programs run, and it asks the kernel for anything it cannot do itself.",
  "Done on the second computer too. The same four commands gave the same output.",
  "Yes. The helper is in the list, and it shows as finished.",
  "Everything I started is closed. Nothing is left running.",
];

function rows(part: string): Row[] {
  const base = { threadId: "c1", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false } as const;
  const out: Array<Record<string, unknown>> = [];
  let seq = 1;
  const n = part === "fresh" ? 1 : ASKS.length;
  for (let i = 0; i < n; i++) {
    out.push({
      ...base,
      messageId: `msg_L_p${i}`,
      threadSeq: seq++,
      author: { kind: "person", id: ME },
      kind: "text",
      body: ASKS[i],
      createdAt: T(9, i * 4),
    });
    if (part === "fresh") break;
    out.push({
      ...base,
      messageId: `msg_L_a${i}`,
      threadSeq: seq++,
      author: { kind: "agent", id: ASSISTANT },
      kind: "agent",
      body: REPLIES[i],
      createdAt: T(9, i * 4 + 1),
    });
  }
  return out.map((m) => ({ id: m["messageId"], ...m }) as unknown as Row);
}

function Chat({ part }: { part: string }): ReactNode {
  const s = useMemo(() => createChatMemorySample({ lessons: true }), []);
  const [ready, setReady] = useState(false);
  const data = useMemo(() => {
    s.conv.replica.remove("messages", [MESSAGE_IDS.ask, MESSAGE_IDS.reply, MESSAGE_IDS.told, MESSAGE_IDS.held]);
    s.conv.replica.put("messages", rows(part));
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      const i = (input ?? {}) as { messageId?: string };
      //
      // the lessons were sent with the first message of the chat only, so only the reply to it carries the mark
      if (cap === "memory.used" && i.messageId === "msg_L_a0")
        return { messageId: i.messageId, at: T(9, 0), facts: LESSONS, quotes: [] };
      if (cap === "memory.used") return { messageId: i.messageId, facts: [], quotes: [] };
      // only the "fresh" chat taught a lesson: a correction ("Show me your draft text here first"), on its last message
      if (cap === "memory.learned")
        return {
          items:
            part === "fresh"
              ? [LESSONS[1]!].map((f) => ({
                  fact: { ...f, sourceLink: `/chats/${KNOW_THREAD}#msg_L_p0` },
                  at: f.learnedAt,
                  what: "learned",
                  actor: ASSISTANT,
                  actorKind: "agent",
                  sourceKind: "chat",
                  sourceRef: KNOW_THREAD,
                  undone: false,
                }))
              : [],
          total: part === "fresh" ? 1 : 0,
        };
      return s.memory.store.call(cap, input);
    };
    const store = createMemoryStore(call);
    return { ...s.data, memory: { ...s.memory, store } };
  }, [s, part]);
  useEffect(() => {
    const store = data.memory!.store;
    const reads: Array<[string, unknown]> = [["memory.learned", { threadId: "c1", limit: 200 }]];
    for (let i = 0; i < ASKS.length; i++) reads.push(["memory.used", { threadId: "c1", messageId: `msg_L_a${i}` }]);
    void Promise.all(reads.map(([c, x]) => store.read(c, x).catch(() => undefined))).then(() => setReady(true));
  }, [data]);
  if (!ready) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Conversation data={data} />
    </View>
  );
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const part = new URLSearchParams(search).get("part") === "fresh" ? "fresh" : "chat";
  return <Chat part={part} />;
}
