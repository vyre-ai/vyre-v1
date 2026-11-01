// The Chats sidebar (spec 3.2, 2.23, ARCH 7.2): the Space and search at the top, then Needs you (only when something waits), Starred agent faces (Cmd-1..9), Chats grouped
// Starred, Today, Yesterday and Earlier with a pulse where an agent works, then Channels with Projects beneath. One flat list in ui/VirtualList, every row a ui/Row with
// leading and trailing slots (ruling 36). Everything reads from the local copy; a new chat shows as a row at once and the server answers behind it.
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import type { QueryFailure } from "../../../../../../client/src/query/types.ts";
import { portalInto } from "../../../shell/sidebar/portal.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
import { chatMenuEntries } from "./chat-menu.ts";
import {
  FILTERS, NEW_CHAT_MS, buildEntries, faceForDigit, filterCounts, archivedRows, groupRecent, matchesFilter, matchesQuery, needsKind, refetch, selectable, stepKey, waitingAgents, whenLabel,
} from "./model.ts";
import type { Agent, ChatRow, Entry, Filter, Group, NeedsItem, RecentOut, SectionError, SectionKey } from "./model.ts";
import { REPORT_PROBLEM_EVENT } from "../../../../../../ui/src/States/index.tsx";
import { displayTitle } from "./titles.ts";
import { Badge, EmptyLine, Face, FaceStack, GroupLabel, Glyph, LeadGlyph, SectionHead, Tool, UnreadDot } from "./parts.tsx";
import type { Channel } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { nameOr } from "../names.ts";
import { Mark } from "../../../onboarding/ProviderLogo.tsx";
import { dayLabel, importedRows, importedStartsOpen, providerMark, providerName } from "../imported/model.ts";
import type { ImportedRow } from "../imported/model.ts";
import { ChannelSheets } from "../channels/Sheets.tsx";
import { onChannelRequest, takeChannelRequest } from "../channels/request.ts";
import type { ChannelSheetKind } from "../channels/request.ts";

export const SIDEBAR_SCREEN = "chats.sidebar";
export const AGENTS_SCREEN = "chats.all-agents";
export const NEEDS_SCREEN = "home.needs-you-top3";
export const ROW_H = 28;

type ChannelsOut = CapMap["channels.list"]["out"];
type AgentsOut = CapMap["agents.list"]["out"];
type NeedsOut = CapMap["tasks.needs_you"]["out"];

/** How long the Undo for Delete chat stays on screen. */
export const UNDO_MS = 8_000;
const EMPTY_RECENT: RecentOut = { starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null };

/** Rows that react to the pointer: tools and times appear on hover or selection. */
function Hot({ children }: { children: (over: boolean) => ReactElement }): ReactElement {
  const [over, setOver] = useState(false);
  return <View style={{ height: ROW_H }} {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>{children(over)}</View>;
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
  // a phone shows the top three Needs you rows and the rest behind "Show all" (0 is "not measured yet": the desktop list)
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < 560;
  const [filter, setFilter] = useState<Filter>("all");
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(new Set());
  // The imported coding sessions (sessions.list): read on open and again when the chats change, so a continued session shows its chat. A Space that cannot list them shows no group.
  const [archive, setArchive] = useState<ImportedRow[]>([]);
  // null: the group follows its default (open unless long); a press on its head decides.
  const [importedOpen, setImportedOpen] = useState<boolean | null>(null);
  // The Archived section starts collapsed (a count on its head); a press opens it.
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  // The New channel and Browse channels sheets: opened from this sidebar, or by a request from Cmd-K or the new menu (one waiting before this mounted is taken now). A Personal Space has none.
  const personal = data.space.personal === true;
  const [sheet, setSheet] = useState<ChannelSheetKind | null>(null);
  useEffect(() => {
    const take = (): void => { const k = takeChannelRequest(); if (k && !personal) setSheet(k); };
    take();
    return onChannelRequest(take);
  }, [personal]);
  const [local, setLocal] = useState<ChatRow[]>([]);
  const onLocal = useCallback((row: ChatRow) => { setLocal((l) => [row, ...l]); setCursor(`c:${row.threadId}`); }, []);
  const onSettled = useCallback((id: string) => setLocal((l) => l.filter((r) => r.threadId !== id)), []);
  const api = useSidebarApi(onLocal, onSettled);

  const recentQ = useScreenQuery<RecentOut>(SIDEBAR_SCREEN, "recent", { filter: "all" });
  const channelsQ = useScreenQuery<ChannelsOut>(SIDEBAR_SCREEN, "channels", {});
  const agentsQ = useScreenQuery<AgentsOut>(AGENTS_SCREEN, "agents", {});
  // The prototype lists every request under Needs you, not only the top three.
  const needsQ = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "items", {});
  useEffect(() => {
    let off = false;
    void (Promise.resolve().then(() => data.call("sessions.list", {})) as Promise<{ sessions?: Partial<ImportedRow>[] } | undefined>).then((r) => { if (!off) setArchive(importedRows(r?.sessions)); }, () => { if (!off) setArchive([]); });
    return () => { off = true; };
  }, [data.call, recentQ]);
  const imported = useMemo(() => archive.filter((r) => matchesQuery(query, r.title, providerName(r.provider))), [archive, query]);
  const allNeedsQ = needsQ;
  const waiting = useMemo(() => waitingAgents(allNeedsQ.status === "ready" ? allNeedsQ.data.items : [], data.space.assistant.agentId), [allNeedsQ]);

  const agents: Agent[] = agentsQ.status === "ready" ? agentsQ.data.agents : [];
  const names = useMemo(() => new Map(agents.map((a) => [a.agentId, a.name])), [agents]);
  const agentName = useCallback((id: string) => nameOr(names.get(id), id), [names]);
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
  // The list is the channels you are in; a public one you are not in is for Browse. A project channel follows the project, so it stays.
  const meId = data.me?.id;
  const channels: Channel[] = useMemo(() => allChannels.filter((c) => (meId === undefined || c.recordId !== undefined || c.members.some((m) => m.id === meId)) && matchesQuery(query, c.name)), [allChannels, query, meId]);
  const allNeeds: NeedsItem[] = needsQ.status === "ready" ? needsQ.data.items : [];
  const needs: NeedsItem[] = useMemo(() => allNeeds.filter((n) => matchesQuery(query, n.task.title, agentName(n.task.createdBy))), [allNeeds, query, agentName]);
  // A read that failed ends the skeleton and says so, for that section only (never the empty state: empty means nothing is here). The other sections draw what they have.
  const errors: Partial<Record<SectionKey, SectionError>> = {};
  for (const [section, label, q] of [["recent", "Chats", recentQ], ["channels", "Channels", channelsQ], ["faces", "Agents", agentsQ], ["needs", "Needs you", needsQ]] as const) {
    if (q.status === "loading" && q.error !== undefined) errors[section] = { text: `Couldn't load ${label.toLowerCase()}`, cause: q.error.message, ...(q.error.code ? { code: q.error.code } : {}), ...(q.error.traceId ? { traceId: q.error.traceId } : {}) };
  }
  const pending = (q: { status: string; error?: unknown }): boolean => q.status === "loading" && q.error === undefined;
  const loading = pending(recentQ) || pending(channelsQ) || pending(agentsQ);

  const counts = useMemo(() => filterCounts(recent, local, agentName), [recent, local, agentName]);
  const groups: Group[] = useMemo(
    () => groupRecent(recent, local, agentName).map((g) => ({ ...g, rows: g.rows.filter((r) => matchesFilter(r, filter) && matchesQuery(query, r.title, r.who)) })).filter((g) => g.rows.length),
    [recent, local, agentName, filter, query],
  );
  const archivedChats: ChatRow[] = useMemo(() => archivedRows(recent, agentName).filter((r) => matchesFilter(r, filter) && matchesQuery(query, r.title, r.who)), [recent, agentName, filter, query]);
  const working = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const r of g.rows) if (r.working && r.kind === "agent") set.add(agents.find((a) => a.name === r.who)?.agentId ?? r.who);
    return set;
  }, [groups, agents]);

  const entries = useMemo(
    () => buildEntries({ needs, needsTotal: needsQ.status === "ready" ? needsQ.data.total : 0, faces, workingAgents: working, waitingAgents: waiting, groups, channels, filter, archived: archivedChats, archivedOpen, closed: (importedOpen ?? importedStartsOpen(archive.length)) ? closed : new Set([...closed, "imported" as const]), facesMore, errors, imported, personal, searching: query.trim() !== "", ...(narrow ? { needsLimit: 3 } : {}) }),
    [personal, query, needs, needsQ, faces, facesMore, recentQ, channelsQ, agentsQ, working, waiting, groups, channels, filter, closed, narrow, imported, importedOpen, archive.length, archivedChats, archivedOpen],
  );
  const order = useMemo(() => selectable(entries), [entries]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  // Choosing a thing takes the phone from the list to the page (the slot's openBody); on a computer it does nothing.
  const leave = (): void => slot?.openBody();
  const toggle = (s: SectionKey): void => {
    if (s === "archived") { setArchivedOpen((o) => !o); return; }
    if (s === "imported") { setImportedOpen(!(importedOpen ?? importedStartsOpen(archive.length))); return; }
    toggleClosed(s);
  };
  const toggleClosed = (s: SectionKey): void => setClosed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const guard = (p: Promise<unknown>): void => void p.catch(() => undefined);
  // after a write to my list the list is read again at once (the live read also hears the event; this is for a read that is not subscribed)
  const again = (p: Promise<unknown>): void => void p.then(() => { refetch(data.screens); }, () => undefined);
  // Delete chat: gone from the list now, with an Undo for UNDO_MS; the Undo is threads.restore. The bar is this sidebar's own, so nothing else needs a toast host.
  const [undo, setUndo] = useState<{ threadId: string; title: string } | null>(null);
  useEffect(() => {
    if (!undo) return undefined;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);
  const deleteWithUndo = (r: ChatRow): void => {
    void api.deleteChat(r.threadId).then(() => { setUndo({ threadId: r.threadId, title: r.title }); refetch(data.screens); }, () => undefined);
  };
  const restore = (): void => {
    const gone = undo;
    setUndo(null);
    if (gone) again(api.restoreChat(gone.threadId));
  };

  // ----- menus: each entry changes real state or opens the thing
  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = FILTERS.map((f) => ({ label: `${f.label}  ${counts[f.key]}`, checked: filter === f.key, onSelect: () => setFilter(f.key) }));
    items.push({ separator: true }, { label: "Next unread", onSelect: () => nextUnread() });
    menu.show(items, x, y, "other");
  };
  const nextUnread = (): void => { if (recent.nextUnread) { setCursor(`c:${recent.nextUnread}`); data.nav.openChat(recent.nextUnread); leave(); } };
  const chatMenu = (r: ChatRow): MenuEntry[] => chatMenuEntries(r, {
    open: () => { data.nav.openChat(r.threadId); leave(); },
    star: () => guard(api.star("thread", r.threadId, !r.starred)),
    markRead: () => guard(api.markRead(r.threadId)),
    archive: () => again(api.archive(r.threadId)),
    unarchive: () => again(api.unarchive(r.threadId)),
    leaveChat: () => again(api.leaveChat(r.threadId)),
    deleteChat: () => deleteWithUndo(r),
  });
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
    // an action that needs words (an answer, a reason) opens the item, where the words are written
    ...n.task.actions.map((a) => ({ label: a.label, onSelect: () => { if (a.note === "required") { data.nav.openNeedsYou(n.task.id); leave(); } else guard(data.call("tasks.act", { taskId: n.task.id, action: a.key })); } })),
    ...(n.task.actions.length ? [{ separator: true } as MenuEntry] : []),
    { label: "Open in Needs you", onSelect: () => { data.nav.openNeedsYou(n.task.id); leave(); } },
  ];

  /** Behind the failed row: the cause as a header line, then Copy trace id and Report a problem. */
  const errorMenu = (e: Extract<Entry, { type: "error" }>): MenuEntry[] => {
    const trace = e.traceId;
    const detail = { message: e.cause, ...(e.code ? { code: e.code } : {}), ...(trace ? { traceId: trace } : {}) };
    return [
      { head: [e.cause, e.code].filter(Boolean).join("  ") },
      ...(trace ? [{ label: "Copy trace id", onSelect: () => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard?.writeText(trace); } }] : []),
      { label: "Report a problem", onSelect: () => { const g = globalThis as { dispatchEvent?: (ev: unknown) => boolean; CustomEvent?: new (t: string, i: { detail: unknown }) => unknown }; if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(REPORT_PROBLEM_EVENT, { detail })); } },
    ];
  };

  const open = (e: Entry): void => {
    setCursor(e.key);
    if (e.type === "chat") data.nav.openChat(e.row.threadId);
    else if (e.type === "imported") { if (e.row.continuedThreadId) data.nav.openChat(e.row.continuedThreadId); else data.nav.openImported?.(e.row.conversationId); }
    else if (e.type === "face") data.nav.openAgentChat(e.agent.agentId);
    else if (e.type === "channel") data.nav.openChannel(e.channel.channelId);
    else if (e.type === "need") data.nav.openNeedsYou(e.item.task.id);
    else if (e.type === "action") { setSheet("new"); return; }
    else if (e.type === "more") { if (e.to === "needs") data.nav.openNeedsYou(); else data.nav.openAllAgents(); }
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
      return m ? <View style={{ height: ROW_H }} {...menuTrigger((x, y) => menu.show(m, x, y, "context", { label: e.key }))}>{child}</View> : child;
    };
    switch (e.type) {
      case "head": {
        if (e.section === "needs") {
          // The prototype's Needs you is one row with the inbox glyph and the count; its requests sit under it as child rows. The chevron folds them.
          return (
            <View testID="head-needs" style={{ height: ROW_H }}>
              <Row
                id="needs-parent" title="Needs you" onPress={() => { data.nav.openNeedsYou(); leave(); }}
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
          <SectionHead id={e.section} label={e.label} count={e.section === "needs" || e.section === "imported" || e.section === "archived" ? e.count : undefined} open={e.open} onToggle={() => toggle(e.section)} keep={recentHead && filter !== "all"}>
            {recentHead ? <Tool icon="filter" label="Filter chats" active={filter !== "all"} onPress={filterMenu} testID="filter-chats" /> : null}
            {recentHead ? <Tool icon="plus" label="New chat" onPress={() => { void api.newChat(); leave(); }} testID="new-chat-section" /> : null}
            {e.section === "faces" ? <Tool icon="arrow" label="All agents" onPress={() => { data.nav.openAllAgents(); leave(); }} testID="all-agents" /> : null}
            {e.section === "channels" ? <Tool icon="search" label="Browse channels" onPress={() => setSheet("browse")} testID="browse-channels-tool" /> : null}
            {e.section === "channels" ? <Tool icon="plus" label="New channel" onPress={() => setSheet("new")} testID="new-channel" /> : null}
          </SectionHead>
        );
      }
      case "group": return <GroupLabel label={e.label} />;
      case "action": return (
        <Row id={e.key} title={e.label} selected={sel} onPress={() => open(e)} leading={<LeadGlyph name="plus" />} />
      );
      case "error": {
        const items = errorMenu(e);
        return (
          <View style={{ height: ROW_H }} testID={`section-error-${e.section}`} {...menuTrigger((x, y) => menu.show(items, x, y, "context", { label: e.text }))}>
            <Row
              id={e.key} title={e.text} leading={<LeadGlyph name="alert" color="var(--warn)" />}
              trailing={
                <View style={st.tools}>
                  <Tool icon="more" label={`Details of: ${e.text}`} onPress={(x, y) => menu.show(items, x, y, "other")} testID={`error-more-${e.section}`} />
                  <Tool icon="retry" label={`Retry: ${e.text}`} onPress={() => void refetch(data.screens)} testID={`retry-${e.section}`} />
                </View>
              }
            />
          </View>
        );
      }
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
                leading={<View style={{ marginRight: 6 }}><Face name={who} seedId={e.item.task.createdBy} kind="agent" size={18} /></View>}
                trailing={over && e.item.task.actions.length && k.tone === "accent" && e.item.task.actions[0]!.note !== "required"
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
              leading={<View style={{ marginRight: 6 }}><Face name={e.agent.name} seedId={e.agent.agentId} kind="agent" size={18} pulse={e.working} /></View>}
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
                id={e.key} title={displayTitle(r, data.clock().offsetMin)} selected={sel} emphasis={r.unread > 0} onPress={() => open(e)}
                leading={<View style={{ marginRight: 6 }}>{r.members ? <FaceStack members={r.members} size={16} /> : <Face name={r.who} seedId={r.whoId} kind={r.kind} size={18} pulse={r.working} />}</View>}
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
      case "imported": {
        const r = e.row, c = data.clock();
        return (
          <View style={{ height: ROW_H }} testID={`imported-row-${r.conversationId}`}>
            <Row
              id={e.key} title={r.title} selected={sel} onPress={() => open(e)}
              leading={<View style={{ marginRight: 6 }} accessibilityLabel={providerName(r.provider)}><Mark k={providerMark(r.provider)} size={16} /></View>}
              trailing={<Text style={st.time}>{r.continuedThreadId ? "Chat" : dayLabel(r.startedAt || r.importedAt, c.now, c.offsetMin)}</Text>}
            />
          </View>
        );
      }
      case "channel": {
        const c = e.channel;
        // A channel with nothing new sits dim; one with unread stands out at full strength with its count (prototype .unread / .dim).
        return wrap(
          <View style={{ height: ROW_H, opacity: c.unread > 0 ? 1 : 0.72 }} testID={c.unread > 0 ? `channel-unread-${c.channelId}` : `channel-read-${c.channelId}`}>
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
  // another Space needing you is a dot by the Space switcher: here on a desktop, on the You tab on a phone
  const dot = data.space.otherNeedsYou && !narrow;
  const headBusy = dot || !online;
  // A Team Space's new menu: a chat, a channel, or the channels you can still join. A Personal Space has the one button.
  const newMenu = (x: number, y: number): void => menu.show([
    { label: "New chat", onSelect: () => { void api.newChat(); leave(); } },
    { label: "New channel", onSelect: () => setSheet("new") },
    { label: "Browse channels", onSelect: () => setSheet("browse") },
  ], x, y, "other");
  const newButton = personal ? null : <Tool icon="plus" label="New" onPress={newMenu} testID="new-menu" />;
  const newChatButton = (
    <Pressable accessibilityRole="button" accessibilityLabel={`New chat with ${data.space.assistant.name}`} {...{ title: `New chat with ${data.space.assistant.name}` }} onPress={() => { void api.newChat(); leave(); }} testID="new-chat" style={({ hovered }: { hovered?: boolean }) => [st.assistant, hovered === true && st.assistantOver]}>
      <Avatar name={data.space.assistant.name} kind="assistant" size={18} />
    </Pressable>
  );
  return (
    <View testID="chats-sidebar" accessibilityRole="listbox" accessibilityLabel="Chats" style={st.root} {...{ tabIndex: 0, onKeyDown, ...(cursor ? { "aria-activedescendant": cursor.startsWith("h:") ? (cursor === "h:needs" ? "row-needs-parent" : `toggle-${cursor.slice(2)}`) : `row-${cursor}` } : {}) }}>
      {headBusy || !inHeader ? (
        <View style={st.top} testID="sidebar-head" accessibilityLabel={`Chats, ${data.space.name}`}>
          {dot ? <View testID="other-space-dot" accessibilityLabel="Another Space needs you" style={st.red} /> : null}
          {online ? null : <Text testID="sidebar-offline" style={st.quiet}>Offline</Text>}
          <View style={{ flex: 1 }} />
          {inHeader ? null : <>{newButton}{newChatButton}</>}
        </View>
      ) : null}
      {inHeader ? portalInto(slot?.actionsOutlet, <>{newButton}{newChatButton}</>) : null}
      <View style={st.list}>
        {loading ? <ChatsSidebarLoading /> : (
          <VirtualList data={entries} rowHeight={ROW_H} keyOf={(e) => e.key} renderItem={(e) => renderEntry(e)} {...(window ? { window } : {})} />
        )}
      </View>
      {undo ? (
        <View testID="chat-deleted" accessibilityRole="alert" style={st.undo}>
          <Text numberOfLines={1} style={st.undoText}>{`Deleted ${undo.title}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Undo delete of ${undo.title}`} testID="undo-delete" onPress={restore} style={st.undoBtn}><Text style={st.undoAct}>Undo</Text></Pressable>
        </View>
      ) : null}
      {menu.element}
      {sheet ? <ChannelSheets kind={sheet} channels={allChannels} agents={agents} onSwitch={setSheet} onClose={() => setSheet(null)} /> : null}
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
  undo: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 8, marginBottom: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  undoText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)" as string },
  undoBtn: { height: 28, paddingHorizontal: 8, justifyContent: "center" },
  undoAct: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
  red: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--danger)" as string },
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
