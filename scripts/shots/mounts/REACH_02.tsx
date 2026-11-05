// Mount for rendered links (lane l-chrome2a): link cards in a real chat, as a member and as an admin. The Space attaches the reader's level to each card when it serves the message, so the first
// draw is right: a card for a thing the person cannot open shows what kind of thing it is and "Ask for access", never its name. ?part=member | admin
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { MessageView } from "../../../apps/app/src/places/chats/conversation/MessageView.tsx";
import { timeline } from "../../../apps/app/src/places/chats/conversation/model.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Rendered links";

const card = (id: string, data: Record<string, unknown>): Message => ({
  messageId: `msg_${id}`, threadId: "thr_r", threadSeq: Number(id.length), author: { kind: "person", id: "usr_olivia" }, kind: "system", body: String(data["lead"]),
  blocks: [{ id: `blk_${id}`, type: "link_card", v: 1, state: "done", data }] as never, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2026, 10, 4, 9, 30 + id.length),
} as unknown as Message);

function Page({ part }: { part: string }): ReactNode {
  const items = useMemo(() => timeline([
    card("a", { icon: "task", lead: "Task created", title: "Send the retainer to Rivera", who: "usr_maya", target: { type: "task", id: "tsk_ok" }, reach: "view" }),
    card("bb", { icon: "task", lead: "Task created", title: "Settlement offer for the Rivera estate", target: { type: "task", id: "tsk_private" }, reach: part === "member" ? "none" : "view" }),
    card("ccc", { icon: "file", lead: "File shared", title: "Okafor medical summary.pdf", target: { type: "file", id: "fil_private" }, reach: part === "member" ? "none" : "manage" }),
  ], { meId: "usr_olivia", nameOf: (id: string) => ({ usr_maya: "Maya", usr_olivia: "Olivia Reed" } as Record<string, string>)[id] ?? id, kindOf: () => "person", clock: { now: Date.UTC(2026, 10, 4, 15, 0), offsetMin: -300 } }), [part]);
  const actions = useMemo(() => ({ nameOf: (id: string) => ({ usr_maya: "Maya" } as Record<string, string>)[id] ?? id, host: { invoke: async () => ({}) }, copy() {}, openThread() {}, setPinned() {}, react() {}, remove() {}, openAgent() {}, showMenu() {} }), []);
  return (
    <View testID={`reach-cards-${part}`} style={{ flex: 1, minHeight: 420, padding: 24, backgroundColor: "var(--win)" as string }}>
      <View style={{ maxWidth: 720, width: "100%" }}>{items.map((it) => <MessageView key={it.key} item={it} actions={actions as never} meId="usr_olivia" />)}</View>
    </View>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "member"), []);
  return part === null ? null : <Page part={part} />;
}
