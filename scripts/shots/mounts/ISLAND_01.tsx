// Mount for ISLAND_01 (lane l-island2): the Island above the composer. ?view=working is the pill with the working agent, ?view=question an agent's question as the pill (choices, the recommended one filled, Other, who can answer),
// ?view=several three questions (1 of 3 and arrows). The chat is the real Conversation over the sample thread; the question card sits in the chat too.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "The Island above the composer";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Doc = { documentElement?: RootLike };

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page view={q.get("view") ?? "question"} skin={q.get("skin") ?? "paper"} /> : <View testID="island-wait" style={{ flex: 1 }} />;
}

const ASKS = [
  { id: "blk_q1", prompt: "How large can an upload be?", options: [{ key: "2gb", label: "2 GB" }, { key: "10gb", label: "10 GB", detail: "Needs a larger disk" }, { key: "none", label: "No limit", detail: "Can fill up" }] },
  { id: "blk_q2", prompt: "Move old files to cold storage after 90 days?", options: [{ key: "90", label: "After 90 days" }, { key: "fast", label: "Keep everything fast", detail: "Costs more" }] },
  { id: "blk_q3", prompt: "Which region should the files live in?", options: [{ key: "eu", label: "Europe" }, { key: "us", label: "United States", detail: "" }] },
];

function Page({ view, skin }: { view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const sample = useMemo(() => {
    const s = createSample("streaming");
    if (view === "working") return s.data;
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    const last = rows[rows.length - 1]!;
    const asks = view === "several" ? ASKS : ASKS.slice(0, 1);
    asks.forEach((a, i) => {
      const m: Message = {
        messageId: `msg_${a.id}`, threadId: s.data.threadId, threadSeq: last.threadSeq + 1 + i, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "", depth: 0, attachments: [], reactions: [], pinned: false,
        createdAt: last.createdAt + 60_000 + i,
        blocks: [{ type: "question", v: 1, id: a.id, state: "waiting", traceId: "tr", data: { prompt: a.prompt, mode: "single", options: a.options, recommended: 0, allowOther: true } }],
      } as unknown as Message;
      s.replica.put("messages", [{ id: m.messageId, ...m }]);
    });
    return s.data;
  }, [view]);
  return <View testID="island-mount" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={sample} /></View>;
}
