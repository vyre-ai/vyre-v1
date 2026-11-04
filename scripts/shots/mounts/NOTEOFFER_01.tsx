// Mount for NOTEOFFER_01 (lane l-learn2): "Save as a note?" in a chat. ?view=offer shows the card an agent offers under its answer: a preview of the note, Private to you, Save and Not now.
// ?view=saved shows the quiet line after Save: Saved to Notes, Open, with nothing of the note in it. The chat is the real Conversation over the sample thread.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Save as a note? in a chat";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Doc = { documentElement?: RootLike };

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page view={q.get("view") ?? "offer"} skin={q.get("skin") ?? "paper"} /> : <View testID="noteoffer-wait" style={{ flex: 1 }} />;
}

function Page({ view, skin }: { view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const sample = useMemo(() => {
    const s = createSample("idle");
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    const last = rows[rows.length - 1]!;
    const saved = view === "saved";
    const offer: Message = {
      messageId: "msg_offer", threadId: s.data.threadId, threadSeq: last.threadSeq + 1, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "", depth: 0, attachments: [], reactions: [], pinned: false,
      createdAt: last.createdAt + 60_000,
      blocks: [{ type: "note_offer", v: 1, id: "blk_offer", state: "done", traceId: "tr", data: { threadId: s.data.threadId, blockId: "blk_offer", person: s.data.me.id, title: "Rivera intake: the Tuesday booking", body: "Booked Tuesday at 2:00 with Maya. Elena gets the invite with the form link; Intake posts in #intake when the form comes back.", topic: "rivera booking", state: saved ? "saved" : "offered", ...(saved ? { noteId: "nte_1" } : {}) } }],
    } as unknown as Message;
    s.replica.put("messages", [{ id: offer.messageId, ...offer }]);
    return s.data;
  }, [view]);
  return <View testID="noteoffer-mount" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={sample} /></View>;
}
