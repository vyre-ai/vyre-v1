// Chats in the shell (spec 3.2): the sidebar on the left, the open conversation in the middle, the agent's pane on the right when it is toggled on. The open chat is this place's own
// state (a click in the sidebar, a helper or a thread in the pane changes it); until one is picked the place opens the newest chat the Space has. Before the Space's runtime exists the
// place draws its loading frame (sidebar rows and a conversation skeleton), the size of the real one.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { ChatsSidebar, ChatsSidebarLoading } from "../../places/chats/sidebar/ChatsSidebar.tsx";
import { LOCAL_PREFIX } from "../../places/chats/sidebar/model.ts";
import { Conversation, ConversationLoading } from "../../places/chats/conversation/Conversation.tsx";
import { ChatRightPane } from "../../places/chats/rightpane/ChatRightPane.tsx";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import { conversationData, paneData, sidebarData } from "./chats-data.ts";
import type { ChatsActions } from "./chats-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

type RecentOut = CapMap["chat.recent"]["out"];
type ThreadOut = CapMap["threads.get"]["out"];

export const SIDEBAR_W = 264;
export const PANE_W = 340;

const NO_PEOPLE: Principal[] = [];
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
function useLive<T>(q: LiveQuery<T> | null): QueryState<T> {
  const live = (q ?? NEVER) as LiveQuery<T>;
  return useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
}

/** The newest chat or channel the Space has, in the order the sidebar lists them. */
export function newestThread(recent: RecentOut | undefined): string | null {
  if (!recent) return null;
  for (const g of [recent.starred, recent.today, recent.yesterday, recent.earlier]) {
    const first = g.find((i) => !i.threadId.startsWith(LOCAL_PREFIX));
    if (first) return first.threadId;
  }
  return null;
}

export function ChatsLoading(): ReactElement {
  return (
    <View testID="chats-place-loading" accessibilityLabel="Loading" style={st.row}>
      <View style={st.side}><ChatsSidebarLoading /></View>
      <View style={st.main}><ConversationLoading /></View>
    </View>
  );
}

function ChatsView({ rt }: { rt: ShellRuntime }): ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const [pane, setPane] = useState(false);
  const recent = useLive(useMemo(() => rt.screens.query("chats.sidebar", "recent", { filter: "all" }) as LiveQuery<RecentOut>, [rt]));
  const principals = useLive<Principal[]>(rt.principals);
  const list = principals.status === "ready" ? principals.data : NO_PEOPLE;
  const threadId = picked ?? newestThread(recent.status === "ready" ? recent.data : undefined);

  const actions = useMemo<ChatsActions>(() => ({
    openThread: (id) => { if (!id.startsWith(LOCAL_PREFIX)) setPicked(id); },
    togglePane: () => setPane((v) => !v),
    openAgentChat: (agentId) => {
      void rt.call("chat.start", { kind: "chat", agentIds: [agentId] }).then((out) => {
        const id = (out as { thread?: { threadId?: string } } | null)?.thread?.threadId;
        if (id) setPicked(id);
      }, () => undefined);
    },
    fillComposer: () => undefined,
  }), [rt]);

  const side = useMemo(() => sidebarData(rt, actions), [rt, actions]);
  const conv = useMemo(() => (threadId ? conversationData(rt, actions, threadId, list) : null), [rt, actions, threadId, list]);
  const thread = useLive(useMemo(() => (threadId ? (rt.screens.query("chats.conversation", "thread", { threadId }) as LiveQuery<ThreadOut>) : null), [rt, threadId]));
  const lead = thread.status === "ready" ? (thread.data.thread.agents.find((a) => a.mode === "lead") ?? thread.data.thread.agents[0]) : undefined;
  const agent = lead ? { agentId: lead.agentId, name: list.find((p) => p.id === lead.agentId)?.name ?? lead.agentId } : { agentId: rt.assistant.id, name: rt.assistant.name };
  const paneCtx = useMemo(() => (threadId ? paneData(rt, actions, threadId, agent) : null), [rt, actions, threadId, agent.agentId, agent.name]); // eslint-disable-line react-hooks/exhaustive-deps -- the agent is read by id and name

  const toggle = useCallback(() => setPane((v) => !v), []);
  return (
    <View testID="chats-place" style={st.row}>
      <View style={st.side}><ChatsSidebar data={side} /></View>
      <View style={st.main}>{conv ? <Conversation key={conv.threadId} data={conv} /> : <ConversationLoading />}</View>
      {pane && paneCtx ? <View style={st.pane}><ChatRightPane data={paneCtx} open onToggle={toggle} /></View> : null}
    </View>
  );
}

export default function ChatsPlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <ChatsView rt={rt} /> : <ChatsLoading />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  pane: { width: PANE_W, minHeight: 0 },
});
