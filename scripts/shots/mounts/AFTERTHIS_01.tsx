// Mount for the chat's "After this" line (lane l-engine21), over the Northwind sample conversation with Intake working. ?part=
//   other  (default) Maya's turn is the one running, you sent a message: it waits, and the line under the thread says "After this: it goes in when this turn ends"
//   own    your own turn is running (the engine takes the message at its next step): the line says "Goes in at the next step"
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { SAMPLE_NOW, createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { ConversationData } from "../../../apps/app/src/places/chats/conversation/data.tsx";
import { createStreamStore } from "../../../ui/src/stream/index.ts";

export const title = "After this";

/** The sample conversation, busy, with your message waiting and a turn of someone's (or your own) writing. */
export function waiting(own: boolean): ConversationData {
  const s = createSample("busy");
  s.replica.put("messages", [{ id: "q1", messageId: "q1", threadId: "c1", threadSeq: 99, author: { kind: "person", id: "usr_irfad" }, kind: "text", body: "Also add the deposit to the summary", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW - 60_000 }]);
  const turns = [{ turnId: "trn_1", threadId: "c1", agentId: "agt_intake", store: createStreamStore(), state: "writing" as const, startedAt: SAMPLE_NOW - 90_000, triggerId: "m6", asker: own ? "usr_irfad" : "usr_maya" }];
  const live = { turnsOf: () => turns, subscribe: () => () => undefined, settle: () => undefined, seed: () => undefined, onGap: () => () => undefined };
  const call = async (cap: string, input: unknown): Promise<unknown> => (cap === "engine.queue.list" ? { items: [{ messageId: "q1", state: "queued" }] } : s.data.call(cap, input));
  return { ...s.data, call, live } as ConversationData;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const own = new URLSearchParams(search ?? "").get("part") === "own";
  const data = useMemo(() => waiting(own), [own]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={data} /></View>;
}
