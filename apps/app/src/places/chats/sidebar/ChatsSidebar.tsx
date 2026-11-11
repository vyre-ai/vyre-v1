// The Chats sidebar (spec 3.2, 2.23, ARCH 7.2): the Space and search at the top, then Needs you (only when something waits), Starred agent faces (Cmd-1..9), Chats grouped
// Starred, Today, Yesterday and Earlier with a pulse where an agent works, then Channels with Projects beneath. One flat list in ui/VirtualList, every row a ui/Row with
// leading and trailing slots (ruling 36). Everything reads from the local copy; a new chat shows as a row at once and the server answers behind it.
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
import { useContextMenu } from "../../../../../../ui/src/Menu/context.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { FACES_SHOWN } from "./model.ts";
import { createSidebarApi } from "./actions.ts";
import { createMenuApi, muteKey } from "../menus/actions.ts";
import { useAddSheet } from "../addsheet/index.ts";
import { useShareSheet } from "../../../share/useShareSheet.tsx";
import { itemLink } from "../../../share/rows.ts";
import { agentMenu, channelMenu, chatMenu as chatMenuOf, personMenu as personMenuOf, shortcutFor } from "../menus/kinds.ts";
import type { SidebarApi } from "./actions.ts";
import { ChatsSidebarDataProvider, useOnline, useOptionalSidebarData, useScreenQuery, useSidebarData } from "./data.tsx";
import type { ChatsSidebarData } from "./data.tsx";
import { chatMenuEntries, importedDeleteConfirm, importedMenuEntries } from "./chat-menu.ts";
import {
  FILTERS, NEW_CHAT_MS, agentUnread, buildEntries, capped, foldedKey, orderPeople, readFolded, writeFolded, dmThreads, faceForDigit, filterCounts, archivedRows, groupRecent, matchesFilter, matchesQuery, openEntry, personUnread, refetch, selectable,
  stepKey, waitingAgents,
} from "./model.ts";
import type { Agent, ChatRow, Entry, Group, NeedsItem, RecentOut, SectionError, SectionKey, SideFilter } from "./model.ts";
import { REPORT_PROBLEM_EVENT } from "../../../../../../ui/src/States/index.tsx";
import { displayTitle } from "./titles.ts";
import { Badge, EmptyLine, Face, FaceStack, GroupLabel, Glyph, LeadGlyph, SectionHead, Tool, UnreadDot } from "./parts.tsx";
import type { Channel } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { nameOr } from "../names.ts";
import { Mark } from "../../../onboarding/ProviderLogo.tsx";
import { dayLabel, importedRows, importedStartsOpen, providerMark, providerName } from "../imported/model.ts";
import type { ImportedRow } from "../imported/model.ts";
import { importedChanged, onImportedChange } from "../imported/changes.ts";
import { useGoals } from "../goals/data.ts";
import { sidebarGoals } from "../goals/model.ts";
import type { GoalLine } from "../goals/model.ts";
import { RADIUS, ROW } from "../../../../../../ui/src/tokens/calm.ts";
import { GOAL_ROW_H, GoalRow } from "../goals/GoalRow.tsx";
import { askedCall, goalMenuEntries } from "../goals/goal-menu.ts";
import { useProjects } from "../projects/data.ts";
import { sidebarProjects } from "../projects/model.ts";
import { HEALTH_LABEL } from "../../records/projectpage/model.ts";
import { projectMenu } from "../menus/kinds-b.ts";
import { copyToClipboard, vyreLink } from "../menus/actions-b.ts";
import { TextAsk } from "../menus/TextAsk.tsx";
import { RenameField } from "../conversation/parts.tsx";
import { ChannelSheets } from "../channels/Sheets.tsx";
import { onChannelRequest, takeChannelRequest } from "../channels/request.ts";
import { usePulse } from "./pulse.ts";
import { GATE, allows, useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import type { ChannelSheetKind } from "../channels/request.ts";

/** This device's storage, where there is one (a test renderer or a native shell may have none). */
const localStore = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null => {
  try { return (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage ?? null; } catch { return null; }
};

export const SIDEBAR_SCREEN = "chats.sidebar";
export const AGENTS_SCREEN = "chats.all-agents";
/** Tasks is the one door to what needs you: the sidebar reads its Needs you and its count (tasks.my-work), never the Home screen. */
export const NEEDS_SCREEN = "tasks.my-work";
export const ROW_H = ROW;
const NO_GOALS: GoalLine[] = [];
/** A section head sits a little apart from the rows above it. */
const WORK_SCREEN = "tasks.my-work";

type ChannelsOut = CapMap["channels.list"]["out"];
type AgentsOut = CapMap["agents.list"]["out"];
type NeedsOut = CapMap["tasks.needs_you"]["out"];

/** How long the Undo for Delete chat stays on screen. */
export const UNDO_MS = 8_000;
const EMPTY_RECENT: RecentOut = { starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null };

/** Rows that react to the pointer: the row's "..." appears on hover. */
function Hot({ children, testID }: { children: (over: boolean) => ReactElement; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return <View {...(testID ? { testID } : {})} style={{ height: ROW_H }} {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>{children(over)}</View>;
}

export function useSidebarApi(onLocal: (row: ChatRow) => void, onSettled: (localId: string) => void): SidebarApi {
  const data = useSidebarData();
  return useMemo(() => createSidebarApi(data, onLocal, onSettled), [data, onLocal, onSettled]);
}

/** The Chats sidebar's content, drawn into the shell's shared place sidebar (title, collapse and search field are the slot's). `window` pins which entries are drawn (tests and
 * screenshots draw them all); the shell leaves it out and the list windows by scroll. `query` is the slot's search field; `slot` lets the phone leave the list for the chat.
 * `open` is what the place's middle shows (`openKeyOf` in mounts/route.ts): its row is the one drawn selected, whatever opened it (a click here, a tab, a link, Cmd-K), and no row is when
 * the page has none. Left out (a sidebar drawn alone, with no page beside it), the row last pressed is the selected one. */
export function ChatsSidebar({ data, window, query = "", slot, open, startFilter }: { data?: ChatsSidebarData; window?: VirtualWindow; query?: string; slot?: SidebarSlotApi | undefined; open?: string | null; startFilter?: SideFilter }): ReactElement {
  const ctx = useOptionalSidebarData();
  const value = data ?? ctx;
  if (!value) return <ChatsSidebarLoading />;
  return <ChatsSidebarDataProvider value={value}><Sidebar query={query} slot={slot} {...(window ? { window } : {})} {...(open !== undefined ? { open } : {})} {...(startFilter ? { startFilter } : {})} /></ChatsSidebarDataProvider>;
}

/** Put this inside the Chats place: it registers the Chats sidebar in the shell's shared slot, so it collapses, searches and lands on the phone like every place. */
export function ChatsSidebarSlot({ data, window, open }: { data?: ChatsSidebarData; window?: VirtualWindow; open?: string | null }): ReactElement {
  return (
    <SidebarContent title="Chats" noSearch>
      {(query, slot) => <ChatsSidebar query={query} slot={slot} {...(data ? { data } : {})} {...(window ? { window } : {})} {...(open !== undefined ? { open } : {})} />}
    </SidebarContent>
  );
}

/** The frame before data: rows the size of the real ones, so nothing moves when the data arrives. */
export function ChatsSidebarLoading(): ReactElement {
  return <View testID="chats-sidebar-loading" accessibilityLabel="Loading" style={st.root} />;
}

function Sidebar({ window, query, slot, open: shown, startFilter }: { window?: VirtualWindow; query: string; slot: SidebarSlotApi | undefined; open?: string | null; startFilter?: SideFilter }): ReactElement {
  const data = useSidebarData();
  const online = useOnline();
  const menu = useMenu();
  const rowMenu = useContextMenu(menu);
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < 560;
  const [filter, setFilter] = useState<SideFilter>(startFilter ?? "all");
  const [more, setMore] = useState<{ recent?: boolean; people?: boolean; faces?: boolean; goals?: boolean; projects?: boolean }>({});
  // Goals: yours and the ones you help with, what needs you first (goals/model.ts). They follow the Space's changes, as a card that reads by capability does.
  const goalsQ = useGoals(data.call, data.changes);
  // Projects follow Goals: the Space's projects, starred first, each with its health dot
  const projectsQ = useProjects(data.call, data.changes, data.nav.openProject !== undefined);
  const projectRows = useMemo(() => sidebarProjects(projectsQ.lines), [projectsQ.lines]);
  // every goal's own chat: its Goal row is the door, so the chat is not listed again in Now or Recent (lane l-polish L2)
  const goalThreads = useMemo(() => new Set(goalsQ.state.status === "ready" ? goalsQ.state.data.flatMap((g) => (g.threadId ? [g.threadId] : [])) : []), [goalsQ.state]);
  const goalRows = useMemo(() => (goalsQ.state.status === "ready" ? sidebarGoals(goalsQ.state.data, data.clock().now) : NO_GOALS), [goalsQ.state, data]);
  // Team now starts folded (owner D24: collapsed in Chats, open in Console); a press opens it
  // the folded groups are remembered on this device, per Space and person (lane l-polish L3)
  const foldStore = foldedKey(`${data.space.name}:${data.me?.id ?? ""}`);
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(() => readFolded(localStore()?.getItem(foldStore)));
  useEffect(() => { localStore()?.setItem(foldStore, writeFolded(closed)); }, [closed, foldStore]);
  // The imported coding sessions (sessions.list): read on open and again when the chats change, so a continued session shows its chat. A Space that cannot list them shows no group.
  const [archive, setArchive] = useState<ImportedRow[]>([]);
  // null: the group follows its default (open unless long); a press on its head decides.
  const [importedOpen, setImportedOpen] = useState<boolean | null>(null);
  // The Archived section starts collapsed (a count on its head); a press opens it.
  const [archivedOpen, setArchivedOpen] = useState(false);
  // The keyboard's place in the list: the arrows move it and Enter opens it. It is not the selection: the selected row is the page that is open (`shown`), and the cursor goes back to it
  // whenever that page changes.
  const [cursor, setCursor] = useState<string | null>(null);
  // An imported session whose title is being edited in its row.
  const [renaming, setRenaming] = useState<string | null>(null);
  // The New channel and Browse channels sheets: opened from this sidebar, or by a request from Cmd-K or the new menu (one waiting before this mounted is taken now). A Personal Space has none.
  const personal = data.space.personal === true;
  // New chat, channel and agent each need their permission (a guest holds none): what the person cannot make is not offered (l-perms)
  const rtPerms = useOptionalShellRuntime();
  const canChat = allows(rtPerms, GATE.newChat), canChannel = allows(rtPerms, GATE.newChannel), canAgent = allows(rtPerms, GATE.newAgent);
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
  const needsQ = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "needs", { limit: 50 });
  const countQ = useScreenQuery<{ count: number }>(WORK_SCREEN, "count", {});
  const peopleQ = useMemo(() => data.people ?? [], [data.people]);
  // read again after a rename, archive or delete here or on the transcript page
  const [reread, setReread] = useState(0);
  useEffect(() => onImportedChange(() => setReread((n) => n + 1)), []);
  useEffect(() => {
    // Imported sessions belong to a Personal Space (the server refuses the list anywhere else with a 422), so a Team Space does not ask
    if (!personal) { setArchive([]); return undefined; }
    let off = false;
    // only a Personal Space keeps imported coding sessions; a Team Space refuses the read (422), so it is not asked
    if (!personal) { setArchive([]); return undefined; }
    void (Promise.resolve().then(() => data.call("sessions.list", {})) as Promise<{ sessions?: Partial<ImportedRow>[] } | undefined>).then((r) => { if (!off) setArchive(importedRows(r?.sessions)); }, () => { if (!off) setArchive([]); });
    return () => { off = true; };
  }, [data.call, recentQ, reread, personal]);
  const imported = useMemo(() => archive.filter((r) => r.archived !== true && matchesQuery(query, r.title, providerName(r.provider))), [archive, query]);
  const archivedImported = useMemo(() => archive.filter((r) => r.archived === true && matchesQuery(query, r.title, providerName(r.provider))), [archive, query]);
  const liveImported = useMemo(() => archive.filter((r) => r.archived !== true).length, [archive]);
  const allNeedsQ = needsQ;
  const waiting = useMemo(() => waitingAgents(allNeedsQ.status === "ready" ? allNeedsQ.data.items : [], data.space.assistant.agentId), [allNeedsQ]);

  const agents: Agent[] = agentsQ.status === "ready" ? agentsQ.data.agents : [];
  const names = useMemo(() => new Map(agents.map((a) => [a.agentId, a.name])), [agents]);
  const agentName = useCallback((id: string) => nameOr(names.get(id), id), [names]);
  const personNames = useMemo(() => new Map(peopleQ.map((p) => [p.id, p.name])), [peopleQ]);
  const personName = useCallback((id: string) => nameOr(personNames.get(id), id), [personNames]);
  // the While you were away row, who is around and what agents are doing (pulse.ts)
  const { pulse, reread: rereadPulse } = usePulse({ call: data.call, changes: data.changes, personal, me: data.me?.id, personName: (id) => (id === data.me?.id ? "you" : personName(id)), agentName });
  const digestCount = pulse.digest ? pulse.digest.items.length : 0;
  // The Agents group is the Space's agents (agents.list takes no "starred" input; starring becomes its own packet): the first FACES_SHOWN of them, the rest behind All agents.
  // Not the assistant (its mark sits beside New chat). An agent waiting on you always comes first, so the cap can never hide one; everyone else keeps the Space's order.
  // Next come the agents with something new for you, so "N more" never hides an unread chat either.
  const recentData = recentQ.status === "ready" ? recentQ.data : null;
  const byAgent = useMemo(() => (recentData ? agentUnread(recentData) : new Map<string, number>()), [recentData]);
  const matching: Agent[] = useMemo(() => {
    const own = agents.filter((a) => a.agentId !== data.space.assistant.agentId && matchesQuery(query, a.name));
    return own;
  }, [agents, query, data.space.assistant.agentId]);
  // the Space's order, never re-ranked by what is new (lane l-polish L5); an agent waiting on you or with something new is kept past the cut instead
  const faces: Agent[] = useMemo(() => capped(matching, FACES_SHOWN, (a) => waiting.has(a.agentId) || (byAgent.get(a.agentId) ?? 0) > 0).shown, [matching, waiting, byAgent]);
  const facesMore = matching.length - faces.length;
  const recent = recentQ.status === "ready" ? recentQ.data : EMPTY_RECENT;
  const allChannels: Channel[] = channelsQ.status === "ready" ? channelsQ.data.channels : [];
  // The list is the channels you are in; a public one you are not in is for Browse. A project channel follows the project, so it stays.
  const meId = data.me?.id;
  const channels: Channel[] = useMemo(() => allChannels.filter((c) => (meId === undefined || c.recordId !== undefined || c.members.some((m) => m.id === meId)) && matchesQuery(query, c.name)), [allChannels, query, meId]);
  const allNeeds: NeedsItem[] = needsQ.status === "ready" ? needsQ.data.items : [];
  const waitingThreads = useMemo(() => new Set(allNeeds.flatMap((n) => { const id = (n.task as { threadId?: string }).threadId; return id ? [id] : []; })), [allNeeds]);
  // exactly what waits on you: the rows of Tasks' Needs you group, each once (tasks.count_needs_you)
  const tasksCount = countQ.status === "ready" ? countQ.data.count : 0;
  // A read that failed ends the skeleton and says so, for that section only (never the empty state: empty means nothing is here). The other sections draw what they have.
  const errors: Partial<Record<SectionKey, SectionError>> = {};
  for (const [section, label, q] of [["recent", "Chats", recentQ], ["channels", "Channels", channelsQ], ["faces", "Agents", agentsQ]] as const) {
    if (q.status === "loading" && q.error !== undefined) errors[section] = { text: `Couldn't load ${label.toLowerCase()}`, cause: q.error.message, ...(q.error.code ? { code: q.error.code } : {}), ...(q.error.traceId ? { traceId: q.error.traceId } : {}) };
  }
  const pending = (q: { status: string; error?: unknown }): boolean => q.status === "loading" && q.error === undefined;
  const loading = pending(recentQ) || pending(channelsQ) || pending(agentsQ);

  // What the toggles in a row menu say comes from what the server says now: who is muted and starred, and each agent's computer. Read when a menu opens (and kept for a few seconds), so a menu
  // shows at once from what was read last and the words are right the moment after.
  const menuApi = useMemo(() => createMenuApi(data), [data]);
  const facts = useRef<{ at: number; mutes: Set<string>; stars: Set<string>; computers: Map<string, { computerId: string; asleep: boolean }> }>({ at: 0, mutes: new Set(), stars: new Set(), computers: new Map() });
  const [factsAt, setFactsAt] = useState(0);
  const readFacts = (force = false): void => {
    if (!force && data.clock().now - facts.current.at < 5_000 && facts.current.at !== 0) return;
    facts.current.at = data.clock().now;
    void Promise.allSettled([menuApi.mutes(), menuApi.stars(), menuApi.computers()]).then(([m, st2, c]) => {
      if (m.status === "fulfilled") facts.current.mutes = m.value;
      if (st2.status === "fulfilled") facts.current.stars = st2.value;
      if (c.status === "fulfilled") facts.current.computers = c.value;
      setFactsAt(facts.current.at);
    });
  };
  const muted = (kind: "person" | "agent" | "channel" | "thread", id: string): boolean => facts.current.mutes.has(muteKey(kind, id));
  const starred = (type: string, id: string): boolean => facts.current.stars.has(`${type}:${id}`);
  // the mutes and stars the list itself shows (lane l-polish): read once when the sidebar opens, then with every menu, so a muted row is quiet and a starred one never hides
  // (mutes and stars only, and the menus' few-seconds window is left alone: a menu still reads its facts fresh when it opens)
  useEffect(() => {
    let on = true;
    void Promise.allSettled([menuApi.mutes(), menuApi.stars()]).then(([m, st2]) => {
      if (!on) return;
      if (m.status === "fulfilled") facts.current.mutes = m.value;
      if (st2.status === "fulfilled") facts.current.stars = st2.value;
      setFactsAt((n) => n + 1);
    });
    return () => { on = false; };
  }, [menuApi]);
  const mutedFn = useCallback((kind: "thread" | "channel" | "person" | "agent", id: string): boolean => facts.current.mutes.has(muteKey(kind, id)), [factsAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const starredFn = useCallback((kind: "agent" | "channel", id: string): boolean => facts.current.stars.has(`${kind}:${id}`), [factsAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const allGroups: Group[] = useMemo(() => groupRecent(recent, local, agentName, personName).map((g) => ({ ...g, rows: g.rows.map((r) => (waitingThreads.has(r.threadId) ? { ...r, waiting: true } : r)) })), [recent, local, agentName, personName, waitingThreads]);
  const counts = useMemo(() => filterCounts(allGroups.flatMap((g) => g.rows), { channels: allChannels, muted: mutedFn, needs: tasksCount }), [allGroups, allChannels, mutedFn, tasksCount]);
  // the Ask history: every Ask pane the person opened beside something in another place, newest first, read when the Asks filter is picked
  const [asks, setAsks] = useState<ChatRow[]>([]);
  useEffect(() => {
    if (filter !== "asks") return undefined;
    let on = true;
    void Promise.resolve(data.call("threads.list", { kind: ["ask"], limit: 100 })).then((o) => {
      if (!on) return;
      const rows = (o as { threads: { threadId: string; title?: string; agents?: string[] }[] }).threads;
      setAsks(rows.map((t): ChatRow => { const a = t.agents?.[0]; const who = a ? agentName(a) : "Ask"; return { threadId: t.threadId, title: t.title && t.title !== "" ? t.title : "Ask", who, ...(a ? { whoId: a } : {}), kind: "agent", unread: 0, working: false, starred: false, lastAt: 0, local: false } as ChatRow; }));
    }, () => undefined);
    return () => { on = false; };
  }, [filter, data, agentName]);
  const groups: Group[] = useMemo(
    () => filter === "asks" ? (asks.length ? [{ key: "earlier", label: "Asks", rows: asks.filter((r) => matchesQuery(query, r.title, r.who)) }] : []) : allGroups.map((g) => ({ ...g, rows: g.rows.filter((r) => (matchesFilter(r, filter) || shown === `t:${r.threadId}`) && matchesQuery(query, r.title, r.who)) })).filter((g) => g.rows.length),
    [allGroups, filter, query, asks, shown],
  );
  // when each chat was last active, for an imported session continued in one: its row says that day, as a chat row would
  const lastAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of [recent.starred, recent.today, recent.yesterday, recent.earlier, recent.archived ?? []]) for (const i of g) m.set(i.threadId, i.lastAt);
    return m;
  }, [recent]);
  const archivedChats: ChatRow[] = useMemo(() => archivedRows(recent, agentName, personName).filter((r) => matchesFilter(r, filter) && matchesQuery(query, r.title, r.who)), [recent, agentName, personName, filter, query]);
  // Each person's row carries the unread of your direct message with them; a chat with new replies to messages you follow is bold with their count.
  const people = useMemo(() => orderPeople(peopleQ.filter((p) => matchesQuery(query, p.name)), personUnread(recent), recentData), [peopleQ, query, recent, recentData]);
  const dms = useMemo(() => dmThreads(recent), [recent]);
  const working = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const r of g.rows) if (r.working && r.kind === "agent") set.add(agents.find((a) => a.name === r.who)?.agentId ?? r.who);
    // an agent that runs outside Vyre has no turn to read: its own status says it
    for (const a of agents) if (a.runtime === "outside" && a.status === "working") set.add(a.agentId);
    return set;
  }, [groups, agents]);

  const entries = useMemo(
    () => buildEntries({ goals: goalRows, moreGoals: more.goals === true, projects: projectRows, moreProjects: more.projects === true, digest: digestCount > 0 ? { count: digestCount } : null, team: pulse.team, presence: pulse.presence, tasksCount, notes: data.nav.openNotes !== undefined, agentUnread: byAgent, waitingThreads, assistant: { agentId: data.space.assistant.agentId, name: data.space.assistant.name }, people, moreRecent: more.recent === true, morePeople: more.people === true, moreAgents: more.faces === true, faces, workingAgents: working, waitingAgents: waiting, groups, channels, filter, archived: archivedChats, archivedOpen, closed: (importedOpen ?? importedStartsOpen(liveImported)) ? closed : new Set([...closed, "imported" as const]), facesMore, errors, imported, archivedImported, personal, searching: query.trim() !== "", open: shown ?? null, goalThreads, muted: mutedFn, starred: starredFn }),
    [shown, goalThreads, mutedFn, starredFn, goalRows, projectRows, digestCount, pulse.team, pulse.presence, personal, query, tasksCount, data.nav.openNotes, byAgent, waitingThreads, people, more, data.space.assistant.agentId, data.space.assistant.name, faces, facesMore, recentQ, channelsQ, agentsQ, working, waiting, groups, channels, filter, closed, imported, archivedImported, importedOpen, liveImported, archivedChats, archivedOpen],
  );
  const order = useMemo(() => selectable(entries), [entries]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  // The selected row is the page that is open. A sidebar drawn alone (no page beside it) keeps the row last pressed.
  const follows = shown !== undefined;
  const openRow = useMemo(() => (follows ? openEntry(entries, shown ?? null) : null), [follows, entries, shown]);
  const selected = follows ? openRow : cursor;
  useEffect(() => { if (follows) setCursor(openRow); }, [follows, openRow]);

  // Choosing a thing takes the phone from the list to the page (the slot's openBody); on a computer it does nothing.
  const leave = (): void => slot?.openBody();
  const toggle = (s: SectionKey): void => {
    if (s === "archived") { setArchivedOpen((o) => !o); return; }
    if (s === "imported") { setImportedOpen(!(importedOpen ?? importedStartsOpen(liveImported))); return; }
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

  // An imported session: rename, archive and delete change the row here at once and ask behind it; a failure reads the list again, so the row shows what the server kept.
  const importedWrite = (cap: string, input: Record<string, unknown>, local: (rows: ImportedRow[]) => ImportedRow[], after?: () => void): void => {
    setArchive(local);
    void Promise.resolve().then(() => data.call(cap, input)).then(() => { after?.(); importedChanged(); }, () => importedChanged());
  };
  const renameImported = (r: ImportedRow, title: string | null): void => {
    setRenaming(null);
    if (title === null) return;
    importedWrite("sessions.rename", { conversationId: r.conversationId, title }, (rows) => rows.map((x) => (x.conversationId === r.conversationId ? { ...x, title } : x)));
  };
  const archiveImported = (r: ImportedRow, on: boolean): void =>
    importedWrite("sessions.archive", on ? { conversationId: r.conversationId } : { conversationId: r.conversationId, unarchive: true }, (rows) => rows.map((x) => (x.conversationId === r.conversationId ? { ...x, archived: on } : x)));
  // the transcript open in the middle goes with it: the place shows a new chat
  const deleteImported = (r: ImportedRow): void =>
    importedWrite("sessions.delete", { conversationId: r.conversationId }, (rows) => rows.filter((x) => x.conversationId !== r.conversationId), () => { if (shown === `i:${r.conversationId}`) data.nav.openNew?.(); });

  // ----- menus: each entry changes real state or opens the thing
  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = FILTERS.map((f) => ({ label: f.key === "asks" ? f.label : `${f.label}  ${counts[f.key]}`, checked: filter === f.key, onSelect: () => setFilter(f.key) }));
    items.push({ separator: true }, { label: "Next unread", onSelect: () => nextUnread() });
    menu.show(items, x, y, "other");
  };
  const nextUnread = (): void => { if (recent.nextUnread) { setCursor(`c:${recent.nextUnread}`); data.nav.openChat(recent.nextUnread); leave(); } };
  const setMute = (kind: "person" | "agent" | "channel" | "thread", id: string, on: boolean, minutes?: number): void => {
    const next = new Set(facts.current.mutes); if (on) next.add(muteKey(kind, id)); else next.delete(muteKey(kind, id));
    facts.current.mutes = next;
    setFactsAt((n) => n + 1);   // the list redraws the row quiet (or loud again) at once
    guard(menuApi.setMute(kind, id, on, minutes));
  };
  const manageAgents = allows(rtPerms, "agents.manage");
  // the Add sheet (people and agents into a chat, a channel invite) and the Share sheet (who may use an agent): one host each, drawn at the end of the sidebar
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string): void => { if (noteTimer.current) clearTimeout(noteTimer.current); setNote(text); noteTimer.current = setTimeout(() => setNote(null), 3500); };
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const seq = useRef(0);
  const meNow = { id: data.me?.id ?? "me", name: nameOr(names.get(data.me?.id ?? ""), "You") };
  const add = useAddSheet({ call: data.call, me: meNow, nameOf: agentName, newKey: () => `sb-add-${++seq.current}`, toast: say, ...(allows(rtPerms, "console.access") ? { admin: true } : {}) }, { copy: (t) => copy(t) });
  const share = useShareSheet({ call: data.call, me: meNow, nameOf: agentName, spaceName: data.space.name, newKey: () => `sb-share-${++seq.current}`, toast: say });
  // a chat's own link, /open/chat/<id> on the Space's web address: it works wherever it is pasted and opens through reach
  const chatLink = (threadId: string): string => itemLink("chat", threadId);
  const chatRowsAll = allGroups.flatMap((g) => g.rows).filter((r) => !r.local);
  const dmWith = (agentId: string): ChatRow | undefined => chatRowsAll.find((r) => r.whoId === agentId && r.members === undefined);
  /** Which chat: the most recent ones, then the one picked gets the call. */
  const pickChat = (title: string, x: number, y: number, run: (threadId: string) => Promise<unknown>): void => {
    const rows = chatRowsAll.slice(0, 12);
    menu.show(rows.length === 0 ? [{ head: "No chats yet." }] : [{ head: title }, ...rows.map((r) => ({ label: r.title, onSelect: () => again(run(r.threadId)) }))], x, y, "other");
  };
  /** How loudly a chat, a channel or an agent tells you: mute for a while, until you turn it back on, or unmute. */
  const notifyMenu = (kind: "thread" | "channel" | "agent" | "person", id: string, x: number, y: number): void => {
    const on = muted(kind, id);
    menu.show([
      { head: "Notifications" },
      ...(on ? [{ label: "Unmute", onSelect: () => setMute(kind, id, false) }] : []),
      { label: "Mute for 1 hour", onSelect: () => setMute(kind, id, true, 60) },
      { label: "Mute for 8 hours", onSelect: () => setMute(kind, id, true, 480) },
      { label: "Mute for 1 day", onSelect: () => setMute(kind, id, true, 1440) },
      { label: "Mute until I turn it back on", onSelect: () => setMute(kind, id, true) },
    ], x, y, "other");
  };
  const [renamingChat, setRenamingChat] = useState<string | null>(null);
  const [goalAsk, setGoalAsk] = useState<{ goalId: string; kind: "stuck" | "report" } | null>(null);
  const renameChat = (r: ChatRow, title: string | null): void => {
    setRenamingChat(null);
    if (title === null || title.trim() === "" || title === r.title) return;
    again(menuApi.renameThread(r.threadId, title.trim()));
  };
  const copy = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard?.writeText(text); };
  const chatMenu = (r: ChatRow): MenuEntry[] => chatMenuEntries(r, {
    open: () => { data.nav.openChat(r.threadId); leave(); },
    star: () => guard(api.star("thread", r.threadId, !r.starred)),
    markRead: () => guard(api.markRead(r.threadId)),
    markUnread: () => guard(api.markUnread(r.threadId)),
    archive: () => again(api.archive(r.threadId)),
    unarchive: () => again(api.unarchive(r.threadId)),
    leaveChat: () => again(api.leaveChat(r.threadId)),
    deleteChat: () => deleteWithUndo(r),
    rename: () => setRenamingChat(r.threadId),
    muted: muted("thread", r.threadId),
    mute: (on) => setMute("thread", r.threadId, on),
    addPeople: () => add.open({ threadId: r.threadId, name: r.title }),
    copyLink: () => copy(chatLink(r.threadId)),
    notifications: () => notifyMenu("thread", r.threadId, 8, 48),
    moveToProject: () => { void menuApi.projects().then((ps) => menu.show(ps.length === 0 ? [{ head: "No projects yet." }] : [{ head: `Move ${r.title} to` }, ...ps.map((p) => ({ label: p.title, onSelect: () => { void menuApi.moveToProject(r.threadId, p.projectId).then(() => say(`Moved to ${p.title}`), () => say("Could not move it. You need Manage on the chat and edit on the project.")); } }))], 8, 48, "other"), () => say("Could not read the projects. Try again.")); },
    ...(data.nav.openChatTab ? { openTab: () => data.nav.openChatTab?.(r.threadId) } : {}),
  });
  const faceMenu = (e: Extract<Entry, { type: "face" }>, x: number, y: number): MenuEntry[] => {
    const a = e.agent, pc = facts.current.computers.get(a.agentId);
    return agentMenu({ name: e.assistant ? data.space.assistant.name : a.name, assistant: e.assistant === true, starred: starred("agent", a.agentId), status: a.status, hasComputer: a.hasComputer, computer: pc, muted: muted("agent", a.agentId), manage: manageAgents }, {
      message: () => { data.nav.openAgentChat(a.agentId); leave(); },
      openProfile: data.nav.openAgent ? () => { data.nav.openAgent?.(a.agentId); leave(); } : undefined,
      openComputer: pc && data.nav.openSubject ? () => { data.nav.openSubject?.({ type: "computer", id: pc.computerId }); leave(); } : data.nav.openAgent ? () => { data.nav.openAgent?.(a.agentId, "computer"); leave(); } : undefined,
      wake: () => { if (pc) again(menuApi.wake(pc.computerId)); readFacts(true); },
      sleep: () => { if (pc) again(menuApi.sleep(pc.computerId)); readFacts(true); },
      pause: () => again(menuApi.pause(a.agentId)),
      resume: () => again(menuApi.resume(a.agentId)),
      // the next menu says what was just done, before the read behind it comes back
      star: (on) => { const next = new Set(facts.current.stars); if (on) next.add(`agent:${a.agentId}`); else next.delete(`agent:${a.agentId}`); facts.current.stars = next; setFactsAt((n) => n + 1); guard(api.star("agent", a.agentId, on)); },
      mute: (on) => setMute("agent", a.agentId, on),
      ...(dmWith(a.agentId) ? { poke: () => { const t = dmWith(a.agentId)!; void menuApi.poke(t.threadId, a.agentId).then(() => say(`Poked ${a.name}`), () => say(`Could not poke ${a.name}. Try again.`)); } } : {}),
      addToChat: () => pickChat(`Add ${a.name} to`, x, y, (threadId) => menuApi.addAgentToChat(threadId, a.agentId)),
      share: () => share.open({ resourceType: "agent", resourceId: a.agentId, itemType: "agent", name: a.name }),
      ...(data.nav.openAgent ? { editInstructions: () => { data.nav.openAgent?.(a.agentId, "instructions"); leave(); } } : {}),
      remove: () => menu.show([{ head: `Delete ${a.name}? Its chats stay; its work and memory go.` }, { label: "Delete agent", danger: true, onSelect: () => again(menuApi.deleteAgent(a.agentId)) }, { label: "Cancel" }], x, y, "other"),
    });
  };
  const channelMenuFor = (c: Channel): MenuEntry[] => channelMenu({ name: c.name, unread: c.unread > 0, starred: starred("channel", c.channelId), muted: muted("channel", c.mainThreadId) || muted("channel", c.channelId), member: data.me ? c.members.some((m) => m.id === data.me?.id) : false, admin: allows(rtPerms, "access.manage") }, {
    open: () => { data.nav.openChannel(c.channelId); leave(); },
    markRead: () => guard(api.markRead(c.mainThreadId)),
    markUnread: () => guard(api.markUnread(c.mainThreadId)),
    star: (on) => { const next = new Set(facts.current.stars); if (on) next.add(`channel:${c.channelId}`); else next.delete(`channel:${c.channelId}`); facts.current.stars = next; setFactsAt((n) => n + 1); guard(api.star("channel", c.channelId, on)); },
    mute: (on) => setMute("channel", c.channelId, on),
    invite: () => add.open({ threadId: c.mainThreadId, name: c.name }),
    notifications: () => notifyMenu("channel", c.channelId, 8, 48),
    copyLink: () => copy(`vyre://channel/${c.channelId}`),
    leave: () => again(menuApi.leaveChannel(c.channelId)),
    archive: () => again(menuApi.archiveChannel(c.channelId)),
  });

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

  const importedMenu = (e: Extract<Entry, { type: "imported" }>, x: number, y: number): MenuEntry[] => importedMenuEntries(e.row, {
    open: () => open(e),
    rename: () => setRenaming(e.row.conversationId),
    archive: () => archiveImported(e.row, true),
    unarchive: () => archiveImported(e.row, false),
    deleteSession: () => menu.show(importedDeleteConfirm(e.row, () => deleteImported(e.row)), x, y, "other"),
  });

  const open = (e: Entry): void => {
    setCursor(e.key);
    if (e.type === "chat") data.nav.openChat(e.row.threadId);
    else if (e.type === "imported") { if (e.row.continuedThreadId) data.nav.openChat(e.row.continuedThreadId); else data.nav.openImported?.(e.row.conversationId); }
    else if (e.type === "face") data.nav.openAgentChat(e.agent.agentId);
    else if (e.type === "channel") data.nav.openChannel(e.channel.channelId);
    else if (e.type === "nav") { (e.to === "tasks" ? data.nav.openTasks : data.nav.openNotes)?.(); }
    else if (e.type === "goal") data.nav.openGoal?.(e.goal.id);
    else if (e.type === "project") data.nav.openProject?.(e.project.id);
    else if (e.type === "person") void api.chatWithPerson(e.id);
    else if (e.type === "pulse") { if (e.kind === "person") void api.chatWithPerson(e.id); else if (e.threadId) data.nav.openChat(e.threadId); else data.nav.openAgentChat(e.id); }
    else if (e.type === "digest") { digestMenu(8, 48); return; }
    else if (e.type === "action") { setSheet("new"); return; }
    else if (e.type === "more") { if (e.to === "agents") data.nav.openAllAgents(); else { setMore((m) => ({ ...m, [e.to]: true })); return; } }
    else if (e.type === "head") { toggle(e.section); return; }
    leave();
  };
  // While you were away: what happened, in the order the digest ranks it; choosing a line opens it and the row goes (the digest resets once seen)
  const seenDigest = (): void => {
    const d = pulse.digest;
    if (d) void data.call("home.mark_digest_seen", { digestId: d.id }).then(rereadPulse, () => undefined);
  };
  const openDigestItem = (subject: { type: string; id: string }): void => {
    if (subject.type === "thread") data.nav.openChat(subject.id);
    else if (subject.type === "task") data.nav.openNeedsYou(subject.id);
    else data.nav.openSubject?.(subject);
    seenDigest();
    leave();
  };
  const digestMenu = (x: number, y: number): void => {
    const d = pulse.digest;
    if (!d) return;
    const items: MenuEntry[] = d.headline.map((h): MenuEntry => ({ head: h }));
    for (const it of d.items) {
      const subject = it.subject;
      items.push({ label: `${it.title}: ${it.line}`, ...(subject && (subject.type === "thread" || subject.type === "task" || data.nav.openSubject) ? { onSelect: () => openDigestItem(subject) } : {}) });
    }
    items.push({ separator: true }, { label: "Mark all seen", onSelect: seenDigest });
    menu.show(items, x, y, "other", { label: "While you were away" });
  };
  const at = (ev: unknown): [number, number] => { const n = (ev as { nativeEvent?: { pageX?: number; pageY?: number } } | undefined)?.nativeEvent; return [n?.pageX ?? 8, n?.pageY ?? 48]; };
  // a person: Message, and Mark as Read or Unread once you have a direct message with them
  const personMenu = (e: Extract<Entry, { type: "person" }>): MenuEntry[] => {
    const dm = dms.get(e.id);
    return personMenuOf({ name: e.name, dm: dm !== undefined, unread: e.unread > 0, muted: muted("person", e.id) }, {
      message: () => open(e),
      markRead: () => { if (dm) guard(api.markRead(dm)); },
      markUnread: () => { if (dm) guard(api.markUnread(dm)); },
      mute: (on) => setMute("person", e.id, on),
      addToChat: () => pickChat(`Add ${e.name} to`, 8, 48, (threadId) => menuApi.addPersonToChat(threadId, e.id)),
      copyHandle: () => { copy(`@${e.name.split(" ")[0] ?? e.name}`); say("Copied"); },
      ...(data.nav.callPerson ? { call: () => data.nav.callPerson!(e.id, e.name) } : {}),
    });
  };
  // Notes: Open, Open in a new tab, Take a note
  const notesMenu = (e: Entry): MenuEntry[] => [
    { label: "Open", onSelect: () => open(e) },
    ...(data.nav.openNotesTab ? [{ label: "Open in a new tab", onSelect: () => data.nav.openNotesTab?.() }] : []),
    ...(data.nav.takeNote ? [{ label: "Take a note", onSelect: () => { setCursor(e.key); data.nav.takeNote?.(); leave(); } }] : []),
  ];
  /** One capability call for a goal from its row menu: the words say what happened, a refusal says it did not. */
  const goalRun = (goalId: string) => (cap: string, input: Record<string, unknown>, done?: string): Promise<unknown> =>
    Promise.resolve(data.call(cap, { goalId, ...input })).then((o) => { if (done) say(done); return o; }, (e: unknown) => { say(e instanceof Error && e.message ? e.message : "That did not go through."); });
  const goalMenu = (e: Extract<Entry, { type: "goal" }>): MenuEntry[] => goalMenuEntries(e.goal, data.me?.id, {
    run: goalRun(e.goal.id),
    ...(data.nav.openGoal ? { open: () => { data.nav.openGoal?.(e.goal.id); leave(); } } : {}),
    ask: (kind) => setGoalAsk({ goalId: e.goal.id, kind }),
  });
  /** A project row's menu: what anyone may do (Open, Star, Copy Link); Share, Add People, Pin File and Archive need the person's role and a sheet, so they are the project page's and are not offered here, where the person's role on the project is known. */
  const projectRowMenu = (e: Extract<Entry, { type: "project" }>): MenuEntry[] => projectMenu({ title: e.project.title, starred: e.project.starred, archived: false, manage: false, edit: false }, {
    open: () => { data.nav.openProject?.(e.project.id); leave(); },
    star: (on) => { void Promise.resolve(data.call("stars.toggle", { resource: { type: "project", id: e.project.id }, on })).then(() => projectsQ.reload(), () => say("That did not go through.")); },
    copyLink: () => { copyToClipboard(vyreLink("project", e.project.id)); say("Link copied"); },
  });
  const menuFor = (e: Entry, x: number, y: number): MenuEntry[] | null =>
    e.type === "goal" ? goalMenu(e) : e.type === "project" ? projectRowMenu(e) : e.type === "nav" && e.to === "notes" ? notesMenu(e) : e.type === "chat" ? chatMenu(e.row) : e.type === "face" ? faceMenu(e, x, y) : e.type === "channel" ? channelMenuFor(e.channel) : e.type === "imported" ? importedMenu(e, x, y) : e.type === "person" ? personMenu(e) : null;
  /** A row's "...", drawn while the pointer is on it: the same menu as a right-click. */
  const moreTool = (e: Entry, label: string): ReactElement => (
    <Tool icon="more" label={`More for ${label}`} onPress={(x, y) => { readFacts(); const m = menuFor(e, x, y); if (m) menu.show(m, x, y, "context", { label: e.key }); }} testID={`more-${e.key}`} />
  );

  // ----- keyboard: arrows move, Enter opens, Cmd-1..9 jump to a starred face
  const onKeyDown = (ev: { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; preventDefault?: () => void }): void => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault?.(); setCursor(stepKey(order, cursor, ev.key === "ArrowDown" ? 1 : -1)); return; }
    if (ev.key === "Enter" && cursor && ev.metaKey !== true && ev.ctrlKey !== true) { const e = byKey.get(cursor); if (e) { ev.preventDefault?.(); open(e); } return; }
    // a key a menu item shows in its hint column does that item on the row with the keyboard's place: S star, U read, E archive, F2 rename, Cmd Enter a new tab, Cmd Backspace delete
    if (cursor) {
      const e = byKey.get(cursor);
      const entries = e ? menuFor(e, 0, 0) : null;
      const hit = entries ? shortcutFor(entries, ev) : null;
      if (hit) { ev.preventDefault?.(); hit.onSelect?.(); }
    }
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
    const sel = selected === e.key;
    // the keyboard cursor on a row that is not the open one: drawn as a hover, never as the selection
    const lit = follows && cursor === e.key && !sel;
    const wrap = (child: ReactElement, rowH: number = ROW_H): ReactElement => {
      const m = menuFor(e, 0, 0);
      return m ? <View style={{ height: rowH }} {...rowMenu.on((at) => menuFor(e, at.x, at.y), { label: e.key, before: () => readFacts() })}>{child}</View> : child;
    };
    switch (e.type) {
      case "head": {
        return (
          <SectionHead id={e.section} label={e.label} count={!e.open ? e.count : undefined} open={e.open} onToggle={() => toggle(e.section)}>
            {e.section === "channels" ? <Tool icon="search" label="Browse channels" onPress={() => setSheet("browse")} testID="browse-channels-tool" /> : null}
            {e.section === "channels" && canChannel ? <Tool icon="plus" label="New channel" onPress={() => setSheet("new")} testID="new-channel" /> : null}
            {e.section === "projects" && data.nav.openNewProject ? <Tool icon="plus" label="New project" onPress={() => { data.nav.openNewProject!(); leave(); }} testID="new-project" /> : null}
            {e.section === "faces" && canAgent ? <Tool icon="plus" label="New agent" onPress={() => { (data.nav.openNewAgent ?? data.nav.openAllAgents)(); leave(); }} testID="all-agents" /> : null}
          </SectionHead>
        );
      }
      case "project": return wrap(
        <Row id={e.key} title={e.project.title} selected={sel} hovered={lit} onPress={() => open(e)}
          leading={<LeadGlyph name="project" />}
          trailing={<View style={st.tools}>{(e.project.unread ?? 0) > 0 ? <UnreadDot /> : null}{e.project.starred ? <Text style={st.starMark}>{"\u2605"}</Text> : null}{e.project.health === "risk" || e.project.health === "off" ? <View style={[st.healthDot, { backgroundColor: HEALTH_DOT[e.project.health] }]} testID={`project-dot-${e.project.id}`} accessibilityLabel={HEALTH_LABEL[e.project.health]} /> : null}</View>} />, ROW_H);
      case "goal": return wrap(<GoalRow goal={e.goal} selected={sel} hovered={lit} now={data.clock().now} me={data.me?.id} leadName={agentName(e.goal.leadAgentId)} onPress={() => open(e)} />, GOAL_ROW_H);
      case "group": return <GroupLabel label={e.label} />;
      case "action": return (
        <Row id={e.key} title={e.label} selected={sel} hovered={lit} onPress={() => open(e)} leading={<LeadGlyph name="plus" />} />
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
      case "nav": {
        const row = (
          <Row
            id={e.key} title={e.label} selected={sel} hovered={lit} onPress={() => open(e)} leading={<LeadGlyph name={e.to === "tasks" ? "task" : e.to === "notes" ? "note" : "reply"} />}
            trailing={e.count > 0 ? <Text testID={`count-${e.to}`} style={st.navCount}>{e.count}</Text> : e.dot ? <UnreadDot /> : null}
          />
        );
        return e.to === "notes" ? wrap(row) : row;
      }
      case "digest": return (
        <Hot testID="away-digest-row">{(over) => (
          <Row id={e.key} title="While you were away" selected={sel} hovered={lit} onPress={(ev) => { setCursor(e.key); const [x, y] = at(ev); digestMenu(x, y); }}
            trailing={over || lit ? <Pressable accessibilityRole="button" accessibilityLabel="Mark all seen" testID="away-digest-seen" onPress={() => seenDigest()} style={st.seenBtn}><Text style={st.seenText}>Mark all seen</Text></Pressable> : <Text testID="away-digest-count" style={st.navCount}>{e.count}</Text>} />
        )}</Hot>
      );
      case "pulse": return (
        <View style={{ height: ROW_H }} testID={`pulse-${e.kind}-${e.id}`}>
          <Row id={e.key} title={e.name} titleSuffix={e.line} selected={sel} hovered={lit} onPress={() => open(e)}
            leading={<View style={{ marginRight: 9 }}><Face name={e.name} seedId={e.id} kind={e.kind} size={18} presence={e.presence} /></View>} />
        </View>
      );
      case "person": return wrap(
        <Hot>{(over) => (
          <Row id={e.key} title={e.name} selected={sel} hovered={lit} emphasis={e.unread > 0 && !sel} onPress={() => open(e)}
            leading={<View style={{ marginRight: 9 }}><Face name={e.name} seedId={e.id} kind="person" size={18} presence={e.presence} /></View>}
            trailing={over ? moreTool(e, e.name) : e.unread > 0 && !sel ? <UnreadDot /> : null} />
        )}</Hot>,
      );
      case "face": return wrap(
        <Hot>{(over) => (
        <Row
          id={e.key} title={e.assistant ? data.space.assistant.name : e.agent.name} selected={sel} hovered={lit} emphasis={(e.unread ?? 0) > 0 && !sel} onPress={() => open(e)}
          trailing={over ? moreTool(e, e.assistant ? data.space.assistant.name : e.agent.name) : (e.unread ?? 0) > 0 && !sel ? <UnreadDot /> : null}
          leading={<View testID={e.agent.runtime === "outside" && e.agent.status === "asleep" ? "outside-offline-row" : undefined} accessibilityLabel={e.agent.runtime === "outside" && e.agent.status === "asleep" ? `${e.agent.name} is offline` : undefined} style={{ marginRight: 9, opacity: e.agent.runtime === "outside" && e.agent.status === "asleep" ? 0.5 : 1 }}><Face name={e.assistant ? data.space.assistant.name : e.agent.name} seedId={e.agent.agentId} kind="agent" size={18} pulse={e.working} waiting={e.waiting} /></View>}
        />
        )}</Hot>,
      );
      case "more": return <Pressable accessibilityRole="button" accessibilityLabel={e.label} testID={`row-${e.key}`} onPress={() => open(e)} style={st.more}><Text style={st.moreText}>{e.label}</Text></Pressable>;
      case "chat": {
        const r = e.row;
        const title = displayTitle(r);
        if (renamingChat === r.threadId) {
          return (
            <View style={st.renameRow} testID={`chat-row-${r.threadId}`}>
              <View style={{ marginRight: 9 }}>{r.members ? <FaceStack members={r.members} size={16} /> : <Face name={r.who} seedId={r.whoId} kind={r.kind} size={18} />}</View>
              <RenameField value={r.title} label={`Rename ${r.title}`} testID={`chat-rename-${r.threadId}`} style={st.renameInput} onDone={(v) => renameChat(r, v)} />
            </View>
          );
        }
        return wrap(
          <Hot>{(over) => (
            <Row
              id={e.key} title={title} selected={sel} hovered={lit} onPress={() => open(e)}
              leading={<View style={{ marginRight: 9 }}>{r.members ? <FaceStack members={r.members} size={16} /> : <Face name={r.who} seedId={r.whoId} kind={r.kind} size={18} pulse={r.working} waiting={r.waiting === true} />}</View>}
              emphasis={(r.repliesUnread ?? 0) > 0 && !sel}
              trailing={over ? moreTool(e, title) : r.waiting ? <View style={st.needDot} testID="need-dot" /> : (r.repliesUnread ?? 0) > 0 ? <Badge n={r.repliesUnread!} testID={`replies-${r.threadId}`} /> : r.unread > 0 && !sel ? <UnreadDot /> : null}
            />
          )}</Hot>,
        );
      }
      case "imported": {
        const r = e.row, c = data.clock();
        const mark = <View style={{ marginRight: 6 }} accessibilityLabel={providerName(r.provider)}><Mark k={providerMark(r.provider)} size={16} /></View>;
        if (renaming === r.conversationId) {
          return (
            <View style={st.renameRow} testID={`imported-row-${r.conversationId}`}>
              {mark}
              <RenameField value={r.title} label={`Rename ${r.title}`} testID={`imported-rename-${r.conversationId}`} style={st.renameInput} onDone={(v) => renameImported(r, v)} />
            </View>
          );
        }
        // a session continued in a chat reads as that chat's last day, like a chat row; else the day it started
        const day = dayLabel((r.continuedThreadId ? lastAt.get(r.continuedThreadId) : undefined) ?? (r.startedAt || r.importedAt), c.now, c.offsetMin);
        return wrap(
          <View style={{ height: ROW_H }} testID={`imported-row-${r.conversationId}`}>
            <Hot>{(over) => (
              <Row
                id={e.key} title={r.title} selected={sel} hovered={lit} onPress={() => open(e)} leading={mark}
                trailing={over ? moreTool(e, r.title) : <Text testID={`imported-day-${r.conversationId}`} style={st.time}>{day}</Text>}
              />
            )}</Hot>
          </View>,
        );
      }
      case "channel": {
        const c = e.channel;
        // A channel with nothing new sits dim; one with unread stands out at full strength with its count (prototype .unread / .dim).
        return wrap(
          <View style={{ height: ROW_H, opacity: c.unread > 0 ? 1 : 0.72 }} testID={c.unread > 0 ? `channel-unread-${c.channelId}` : `channel-read-${c.channelId}`}>
            <Hot>{(over) => (
              <Row
                id={e.key} title={c.name} selected={sel} hovered={lit} emphasis={c.unread > 0} onPress={() => open(e)}
                leading={<LeadGlyph name={e.project ? "project" : c.visibility === "invite" ? "lock" : "hash"} />}
                trailing={over ? moreTool(e, c.name) : c.unread > 0 ? <Badge n={c.unread} testID={`unread-${c.channelId}`} /> : null}
              />
            )}</Hot>
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
  // Filter, then New: a chat, a channel, an agent. A Personal Space has no channels.
  const newMenu = (x: number, y: number): void => menu.show([
    ...(canChat ? [{ label: "New chat", onSelect: () => { (data.nav.openNew ?? (() => void api.newChat()))(); leave(); } }] : []),
    ...(personal ? [] : [...(canChannel ? [{ label: "New channel", onSelect: () => setSheet("new") }] : []), { label: "Browse channels", onSelect: () => setSheet("browse") }]),
    ...(canAgent ? [{ label: "New agent", onSelect: () => { (data.nav.openNewAgent ?? data.nav.openAllAgents)(); leave(); } }] : []),
  ], x, y, "other");
  const newButton = <Tool icon="plus" label="New" onPress={newMenu} testID="new-menu" />;
  const newChatButton = <Tool icon="filter" label="Filter" active={filter !== "all"} onPress={filterMenu} testID="filter-chats" />;
  return (
    <View testID="chats-sidebar" accessibilityRole="listbox" accessibilityLabel="Chats" style={st.root} {...{ tabIndex: 0, onKeyDown, ...(cursor ? { "aria-activedescendant": cursor.startsWith("h:") ? (cursor === "h:needs" ? "row-needs-parent" : `toggle-${cursor.slice(2)}`) : `row-${cursor}` } : {}) }}>
      {headBusy || !inHeader ? (
        <View style={st.top} testID="sidebar-head" accessibilityLabel={`Chats, ${data.space.name}`}>
          {dot ? <View testID="other-space-dot" accessibilityLabel="Another Space needs you" style={st.red} /> : null}
          {online ? null : <Text testID="sidebar-offline" style={st.quiet}>Offline</Text>}
          <View style={{ flex: 1 }} />
          {inHeader ? null : <>{newChatButton}{newButton}</>}
        </View>
      ) : null}
      {inHeader ? portalInto(slot?.actionsOutlet, <>{newChatButton}{newButton}</>) : null}
      {data.nav.openArtifacts ? <View style={{ height: ROW_H, flexShrink: 0 }}><Row id="artifacts" testID="chats-artifacts" title="Artifacts" selected={selected === "artifacts"} hovered={follows && cursor === "artifacts" && selected !== "artifacts"} leading={<LeadGlyph name="project" />} onPress={() => { setCursor("artifacts"); data.nav.openArtifacts?.(); leave(); }} /></View> : null}
      <View style={st.list}>
        {loading ? <ChatsSidebarLoading /> : (
          <VirtualList data={entries} rowHeight={ROW_H} heightOf={(e) => (e.type === "goal" ? GOAL_ROW_H : ROW_H)} keyOf={(e) => e.key} renderItem={(e) => renderEntry(e)} {...(window ? { window } : {})} />
        )}
      </View>
      {undo ? (
        <View testID="chat-deleted" accessibilityRole="alert" style={st.undo}>
          <Text numberOfLines={1} style={st.undoText}>{`Deleted ${undo.title}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Undo delete of ${undo.title}`} testID="undo-delete" onPress={restore} style={st.undoBtn}><Text style={st.undoAct}>Undo</Text></Pressable>
        </View>
      ) : null}
      {note ? <View testID="menu-note" accessibilityRole="alert" style={st.undo}><Text numberOfLines={2} style={st.undoText}>{note}</Text></View> : null}
      {menu.element}
      {add.element}
      {share.element}
      {goalAsk ? <TextAsk title={goalAsk.kind === "stuck" ? "Why is this goal stuck?" : "Report progress"} label={goalAsk.kind === "stuck" ? "What is in the way" : "What changed and what is next"} action={goalAsk.kind === "stuck" ? "Mark stuck" : "Report"} multiline onClose={() => setGoalAsk(null)} onDone={(text) => { const c = askedCall(goalAsk.kind, text); const id = goalAsk.goalId; setGoalAsk(null); void goalRun(id)(c.cap, c.input, c.done); }} /> : null}
      {sheet ? <ChannelSheets kind={sheet} channels={allChannels} agents={agents} onSwitch={setSheet} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

/** Time budget helper for the proof: how long a new chat takes to show as a row. Exported so the test and the mount share one measure. */
export const NEW_CHAT_BUDGET_MS = NEW_CHAT_MS;

const HEALTH_DOT: Record<string, string> = { on: "var(--ok)", risk: "var(--warn)", off: "var(--danger)", hold: "var(--ink-3)", done: "var(--accent)", none: "var(--line-2)" };

const st = StyleSheet.create({
  healthDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 5 },
  starMark: { fontSize: 11, color: "var(--warn)" as string },
  root: { flex: 1, minHeight: 0, paddingHorizontal: 8 },
  top: { height: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, paddingBottom: 4 },
  seenBtn: { height: 24, paddingHorizontal: 6, justifyContent: "center", borderRadius: RADIUS },
  seenText: { fontSize: 12, color: "var(--ink-3)" as string },
  navCount: { fontSize: 11, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  needDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--warn)" as string },
  more: { height: ROW_H, justifyContent: "center", paddingHorizontal: 8 },
  moreText: { fontSize: 12, color: "var(--ink-3)" as string },
  undo: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 8, marginBottom: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: RADIUS, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  undoText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)" as string },
  undoBtn: { height: 28, paddingHorizontal: 8, justifyContent: "center" },
  undoAct: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
  red: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--danger)" as string },
  list: { flex: 1, minHeight: 0, overflow: "hidden" },
  tools: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontSize: 11, color: "var(--ink-3)" as string },
  renameRow: { height: ROW_H, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  renameInput: { flex: 1, minWidth: 0, height: 24, borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--accent)" as string, paddingHorizontal: 6, fontSize: 13, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  digit: { fontSize: 11, color: "var(--ink-4)" as string },
  waiting: { fontSize: 11.5, color: "var(--accent)" as string },
  quiet: { fontSize: 11.5, color: "var(--ink-3)" as string },
  kind: { fontSize: 11.5, color: "var(--accent)" as string, fontWeight: "500" },
  kindWarn: { color: "var(--warn)" as string },
});
