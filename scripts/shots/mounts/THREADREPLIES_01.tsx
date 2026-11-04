// Mount for agents replying in threads (lane l-threadreplies): the chat and the thread beside it over the Northwind sample channel, with the ask in the chat and the agent answering in the thread under it. ?part=
//   main    (default) the chat: your ask with the live footer under it, Intake writing, 1 reply; no thread open
//   thread  the thread open beside the chat (a full-screen sheet on a phone): the asking message, Intake's replies, the "Also sent to the chat" mark, the composer with its tick and the switch
//   done    the footer at rest: 3 replies and when the last one came
//   empty   the thread is open and nothing is in it yet
//   long    the thread is open with sixty replies
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { ThreadSide } from "../../../apps/app/src/places/chats/mounts/ThreadSide.tsx";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";
import { SAMPLE_NOW, createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { LiveTurns } from "../../../apps/app/src/places/chats/conversation/data.tsx";

export const title = "Thread replies";

const none: never[] = [];
const at = (h: number, min: number, sec = 0): number => Date.UTC(2025, 9, 24, h, min, sec);
const intake = { kind: "agent" as const, id: "agt_intake" };
const me = { kind: "person" as const, id: "usr_irfad" };
const msg = (id: string, thread: string, seq: number, who: { kind: "person" | "agent"; id: string }, body: string, createdAt: number, blocks: unknown[] = []) => ({
  id, messageId: id, threadId: thread, threadSeq: seq, author: who, kind: who.kind === "agent" ? "agent" : "text", body, blocks, depth: 0, attachments: [], reactions: [], pinned: false, createdAt,
});

function build(part: string) {
  const s = createSample("channel");
  const main = s.replica.rows("threads")[0] as object;
  s.replica.put("threads", [{ id: "c1", ...main, title: "Vendor onboarding", agentRepliesInThreads: true }]);
  s.replica.put("messages", [msg("c2", "c1", 2, me, "Find a time for the vendor call next week, and compare the two quotes.", at(9, 21))]);
  const count = part === "empty" ? 0 : part === "long" ? 60 : part === "main" ? 1 : 3;
  s.replica.put("threads", [{
    id: "t_c2", threadId: "t_c2", kind: "thread", parentThreadId: "c1", parentMessageId: "c2", listed: false, planMode: false, members: [], agents: [{ agentId: "agt_intake", mode: "lead" }], createdAt: at(9, 22), replyCount: count, lastMessageAt: count >= 3 ? at(9, 40) : at(9, 23), repliers: [{ kind: "agent", id: "agt_intake" }], preview: part === "done" ? "Two helpers. Tess checks the vendor calendar and Orin compares the quotes, then Decision: book Thursday 14:00." : undefined,
  }]);
  if (part === "long") {
    s.replica.put("messages", Array.from({ length: 60 }, (_, i) => msg(`tl${i + 1}`, "t_c2", i + 1, i % 2 === 0 ? intake : me, i % 2 === 0 ? `Checked item ${i + 1} against the quote and the calendar.` : `Thanks, go on with item ${i + 1}.`, at(9, 22, i * 10))));
  } else if (part !== "empty") {
    s.replica.put("messages", [
      msg("tm1", "t_c2", 1, intake, "Two helpers. Tess checks the vendor calendar and Orin compares the quotes. I will bring it together when they are back.", at(9, 22)),
      ...(part === "main" ? [] : [
        msg("tm2", "t_c2", 2, intake, "Harbor costs $260 more up front, but Pine's setup fee closes most of that gap, and Harbor is ready two weeks sooner.", at(9, 31)),
        msg("tm3", "t_c2", 3, intake, "Decision: book Thursday 14:00 and go with Harbor.", at(9, 40)),
        msg("c3", "c1", 3, intake, "Decision: book Thursday 14:00 and go with Harbor.", at(9, 40), [{ type: "from_thread", v: 1, id: "bft", data: { threadId: "t_c2", messageId: "tm3" } }]),
      ]),
    ]);
  }
  // the thread's root row reads the message it hangs off
  const call = s.data.call;
  s.data.call = async (cap: string, input: unknown) => (cap === "chat.message.get" ? { message: { author: { id: "usr_irfad" }, body: "Find a time for the vendor call next week, and compare the two quotes.", createdAt: at(9, 21) } } : call(cap, input));
  return s.data;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = new URLSearchParams(search ?? "").get("part") ?? "main";
  const parts = useMemo(() => {
    const data = build(part);
    const writing = part === "main";
    const live: LiveTurns = {
      turnsOf: (id) => (writing && id === "t_c2" ? turns : none), subscribe: () => () => undefined, settle: () => undefined, seed: () => undefined, onGap: () => () => undefined,
    };
    const turns = [{ turnId: "turn_1", threadId: "t_c2", agentId: "agt_intake", store: undefined as never, state: "writing" as const, startedAt: Date.now() - 23_000 }];
    return { conversation: { ...data, clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }), live } };
  }, [part]);
  const width = useWindowDimensions().width;
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const open = part === "main" || part === "done" ? undefined : "t_c2";
  const d = parts.conversation;
  const rt = { screens: d.screens, call: d.call, connection: d.connection } as unknown as ShellRuntime;
  const narrow = width > 0 && width < 640;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ flex: 1, minWidth: 0 }}><Conversation data={d} /></View>
      {open ? <ThreadSide rt={rt} threadId={open} data={{ ...d, threadId: open }} narrow={narrow} onClose={() => undefined} say={() => undefined} /> : null}
    </View>
  );
}
