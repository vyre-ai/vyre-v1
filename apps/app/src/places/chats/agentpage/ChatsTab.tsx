// Agent page > Chats (spec 3.2): what the agent is working on, the chats it is in (newest first), and what it is linked to. A click opens the chat in place.
import type { ReactElement } from "react";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Face, Icon, LeadIcon, PaneList } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { useAgentPageData, useScreenQuery } from "./data.tsx";
import { chatNote, chatsOf } from "./model.ts";
import type { Summary } from "./model.ts";

type ThreadsOut = CapMap["threads.list"]["out"];

export function ChatsTab({ summary, window }: { summary: Summary; window?: VirtualWindow }): ReactElement {
  const data = useAgentPageData();
  const chats = useScreenQuery<ThreadsOut>("chats", {});
  const clock = data.clock();
  const list = chatsOf(data.agent.agentId, chats.status === "ready" ? chats.data.threads : []);
  const entries: Entry[] = [];
  if (summary.workingOn.length > 0) {
    entries.push({ key: "l-working", type: "label", text: "Working on" });
    for (const w of summary.workingOn) entries.push({ key: `w-${w.id}`, type: "row", title: w.title, note: w.kind, leading: <LeadIcon name="clock" color="var(--accent)" />, onPress: () => data.nav.openSource(w.kind, w.id), testID: `working-${w.id}` });
  }
  entries.push({ key: "l-chats", type: "label", text: "Chats", right: list.length > 0 ? String(list.length) : "" });
  if (chats.status === "loading") entries.push({ key: "chats-loading", type: "empty", text: "Loading…", testID: "chats-loading" });
  else if (list.length === 0) entries.push({ key: "no-chats", type: "empty", text: `No chats with ${data.agent.name} yet. Press Chat to start one.`, testID: "chats-empty" });
  for (const t of list) {
    entries.push({
      key: `c-${t.threadId}`, type: "row", title: t.title ?? "New chat", note: chatNote(t, clock), leading: <Face name={data.agent.name} size={16} />,
      onPress: () => data.nav.openChat(t.threadId), testID: `chat-${t.threadId}`,
      menu: [{ label: "Open", onSelect: () => data.nav.openChat(t.threadId) }, { label: "Open to the Side", onSelect: () => data.nav.openThread(t.threadId, "side") }],
    });
  }
  if (summary.linked.length > 0) {
    entries.push({ key: "l-linked", type: "label", text: "Linked" });
    for (const l of summary.linked) entries.push({ key: `l-${l.id}`, type: "row", title: l.title, note: l.kind, leading: <LeadIcon name="folder" />, onPress: () => data.nav.openSource(l.kind, l.id), trailing: <Icon name="chev" size={12} />, testID: `linked-${l.id}` });
  }
  return <PaneList entries={entries} {...(window ? { window } : {})} testID="chats-list" />;
}
