// The Chats sidebar (spec 3.2, 2.23, ARCH 7.2): the Space and search at the top, then Needs you (only when something waits), Starred agent faces (Cmd-1..9), Chats grouped
// Starred, Today, Yesterday and Earlier with a pulse where an agent works, then Channels with Projects beneath. One flat list in ui/VirtualList, every row a ui/Row with
// leading and trailing slots (ruling 36). Everything reads from the local copy; a new chat shows as a row at once and the server answers behind it.
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { createSidebarApi } from "./actions.ts";
import type { SidebarApi } from "./actions.ts";
import { ChatsSidebarDataProvider, useOnline, useOptionalSidebarData, useScreenQuery, useSidebarData } from "./data.tsx";
import type { ChatsSidebarData } from "./data.tsx";
import {
  FILTERS, NEW_CHAT_MS, buildEntries, faceForDigit, filterCounts, groupRecent, matchesFilter, needsKind, selectable, stepKey, waitingAgents, whenLabel,
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
  return <View style={{ height: ROW_H }} {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>{children(over)}</View>;
}

export function useSidebarApi(onLocal: (row: ChatRow) => void, onSettled: (localId: string) => void): SidebarApi {
  const data = useSidebarData();
  return useMemo(() => createSidebarApi(data, onLocal, onSettled), [data, onLocal, onSettled]);
}

/** `window` pins which entries are drawn (tests and screenshots draw them all); the shell leaves it out and the list windows by scroll. */
export function ChatsSidebar({ data, window }: { data?: ChatsSidebarData; window?: VirtualWindow }): ReactElement {
  const ctx = useOptionalSidebarData();
  const value = data ?? ctx;
  if (!value) return <ChatsSidebarLoading />;
  return <ChatsSidebarDataProvider value={value}><Sidebar {...(window ? { window } : {})} /></ChatsSidebarDataProvider>;
}

/** The frame before data: rows the size of the real ones, so nothing moves when the data arrives. */
export function ChatsSidebarLoading(): ReactElement {
  const rows: ReactElement[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(<View key={i} style={{ height: ROW_H, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}><View style={st.skFace} /><View style={[st.skBar, { width: `${40 + ((i * 17) % 40)}%` }]} /></View>);
  }
  return <View testID="chats-sidebar-loading" accessibilityLabel="Loading" style={st.root}><View style={st.top} />{rows}</View>;
}

function Sidebar({ window }: { window?: VirtualWindow }): ReactElement {
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
  const facesQ = useScreenQuery<AgentsOut>(AGENTS_SCREEN, "agents", { section: "starred" });
  const agentsQ = useScreenQuery<AgentsOut>(AGENTS_SCREEN, "agents", {});
  const needsQ = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "items", { limit: 3 });
  const allNeedsQ = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "items", {});
  const waiting = useMemo(() => waitingAgents(allNeedsQ.status === "ready" ? allNeedsQ.data.items : []), [allNeedsQ]);

  const agents: Agent[] = agentsQ.status === "ready" ? agentsQ.data.agents : [];
  const names = useMemo(() => new Map(agents.map((a) => [a.agentId, a.name])), [agents]);
  const agentName = useCallback((id: string) => names.get(id) ?? id, [names]);
  const faces: Agent[] = facesQ.status === "ready" ? facesQ.data.agents : [];
  const recent = recentQ.status === "ready" ? recentQ.data : EMPTY_RECENT;
  const channels: Channel[] = channelsQ.status === "ready" ? channelsQ.data.channels : [];
  const needs: NeedsItem[] = needsQ.status === "ready" ? needsQ.data.items : [];
  const loading = recentQ.status === "loading" || channelsQ.status === "loading" || facesQ.status === "loading";

  const counts = useMemo(() => filterCounts(recent, local, agentName), [recent, local, agentName]);
  const groups: Group[] = useMemo(
    () => groupRecent(recent, local, agentName).map((g) => ({ ...g, rows: g.rows.filter((r) => matchesFilter(r, filter)) })).filter((g) => g.rows.length),
    [recent, local, agentName, filter],
  );
  const working = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const r of g.rows) if (r.working && r.kind === "agent") set.add(agents.find((a) => a.name === r.who)?.agentId ?? r.who);
    return set;
  }, [groups, agents]);

  const entries = useMemo(
    () => buildEntries({ needs, needsTotal: needsQ.status === "ready" ? needsQ.data.total : 0, faces, workingAgents: working, waitingAgents: waiting, groups, channels, filter, closed }),
    [needs, needsQ, faces, working, waiting, groups, channels, filter, closed],
  );
  const order = useMemo(() => selectable(entries), [entries]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  const toggle = (s: SectionKey): void => setClosed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const guard = (p: Promise<unknown>): void => void p.catch(() => undefined);

  // ----- menus: each entry changes real state or opens the thing
  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = FILTERS.map((f) => ({ label: `${f.label}  ${counts[f.key]}`, checked: filter === f.key, onSelect: () => setFilter(f.key) }));
    items.push({ separator: true }, { label: "Next unread", onSelect: () => nextUnread() });
    menu.show(items, x, y, "other");
  };
  const nextUnread = (): void => { if (recent.nextUnread) { setCursor(`c:${recent.nextUnread}`); data.nav.openChat(recent.nextUnread); } };
  const chatMenu = (r: ChatRow): MenuEntry[] => [
    { label: "Open", onSelect: () => data.nav.openChat(r.threadId) },
    { separator: true },
    { label: r.starred ? "Remove Star" : "Star", onSelect: () => guard(api.star("thread", r.threadId, !r.starred)) },
    ...(r.unread > 0 ? [{ label: "Mark as Read", onSelect: () => guard(api.markRead(r.threadId)) }] : []),
  ];
  const faceMenu = (a: Agent): MenuEntry[] => [
    { label: `Chat with ${a.name}`, onSelect: () => data.nav.openAgentChat(a.agentId) },
    { label: "New Chat", onSelect: () => void api.newChat({ agentId: a.agentId, name: a.name }) },
    { separator: true },
    { label: "Remove from Starred", onSelect: () => guard(api.star("agent", a.agentId, false)) },
    { label: "All Agents", onSelect: () => data.nav.openAllAgents() },
  ];
  const channelMenu = (c: Channel): MenuEntry[] => [
    { label: "Open", onSelect: () => data.nav.openChannel(c.channelId) },
    { separator: true },
    ...(c.unread > 0 ? [{ label: "Mark as Read", onSelect: () => guard(api.markRead(c.mainThreadId)) }] : []),
    { label: "Star", onSelect: () => guard(api.star("channel", c.channelId, true)) },
  ];
  const needMenu = (n: NeedsItem): MenuEntry[] => [
    ...n.task.actions.map((a) => ({ label: a.label, onSelect: () => guard(data.call("tasks.act", { taskId: n.task.id, action: a.key })) })),
    ...(n.task.actions.length ? [{ separator: true } as MenuEntry] : []),
    { label: "Open in Needs you", onSelect: () => data.nav.openNeedsYou(n.task.id) },
  ];

  const open = (e: Entry): void => {
    setCursor(e.key);
    if (e.type === "chat") data.nav.openChat(e.row.threadId);
    else if (e.type === "face") data.nav.openAgentChat(e.agent.agentId);
    else if (e.type === "channel") data.nav.openChannel(e.channel.channelId);
    else if (e.type === "need") data.nav.openNeedsYou(e.item.task.id);
    else if (e.type === "more") data.nav.openAllAgents();
    else if (e.type === "head") toggle(e.section);
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
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [data]);

  const renderEntry = (e: Entry): ReactElement => {
    const sel = cursor === e.key;
    const wrap = (child: ReactElement): ReactElement => {
      const m = menuFor(e);
      return m ? <View style={{ height: ROW_H }} {...menuTrigger((x, y) => menu.show(m, x, y, "context", { label: e.key }))}>{child}</View> : child;
    };
    switch (e.type) {
      case "head": {
        if (e.section === "needs") {
          // The prototype's Needs you is one row with the inbox glyph and the count; its requests sit under it as child rows. The chevron folds them.
          return (
            <View testID="head-needs" style={{ height: ROW_H }}>
              <Row
                id="needs-parent" title="Needs you" onPress={() => data.nav.openNeedsYou()}
                leading={<LeadGlyph name="inbox" />}
                trailing={
                  <View style={st.tools}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Needs you, ${e.count ?? 0}`} accessibilityState={{ expanded: e.open }} onPress={() => toggle("needs")} testID="toggle-needs" style={{ transform: [{ rotate: e.open ? "0deg" : "-90deg" }] }}>
                      <Glyph name="chev" size={11} color="var(--ink-4)" />
                    </Pressable>
                    {e.count ? <Badge n={e.count} testID="count-needs" /> : null}
                  </View>
                }
              />
            </View>
          );
        }
        const recentHead = e.section === "recent";
        return (
          <SectionHead id={e.section} label={e.label} count={e.section === "needs" ? e.count : undefined} open={e.open} onToggle={() => toggle(e.section)} keep={recentHead && filter !== "all"}>
            {recentHead ? <Tool icon="filter" label="Filter chats" active={filter !== "all"} onPress={filterMenu} testID="filter-chats" /> : null}
            {recentHead ? <Tool icon="plus" label="New chat" onPress={() => void api.newChat()} testID="new-chat-section" /> : null}
            {e.section === "channels" ? <Tool icon="plus" label="New channel" onPress={() => data.nav.openNewChannel()} testID="new-channel" /> : null}
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
                leading={<Face name={who} kind="agent" size={16} />}
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
              leading={<Face name={e.agent.name} kind="agent" size={18} pulse={e.working} />}
              trailing={over
                ? <View style={st.tools}>{e.digit !== undefined ? <Text style={st.digit}>{`⌘${e.digit}`}</Text> : null}<Tool icon="plus" label={`New chat with ${e.agent.name}`} onPress={() => void api.newChat({ agentId: e.agent.agentId, name: e.agent.name })} testID={`face-new-${e.agent.agentId}`} /></View>
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
                id={e.key} title={r.title} selected={sel} onPress={() => open(e)}
                leading={<Face name={r.who} kind={r.kind} size={18} pulse={r.working} />}
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
          <View style={{ height: ROW_H, opacity: c.unread > 0 ? 1 : 0.72 }} testID={c.unread > 0 ? `channel-unread-${c.channelId}` : `channel-read-${c.channelId}`}>
            <Row
              id={e.key} title={c.name} selected={sel} onPress={() => open(e)}
              leading={<LeadGlyph name={e.project ? "project" : c.visibility === "invite" ? "lock" : "hash"} />}
              trailing={c.unread > 0 ? <Badge n={c.unread} testID={`unread-${c.channelId}`} /> : null}
            />
          </View>,
        );
      }
    }
  };

  return (
    <View testID="chats-sidebar" accessibilityRole="list" accessibilityLabel="Chats" style={st.root} {...{ tabIndex: 0, onKeyDown }}>
      <View style={st.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${data.space.name}, switch Space`} onPress={() => data.nav.openSpaceSwitcher()} testID="space-switcher" style={st.space}>
          <Avatar name={data.space.name} kind="space" size={20} />
          <Text numberOfLines={1} style={st.spaceName}>{data.space.name}</Text>
          {data.space.otherNeedsYou ? <View testID="other-space-dot" accessibilityLabel="Another Space needs you" style={st.red} /> : null}
          <Glyph name="chev" size={12} color="var(--ink-4)" />
          <View style={{ flex: 1 }} />
          {online ? null : <Text testID="sidebar-offline" style={st.quiet}>Offline</Text>}
        </Pressable>
        <View style={st.searchRow}>
          <Pressable accessibilityRole="search" accessibilityLabel="Search" onPress={() => data.nav.openSearch()} testID="sidebar-search" style={st.search}>
            <Glyph name="search" size={14} color="var(--ink-3)" />
            <Text style={st.searchText}>Search</Text>
            <View style={{ flex: 1 }} />
            <Text style={st.digit}>⌘K</Text>
          </Pressable>
          <Tool icon="compose" label={`New chat with ${data.space.assistant.name}`} onPress={() => void api.newChat()} testID="new-chat" />
        </View>
      </View>
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
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--side)" as string, paddingHorizontal: 8, paddingTop: 6 },
  top: { gap: 6, paddingBottom: 6 },
  space: { height: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, borderRadius: 7 },
  spaceName: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  red: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--danger)" as string },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  search: { flex: 1, height: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  searchText: { fontSize: 13, color: "var(--ink-3)" as string },
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
