// Right pane > Threads (spec 3.2): the threads this agent worked in under the open chat, its helpers (running first), and its own chats. A click opens in place; Option-click,
// the row's side button or "Open to the Side" opens beside as a side tab. Helpers live under the chat that started them, so they appear here and never in the sidebar.
import type { ReactElement } from "react";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { copyText } from "./actions.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { groupThreads, helperNote, threadNote } from "./model.ts";
import type { Helper, Thread } from "./model.ts";
import { Face, LeadIcon, PaneList, Tool } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type ThreadsOut = CapMap["threads.list"]["out"];
type HelpersOut = CapMap["chat.helpers.list"]["out"];

export const PANE_SCREEN = "chats.right-pane";
export const AGENT_PAGE_SCREEN = "chats.agent-page";

export function ThreadsTab({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const children = useScreenQuery<ThreadsOut>(PANE_SCREEN, "threads", { threadId: data.threadId });
  const helpers = useScreenQuery<HelpersOut>(PANE_SCREEN, "helpers", { threadId: data.threadId });
  const chats = useScreenQuery<ThreadsOut>(AGENT_PAGE_SCREEN, "chats", {});
  const clock = data.clock();
  const g = groupThreads(
    data.agent.agentId,
    children.status === "ready" ? children.data.threads : [],
    helpers.status === "ready" ? helpers.data.helpers : [],
    chats.status === "ready" ? chats.data.threads : [],
  );
  const side = (t: { threadId: string }): ReactElement => <Tool icon="expand" label="Open to the Side" onPress={() => data.nav.openThread(t.threadId, "side")} testID={`side-${t.threadId}`} />;
  const menu = (t: { threadId: string }) => [
    { label: "Open", onSelect: () => data.nav.openThread(t.threadId, "here") },
    { label: "Open to the Side", onSelect: () => data.nav.openThread(t.threadId, "side") },
    { separator: true as const },
    { label: "Copy Link", onSelect: () => void copyText(deps, `vyre://thread/${t.threadId}`) },
  ];
  const entries: Entry[] = [];
  if (g.worked.length > 0) {
    entries.push({ key: "l-worked", type: "label", text: "Threads it worked in" });
    for (const t of g.worked as Thread[]) entries.push({ key: `t-${t.threadId}`, type: "row", title: t.title ?? "Thread", note: threadNote(t, clock), leading: <LeadIcon name="reply" />, onPress: () => data.nav.openThread(t.threadId, "here"), trailing: (over) => (over ? side(t) : null), menu: menu(t), testID: `thread-${t.threadId}` });
  }
  if (g.helpers.length > 0) {
    entries.push({ key: "l-helpers", type: "label", text: "Helpers" });
    for (const h of g.helpers as Helper[]) entries.push({ key: `h-${h.threadId}`, type: "row", title: h.title, note: helperNote(h, clock), leading: <LeadIcon name="helper" color={h.status === "running" ? "var(--accent)" : "var(--ink-3)"} />, onPress: () => data.nav.openHelper(h.threadId), menu: [{ label: "Open", onSelect: () => data.nav.openHelper(h.threadId) }, { label: "Open to the Side", onSelect: () => data.nav.openThread(h.threadId, "side") }], testID: `helper-${h.threadId}` });
  }
  entries.push({ key: "l-chats", type: "label", text: "Its chats" });
  if (g.chats.length === 0) entries.push({ key: "no-chats", type: "empty", text: "No chats yet.", testID: "chats-empty" });
  for (const t of g.chats) entries.push({ key: `c-${t.threadId}`, type: "row", title: t.title ?? "New chat", note: threadNote(t, clock), leading: <Face name={data.agent.name} size={16} />, selected: t.threadId === data.threadId, onPress: () => data.nav.openThread(t.threadId, "here"), trailing: (over) => (over ? side(t) : null), menu: menu(t), testID: `chat-${t.threadId}` });
  if (g.worked.length === 0 && g.helpers.length === 0) entries.splice(0, 0, { key: "none-worked", type: "empty", text: `${data.agent.name} has not worked in a thread here yet.`, testID: "threads-empty" });
  return <PaneList entries={entries} {...(window ? { window } : {})} testID="threads-list" />;
}
