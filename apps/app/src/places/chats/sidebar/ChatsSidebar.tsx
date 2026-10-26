// The Chats sidebar (spec 3.2, 2.23, ARCH 7.2): the Space and search at the top, then Needs you (only when something waits), Starred agent faces (Cmd-1..9), Chats grouped
// Starred, Today, Yesterday and Earlier with a pulse where an agent works, then Channels with Projects beneath. One flat list in ui/VirtualList, every row a ui/Row with
// leading and trailing slots (ruling 36). Everything reads from the local copy; a new chat shows as a row at once and the server answers behind it.
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { SidebarContent, each } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import type { QueryFailure } from "../../../../../../client/src/query/types.ts";
import { portalInto } from "../../../shell/sidebar/portal.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { FACES_SHOWN } from "./model.ts";
import { createSidebarApi } from "./actions.ts";
import type { SidebarApi } from "./actions.ts";
import { ChatsSidebarDataProvider, useOnline, useOptionalSidebarData, useScreenQuery, useSidebarData } from "./data.tsx";
import type { ChatsSidebarData } from "./data.tsx";
import {
  FILTERS, NEW_CHAT_MS, buildEntries, faceForDigit, filterCounts, groupRecent, matchesFilter, matchesQuery, needsKind, selectable, stepKey, waitingAgents, whenLabel,
} from "./model.ts";
import type { Agent, ChatRow, Entry, Filter, Group, NeedsItem, RecentOut, SectionKey } from "./model.ts";
import { Badge, EmptyLine, Face, GroupLabel, Glyph, LeadGlyph, SectionHead, Tool, UnreadDot } from "./parts.tsx";
import type { Channel } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export const SIDEBAR_SCREEN = "chats.sidebar";
export const AGENTS_SCREEN = "chats.all-agents";
export const NEEDS_SCREEN = "home.needs-you-top3";
export const ROW_H = 28;

type ChannelsOut = CapMap["channels.list"]["out"];
type AgentsOut = CapMap["agents.list"]["out"];
type NeedsOut = CapMap["tasks.needs_you"]["out"];

const EMPTY_RECENT: RecentOut = { starred: [], today: [], yesterday: [], earlier: [], nextUnread: null };

/** Rows that react to the pointer: tools and times appear on hover or selection. */
function Hot({ children }: { children: (over: boolean) => ReactElement }): ReactElement {
  const [over, setOver] = useState(false);
  return <View style={{ minHeight: ROW_H }} {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>{children(over)}</View>;
}

export function useSidebarApi(onLocal: (row: ChatRow) => void, onSettled: (localId: string) => void): SidebarApi {
  const data = useSidebarData();
  return useMemo(() => createSidebarApi(data, onLocal, onSettled), [data, onLocal, onSettled]);
}

/** The Chats sidebar's content, drawn into the shell's shared place sidebar (title, collapse and search field are the slot's). `window` pins which entries are drawn (tests and
 * screenshots draw them all); the shell leaves it out and the list windows by scroll. `query` is the slot's search field; `slot` lets the phone leave the list for the chat. */
export function ChatsSidebar({ data, window, query = "", slot }: { data?: ChatsSidebarData; window?: VirtualWindow; query?: string; slot?: SidebarSlotApi | undefined }): ReactElement {
  const ctx = useOptionalSidebarData();
  const value = data ?? ctx;
  if (!value) return <ChatsSidebarLoading />;
  return <ChatsSidebarDataProvider value={value}><Sidebar query={query} slot={slot} {...(window ? { window } : {})} /></ChatsSidebarDataProvider>;
}

/** Put this inside the Chats place: it registers the Chats sidebar in the shell's shared slot, so it collapses, searches and lands on the phone like every place. */
export function ChatsSidebarSlot({ data, window }: { data?: ChatsSidebarData; window?: VirtualWindow }): ReactElement {
  return (
    <SidebarContent title="Chats" searchPlaceholder="Search chats">
      {(query, slot) => <ChatsSidebar query={query} slot={slot} {...(data ? { data } : {})} {...(window ? { window } : {})} />}
    </SidebarContent>
  );
}

/** The frame before data: rows the size of the real ones, so nothing moves when the data arrives. */
export function ChatsSidebarLoading(): ReactElement {
  const rows: ReactElement[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(<View key={i} style={{ height: ROW_H, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}><View style={st.skFace} /><View style={[st.skBar, { width: `${40 + ((i * 17) % 40)}%` }]} /></View>);
  }
  return <View testID="chats-sidebar-loading" accessibilityLabel="Loading" style={st.root}><View style={st.top} />{rows}</View>;
}

function Sidebar({ window, query, slot }: { window?: VirtualWindow; query: string; slot: SidebarSlotApi | undefined }): ReactElement {
  const data = useSidebarData();
  const online = useOnline();
  const menu = useMenu();
  const [filter, setFilter] = useState<Filter>("all");
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [local, setLocal] = useState<ChatRow[]>([]);
  const onLocal = useCallback((row: ChatRow) => { setLocal((l) => [row, ...l]); setCursor(`c:${row.threadId}`); }, []);
  const onSettled = useCallback((id: string) => setLocal((l) => l.filter((r) => r.threadId !== id)), []);
  const api = useSidebarApi(onLocal, onSettled);

  const recentQ = useScreenQuery<RecentOut>(SIDEBAR_SCREEN, "recent", { filter: "all" });
  const channelsQ = useScreenQuery<ChannelsOut>(SIDEBAR_SCREEN, "channels", {});
  const agentsQ = useScreenQuery<AgentsOut>(AGENTS_SCREEN, "agents", {});
  // The prototype lists every request under Needs you, not only the top three.
  const needsQ = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "items", {});
  const allNeedsQ = needsQ;
  const waiting = useMemo(() => waitingAgents(allNeedsQ.status === "ready" ? allNeedsQ.data.items : [], data.space.assistant.agentId), [allNeedsQ]);

  const agents: Agent[] = agentsQ.status === "ready" ? agentsQ.data.agents : [];
  const names = useMemo(() => new Map(agents.map((a) => [a.agentId, a.name])), [agents]);
  const agentName = useCallback((id: string) => names.get(id) ?? id, [names]);
  // The Agents group is the Space's agents (agents.list takes no "starred" input; starring becomes its own packet): the first FACES_SHOWN of them, the rest behind All agents.
  // Not the assistant (its mark sits beside New chat). An agent waiting on you always comes first, so the cap can never hide one; everyone else keeps the Space's order.
  const matching: Agent[] = useMemo(() => {
    const own = agents.filter((a) => a.agentId !== data.space.assistant.agentId && matchesQuery(query, a.name));
    return [...own.filter((a) => waiting.has(a.agentId)), ...own.filter((a) => !waiting.has(a.agentId))];
  }, [agents, query, waiting, data.space.assistant.agentId]);
  const faces: Agent[] = useMemo(() => matching.slice(0, FACES_SHOWN), [matching]);
  const facesMore = matching.length - faces.length;
  const recent = recentQ.status === "ready" ? recentQ.data : EMPTY_RECENT;
  const allChannels: Channel[] = channelsQ.status === "ready" ? channelsQ.data.channels : [];
  const channels: Channel[] = useMemo(() => allChannels.filter((c) => matchesQuery(query, c.name)), [allChannels, query]);
  const allNeeds: NeedsItem[] = needsQ.status === "ready" ? needsQ.data.items : [];
  const needs: NeedsItem[] = useMemo(() => allNeeds.filter((n) => matchesQuery(query, n.task.title, agentName(n.task.createdBy))), [allNeeds, query, agentName]);
  // A read that failed ends the skeleton and says so, for that section only (never the empty state: empty means nothing is here). The other sections draw what they have.
  const failures: { key: string; label: string; error: QueryFailure }[] = [];
  for (const [key, label, q] of [["recent", "Chats", recentQ], ["channels", "Channels", channelsQ], ["agents", "Agents", agentsQ], ["needs", "Needs you", needsQ]] as const) {
    if (q.status === "loading" && q.error !== undefined) failures.push({ key, label, error: q.error });
  }
  const failed = (key: string): boolean => failures.some((f) => f.key === key);
  const pending = (q: { status: string; error?: unknown }): boolean => q.status === "loading" && q.error === undefined;
  const loading = pending(recentQ) || pending(channelsQ) || pending(agentsQ);

  const counts = useMemo(() => filterCounts(recent, local, agentName), [recent, local, agentName]);
  const groups: Group[] = useMemo(
    () => groupRecent(recent, local, agentName).map((g) => ({ ...g, rows: g.rows.filter((r) => matchesFilter(r, filter) && matchesQuery(query, r.title, r.who)) })).filter((g) => g.rows.length),
    [recent, local, agentName, filter, query],
  );
  const working = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const r of g.rows) if (r.working && r.kind === "agent") set.add(agents.find((a) => a.name === r.who)?.agentId ?? r.who);
    return set;
  }, [groups, agents]);

  const entries = useMemo(
    () => buildEntries({ needs, needsTotal: needsQ.status === "ready" ? needsQ.data.total : 0, faces, workingAgents: working, waitingAgents: waiting, groups, channels, filter, closed, facesMore, recentFailed: failed("recent") }),
    [needs, needsQ, faces, facesMore, recentQ, working, waiting, groups, channels, filter, closed],
  );
  const order = useMemo(() => selectable(entries), [entries]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  // Choosing a thing takes the phone from the list to the page (the slot's openBody); on a computer it does nothing.
  const leave = (): void => slot?.openBody();
  const toggle = (s: SectionKey): void => setClosed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const guard = (p: Promise<unknown>): void => void p.catch(() => undefined);

  // ----- menus: each entry changes real state or opens the thing
  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = FILTERS.map((f) => ({ label: `${f.label}  ${counts[f.key]}`, checked: filter === f.key, onSelect: () => setFilter(f.key) }));
    items.push({ separator: true }, { label: "Next unread", onSelect: () => nextUnread() });
    menu.show(items, x, y, "other");
  };
  const nextUnread = (): void => { if (recent.nextUnread) { setCursor(`c:${recent.nextUnread}`); data.nav.openChat(recent.nextUnread); leave(); } };
  const chatMenu = (r: ChatRow): MenuEntry[] => [
    { label: "Open", onSelect: () => { data.nav.openChat(r.threadId); leave(); } },
    { separator: true },
    { label: r.starred ? "Remove Star" : "Star", onSelect: () => guard(api.star("thread", r.threadId, !r.starred)) },
    ...(r.unread > 0 ? [{ label: "Mark as Read", onSelect: () => guard(api.markRead(r.threadId)) }] : []),
  ];
  const faceMenu = (a: Agent): MenuEntry[] => [
    { label: `Chat with ${a.name}`, onSelect: () => { data.nav.openAgentChat(a.agentId); leave(); } },
    { label: "New Chat", onSelect: () => { void api.newChat({ agentId: a.agentId, name: a.name }); leave(); } },
    { separator: true },
    { label: "Remove from Starred", onSelect: () => guard(api.star("agent", a.agentId, false)) },
    { label: "All Agents", onSelect: () => { data.nav.openAllAgents(); leave(); } },
  ];
  const channelMenu = (c: Channel): MenuEntry[] => [
    { label: "Open", onSelect: () => { data.nav.openChannel(c.channelId); leave(); } },
    { separator: true },
    ...(c.unread > 0 ? [{ label: "Mark as Read", onSelect: () => guard(api.markRead(c.mainThreadId)) }] : []),
    { label: "Star", onSelect: () => guard(api.star("channel", c.channelId, true)) },
  ];
  const needMenu = (n: NeedsItem): MenuEntry[] => [
    ...n.task.actions.map((a) => ({ label: a.label, onSelect: () => guard(data.call("tasks.act", { taskId: n.task.id, action: a.key })) })),
    ...(n.task.actions.length ? [{ separator: true } as MenuEntry] : []),
    { label: "Open in Needs you", onSelect: () => { data.nav.openNeedsYou(n.task.id); leave(); } },
  ];

  const open = (e: Entry): void => {
    setCursor(e.key);
    if (e.type === "chat") data.nav.openChat(e.row.threadId);
    else if (e.type === "face") data.nav.openAgentChat(e.agent.agentId);
    else if (e.type === "channel") data.nav.openChannel(e.channel.channelId);
    else if (e.type === "need") data.nav.openNeedsYou(e.item.task.id);
    else if (e.type === "more") data.nav.openAllAgents();
    else if (e.type === "head") { toggle(e.section); return; }
    leave();
  };
  const menuFor = (e: Entry): MenuEntry[] | null =>
    e.type === "chat" ? chatMenu(e.row) : e.type === "face" ? faceMenu(e.agent) : e.type === "channel" ? channelMenu(e.channel) : e.type === "need" ? needMenu(e.item) : null;

  // ----- keyboard: arrows move, Enter opens, Cmd-1..9 jump to a starred face
  const onKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault?.(); setCursor(stepKey(order, cursor, ev.key === "ArrowDown" ? 1 : -1)); return; }
    if (ev.key === "Enter" && cursor) { const e = byKey.get(cursor); if (e) { ev.preventDefault?.(); open(e); } }
  };
  const facesRef = useRef(faces);
  facesRef.current = faces;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const a = faceForDigit(facesRef.current, e.key);
      if (!a) return;
      e.preventDefault();
      setCursor(`f:${a.agentId}`);
      data.nav.openAgentChat(a.agentId);
      slot?.openBody();
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [data, slot]);

  const renderEntry = (e: Entry): ReactElement => {
    const sel = cursor === e.key;
    const wrap = (child: ReactElement): ReactElement => {
      const m = menuFor(e);
      return m ? <View style={{ minHeight: ROW_H }} {...menuTrigger((x, y) => menu.show(m, x, y, "context", { label: e.key }))}>{child}</View> : child;
    };
    switch (e.type) {
      case "head": {
        if (e.section === "needs") {
          // The prototype's Needs you is one row with the inbox glyph and the count; its requests sit under it as child rows. The chevron folds them.
          return (
            <View testID="head-needs" style={{ minHeight: ROW_H }}>
              <Row
                id="needs-parent" title="Needs you" onPress={() => { data.nav.openNeedsYou(); leave(); }}
                leading={<LeadGlyph name="inbox" />}
                titleMarks={
                  // The fold chevron follows the label at the head chevron's size and tint, as every other section head draws it.
                  <Pressable accessibilityRole="button" accessibilityLabel={`Needs you, ${e.count ?? 0}`} accessibilityState={{ expanded: e.open }} onPress={() => toggle("needs")} testID="toggle-needs" style={{ alignSelf: "center", transform: [{ rotate: e.open ? "0deg" : "-90deg" }] }}>
                    <Glyph name="chev" size={11} color="var(--ink-4)" />
                  </Pressable>
                }
                trailing={e.count ? <Badge n={e.count} testID="count-needs" /> : null}
              />
            </View>
          );
        }
        const recentHead = e.section === "recent";
        return (
          <SectionHead id={e.section} label={e.label} count={e.section === "needs" ? e.count : undefined} open={e.open} onToggle={() => toggle(e.section)} keep={recentHead && filter !== "all"}>
            {recentHead ? <Tool icon="filter" label="Filter chats" active={filter !== "all"} onPress={filterMenu} testID="filter-chats" /> : null}
            {recentHead ? <Tool icon="plus" label="New chat" onPress={() => { void api.newChat(); leave(); }} testID="new-chat-section" /> : null}
            {e.section === "faces" ? <Tool icon="arrow" label="All agents" onPress={() => { data.nav.openAllAgents(); leave(); }} testID="all-agents" /> : null}
            {e.section === "channels" ? <Tool icon="plus" label="New channel" onPress={() => { data.nav.openNewChannel(); leave(); }} testID="new-channel" /> : null}
          </SectionHead>
        );
      }
      case "group": return <GroupLabel label={e.label} />;
      case "empty": return (
        <View>
          <EmptyLine text={e.text} />
        </View>
      );
      case "need": {
        const k = needsKind(e.item);
        const who = agentName(e.item.task.createdBy);
        return wrap(
          <Hot>
            {(over) => (
              <Row
                id={e.key} title={e.item.task.title} selected={sel} onPress={() => open(e)}
                leading={<Face name={who} seedId={e.item.task.createdBy} kind="agent" size={16} />}
                trailing={over && e.item.task.actions.length && k.tone === "accent"
                  ? <Tool icon="check" label={`${e.item.task.actions[0]!.label} ${e.item.task.title}`} onPress={() => guard(api.act(e.item))} testID={`need-act-${e.item.task.id}`} />
                  : <Text style={[st.kind, k.tone === "warn" && st.kindWarn]}>{k.label}</Text>}
              />
            )}
          </Hot>,
        );
      }
      case "face": return wrap(
        <Hot>
          {(over) => (
            <Row
              id={e.key} title={e.agent.name} selected={sel} onPress={() => open(e)}
              leading={<Face name={e.agent.name} seedId={e.agent.agentId} kind="agent" size={18} pulse={e.working} />}
              trailing={over
                ? <View style={st.tools}>{e.digit !== undefined ? <Text style={st.digit}>{`⌘${e.digit}`}</Text> : null}<Tool icon="plus" label={`New chat with ${e.agent.name}`} onPress={() => { void api.newChat({ agentId: e.agent.agentId, name: e.agent.name }); leave(); }} testID={`face-new-${e.agent.agentId}`} /></View>
                : e.waiting ? <Text style={st.waiting}>Waiting on you</Text> : e.working ? <Text style={st.quiet}>Working</Text> : null}
            />
          )}
        </Hot>,
      );
      case "more": return (
        <Row id={e.key} title={e.label} selected={sel} onPress={() => open(e)} leading={<LeadGlyph name="arrow" />} />
      );
      case "chat": {
        const r = e.row;
        return wrap(
          <Hot>
            {(over) => (
              <Row
                id={e.key} title={r.title} selected={sel} emphasis={r.unread > 0} onPress={() => open(e)}
                leading={<Face name={r.who} seedId={r.whoId} kind={r.kind} size={18} pulse={r.working} />}
                trailing={
                  <View style={st.tools}>
                    {r.starred && !over ? <Glyph name="star" size={12} color="var(--ink-4)" fill="var(--ink-4)" /> : null}
                    {r.unread > 0 && !over ? <UnreadDot /> : null}
                    {over ? <Text style={st.time}>{whenLabel(r.lastAt, data.clock().now, data.clock().offsetMin)}</Text> : null}
                  </View>
                }
              />
            )}
          </Hot>,
        );
      }
      case "channel": {
        const c = e.channel;
        // A channel with nothing new sits dim; one with unread stands out at full strength with its count (prototype .unread / .dim).
        return wrap(
          <View style={{ minHeight: ROW_H, opacity: c.unread > 0 ? 1 : 0.72 }} testID={c.unread > 0 ? `channel-unread-${c.channelId}` : `channel-read-${c.channelId}`}>
            <Row
              id={e.key} title={c.name} selected={sel} emphasis={c.unread > 0} onPress={() => open(e)}
              leading={<LeadGlyph name={e.project ? "project" : c.visibility === "invite" ? "lock" : "hash"} />}
              trailing={c.unread > 0 ? <Badge n={c.unread} testID={`unread-${c.channelId}`} /> : null}
            />
          </View>,
        );
      }
    }
  };

  // In the shell the assistant's new-chat button sits in the slot's header, right of the title beside the collapse button (the prototype's "Chats ... V [panel]"); alone it sits in a row of its own.
  const inHeader = slot?.actionsOutlet !== undefined && slot.actionsOutlet !== null;
  // The other-Space dot sits beside the assistant's button in the slot's header (the prototype puts it by the Space name), never alone on a row under the search field.
  const headBusy = !online || (data.space.otherNeedsYou && !inHeader);
  const otherDot = data.space.otherNeedsYou ? <View testID="other-space-dot" accessibilityLabel="Another Space needs you" {...{ title: "Another Space needs you" }} style={st.red} /> : null;
  const newChatButton = (
    <Pressable accessibilityRole="button" accessibilityLabel={`New chat with ${data.space.assistant.name}`} {...{ title: `New chat with ${data.space.assistant.name}` }} onPress={() => { void api.newChat(); leave(); }} testID="new-chat" style={({ hovered }: { hovered?: boolean }) => [st.assistant, hovered === true && st.assistantOver]}>
      <Avatar name={data.space.assistant.name} kind="assistant" size={18} />
    </Pressable>
  );
  return (
    <View testID="chats-sidebar" accessibilityRole="list" accessibilityLabel="Chats" style={st.root} {...{ tabIndex: 0, onKeyDown }}>
      {headBusy || !inHeader ? (
        <View style={st.top} testID="sidebar-head" accessibilityLabel={`Chats, ${data.space.name}`}>
          {otherDot}
          {online ? null : <Text testID="sidebar-offline" style={st.quiet}>Offline</Text>}
          <View style={{ flex: 1 }} />
          {inHeader ? null : newChatButton}
        </View>
      ) : null}
      {inHeader ? portalInto(slot?.actionsOutlet, <View style={st.headTools}>{otherDot}{newChatButton}</View>) : null}
      {each(failures, (f) => (
        <View key={f.key} testID={`section-error-${f.key}`} accessibilityLabel={`${f.label} could not load`}>
          <States kind="error" message={`${f.label} could not load`} cause={f.error.message} {...(f.error.code ? { code: f.error.code } : {})} {...(f.error.traceId ? { traceId: f.error.traceId } : {})} />
        </View>
      ))}
      <View style={st.list}>
        {loading ? <ChatsSidebarLoading /> : (
          <VirtualList data={entries} rowHeight={ROW_H} keyOf={(e) => e.key} renderItem={(e) => renderEntry(e)} {...(window ? { window } : {})} />
        )}
      </View>
      {menu.element}
    </View>
  );
}

/** Time budget helper for the proof: how long a new chat takes to show as a row. Exported so the test and the mount share one measure. */
export const NEW_CHAT_BUDGET_MS = NEW_CHAT_MS;

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, paddingHorizontal: 8 },
  top: { height: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, paddingBottom: 4 },
  assistant: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  assistantOver: { backgroundColor: "var(--press)" as string },
  red: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
  headTools: { flexDirection: "row", alignItems: "center", gap: 6 },
  list: { flex: 1, minHeight: 0 },
  tools: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontSize: 11, color: "var(--ink-3)" as string },
  digit: { fontSize: 11, color: "var(--ink-4)" as string },
  waiting: { fontSize: 11.5, color: "var(--accent)" as string },
  quiet: { fontSize: 11.5, color: "var(--ink-3)" as string },
  kind: { fontSize: 11.5, color: "var(--accent)" as string, fontWeight: "500" },
  kindWarn: { color: "var(--warn)" as string },
  skFace: { width: 18, height: 18, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});
