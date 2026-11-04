// Mount for HOOKS_01 (lane l-hooks): ?view=lines shows the quiet lines a hook leaves in the chat (added, set for helpers, stopped something); ?view=tab shows the right pane on Hooks, grouped by where
// each hook comes from; ?view=helper shows a helper's own page with its hooks (From the lead, Inherited). Real components over the sample Spaces.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { createSample as createPaneSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import { HelperChat } from "../../../apps/app/src/places/chats/helper/HelperChat.tsx";
import { createSample as createHelperSample } from "../../../apps/app/src/places/chats/helper/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Hooks";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Doc = { documentElement?: RootLike };

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page view={q.get("view") ?? "lines"} skin={q.get("skin") ?? "paper"} /> : <View testID="hooks-wait" style={{ flex: 1 }} />;
}

function Page({ view, skin }: { view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const lines = useMemo(() => {
    const s = createSample("idle");
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    // a short chat, so the hook lines and the reply fit above the composer
    s.replica.remove("messages", rows.slice(2).map((r) => r.id));
    let seq = rows[1]!.threadSeq, at = rows[1]!.createdAt;
    const quiet = (id: string, line: string, kind: string, extra: Record<string, unknown> = {}): Message => {
      seq += 1; at += 60_000;
      return { messageId: id, threadId: s.data.threadId, threadSeq: seq, author: { kind: "agent", id: "agt_intake" }, kind: "quiet", body: line, depth: 0, attachments: [], reactions: [], createdAt: at,
        blocks: [{ type: "hook", v: 1, id: `blk_${id}`, state: "done", traceId: "tr", data: { threadId: s.data.threadId, kind, line, hookId: "hok_chat", scope: "chat", by: "agt_intake", byKind: "agent", ...extra } }] } as unknown as Message;
    };
    const made = [
      quiet("msg_hook1", "Intake added a hook in this chat: before any email, check the address is in Contacts", "added"),
      quiet("msg_hook2", "Intake set a hook for its helpers: before a helper opens a link, only open links from the quotes you were sent", "added", { hookId: "hok_run", scope: "run" }),
      quiet("msg_hook3", "A hook stopped this: the address isn't in Contacts", "blocked", { reason: "the address isn't in Contacts", agentId: "agt_intake", next: [{ label: "Add Harbor Supply to Contacts", ask: "Please add Harbor Supply to Contacts, then send the email" }, { label: "Send once without adding", ask: "Send it once without adding them, I will check it myself" }] }),
      { messageId: "msg_hook4", threadId: s.data.threadId, threadSeq: seq + 1, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "I did not send it. Harbor Supply's address is not in Contacts yet.", depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at + 5_000, blocks: [] } as unknown as Message,
    ];
    s.replica.put("messages", made.map((m) => ({ id: m.messageId, ...m })));
    return { ...s.data, nav: { ...s.data.nav, openHooks: () => undefined } };
  }, []);
  const pane = useMemo(() => createPaneSample("northwind", { hooks: true, admin: false }), []);
  const helper = useMemo(() => createHelperSample("done", { hooks: true }), []);
  if (view === "tab") return <View testID="hooks-mount" style={{ flex: 1, flexDirection: "row" }}><View style={{ flex: 1 }} /><ChatRightPane data={pane.data} open onToggle={() => undefined} tab="hooks" hookSel="hok_chat" window={{ start: 0, end: 500 }} /></View>;
  if (view === "helper") return <View testID="hooks-mount" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><HelperChat data={{ ...helper.data, nav: { ...helper.data.nav, openHooks: () => undefined } }} /></View>;
  return <View testID="hooks-mount" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={lines} /></View>;
}
