// The conversation (spec 3.2 Chats, 2.5, 4.13, 4.6): the middle of the Chats place. A header with the thread's title, the faces of its agents with their mode marks (a press opens that
// agent's mode menu), Helpers while any run, Stop and Stop all while any work, the pane toggle and a menu. Under it the last 50 messages (older ones stream in on request), the agent's
// work folded into one line, and the shared composer with its who-will-reply line. A send shows on the page in the same frame, before chat.post answers; while an agent works, a plain
// send queues for its next step and Interrupt sends it now.
import { useFrameStore } from "./frame.ts";
import type { FrameControls, FrameStore } from "./frame.ts";
import { foldHelperRows, groupHelperStrips, hideCrewPosts, mergeCrewAnswer, stripFromCoders } from "./helper-rows.ts";
import { useCrew } from "../crew/context.tsx";
import { crewChipOf } from "../crew/model.ts";
import { CrewIsland } from "../crew/island.tsx";
import { AlsoToChat } from "../crew/also.tsx";
import { readReplyDetails } from "../details/read.ts";
import type { Call } from "../details/read.ts";
import { DECIDED_LINE, isDecided } from "../../../shell/decided.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { COLUMN, RADIUS, gutterFits } from "../../../../../../ui/src/tokens/calm.ts";
import { GutterContext } from "./gutter.ts";
import { Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { ComposerSend, ListItem } from "../../../../../../ui/src/Composer/index.tsx";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { DropRoute } from "../../../../../../ui/src/FileDrop/index.tsx";
import type { TransferLike } from "../../../../../../ui/src/FileDrop/index.tsx";
import { useRunsOn } from "./RunsOn.tsx";
import { ReactionPicker } from "./ReactionPicker.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Feed } from "../../../../../../ui/src/stream/index.ts";
import { Quiet } from "../../../../../../ui/src/States/Quiet.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { droppedOf, sharedLine, shareWithAgents, undoShare } from "./dropshare.ts";
import { ConversationDataProvider, useConversationData, useOnline, useOptionalConversationData, useScreenQuery } from "./data.tsx";
import type { ConversationData, ConversationNav } from "./data.tsx";
import * as act from "./actions.ts";
import { newDelegates, stableActions } from "./stable-actions.ts";
import { ChatMemoryProvider } from "../memory/thread.tsx";
import { keepItem, weave } from "../tasks/activity.ts";
import { useMemoryEntries } from "../memory/menu.tsx";
import { MessageView } from "./MessageView.tsx";
import { QueueWaiting } from "./QueueWaiting.tsx";
import { CatchUpLine } from "./catch-up.tsx";
import { AsideList } from "./Aside.tsx";
import type { AsideItem } from "./Aside.tsx";
import { commandItems, lastActionable, runSlash } from "./commands.ts";
import type { CommandEnv } from "./commands.ts";
import { parseSlash } from "../../../../../../lib/chat-commands.ts";
import { pluginNames } from "./commands.ts";
import { composerSuggest, previewOf } from "./suggest.ts";
import { ThreadParent } from "./ThreadParent.tsx";
import { replySummaries } from "./replies.ts";
import type { ReplySummary } from "./replies.ts";
import type { LiveQuery } from "../../../../../../client/src/index.ts";
import { useAddSheet } from "../addsheet/index.ts";
import { useChatViewing, useOpenPublished } from "./artifact-open.ts";
import { QuestionIsland } from "./QuestionIsland.tsx";
import { islandView, openQuestions } from "./island.ts";
import { useCardsInView } from "./use-cards-in-view.ts";
import { ChatBrain, compactChat, entryOf, modeOf, prettyModel, setChatMode, stripAgents, useAccounts, useLastPick, usePickUnavailable, useUsage, withLastPick } from "./brain.tsx";
import type { ChatMode } from "../../../../../../ui/src/Composer/index.tsx";
import { useConnectVersion } from "../../../shell/connect/context.ts";
import { windowAround } from "./focus.ts";
import type { MessageActions } from "./MessageView.tsx";
import { Glyph, IconButton, PeopleCount, RenameField, TextButton } from "./parts.tsx";
import { CONTINUE_TEXT, DEFAULT_AGENT_HOPS, limitOf, parkedAtLimit, parkedLine } from "./hops.ts";
import { addedAgentMentions, askPost, pickerAgents, unansweredOwn } from "./askagent.ts";
import { MemorySwitch } from "./memory-switch.tsx";
import { SWITCH_NOTE, SWITCH_TITLE, hasSwitch, repliesOf } from "../thread-replies/model.ts";
import { useReplySwitch } from "../thread-replies/ThreadSwitch.tsx";
import type { AgentMeta } from "./askagent.ts";
import { useMobileBack } from "../../../mobile/shell/back.ts";
import { offlineLine } from "../agentpage/model.ts";
import { CONNECT_YOURS, NO_AI_LINE, SET_SPACE_KEY, aiReady } from "./ai-ready.ts";
import type { AiReady } from "./ai-ready.ts";
import { useOpenConnect } from "../../../shell/connect/context.ts";
import {
  WINDOW, beforeCursor, byOrder, collect, ghostMessages, findMatches, isClosed, lastMessages, leadOf, matchLine, mentionsIn, mergePages, modelLabel, pendingMessage, placeholderFor, queueNote, queuedCount, queuedIds, sendKind, stillPending, stopLabel,
  directWith, mentionable, muteOfferFor, onBehalfOf, threadKindNote, timeLabel, timeline, titleOf, whoLine, workingAgents, withoutAnswered } from "./model.ts";
import type { Message, Pending, SendKind, Thread } from "./model.ts";
import { LoadFailed, failureOf } from "../../../../../../ui/src/States/Loads.tsx";
import { messageLink } from "../../../share/rows.ts";
import { useZones } from "../../../../../../ui/src/Time/index.tsx";
import { offsetMinAt, zoneName } from "../../../../../../lib/zones.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type MessagesOut = CapMap["chat.messages.list"]["out"];
type HelpersOut = CapMap["chat.helpers.list"]["out"];
type ThreadsOut = CapMap["threads.list"]["out"];

export const CONVERSATION_SCREEN = "chats.conversation";
/** The threads hanging off a chat, read once per chat and live: the line under each message that has one. */
export const REPLIES_SCREEN = "chats.right-pane";

const NO_REPLIES: Map<string, ReplySummary> = new Map();
const NOT_READ: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
/** The reply threads of this chat by message. A host whose kept copy cannot read them (a test double) draws no lines. */
function useReplies(threadId: string): Map<string, ReplySummary> {
  const { screens } = useConversationData();
  const q = useMemo(() => { try { return screens.query(REPLIES_SCREEN, "threads", { threadId }) as LiveQuery<ThreadsOut>; } catch { return NOT_READ; } }, [screens, threadId]);
  const snap = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  return useMemo(() => (snap.status === "ready" ? replySummaries(snap.data.threads, { empty: true }) : NO_REPLIES), [snap]);
}

/** `compact` is for a conversation inside another screen (the onboarding Assistant): just the messages and the composer, no title bar with members, search and side-panel buttons. */
const CompactContext = createContext(false);
const NO_IDS: readonly string[] = [];
/** The mute lines a teammate has been shown, by message (lane l-agentdm): kept on this device so the line does not come back once seen. */
const MUTE_SEEN = "vyre.agentdm.mute-seen.v1";
function readMuteSeen(): ReadonlySet<string> {
  try { return new Set(JSON.parse(globalThis.localStorage?.getItem(MUTE_SEEN) ?? "[]") as string[]); } catch { return new Set(); }
}
function rememberMuteSeen(id: string): void {
  try {
    const now = [...readMuteSeen()];
    if (now.includes(id)) return;
    globalThis.localStorage?.setItem(MUTE_SEEN, JSON.stringify([...now, id].slice(-200)));
  } catch { /* no storage here: the line shows again next time */ }
}

/** The newest rows are always drawn in full (the chat follows the end and streams there); older ones may be skipped while off screen. */
const OFFSCREEN_KEEP = 24;

export function Conversation({ data, compact = false }: { data?: ConversationData; compact?: boolean }): ReactElement {
  const ctx = useOptionalConversationData();
  const value = data ?? ctx;
  if (!value) return <ConversationLoading />;
  return <ConversationDataProvider value={value}><CompactContext.Provider value={compact}><ChatMemoryProvider memory={value.memory ? { ...value.memory, time: (at: number) => timeLabel(at, value.clock()) } : value.memory} threadId={value.threadId}><ConversationView /></ChatMemoryProvider></CompactContext.Provider></ConversationDataProvider>;
}

/** How much of the header's faces fit: all of them, the lead agent's face alone, or only the name and the buttons. The title keeps its room first. */
export function headerTier(width: number): "full" | "lead" | "bare" {
  return width <= 0 || width >= 720 ? "full" : width >= 420 ? "lead" : "bare";
}

/** The frame before data: a header bar, messages the size of real ones and a composer box, so nothing moves when the thread arrives. */
export function ConversationLoading(): ReactElement {
  return (
    <View testID="conversation-loading" accessibilityLabel="Loading" style={st.root}>
      <View style={st.head} />
      <View style={st.feedBox}><Quiet /></View>
    </View>
  );
}

/** The channel menu's "Connect an Outside Agent": only on a channel, and only where the shell has the sheet for it (P-L9b_23). */
export function connectEntries(thread: Pick<Thread, "kind" | "channelId" | "threadId">, nav: ConversationNav): MenuEntry[] {
  const open = nav.openConnectOutsideAgent;
  return thread.kind === "channel" && open ? [{ label: "Connect an Outside Agent", onSelect: () => open(thread.channelId ?? thread.threadId) }] : [];
}

const NO_TURNS: readonly never[] = [];
const noSub = (): (() => void) => () => undefined;

/** Replies being written in this chat, re-read whenever one starts, grows a state, or is saved. */
function useLiveTurns(data: ConversationData): readonly import("../../../shell/session/turn-streams.ts").LiveTurn[] {
  const live = data.live;
  const read = (): readonly import("../../../shell/session/turn-streams.ts").LiveTurn[] => (live ? live.turnsOf(data.threadId) : NO_TURNS);
  return useSyncExternalStore(live ? live.subscribe : noSub, read, read);
}

/** The lead of this chat runs outside Vyre and has gone quiet: said plainly above the composer, because a message here will wait. Only its owner can read it, and only its owner can ask it. */
export function useOutsideOffline(data: Pick<ConversationData, "call">, agentId: string | null, messages: number): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (agentId === null) { setLine(null); return undefined; }
    let live = true;
    const read = (): void => { void data.call("agents.get", { agentId }).then((o) => {
      const a = (o as { agent?: { name?: string; runtime?: string; status?: string } }).agent;
      if (live) setLine(a?.runtime === "outside" && a.status === "asleep" ? offlineLine(a.name ?? "This agent") : null);
    }, () => { if (live) setLine(null); }); };
    read();
    const t = setInterval(read, OUTSIDE_POLL_MS);
    (t as { unref?: () => void }).unref?.();
    return () => { live = false; clearInterval(t); };
  }, [data, agentId, messages]);
  return line;
}
const OUTSIDE_POLL_MS = 30_000;

/** Before sending, not after a failed reply: no AI account that could pay for my next message to this agent here is said above the composer, with the fix beside it (ai-ready.ts). */
function NoAiLine({ data, threadId, agentId }: { data: Pick<ConversationData, "call" | "nav">; threadId: string; agentId: string }): ReactElement | null {
  const [ai, setAi] = useState<AiReady>({ ready: true, admin: false });
  const openConnect = useOpenConnect();
  useEffect(() => {
    let live = true;
    void aiReady(data.call, threadId, agentId).then((r) => { if (live) setAi(r); });
    return () => { live = false; };
  }, [data.call, threadId, agentId]);
  if (ai.ready) return null;
  const connect = (): void => { if (openConnect) void openConnect({ kind: "ai" }); else data.nav.openAiSetup?.(); };
  return (
    <View testID="no-ai-line" accessibilityLiveRegion="polite" style={st.lineBox}>
      <Text style={st.lineText}>{NO_AI_LINE}</Text>
      <TextButton link label={CONNECT_YOURS} testID="no-ai-connect" onPress={connect} />
      {ai.admin && data.nav.openSpaceAiKey ? <><Text style={st.lineText}>or</Text><TextButton link label={SET_SPACE_KEY} testID="no-ai-space-key" onPress={() => data.nav.openSpaceAiKey?.()} /></> : null}
    </View>
  );
}

function ConversationView(): ReactElement {
  const frame = useFrameStore();
  const inFrame = frame !== null;
  const data = useConversationData();
  const zones = useZones();
  const compact = useContext(CompactContext);
  const liveTurns = useLiveTurns(data);
  const online = useOnline();
  // A chat opened mid-turn, on any device, or after a reconnect, shows the running turn at once: ask what it has written so far, then the live pieces carry on from there.
  useEffect(() => {
    const live = data.live;
    if (!live || !online) return;
    let gone = false;
    const fetchNow = (): void => { void data.call("engine.live_turns", { threadId: data.threadId }).then((r) => { if (!gone) live.seed(data.threadId, (r as { turns?: { turnId: string; agentId: string; text: string }[] }).turns ?? []); }, () => undefined); };
    fetchNow();
    const off = live.onGap((th) => { if (th === data.threadId) fetchNow(); });
    return () => { gone = true; off(); };
  }, [data, data.threadId, online]);
  const menu = useMenu();
  const add = useAddSheet({ call: data.call, me: data.me, nameOf: data.nameOf, newKey: data.newKey, toast: data.toast }, { copy: data.copy });
  const memoryEntries = useMemoryEntries();
  const threadQ = useScreenQuery<ThreadOut>(CONVERSATION_SCREEN, "thread", { threadId: data.threadId });
  const messagesQ = useScreenQuery<MessagesOut>(CONVERSATION_SCREEN, "messages", { threadId: data.threadId });
  const repliesSwitch = useReplySwitch(data, data.threadId, threadQ.status === "ready" ? repliesOf(threadQ.data.thread) : undefined);
  const helpersQ = useScreenQuery<HelpersOut>(CONVERSATION_SCREEN, "helpers", { threadId: data.threadId });
  const [shown, setShown] = useState(WINDOW);
  const delegates = useRef(newDelegates());
  const [older, setOlder] = useState<Message[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [line, setLine] = useState("");
  // the question island: put-away questions (this session) and the one the person stepped to
  const [putAway, setPutAway] = useState<ReadonlySet<string>>(() => new Set());
  const [islandAt, setIslandAt] = useState<string | null>(null);
  /** A line with an Undo (a drop that shared something): the taking-back runs when it is pressed. */
  const [undo, setUndo] = useState<(() => void) | null>(null);
  // text asked for by a pane or a page ("Ask about this file"): taken when this conversation opens and whenever it is asked again, after what the person had typed
  const [seed, setSeed] = useState<{ value: string; n: number }>(() => ({ value: data.fill?.take() ?? "", n: 0 }));
  const [typed, setTyped] = useState(seed.value);
  const typedRef = useRef(seed.value);
  const emptyRef = useRef(false);
  const [atEnd, setAtEnd] = useState(true);
  const [jump, setJump] = useState(0);
  const [sentOnPage, setSentOnPage] = useState(0);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [matchAt, setMatchAt] = useState(0);
  const [asides, setAsides] = useState<AsideItem[]>([]);
  const [focusId, setFocusId] = useState<string | null>(data.focus ?? null);
  /** Messages read around a marked one that is older than the page holds: shown instead of the newest, until "Jump to latest". */
  const [around, setAround] = useState<Message[] | null>(null);
  // asked for again (the box at the top of a thread, pressed twice), the same message is marked again
  useEffect(() => { setFocusId(data.focus ?? null); }, [data.focus]);
  const askedN = useRef(data.focusN);
  useEffect(() => {
    if (data.focusN === askedN.current) return undefined;
    askedN.current = data.focusN;
    setFocusId(null);
    const t = setTimeout(() => setFocusId(data.focus ?? null), 0);
    return () => clearTimeout(t);
  }, [data.focusN, data.focus]);
  const replies = useReplies(data.threadId);
    const accounts = useAccounts(data, useConnectVersion());
  const [modeOver, setModeOver] = useState<ChatMode | null>(null);
  const [picker, setPicker] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const width = useWindowDimensions().width;
  const [gutter, setGutter] = useState(() => gutterFits(width));
  const mobileBack = useMobileBack();
  const narrow = width > 0 && width < 640;

  /* Cmd/Ctrl+F opens find in chat, as in the prototype; Escape closes it. */
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault: () => void }) => void) => void; removeEventListener?: (t: string, f: unknown) => void };
    const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault: () => void }): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFinding(true); }
    };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, []);

  useEffect(() => data.fill?.subscribe(() => {
    const t = data.fill?.take();
    if (!t) return;
    const value = typedRef.current.trim() === "" ? t : `${typedRef.current}\n${t}`;
    typedRef.current = value;
    setTyped(value);
    setSeed((x) => ({ value, n: x.n + 1 }));
  }), [data.fill]);

  const say = useCallback((text: string) => { setLine(text); setUndo(null); }, []);
  /** A rejected write: say what did not happen and that it can be tried again. The page keeps what it showed. */
  const fail = (what: string) => (e?: unknown): void => say(isDecided(e) ? DECIDED_LINE : `${what} Try again.`);

  /* ---------- sending: the message is on the page before chat.post answers ---------- */
  const run = useCallback((p: Pending) => {
    // the first message sent from this device names the chat on this device (the server never puts message text in a title)
    emptyRef.current = false;
    void (async () => {
      // files first: each is stored in Files under a key derived from this send, so a retry finds the same files and attaches them again
      const kept = (p.files ?? []).flatMap((f) => (f.fileId !== undefined ? [f.fileId] : []));
      const fresh = (p.files ?? []).filter((f) => f.fileId === undefined);
      const attachments = [...(fresh.length > 0 ? await act.uploadAttachments(data, fresh, `chat-attach:${p.key}`) : []), ...kept];
      return act.sendMessage(data, { text: p.body, mentions: p.mentions, key: p.key, kind: p.kind, working: p.working, ...(p.refs && p.refs.length > 0 ? { refs: p.refs } : {}), attachments, ...(p.alsoToChat === true ? { alsoToChat: true } : {}) });
    })().then(
      (r) => setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, messageId: r.messageId, state: "sending" as const } : x))),
      (e) => { setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, state: "failed" as const } : x))); say(`Not sent.${p.files && p.files.length > 0 && e instanceof Error && e.message.length < 120 ? ` ${e.message}.` : ""} Retry or discard it.`); },
    );
  }, [data, say]);

  const leadNow = threadQ.status === "loading" ? undefined : leadOf(threadQ.data.thread);
  // the lead's context, read again whenever the message count changes (a turn ended or a message went out)
  const leadUsage = useUsage(data, leadNow?.agentId ?? null, leadNow?.accountRef ?? null, messagesQ.status === "loading" ? 0 : messagesQ.data.messages.length);
  const leadPickOff = usePickUnavailable(data, leadNow?.model, leadNow?.accountRef ?? null);
  const lastPick = useLastPick(data);
  const outsideOffline = useOutsideOffline(data, leadNow?.agentId ?? null, messagesQ.status === "loading" ? 0 : messagesQ.data.messages.length);
  const place = useRunsOn({ call: data.call, threadId: data.threadId, agentId: leadNow?.agentId, spaceName: data.spaceName ?? "The Space", say });
  const serverMode = threadQ.status === "loading" ? null : modeOf(threadQ.data.thread);
  // what the server says wins once it changes (a /plan, another device); a local choice holds until then
  useEffect(() => { setModeOver(null); }, [serverMode]);
  // the mute line under an agent's message for its person shows until the teammate has seen it: what this chat already showed before this open stays hidden (lane l-agentdm)
  const muteSeen = useRef<ReadonlySet<string>>(readMuteSeen());
  const [mutedHere, setMutedHere] = useState<ReadonlySet<string>>(new Set());
  const failed = failureOf(threadQ, messagesQ);
  // an artifact an agent publishes in a turn this person asked opens in a tab while this chat is open: say it is open, and open the cards marked for this person (lane l-engine21)
  useChatViewing(data.call, data.threadId);
  useOpenPublished(messagesQ.status === "loading" ? undefined : messagesQ.data.messages, data.me.id, (artifactId) => data.nav.openBeside("artifact", artifactId));
  // the chat's budget of agent turns: the Space's Policies setting, else 8 (owner ruling, 3 Nov)
  const [hopLimit, setHopLimit] = useState(DEFAULT_AGENT_HOPS);
  useEffect(() => {
    let live = true;
    data.call("settings.get", { key: "engine.agent_hops" }).then((out) => { if (live) setHopLimit(limitOf((out as { row?: { value?: unknown } } | null)?.row?.value)); }, () => undefined);
    return () => { live = false; };
  }, [data.threadId]);  // eslint-disable-line react-hooks/exhaustive-deps
  // "Also post to the chat", for a thread: on for the next message only
  const [alsoOn, setAlso] = useState(false);
  const also = useRef(false);
  also.current = alsoOn;
  // the crew of this chat: read again when the chat gets a new message (a helper started or reported)
  const crew = useCrew();
  const messageCount = messagesQ.status === "loading" ? 0 : messagesQ.data.messages.length;
  useEffect(() => { crew?.refresh(); }, [messageCount]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the agents.list rows the Ask-an-agent picker labels its agents from, read when it first opens
  const agentMeta = useRef<readonly AgentMeta[] | null>(null);
  // which open questions have their own card on screen: the island docks the ones that do not (a hook, so before the early returns)
  const cardsInView = useCardsInView(messagesQ.status === "loading" ? NO_IDS : openQuestions(mergePages(around ?? messagesQ.data.messages, older)).map((x) => x.id));
  if (failed) return <LoadFailed what="this chat" failure={failed} testID="conversation-failed" />;
  if (threadQ.status === "loading" || messagesQ.status === "loading") return <ConversationLoading />;
  const thread: Thread = threadQ.data.thread;
  const live = messagesQ.data.messages;
  const all = mergePages(around ?? live, older);
  const openQs = openQuestions(all);
  emptyRef.current = all.length === 0;
  const liveView = around === null;
  // a failure a later reply has answered is over: its card leaves, and the reply stands on its own time
  const win = lastMessages(withoutAnswered(all), shown);
  const ghosts = liveView ? ghostMessages(liveTurns, win.rows, thread.threadId) : [];
  const writing = new Set(collect([...win.rows, ...ghosts].filter((m) => { const s = data.streamOf(m.messageId); return s !== undefined && !s.getSnapshot().done; }), (m) => m.messageId));
  // a reply being written has no saved message yet: its row is the live turn (a ghost), and it counts as work from the moment the turn starts
  const working = workingAgents([...win.rows, ...ghosts], writing);
  const isWorking = working.length > 0;
  const nameOf = data.nameOf;
  const lead = leadOf(thread);
  const hasEarlier = win.hiddenLocal > 0 || (olderMore ?? messagesQ.data.hasMore);

  // Ask an agent about one message (owner ruling, 3 Nov): the channel's agents, your own first, a private agent as "<Person> (Agent)". The ask is the presser's own short reply to that
  // message naming the agent, so the turn runs on the presser's account and chat.post's audience checks apply.
  const askAbout = (messageId: string, agentId: string): void => {
    const label = pickerAgents(thread, agentMeta.current ?? [], data.me.id, nameOf).find((a) => a.id === agentId)?.label ?? nameOf(agentId);
    void data.call("chat.post", askPost(thread.threadId, messageId, { id: agentId, name: nameOf(agentId) }, data.me.id, data.newKey())).then(() => say(`Asked ${label}`), fail(`Could not ask ${label}.`));
  };
  const openAskPicker = (messageId: string, x: number, y: number): void => {
    const show = (): void => {
      const agents = pickerAgents(thread, agentMeta.current ?? [], data.me.id, nameOf);
      // a mention-style picker, not a context menu: Report a problem belongs on message menus
      menu.show(agents.map((a) => ({ label: a.label, leading: <Avatar name={a.label} seedId={a.id} kind="agent" size={16} />, onSelect: () => askAbout(messageId, a.id) })), x, y, "other", { label: "Ask an agent" });
    };
    if (agentMeta.current !== null) { show(); return; }
    void data.call("agents.list", {}).then((out) => { agentMeta.current = ((out as { agents?: AgentMeta[] } | null)?.agents ?? []); show(); }, () => { agentMeta.current = []; show(); });
  };

  const commandEnv = (): CommandEnv => ({
    data, thread, rows: win.rows, say, newKey: data.newKey,
    openFind: () => setFinding(true), openSearch: (q) => data.nav.openSearch?.(q), openModel: () => { if (lead) modelMenu(8, 120); else say("Add an agent to this chat first."); },
    aside: (question) => void act.startAside(data, thread.threadId, question, data.newKey()).then((r) => setAsides((cur) => [...cur, { id: r.asideThreadId, question }]), fail("Could not ask that.")),
    send: (text) => submit({ text, chips: [], files: [], folder: null, links: [], refs: [], mode: "queue", answers: "" }, "queue"),
  });

  const submit = (payload: ComposerSend, kind: SendKind): void => {
    // a slash command is not a message: it runs, and nothing is posted (a name that is not a command is an ordinary message)
    if (payload.files.length === 0 && parseSlash(payload.text, pluginNames(data.pluginCommands?.())) !== null) {
      setLine(""); setTyped("");
      void runSlash(payload.text, commandEnv());
      return;
    }
    if (data.head) setSentOnPage((n) => n + 1);
    const key = data.newKey();
    const mentions = mentionsIn(payload.text, data.directory);
    const refs = act.sendRefs(payload);
    const files = payload.files.map((f) => ({ name: f.name, ...(f.file !== undefined ? { file: f.file } : {}), ...(f.size !== undefined ? { size: f.size } : {}), ...(f.mime ? { mime: f.mime } : {}), ...(f.fileId !== undefined ? { fileId: f.fileId } : {}) }));
    const p: Pending = { key, body: payload.text, at: data.clock().now, state: "sending", kind: sendKind(kind, isWorking), mentions, working: isWorking, ...(files.length > 0 ? { files } : {}), ...(refs.length > 0 ? { refs } : {}), ...(also.current ? { alsoToChat: true } : {}) };
    if (also.current) { also.current = false; setAlso(false); }
    setPending((cur) => [...cur, p]);
    setLine("");
    setTyped("");
    typedRef.current = "";
    setSeed((x) => (x.value === "" ? x : { value: "", n: x.n }));
    run(p);
  };

  const found = finding ? findMatches(win.rows, query) : [];
  // the message a search result or a fork's link opened on is marked like the current find match, for a few seconds
  const matches = finding ? found : focusId !== null && all.some((m) => m.messageId === focusId) ? [focusId] : [];
  const activeId = finding ? (found.length > 0 ? found[Math.min(matchAt, found.length - 1)] : undefined) : matches[0];
  // in the order the chat reads: a reply being written sits after the message that started it, before what was sent while it writes
  const timelineMessages = byOrder([...win.rows, ...collect(liveView ? stillPending(pending, win.rows) : [], (p, i) => pendingMessage(p, data.me.id, thread.threadId, (win.rows[win.rows.length - 1]?.threadSeq ?? 0) + 1 + i)), ...ghosts]);
  const pendingState = new Map<string, "sending" | "failed">();
  for (const p of stillPending(pending, win.rows)) pendingState.set(`pending:${p.key}`, p.state);
  const coders = (crew?.status?.members ?? []).filter((x) => x.kind === "teammate");
  const coderThreads = new Set(coders.map((x) => x.id));
  const folded = mergeCrewAnswer(hideCrewPosts(stripFromCoders(groupHelperStrips(foldHelperRows(timelineMessages)), coderThreads), coderThreads, new Set(coders.flatMap((x) => (x.jobId ? [x.jobId] : [])))));
  const woven = data.activity ? weave(folded, data.activity.events).filter((m) => keepItem(m, data.activity!.show)) : folded;
  // a channel, or a chat between people, is shared: its times read in the Space zone; a chat with only you and your agents reads in your own
  const sharedChat = thread.kind === "channel" || thread.members.filter((p) => p.kind === "person").length >= 2;
  const items = timeline(woven, { meId: data.me.id, nameOf, kindOf: data.kindOf, clock: { ...data.clock(), ...(sharedChat ? { zones } : {}) }, shared: sharedChat }).filter((it) => !(thread.kind === "thread" && it.kind === "day"));   // a thread has no day dividers: its root row and "N replies" lead
  const lastLive = [...timelineMessages].reverse().find((m) => data.streamOf(m.messageId) !== undefined);
  const lastStream = lastLive ? data.streamOf(lastLive.messageId) : undefined;
  const queued = queuedCount(timelineMessages, data.me.id, isWorking);
  const queuedIdsNow = queuedIds(timelineMessages, data.me.id, isWorking);
  const leadDriver = entryOf(accounts, leadNow?.accountRef)?.provider;
  // only the person whose turn it is steers it; anyone else's message goes in after it (the engine holds to this; a turn picked up mid-way names nobody until its next start)
  const runningFor = liveTurns.find((t) => t.state === "writing" && t.agentId === leadNow?.agentId)?.asker;
  const writingTurn = liveTurns.find((t) => t.state === "writing");
  const writingName = writingTurn ? nameOf(writingTurn.agentId) : undefined;
  const ownTurn = runningFor === undefined || runningFor === data.me.id;
  const canSteer = ownTurn && !(leadDriver !== undefined && act.CANNOT_STEER.has(leadDriver));   // a chat on Codex or Grok keeps its message queued: they read nothing mid-turn
  const helpers = (helpersQ.status === "loading" ? [] : helpersQ.data.helpers).filter((h) => h.status === "running");
  // the header chip counts from the crew read (the strip's own): how many are on it and how many wait for you; the pane opens on the overview
  const crewChip = crew?.status && crew.status.members.length > 0 ? crewChipOf(crew.status.totals) : null;

  /* ---------- menus: all open under the button that asked ---------- */
  const stopMenu = (x: number, y: number): void => {
    if (working.length === 1) { void act.stopAgent(data, working[0]).then(() => say("Stopped. The steps so far are kept."), fail("Could not stop it.")); return; }
    menu.show([
      ...collect(working, (id): MenuEntry => ({ label: `Stop ${nameOf(id)}`, onSelect: () => void act.stopAgent(data, id).then(() => say(`${nameOf(id)} stopped`), fail("Could not stop it.")) })),
      { separator: true },
      { label: "Stop All", danger: true, onSelect: () => void act.stopAll(data).then(() => say("Everything stopped. The steps so far are kept."), fail("Could not stop.")) },
    ], x, y, "other", { label: "Stop" });
  };
  const helpersMenu = (x: number, y: number): void => {
    menu.show(
      [{ head: `${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} running` } as MenuEntry, ...collect(helpers, (h): MenuEntry => ({ label: `${h.title} · ${nameOf(h.agentId)}`, onSelect: () => data.nav.openThread(h.threadId) }))],
      x, y, "other", { label: "Helpers" },
    );
  };
  const island = islandView(openQs, putAway, islandAt, cardsInView);
  const typingNames: readonly string[] = data.typing ?? [];
  const peopleMenu = (x: number, y: number): void => add.showPeople({ thread, x, y, onOpenAgent: data.nav.openAgent });
  const modelMenu = (x: number, y: number): void => {
    if (!lead) return;
    void act.listModels(data).then(
      (models) => menu.show(
        [{ head: `Model for ${nameOf(lead.agentId)}` } as MenuEntry, ...collect(models, (m): MenuEntry => ({ label: m.title, checked: m.model === lead.model || (m.alias !== undefined && m.alias === lead.model) || modelLabel(lead.model ?? "") === m.title, onSelect: () => { if (!m.allowed) { say(`${m.title} is not allowed here. Ask an admin for access.`); return; } void act.setModel(data, lead.agentId, m).then(() => say(`${nameOf(lead.agentId)} now answers with ${m.title}`), fail("Could not switch the model.")); } }))],
        x, y, "other", { label: "Model" },
      ),
      fail("Could not list the models."),
    );
  };
  const moreEntries = (): MenuEntry[] => {
    const items: MenuEntry[] = [
      { label: "Find in Chat", hint: "⌘F", onSelect: () => setFinding(true) },
      { separator: true } as MenuEntry,
      { label: "Plan Mode", checked: mode === "plan", onSelect: () => chooseChatMode(mode === "plan" ? "ask" : "plan") },
      ...(hasSwitch(thread) && repliesSwitch.on !== null ? [{ label: SWITCH_TITLE, checked: repliesSwitch.on, ...(repliesSwitch.on ? { hint: SWITCH_NOTE } : {}), onSelect: () => repliesSwitch.set(!repliesSwitch.on) } as MenuEntry] : []),
      ...(lead ? [{ label: `Open ${nameOf(lead.agentId)}'s Page`, onSelect: () => data.nav.openAgent(lead.agentId) } as MenuEntry] : []),
      ...connectEntries(thread, data.nav),
      { separator: true } as MenuEntry,
      ...(data.nav.openSearch ? [{ label: "Search All Chats…", onSelect: () => data.nav.openSearch!("") } as MenuEntry] : []),
      ...collect(act.onlyMeHere(thread, data.me.id) ? (data.elsewhere?.spaces ?? []).slice(0, 6) : [], (sp): MenuEntry => ({ label: `Continue in ${sp.name}`, onSelect: () => void runSlash(`/continue ${sp.name}`, commandEnv()) })),
      { label: "Fork This Chat", onSelect: () => void runSlash("/fork", commandEnv()) } as MenuEntry,
      { label: "Export as Markdown", onSelect: () => void runSlash("/export md", commandEnv()) } as MenuEntry,
      { label: "Export as JSON", onSelect: () => void runSlash("/export json", commandEnv()) } as MenuEntry,
      ...(isWorking ? [{ separator: true } as MenuEntry, { label: "Stop All", danger: true, onSelect: () => void act.stopAll(data).then(() => say("Everything stopped. The steps so far are kept."), fail("Could not stop.")) } as MenuEntry] : []),
    ];
    return items;
  };
  const moreMenu = (x: number, y: number): void => { menu.show(moreEntries(), x, y, "other", { label: "Chat" }); };
  // in a project's frame the page draws these in its own header (conversation/frame.ts). The controls are built here, and a small child hands them over: hooks cannot sit down here, after the early returns above.
  const frameFeed: FrameControls | null = frame ? {
    find: { active: finding, toggle: () => setFinding((f) => !f) },
    pane: { toggle: () => data.nav.togglePane() },
    helpers: crewChip ? { label: crewChip.label, badge: crewChip.active > 0 ? crewChip.active : crewChip.total, onPress: () => crew!.show(null) }
      : helpers.length > 0 ? { label: `${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} running`, badge: helpers.length, onPress: helpersMenu } : null,
    stop: isWorking ? { label: stopLabel(working, nameOf), onPress: stopMenu } : null,
    chatEntries: moreEntries,
  } : null;

  /* ---------- the message actions, one object for every row ---------- */
  const muteOffer = muteOfferFor(all, data.me.id, (id, person) => muteSeen.current.has(id) || mutedHere.has(person));
  if (muteOffer) rememberMuteSeen(muteOffer);
  const host: BlockHost = {
    invoke: (cap, input) => data.call(cap, input),
    meId: data.me.id,
    nameOf,
    ...(data.nav.openUrl ? { openUrl: data.nav.openUrl } : {}),
    open: (tab, input) => { const id = Object.values(input).find((v): v is string => typeof v === "string"); data.nav.openBeside(tab, id ?? ""); },
  };
  const openDetails = data.nav.openDetails;
  // a plain object (no hook below the early returns): the card and the tab read by message id, and the read is kept per reply
  const details = openDetails
    ? { read: (messageId: string) => readReplyDetails(data.call as Call, thread.threadId, messageId), open: (messageId: string) => openDetails(thread.threadId, messageId), meId: data.me.id, nameOf }
    : undefined;
  const actions: MessageActions = {
    host,
    copy: (t) => { data.copy(t); say("Copied"); },
    // one message's own link, /open/message/<threadId>/<messageId>: it opens the chat on that message, through reach
    copyLink: (id) => { data.copy(messageLink(data.threadId, id)); say("Link copied"); },
    edit: (id, body) => {
      // an edit that adds an @mention asks that agent once, as if it had been named when sent (owner ruling, 3 Nov); the fixed ask id keeps a second edit from asking again
      const before = all.find((x) => x.messageId === id)?.body ?? "";
      const added = addedAgentMentions(before, body, data.directory, thread.agents.map((a) => a.agentId));
      void act.editMessage(data, id, body).then(() => { for (const agentId of added) askAbout(id, agentId); }, fail("Could not save the edit."));
    },
    setPinned: (id, pinned) => void act.setPinned(data, id, pinned).catch(fail("Could not pin it.")),
    react: (id, emoji, remove) => void act.react(data, id, emoji, remove).catch(fail("Could not react.")),
    openThread: (id) => void act.openMessageThread(data, id).then((tid) => data.nav.openThread(tid), fail("Could not open the replies.")),
    remove: (id) => void act.deleteMessage(data, id).catch(fail("Could not delete it.")),
    ...(data.alsoSent ? { alsoSent: data.alsoSent } : {}),
    ...(thread.kind === "thread" ? { faceInThread: true } : {}),
    openAgent: data.nav.openAgent,
    openBeside: data.nav.openBeside,
    ...(data.nav.openGoal ? { openGoal: data.nav.openGoal } : {}),
    answer: (blockId, answer) => void act.answerBlock(data, blockId, answer).catch(fail("Could not send the answer.")),
    reply: (text) => submit({ text, chips: [], files: [], folder: null, links: [], refs: [], mode: "queue", answers: "" }, "queue"),
    approvePlan: (planId) => void act.approvePlan(data, planId).then(() => say("Plan approved. The steps run and tick off in the card."), fail("Could not approve the plan.")),
    retryTurn: (turnId) => void act.retryTurn(data, turnId).catch(fail("Could not retry.")),
    regenerate: (messageId) => void act.regenerate(data, messageId).catch(fail("Could not ask again.")),
    markUnreadFrom: (seq) => void act.markUnreadFrom(data, seq).then(() => say("Marked unread from that message."), fail("Could not mark it unread.")),
    turnDetail: (turnId) => act.turnDetail(data, turnId),
    accountReady: () => act.hasWorkingAccount(data),
    errorNext: (key, turnId) => void act.errorAction(data, key, turnId, say).catch(fail("Could not do that.")),
    retrySend: (id) => { const p = pending.find((x) => `pending:${x.key}` === id); if (p) { setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, state: "sending" as const } : x))); setLine(""); run(p); } },
    discardSend: (id) => { setPending((cur) => cur.filter((x) => `pending:${x.key}` !== id)); setLine(""); },
    showMenu: (entries, x, y, label) => menu.show(entries, x, y, "context", { label }),
    ...(lead ? { liveCard: { call: data.call, now: () => data.clock().now, ...(data.spaceUrl ? { spaceUrl: data.spaceUrl } : {}), openComputer: (agentId: string) => data.nav.openBeside("computer", agentId), agentId: lead.agentId } } : {}),
    ...(data.terminal ? { runCode: { deps: { call: data.call, newKey: data.newKey }, team: data.personal !== true, nameOf: (id: string) => data.nameOf(id), now: () => data.clock().now, copy: (t: string) => data.copy(t), openTerminal: (id: string) => data.nav.openBeside("terminal", id) } } : {}),
    ...(data.terminal ? { terminalCard: { deps: { call: data.call, newKey: data.newKey }, ...(lead ? { agentId: lead.agentId } : {}), copy: (t: string) => data.copy(t), openTerminal: (id: string) => data.nav.openBeside("terminal", id) } } : {}),
    ...(data.mountSheet ? { mountCard: { agents: thread.agents.map((a) => ({ id: a.agentId, name: nameOf(a.agentId) })), data } } : {}),
    ...(memoryEntries ? { memoryEntries } : {}),
    ...(details ? { details } : {}),
    pickReaction: (id, x, y) => setPicker({ id, x, y }),
    humanChat: thread.agents.length === 0,
    ...(thread.agents.length === 0 || thread.kind === "channel" ? {} : { fork: (id: string) => void act.forkChat(data, id, data.newKey()).then((next) => { say("Branched into a new chat, linked back to this one"); data.nav.openThread(next); }, fail("Could not fork it.")) }),
    ...(thread.kind === "channel" && thread.agents.length > 0 ? { askAgent: (id: string, x: number, y: number) => openAskPicker(id, x, y) } : {}),
    makeTask: (id) => {
      const m = all.find((x) => x.messageId === id);
      if (!m) return;
      void act.makeTask(data, thread, m, data.newKey()).then(() => undefined, fail("Could not make the task."));  // the card in the thread says it and opens it; the person stays where they are
    },
    files: data,
    // the buttons on an agent's cards from the person's own Chrome (browser.chrome.act): they act only for the person whose Chrome it is, and say why when it is not open here
    chrome: {
      send: async (h, edits) => { const r = (await data.call("browser.chrome.act", { action: "send", agentId: h.agentId, heldId: h.heldId, ...(edits ? { edits } : {}), threadId: thread.threadId, idempotencyKey: `chrsend:${h.heldId}` })) as { done: boolean }; return { sent: r.done }; },
      drop: async (h, reason) => { await data.call("browser.chrome.act", { action: "drop", agentId: h.agentId, heldId: h.heldId, threadId: thread.threadId, summary: h.summary, ...(reason ? { reason } : {}), idempotencyKey: `chrdrop:${h.heldId}` }); },
      watch: async (agentId) => { await data.call("browser.chrome.act", { action: "watch", agentId, idempotencyKey: data.newKey() }); },
      takeOver: async (agentId) => { await data.call("browser.chrome.act", { action: "takeover", agentId, idempotencyKey: data.newKey() }); },
    },
    // an agent's message for its person, read by the teammate it went to: they can mute that person's agents for the rest of their day (lane l-agentdm)
    agentMute: {
      me: data.me.id,
      offerFor: muteOffer,
      mute: (personId: string) => void Promise.resolve(data.call("chat.agent_dm.mute", { personId })).then(
        () => { setMutedHere((cur) => new Set([...cur, personId])); const first = nameOf(personId).split(" ")[0]; say(`Muted for today. ${first ? `${first}'s agents wait` : "Their agents wait"} until tomorrow.`); },
        fail("Could not mute them."),
      ),
    },
    ...(data.activityOf ? { activityOf: (id: string) => data.activityOf!(id) } : {}),
    nameOf,
    ...(data.nav.openHooks ? { openHooks: (hookId: string | undefined) => data.nav.openHooks?.(thread.threadId, hookId) } : {}),
    openMessage: (threadId, messageId) => (messageId === "" ? data.nav.openThread(threadId) : data.nav.openThread(threadId, messageId)),
    ...(crew ? { crew: {
      status: crew.status, selected: crew.selected, peek: (id: string) => crew.show(id), openPane: () => crew.show(null),
      stopAll: () => void act.stopHelpers(data).then(() => crew.refresh(), fail("Could not stop the helpers.")),
      retry: (id: string) => void act.retryHelper(data, id, data.newKey()).then(() => crew.refresh(), fail("Could not start it again.")),
      merge: (jobIds: readonly string[]) => void Promise.all(jobIds.map((jobId) => data.call("engine.crew.merge", { jobId, idempotencyKey: data.newKey() }))).then(() => { crew.refresh(); }, fail("Could not merge it.")),
    } } : {}),
    share: (id, x, y) => void act.shareTargets(data, thread.threadId).then((targets) => {
      const entries: MenuEntry[] = [];
      for (const to of targets) entries.push({ label: to.label, onSelect: () => void act.shareTo(data, thread.threadId, id, to, data.newKey()).catch(fail("Could not share it.")) });
      if (entries.length === 0) entries.push({ label: "No one to share with", disabled: true, onSelect: () => undefined } as MenuEntry);
      menu.show(entries, x, y, "context", { label: "Share to" });
    }, fail("Could not list where to share it.")),
  };
  // what the rows get: the same data, with every function swapped for one that never changes (so a row the list skips still does the latest thing)
  const rowActions = stableActions(delegates.current, actions);

  const inThread = new Map(thread.agents.map((a) => [a.agentId, a.mode] as const));
  const dirId = (name: string, kind: "agent" | "person"): string | undefined => data.directory.find((c) => c.kind === kind && c.name === name)?.id;
  const noteFor = (x: ListItem, kind: "agent" | "person"): ListItem => {
    const name = typeof x === "string" ? x : x.t;
    const id = (typeof x === "string" ? undefined : x.ref) ?? dirId(name, kind);
    const base = typeof x === "string" ? { t: x } : x;
    // the menu groups as the prototype draws them: the agents in this chat (Lead, Teammate), People (Member), and the agents to Bring in
    const inChat = kind === "agent" ? id !== undefined && inThread.has(id) : id !== undefined && thread.members.some((m) => m.id === id);
    const mineAssistant = kind === "agent" && id !== undefined && id === data.assistantId;
    const group = kind === "agent" ? (inChat || mineAssistant ? "Agents in this chat" : "Bring in") : "People";
    const where = kind === "agent" ? (mineAssistant ? "Yours" : inChat ? (inThread.get(id!) === "lead" ? "Lead" : "Teammate") : "Agent") : (inChat ? "Member" : "Space");
    return { ...base, group, kind: kind === "agent" ? "Agent" : "Person", ...(id ? { ref: id } : {}), s: base.s ? `${base.s} \u00b7 ${where}` : where };
  };
  // a guest is offered only the agents this chat allows (mentionable)
  const lists = { ...data.lists, agents: (data.lists.agents ?? []).map((x) => noteFor(x, "agent")).filter((x) => mentionable(x, data.me.guest === true, inThread)), people: (data.lists.people ?? []).map((x) => noteFor(x, "person")), commands: commandItems(data.pluginCommands?.()) };
  const mode: ChatMode = modeOver ?? modeOf(thread);
  const chooseChatMode = (m: ChatMode): void => {
    setModeOver(m);
    void setChatMode(data, m).then(
      () => say(m === "plan" ? "Plan mode is on: the agent plans and changes nothing until you approve" : m === "auto" ? "Auto: the agent acts on its own. What others would see goes only if you asked for it" : "Ask first: the agent asks before it changes or sends anything"),
      () => { setModeOver(null); say("Could not change the mode. Try again."); },
    );
  };
  const contexts = new Map<string, { used: number; window: number } | null>();
  if (lead && leadUsage !== "loading") contexts.set(lead.agentId, leadUsage?.context ?? null);
  const shownThread = withLastPick(thread, lastPick);
  const composerAgents = stripAgents(shownThread, nameOf, accounts ?? [], contexts, new Set(lead && leadPickOff ? [lead.agentId] : []));
  // a person @mentioned who is not in a private chat: Add them (the chat becomes a group chat), or start a channel instead
  const personMention = thread.kind === "chat"
    ? mentionsIn(typed, data.directory.filter((c) => c.kind === "person" && c.id !== data.me.id && !thread.members.some((m) => m.id === c.id)))[0]
    : undefined;
  const closed = isClosed(thread);
  const parked = !closed && parkedAtLimit(win.rows[win.rows.length - 1], hopLimit, isWorking);
  const unanswered = closed || isWorking ? null : unansweredOwn(thread, win.rows, data.me.id, data.directory, (id) => replies.has(id));
  // an Ask drawn in its own pane is already titled Ask Vyre: the quiet "Ask pane" line is for an Ask opened in Chats
  const note = data.head || (compact && thread.kind === "ask") ? "" : threadKindNote(thread, nameOf);
  const title = titleOf(thread, nameOf, data.me.id);
  // a direct chat is named for the other person and wears their face
  const dmWith = directWith(thread, data.me.id);
  const q = queueNote(queued, lead ? nameOf(lead.agentId) : "", canSteer, ownTurn);

  // A mounted folder or file dragged from Files is shared with this chat's agents (desktop); the line says so and can take it back
  const dropShare = (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }): void => {
    const items = droppedOf(e.dataTransfer?.getData?.("text/plain") ?? "");
    if (items.length === 0) return;
    e.preventDefault();
    const agents = thread.agents.map((a) => ({ id: a.agentId, name: nameOf(a.agentId) }));
    if (agents.length === 0) { say("No agent in this chat."); return; }
    void shareWithAgents(data, items, agents, data.newKey()).then(
      (done) => { setLine(sharedLine(done)); setUndo(() => () => { void undoShare(data, done.grants).then(() => say("Taken back."), fail("Could not take it back.")); }); },
      fail("Could not share that."),
    );
  };
  // The whole pane is a drop zone: files dropped anywhere on it go to this chat's composer tray; a mounted folder dragged from Files is shared (above). A react-native View
  // drops drag props on the web, so the zone is ui/FileDrop's own element.
  const takeShare = (dt: TransferLike): boolean => { let took = false; dropShare({ preventDefault: () => { took = true; }, dataTransfer: dt as { getData?: (t: string) => string } }); return took; };
  return (
    <DropRoute testID="conversation-drop" style={ROUTE_STYLE} onOther={takeShare}>
    <View testID="conversation" accessibilityLabel={`Conversation, ${title}`} style={st.root}>
      <FrameFeed frame={frame} feed={frameFeed} />
      {compact || inFrame ? null : (
      <View testID="conversation-head" accessibilityRole="header" style={st.head}>
        {mobileBack ? <IconButton icon="back" label="Back" size={32} testID="conversation-back" onPress={() => mobileBack()} /> : null}
        {renaming ? (
          <RenameField
            value={title} testID="conversation-rename" label="Rename this chat" style={st.rename}
            onDone={(v) => { setRenaming(false); if (v !== null) void Promise.resolve(data.call("threads.update", { threadId: thread.threadId, title: v })).catch(fail("Could not rename it.")); }}
          />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${title}`} testID="conversation-title-button" {...(Platform.OS === "web" ? ({ title: "Rename" } as object) : {})} onPress={() => { if (thread.kind === "chat" || thread.kind === "channel") setRenaming(true); }} style={({ hovered }: { hovered?: boolean }) => [st.titleBtn, hovered === true && st.titleOver]}>
            {dmWith ? <Face name={title} seedId={dmWith} kind="person" size={20} /> : null}
            <Text numberOfLines={1} testID="conversation-title" style={st.title}>{title}</Text>
          </Pressable>
        )}
        {isWorking ? <View testID="conversation-live" accessibilityLabel="Working" style={st.live}><View style={st.liveDot} /></View> : null}
        <View style={{ flex: 1 }} />
        {online ? null : <Text testID="conversation-offline" style={st.meta}>Offline</Text>}
        {crewChip ? (crewChip.text !== "" && !narrow ? <Pressable accessibilityRole="button" accessibilityLabel={crewChip.label} testID="helpers-button" onPress={() => crew!.show(null)} style={st.crewChip}><Text testID="helpers-chip-text" style={st.crewChipText}>{crewChip.text}</Text></Pressable> : <IconButton icon="helper" label={crewChip.label} badge={crewChip.active > 0 ? crewChip.active : crewChip.total} testID="helpers-button" onPress={() => crew!.show(null)} />)
          : helpers.length > 0 ? <IconButton icon="helper" label={`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} running`} badge={helpers.length} testID="helpers-button" onPress={helpersMenu} /> : null}
        {isWorking ? <IconButton icon="stop" label={stopLabel(working, nameOf)} danger testID="stop-button" onPress={stopMenu} /> : null}
        <PeopleCount count={thread.members.length} label={`${thread.members.length} in this chat`} testID="participants-button" onPress={peopleMenu} />
        <IconButton icon="pane" label="Show or hide the pane" testID="pane-button" onPress={() => data.nav.togglePane()} />
        <IconButton icon="more" label="More" testID="more-button" onPress={moreMenu} />
      </View>
      )}
      {finding ? (
        <View testID="find-bar" accessibilityRole="search" style={st.find}>
          <Glyph name="search" size={14} color="var(--ink-3)" />
          <TextInput
            autoFocus testID="find-input" accessibilityLabel="Find in chat" placeholder="Find in this chat" placeholderTextColor="var(--ink-4)" value={query}
            onChangeText={(t) => { setQuery(t); setMatchAt(0); }}
            onKeyPress={(e) => {
              const k = (e as unknown as { nativeEvent: { key: string; shiftKey?: boolean } }).nativeEvent;
              if (k.key === "Escape") { setFinding(false); setQuery(""); }
              else if (k.key === "Enter" && matches.length > 0) setMatchAt((i) => (k.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length));
            }}
            style={st.findInput}
          />
          <Text testID="find-count" accessibilityLiveRegion="polite" style={st.meta}>{matchLine(matches.length, Math.min(matchAt, Math.max(0, matches.length - 1)), query)}</Text>
          <IconButton icon="up" label="Previous match" size={24} testID="find-prev" onPress={() => matches.length > 0 && setMatchAt((i) => (i - 1 + matches.length) % matches.length)} />
          <IconButton icon="chevd" label="Next match" size={24} testID="find-next" onPress={() => matches.length > 0 && setMatchAt((i) => (i + 1) % matches.length)} />
          <IconButton icon="x" label="Close find" size={24} testID="find-close" onPress={() => { setFinding(false); setQuery(""); }} />
        </View>
      ) : null}
      <CatchUpLine onJump={(id) => setFocusId(id)} newest={live[live.length - 1]?.messageId ?? ""} credit={(id) => { const m = all.find((x) => x.author.id === id && onBehalfOf(x)); const ob = m ? onBehalfOf(m) : null; return ob ? `${nameOf(ob.person)} (Agent)` : undefined; }} />
      {note ? <Text testID="conversation-note" style={st.noteLine}>{note}</Text> : null}
      {sharedChat ? <Text testID="zone-note" accessibilityLabel={`Times in this chat use ${zoneName(zones.space)}`} style={{ fontSize: 11.5, color: "var(--ink-3)" as string, textAlign: "center", paddingTop: 6, paddingHorizontal: 12 }}>{`Times here use ${zoneName(zones.space)}, the Space's time zone${zones.viewer !== zones.space && offsetMinAt(Date.now(), zones.viewer) !== offsetMinAt(Date.now(), zones.space) ? `. Hover a time to see yours.` : "."}`}</Text> : null}
      {thread.kind === "thread" ? <ThreadParent threadId={thread.parentThreadId} messageId={thread.parentMessageId} call={data.call as never} nameOf={nameOf} kindOf={data.kindOf} clock={data.clock()} count={thread.replyCount ?? all.length} writing={writingName} onOpen={thread.parentThreadId && thread.parentMessageId ? () => data.nav.openThread(thread.parentThreadId!, thread.parentMessageId!) : undefined} /> : null}

      {liveView ? null : (
        <View testID="viewing-earlier" accessibilityRole="alert" style={st.earlierBar}>
          <Text style={st.earlierText}>Viewing earlier messages</Text>
          <TextButton label="Jump to latest" testID="viewing-earlier-latest" onPress={() => { setAround(null); setOlder([]); setFocusId(null); setShown(WINDOW); setJump((n) => n + 1); setAtEnd(true); }} />
        </View>
      )}
      <View style={st.feedBox} onLayout={(e) => setGutter(gutterFits(e.nativeEvent.layout.width))}>
        <GutterContext.Provider value={gutter}>
        <Feed key={jump} followKey={timelineMessages.length} {...(lastStream ? { store: lastStream } : {})} {...(data.head ? { startAway: true, endKey: sentOnPage } : {})} testID="conversation-feed" contentStyle={st.feedContent} onAtEndChange={setAtEnd}>
          {data.head ?? null}
          <View style={st.col}>
            {hasEarlier ? (
              <View style={st.earlier}>
                <TextButton label="Show earlier messages" testID="earlier-button" onPress={() => { if (win.hiddenLocal > 0) setShown((n) => n + WINDOW); else { const c = beforeCursor(all); if (c !== null) setCursor(c); } }} />
              </View>
            ) : null}
            {items.length === 0 && !data.head && thread.kind !== "thread" ? <States kind="empty" icon="chat" title="Say something to start" /> : null}
            {collect(items, (it, at) => {
              const key = it.key;
              const stream = it.kind === "other" ? data.streamOf(it.message.messageId) : undefined;
              const sending = it.kind === "me" ? pendingState.get(it.message.messageId) : undefined;
              const under = it.kind === "me" || it.kind === "other" ? replies.get(it.message.messageId) : undefined;
              const row = <MessageView key={key} item={it} actions={rowActions} meId={data.me.id} stream={stream} sending={sending} mark={markOf(it, matches, activeId, finding)} replies={under ? { s: under, clock: data.clock() } : undefined} />;
              // always wrapped on the web, so a row that grows old keeps its state; only the style changes
              return Platform.OS === "web" ? <View key={key} style={at < items.length - OFFSCREEN_KEEP ? st.offscreen : undefined}>{row}</View> : row;
            })}
            {data.tail ?? null}
          </View>
        </Feed>
        </GutterContext.Provider>
      </View>
      {/* in its own row under the list, at the right: it never sits over a line of text */}
      {atEnd || data.head ? null : (
        <Pressable testID="to-latest" accessibilityRole="button" accessibilityLabel="Jump to latest" onPress={() => { setJump((n) => n + 1); setAtEnd(true); }} style={st.toLatest}>
          <Glyph name="down" size={14} color="var(--ink-2)" /><Text style={st.toLatestText}>Jump to latest</Text>
        </Pressable>
      )}
      {data.live ? <SettleTurns turns={liveTurns} rows={win.rows} settle={data.live.settle} /> : null}
      {focusId !== null ? <FocusLoader key={focusId} id={focusId} have={all.some((m) => m.messageId === focusId)} shownHas={win.rows.some((m) => m.messageId === focusId)} onWindow={(page) => setAround(page)} onWiden={() => setShown((n) => n + WINDOW)} onDone={() => setFocusId(null)} /> : null}
      {activeId ? <ScrollToMessage key={`${activeId}:${matchAt}`} id={activeId} /> : null}
      {cursor !== null ? <OlderPage key={cursor} before={cursor} onPage={(page) => { setOlder((cur) => mergePages(cur, page.messages)); setOlderMore(page.hasMore); setShown((n) => n + WINDOW); setCursor(null); }} /> : null}

      {data.waitingLine ?? null}
      <AsideList items={asides} onDismiss={(id) => setAsides((cur) => cur.filter((x) => x.id !== id))} />
      <QueueWaiting ids={queuedIdsNow} call={data.call} threadId={thread.threadId}>{(waiting) => (q && waiting.length > 0 ? (<View testID="queue-row" style={st.queueRow}><Text testID="queue-note" accessibilityLiveRegion="polite" style={st.queue}>{queueNote(waiting.length, lead ? nameOf(lead.agentId) : "", canSteer, ownTurn)}</Text>{waiting.length > 0 ? <TextButton link label="Edit" testID="queue-edit" onPress={() => { const id = waiting[waiting.length - 1]!; const words = timelineMessages.find((m) => m.messageId === id)?.body ?? ""; void act.takeBackQueued(data, thread.threadId, id).then((ok) => { if (ok) { setPending((cur) => cur.filter((p) => p.messageId !== id)); setSeed((s) => ({ n: s.n + 1, value: words })); } else say("It was already read, so it cannot be edited now."); }, fail("Could not take it back.")); }} /> : null}{waiting.length > 0 ? <TextButton link label="Stop and send" testID="queue-send-now" onPress={() => void act.sendQueuedNow(data, thread.threadId, waiting[0]!).catch(fail("Could not send it now."))} /> : null}</View>) : null)}</QueueWaiting>
      {unanswered ? (
        <View testID="no-agent-line" style={st.lineBox}>
          <Pressable
            accessibilityRole="button" accessibilityLabel="No agent will reply. Ask an agent about your message" accessibilityHint="Opens the list of this channel's agents" testID="no-agent-ask"
            onPress={(e) => { const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } } }).currentTarget?.getBoundingClientRect?.(); openAskPicker(unanswered.messageId, box?.left ?? 16, box?.top ?? 0); }}
          >
            <Text style={[st.lineText, st.quietLine]}>No agent will reply. @mention one</Text>
          </Pressable>
        </View>
      ) : null}
      {lead && !closed ? <NoAiLine data={data} threadId={thread.threadId} agentId={lead.agentId} /> : null}
      {parked ? <View testID="hop-parked" accessibilityLiveRegion="polite" style={st.lineBox}><Text style={st.lineText}>{parkedLine(hopLimit)}</Text><TextButton label="Continue" testID="hop-continue" onPress={() => commandEnv().send(CONTINUE_TEXT)} /></View> : null}
      {line ? <View testID="conversation-line" accessibilityLiveRegion="polite" style={st.lineBox}><Text style={st.lineText}>{line}</Text>{undo ? <TextButton link label="Undo" testID="conversation-undo" onPress={undo} /> : null}</View> : null}
      {outsideOffline && !closed ? <Text testID="outside-offline" style={st.outsideOffline}>{outsideOffline}</Text> : null}
      {closed ? (
        <View testID="conversation-closed" style={st.closed}><Text style={st.lineText}>This thread is closed.</Text><TextButton label="Reopen" onPress={() => void data.call("threads.reopen", { threadId: thread.threadId }).catch(fail("Could not reopen."))} testID="reopen" /></View>
      ) : (
        <View style={st.composerBox}>
          {thread.kind === "channel" ? <View testID="typing-row" accessibilityLiveRegion="polite" style={st.typingRow}>{typingNames.length > 0 ? <Text style={st.typingText}>{`${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`}</Text> : null}</View> : null}
          {island.list.length > 0 ? (
            <QuestionIsland list={island.list} index={island.index} nameOf={nameOf}
              onStep={(d) => setIslandAt(island.list[(island.index + d + island.list.length) % island.list.length]!.id)}
              onAnswer={(q, a) => { void act.answerBlock(data, q.id, a).catch(fail("Could not send the answer.")); }}
              onDismiss={(q) => setPutAway((cur) => new Set([...cur, q.id]))}
              onPeople={(x, y) => peopleMenu(x, y)} />
          ) : null}
          {crew?.status && crew.status.members.length > 0 ? <CrewIsland status={crew.status} onPress={() => crew.show(null)} /> : null}
          {personMention ? (() => {
            // one strip on top of the composer: who is not here, Add (they read from now on), and a caret for the other ways
            const first = nameOf(personMention.id).split(" ")[0] ?? "";
            const addIt = (fromStart: boolean): void => void act.addPerson(data, personMention.id, fromStart).then(() => say(`${first} was added. This is now a group chat.`), fail("Could not add them."));
            return (
              <View testID="channel-offer" accessibilityRole="alert" style={st.offerStrip}>
                <Text numberOfLines={1} testID="channel-offer-text" style={st.offerStripText}>{`${first} isn't in this chat`}</Text>
                <View style={st.offerBtns}>
                  <TextButton primary label={`Add ${first}`} testID="channel-add" onPress={() => addIt(false)} />
                  <IconButton icon="chevd" label="Other ways to add" size={24} testID="channel-add-menu" onPress={(x, y) => menu.show([
                    { label: "Add, from now on", checked: true, onSelect: () => addIt(false) },
                    { label: "Add, with earlier messages", onSelect: () => addIt(true) },
                    { separator: true },
                    { label: "Start a channel instead", onSelect: () => void act.startChannel(data, personMention.id, data.newKey()).then(() => say("Channel started, linked back to this chat."), fail("Could not start the channel.")) },
                  ], x, y, "other", { label: `Add ${first}` })} />
                </View>
              </View>
            );
          })() : null}
          {thread.kind === "thread" && thread.parentThreadId ? <View testID="also-to-chat-row" style={st.alsoRow}><AlsoToChat on={alsoOn} onChange={setAlso} /></View> : null}
          <Composer
            key={`composer-${seed.n}`} {...(seed.value !== "" ? { value: seed.value } : {})}
            testID="composer" whoWillAnswer={whoLine(thread, nameOf)} placeholder={data.placeholder ?? frame?.placeholder() ?? placeholderFor(thread, nameOf, isWorking, canSteer)} working={isWorking}
            {...(place.chip ? { runsChip: place.chip } : {})}
            agents={composerAgents} mode={mode} onMode={chooseChatMode}
            barExtra={<MemorySwitch threadId={thread.threadId} call={data.call} say={say} />}
            suggest={composerSuggest(data)} preview={(item) => previewOf(data, item)}
            renderPanel={(agent, close, narrowPanel) => <ChatBrain data={data} thread={shownThread} agent={agent} accounts={accounts} mode={mode} onMode={chooseChatMode} close={close} narrow={narrowPanel} say={say} {...(place.runs ? { runs: place.runs } : {})} onCompact={(keep, always) => void compactChat(data, keep, always, agent.id).then((line) => { if (line === null) say(keep ? `Compacted, keeping ${keep}` : "Compacted"); }, fail("Could not compact."))} />}
            onAddPeople={() => add.open({ threadId: thread.threadId })}
            {...(lead ? { lead: nameOf(lead.agentId) } : {})} members={thread.members.filter((p) => p.kind === "person").map((p) => nameOf(p.id))} listening={collect(thread.agents.filter((a) => a.mode === "listen"), (a) => nameOf(a.agentId))}
            lists={lists} agentChat={thread.kind !== "channel"} onChange={(t) => { typedRef.current = t; setTyped(t); }} onCommand={(name) => void runSlash(`/${name}`, commandEnv())}
            onSubmit={(p) => submit(p, "queue")} onInterrupt={(p) => submit(p, "interrupt")}
            onStop={() => void (working.length > 1 ? act.stopAll(data) : act.stopAgent(data, working[0])).then(() => say("Stopped. The steps so far are kept."), fail("Could not stop it."))}
          />
        </View>
      )}
      {picker ? <ReactionPicker x={picker.x} y={picker.y} onPick={(e) => { actions.react(picker.id, e, false); setPicker(null); }} onClose={() => setPicker(null)} /> : null}
      {menu.element}
      {add.element}
    </View>
    </DropRoute>
  );
}

const ROUTE_STYLE = { flex: 1, minHeight: 0 };

/**
 * Brings a message the page does not hold into it: reads the window around it, widens the page until the row is mounted, leaves it marked for a few seconds, then lets go.
 * A message that cannot be read (deleted, or not the person's) ends quietly.
 */
function FocusLoader({ id, have, shownHas, onWindow, onWiden, onDone }: { id: string; have: boolean; shownHas: boolean; onWindow: (page: Message[]) => void; onWiden: () => void; onDone: () => void }): null {
  const data = useConversationData();
  const asked = useRef(false);
  const cb = useRef({ onWindow, onWiden, onDone });
  cb.current = { onWindow, onWiden, onDone };
  useEffect(() => {
    if (have || asked.current) return;
    asked.current = true;
    void windowAround(data, id).then((page) => { if (page === null) cb.current.onDone(); else cb.current.onWindow(page); }, () => cb.current.onDone());
  }, [data, id, have]);
  useEffect(() => { if (have && !shownHas) cb.current.onWiden(); }, [have, shownHas]);
  useEffect(() => {
    if (!have || !shownHas) return undefined;
    const t = setTimeout(() => cb.current.onDone(), 6000);
    return () => clearTimeout(t);
  }, [have, shownHas]);
  return null;
}

/** Brings the match the person is on into view. A web page scrolls its element; a phone's list follows its own rules. */
/** A reply whose saved message is now in the list: its row has the words, so the live stream behind it can go. */
function SettleTurns({ turns, rows, settle }: { turns: readonly { messageId?: string | null | undefined }[]; rows: readonly Message[]; settle: (messageId: string) => void }): null {
  useEffect(() => {
    const have = new Set(rows.map((m) => m.messageId));
    for (const t of turns) if (t.messageId && have.has(t.messageId)) settle(t.messageId);
  }, [turns, rows, settle]);
  return null;
}

/** Brings the match the person is on into view. A web page scrolls its element; a phone's list follows its own rules. */
function ScrollToMessage({ id }: { id: string }): null {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const doc = (globalThis as unknown as { document?: { querySelector(s: string): { scrollIntoView?: (o: object) => void } | null } }).document;
    doc?.querySelector(`[data-testid="msg-${id}"]`)?.scrollIntoView?.({ block: "center" });
  }, [id]);
  return null;
}

const markOf = (it: { kind: string; message?: { messageId: string } }, matches: readonly string[], active: string | undefined, finding = true): "match" | "active" | "selected" | undefined => {
  const id = it.message?.messageId;
  if (id === undefined || !matches.includes(id)) return undefined;
  // not a find: the message a thread, a link or a result went back to, in the app's subtle selected tint
  if (!finding) return "selected";
  return id === active ? "active" : "match";
};

/** One page of older messages from the kept copy, read as a live query so it paints from the device and fills in as more arrives. */
function OlderPage({ before, onPage }: { before: number; onPage: (page: MessagesOut) => void }): ReactElement | null {
  const data = useConversationData();
  const q = useScreenQuery<MessagesOut>(CONVERSATION_SCREEN, "messages", { threadId: data.threadId, before });
  const done = useRef(false);
  useEffect(() => {
    if (q.status !== "loading" && !done.current) { done.current = true; onPage(q.data); }
  }, [q, onPage]);
  return null;
}

const st = StyleSheet.create({
  /** "Also post to the chat" sits above a thread's composer, as the prototype draws it, so the composer's own bar keeps its room in a narrow pane. */
  alsoRow: { marginLeft: -4, marginBottom: 8 },
  outsideOffline: { paddingHorizontal: 16, paddingBottom: 6, fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string, textAlign: "center" },
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 10 },
  title: { flexShrink: 1, minWidth: 40, maxWidth: 320, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  titleBtn: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: RADIUS, paddingHorizontal: 6, paddingVertical: 2, marginLeft: -6 },
  titleOver: { backgroundColor: "var(--hover)" as string },
  rename: { width: 320, maxWidth: "60%", height: 28, borderRadius: RADIUS, paddingHorizontal: 6, marginLeft: -6, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  find: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  findInput: { flex: 1, minWidth: 0, height: 28, fontSize: 13.5, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  liveText: { fontSize: 12, color: "var(--ink-2)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  crewChip: { height: 28, paddingHorizontal: 10, borderRadius: RADIUS, justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  crewChipText: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  earlierBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 34, backgroundColor: "var(--side)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  earlierText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  noteLine: { paddingHorizontal: 16, paddingTop: 6, fontSize: 12, color: "var(--ink-3)" as string },
  feedBox: { flex: 1, minHeight: 0 },
  feedContent: { alignItems: "center", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 18 },
  col: { width: "100%", maxWidth: COLUMN, paddingTop: 6 },
  // an older row the browser may skip drawing and laying out while it is off screen; it keeps the size it last had, so the scroll bar and the scroll position do not move
  offscreen: { contentVisibility: "auto", containIntrinsicSize: "auto 88px" } as object,
  earlier: { alignItems: "center", paddingVertical: 10 },
  toLatest: { alignSelf: "flex-end", marginRight: 16, marginVertical: 4, height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string },
  toLatestText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  queueRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 10, rowGap: 2, paddingHorizontal: 24, paddingVertical: 4 },
  queue: { fontSize: 12.5, color: "var(--ink-3)" as string, textAlign: "center" },
  lineBox: { paddingHorizontal: 24, paddingVertical: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  lineText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  /** A quiet line: muted ink, no underline. */
  quietLine: { color: "var(--ink-3)" as string },
  offerStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 38, paddingLeft: 14, paddingRight: 6, marginHorizontal: 10, marginBottom: -1, borderTopLeftRadius: RADIUS, borderTopRightRadius: RADIUS, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  offerStripText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
  offerBtns: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  closed: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  typingRow: { height: 20, justifyContent: "center", paddingLeft: 6 },
  typingText: { fontSize: 12, color: "var(--ink-3)" as string },
  composerBox: { alignSelf: "center", width: "100%", maxWidth: COLUMN + 48, paddingHorizontal: 24, paddingBottom: 16 },
});


/** Hands the conversation's header controls to the frame it is drawn in, and takes them back when it leaves. Its own component, so its hooks run on every render of the conversation, loaded or not. */
function FrameFeed({ frame, feed }: { frame: FrameStore | null | undefined; feed: FrameControls | null }): null {
  useEffect(() => { if (frame && feed) frame.set(feed); });
  useEffect(() => () => frame?.set(null), [frame]);
  return null;
}
