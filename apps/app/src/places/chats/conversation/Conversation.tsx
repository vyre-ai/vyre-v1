// The conversation (spec 3.2 Chats, 2.5, 4.13, 4.6): the middle of the Chats place. A header with the thread's title, the faces of its agents with their mode marks (a press opens that
// agent's mode menu), Helpers while any run, Stop and Stop all while any work, the pane toggle and a menu. Under it the last 50 messages (older ones stream in on request), the agent's
// work folded into one line, and the shared composer with its who-will-reply line. A send shows on the page in the same frame, before chat.post answers; while an agent works, a plain
// send queues for its next step and Interrupt sends it now.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Feed, SkeletonMessage } from "../../../../../../ui/src/stream/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { ConversationDataProvider, useConversationData, useOnline, useOptionalConversationData, useScreenQuery } from "./data.tsx";
import type { ConversationData, ConversationNav } from "./data.tsx";
import * as act from "./actions.ts";
import { MessageView } from "./MessageView.tsx";
import { commandItems, lastActionable, runSlash } from "./commands.ts";
import type { CommandEnv } from "./commands.ts";
import { parseSlash } from "../../../../../../lib/chat-commands.ts";
import { pluginNames } from "./commands.ts";
import { useSuggest } from "./suggest.ts";
import { windowAround } from "./focus.ts";
import type { MessageActions } from "./MessageView.tsx";
import { FaceButton, Glyph, IconButton, TextButton, anchorOf } from "./parts.tsx";
import {
  WINDOW, beforeCursor, collect, faces, ghostMessages, findMatches, isClosed, lastMessages, leadOf, matchLine, mentionsIn, mergePages, modeTitle, modelLabel, participants, pendingMessage, placeholderFor, queueNote, queuedCount, sendKind, stillPending, stopLabel, swapNeeded,
  threadKindNote, timeline, titleOf, whoLine, workingAgents,
} from "./model.ts";
import type { Face as FaceModel, Message, Pending, SendKind, Thread } from "./model.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type MessagesOut = CapMap["chat.messages.list"]["out"];
type HelpersOut = CapMap["chat.helpers.list"]["out"];

export const CONVERSATION_SCREEN = "chats.conversation";

export function Conversation({ data }: { data?: ConversationData }): ReactElement {
  const ctx = useOptionalConversationData();
  const value = data ?? ctx;
  if (!value) return <ConversationLoading />;
  return <ConversationDataProvider value={value}><ConversationView /></ConversationDataProvider>;
}

/** The frame before data: a header bar, messages the size of real ones and a composer box, so nothing moves when the thread arrives. */
export function ConversationLoading(): ReactElement {
  return (
    <View testID="conversation-loading" accessibilityLabel="Loading" style={st.root}>
      <View style={st.head}><View style={st.skTitle} /></View>
      <View style={st.feedBox}>
        <View style={st.col}>
          <SkeletonMessage lines={2} testID="skeleton-1" />
          <View style={{ height: 18 }} />
          <SkeletonMessage lines={3} testID="skeleton-2" />
        </View>
      </View>
      <View style={st.skComposer} />
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

function ConversationView(): ReactElement {
  const data = useConversationData();
  const liveTurns = useLiveTurns(data);
  const online = useOnline();
  const menu = useMenu();
  const threadQ = useScreenQuery<ThreadOut>(CONVERSATION_SCREEN, "thread", { threadId: data.threadId });
  const messagesQ = useScreenQuery<MessagesOut>(CONVERSATION_SCREEN, "messages", { threadId: data.threadId });
  const helpersQ = useScreenQuery<HelpersOut>(CONVERSATION_SCREEN, "helpers", { threadId: data.threadId });
  const [shown, setShown] = useState(WINDOW);
  const [older, setOlder] = useState<Message[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [line, setLine] = useState("");
  const [typed, setTyped] = useState("");
  const [atEnd, setAtEnd] = useState(true);
  const [jump, setJump] = useState(0);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [matchAt, setMatchAt] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(data.focus ?? null);
  /** Messages read around a marked one that is older than the page holds: shown instead of the newest, until "Jump to latest". */
  const [around, setAround] = useState<Message[] | null>(null);
  useEffect(() => { setFocusId(data.focus ?? null); }, [data.focus]);
  const suggested = useSuggest(data, typed);
  const width = useWindowDimensions().width;
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

  const say = useCallback((text: string) => { setLine(text); }, []);
  /** A rejected write: say what did not happen and that it can be tried again. The page keeps what it showed. */
  const fail = (what: string) => (): void => say(`${what} Try again.`);

  /* ---------- sending: the message is on the page before chat.post answers ---------- */
  const run = useCallback((p: Pending) => {
    void (async () => {
      // files first: each is stored in Files under a key derived from this send, so a retry finds the same files and attaches them again
      const attachments = p.files && p.files.length > 0 ? await act.uploadAttachments(data, p.files, `chat-attach:${p.key}`) : [];
      return act.sendMessage(data, { text: p.body, mentions: p.mentions, key: p.key, kind: p.kind, working: p.working, ...(p.refs && p.refs.length > 0 ? { refs: p.refs } : {}), attachments });
    })().then(
      (r) => setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, messageId: r.messageId, state: "sending" as const } : x))),
      (e) => { setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, state: "failed" as const } : x))); say(`Not sent.${p.files && p.files.length > 0 && e instanceof Error && e.message.length < 120 ? ` ${e.message}.` : ""} Retry or discard it.`); },
    );
  }, [data, say]);

  if (threadQ.status === "loading" || messagesQ.status === "loading") return <ConversationLoading />;
  const thread: Thread = threadQ.data.thread;
  const live = messagesQ.data.messages;
  const all = mergePages(around ?? live, older);
  const liveView = around === null;
  const win = lastMessages(all, shown);
  const ghosts = liveView ? ghostMessages(liveTurns, win.rows, thread.threadId) : [];
  const writing = new Set(collect([...win.rows, ...ghosts].filter((m) => { const s = data.streamOf(m.messageId); return s !== undefined && !s.getSnapshot().done; }), (m) => m.messageId));
  const working = workingAgents(win.rows, writing);
  const isWorking = working.length > 0;
  const nameOf = data.nameOf;
  const lead = leadOf(thread);
  const hasEarlier = win.hiddenLocal > 0 || (olderMore ?? messagesQ.data.hasMore);

  const commandEnv = (): CommandEnv => ({
    data, thread, rows: win.rows, say, newKey: data.newKey,
    openFind: () => setFinding(true), openSearch: (q) => data.nav.openSearch?.(q), openModel: () => { if (lead) modelMenu(8, 120); else say("Add an agent to this chat first."); },
    send: (text) => submit({ text, chips: [], files: [], folder: null, links: [], refs: [], mode: "queue", answers: "" }, "queue"),
  });

  const submit = (payload: ComposerSend, kind: SendKind): void => {
    // a slash command is not a message: it runs, and nothing is posted (a name that is not a command is an ordinary message)
    if (payload.files.length === 0 && parseSlash(payload.text, pluginNames(data.pluginCommands?.())) !== null) {
      setLine(""); setTyped("");
      void runSlash(payload.text, commandEnv());
      return;
    }
    const key = data.newKey();
    const mentions = mentionsIn(payload.text, data.directory);
    const refs = [...payload.refs, ...payload.chips.flatMap((c) => (c.id !== undefined ? [{ kind: c.kind.toLowerCase(), id: c.id, title: c.name }] : []))];
    const files = payload.files.map((f) => ({ name: f.name, ...(f.file !== undefined ? { file: f.file } : {}), ...(f.size !== undefined ? { size: f.size } : {}), ...(f.mime ? { mime: f.mime } : {}) }));
    const p: Pending = { key, body: payload.text, at: data.clock().now, state: "sending", kind: sendKind(kind, isWorking), mentions, working: isWorking, ...(files.length > 0 ? { files } : {}), ...(refs.length > 0 ? { refs } : {}) };
    setPending((cur) => [...cur, p]);
    setLine("");
    setTyped("");
    run(p);
  };

  const found = finding ? findMatches(win.rows, query) : [];
  // the message a search result or a fork's link opened on is marked like the current find match, for a few seconds
  const matches = finding ? found : focusId !== null && all.some((m) => m.messageId === focusId) ? [focusId] : [];
  const activeId = finding ? (found.length > 0 ? found[Math.min(matchAt, found.length - 1)] : undefined) : matches[0];
  const timelineMessages = [...win.rows, ...collect(liveView ? stillPending(pending, win.rows) : [], (p, i) => pendingMessage(p, data.me.id, thread.threadId, (win.rows[win.rows.length - 1]?.threadSeq ?? 0) + 1 + i)), ...ghosts];
  const pendingState = new Map<string, "sending" | "failed">();
  for (const p of stillPending(pending, win.rows)) pendingState.set(`pending:${p.key}`, p.state);
  const items = timeline(timelineMessages, { meId: data.me.id, nameOf, kindOf: data.kindOf, clock: data.clock() });
  const lastLive = [...timelineMessages].reverse().find((m) => data.streamOf(m.messageId) !== undefined);
  const lastStream = lastLive ? data.streamOf(lastLive.messageId) : undefined;
  const queued = queuedCount(timelineMessages, data.me.id, isWorking);
  const helpers = (helpersQ.status === "loading" ? [] : helpersQ.data.helpers).filter((h) => h.status === "running");

  /* ---------- menus: all open under the button that asked ---------- */
  const faceList = faces(thread, nameOf, working);
  const leadFace = faceList.find((f) => f.mode === "lead") ?? faceList[0];
  const otherFaces = faceList.filter((f) => f !== leadFace);
  const modeMenu = (f: FaceModel, x: number, y: number): void => {
    const items: MenuEntry[] = [
      { head: f.name },
      { label: "Leads", checked: f.mode === "lead", onSelect: () => chooseMode(f, "lead", x, y) },
      { label: "Listening", checked: f.mode === "listen", onSelect: () => chooseMode(f, "listen", x, y) },
      { separator: true },
      ...(f.model ? [{ head: `Model · ${f.model}` } as MenuEntry] : []),
      { label: `Ask ${f.name} to Review This`, onSelect: () => void act.askToReview(data, thread, f.agentId, data.newKey()).catch(fail("Could not ask.")) },
      { label: `Open ${f.name}'s Page`, onSelect: () => data.nav.openAgent(f.agentId) },
      { separator: true },
      { label: "Remove From Thread", danger: true, onSelect: () => void act.removeAgent(data, f.agentId).catch(fail("Could not remove it.")) },
    ];
    menu.show(items, x, y, "other", { label: f.name });
  };
  const chooseMode = (f: FaceModel, mode: "lead" | "listen", x: number, y: number): void => {
    if (mode === f.mode) return;
    const old = mode === "lead" ? swapNeeded(thread, f.agentId) : null;
    if (old) {
      menu.show([
        { head: `${nameOf(old.agentId)} leads this thread. Make ${f.name} lead instead? ${nameOf(old.agentId)} will keep listening.` },
        { label: "Swap", onSelect: () => void act.setMode(data, f.agentId, "lead").then(() => say(`${f.name} now leads. ${nameOf(old.agentId)} is listening.`), fail("Could not change the mode.")) },
        { label: "Cancel" },
      ], x, y, "other", { label: f.name });
      return;
    }
    void act.setMode(data, f.agentId, mode).then(() => say(mode === "lead" ? `${f.name} now leads this thread` : `${f.name} is listening`), fail("Could not change the mode."));
  };
  const addMenu = (x: number, y: number): void => {
    const inThread = new Set(collect(thread.agents, (a) => a.agentId));
    const choices = data.directory.filter((c) => c.kind === "agent" && !inThread.has(c.id));
    menu.show(
      choices.length > 0
        ? [{ head: "Add as listening" } as MenuEntry, ...collect(choices, (c): MenuEntry => ({ label: c.name, onSelect: () => void act.addAgent(data, c.id).then(() => say(`${c.name} is listening`), fail("Could not add it.")) }))]
        : [{ head: "Every agent is already here" } as MenuEntry],
      x, y, "other", { label: "Add an agent" },
    );
  };
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
  const peopleMenu = (x: number, y: number): void => {
    const list = participants(thread, nameOf);
    menu.show(
      [{ head: `${list.length} in this thread` } as MenuEntry, ...collect(list, (p): MenuEntry => ({ label: `${p.name} · ${p.role}`, onSelect: () => { if (p.kind === "agent") data.nav.openAgent(p.id); } }))],
      x, y, "other", { label: "People in this thread" },
    );
  };
  const modelMenu = (x: number, y: number): void => {
    if (!lead) return;
    void act.listModels(data).then(
      (models) => menu.show(
        [{ head: `Model for ${nameOf(lead.agentId)}` } as MenuEntry, ...collect(models, (m): MenuEntry => ({ label: m.title, checked: modelLabel(lead.model ?? "") === m.title, onSelect: () => { if (!m.allowed) { say(`${m.title} is not allowed here. Ask an admin for access.`); return; } void act.setModel(data, lead.agentId, m).then(() => say(`${nameOf(lead.agentId)} now answers with ${m.title}`), fail("Could not switch the model.")); } }))],
        x, y, "other", { label: "Model" },
      ),
      fail("Could not list the models."),
    );
  };
  const moreMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [
      { label: "Plan Mode", checked: thread.planMode, onSelect: () => void act.setPlanMode(data, !thread.planMode).then(() => say(thread.planMode ? "Plan mode is off" : "Plan mode is on: the agent plans and changes nothing until you approve"), fail("Could not change plan mode.")) },
      ...(lead ? [{ label: `Open ${nameOf(lead.agentId)}'s Page`, onSelect: () => data.nav.openAgent(lead.agentId) } as MenuEntry] : []),
      ...connectEntries(thread, data.nav),
      { separator: true } as MenuEntry,
      ...(data.nav.openSearch ? [{ label: "Search All Chats…", onSelect: () => data.nav.openSearch!("") } as MenuEntry] : []),
      { label: "Fork This Chat", onSelect: () => void runSlash("/fork", commandEnv()) } as MenuEntry,
      { label: "Export as Markdown", onSelect: () => void runSlash("/export md", commandEnv()) } as MenuEntry,
      { label: "Export as JSON", onSelect: () => void runSlash("/export json", commandEnv()) } as MenuEntry,
      ...(isWorking ? [{ separator: true } as MenuEntry, { label: "Stop All", danger: true, onSelect: () => void act.stopAll(data).then(() => say("Everything stopped. The steps so far are kept."), fail("Could not stop.")) } as MenuEntry] : []),
    ];
    menu.show(items, x, y, "other", { label: "Chat" });
  };

  /* ---------- the message actions, one object for every row ---------- */
  const host: BlockHost = {
    invoke: (cap, input) => data.call(cap, input),
    open: (tab, input) => { const id = Object.values(input).find((v): v is string => typeof v === "string"); data.nav.openBeside(tab, id ?? ""); },
  };
  const actions: MessageActions = {
    host,
    copy: (t) => { data.copy(t); say("Copied"); },
    edit: (id, body) => void act.editMessage(data, id, body).catch(fail("Could not save the edit.")),
    setPinned: (id, pinned) => void act.setPinned(data, id, pinned).catch(fail("Could not pin it.")),
    react: (id, emoji, remove) => void act.react(data, id, emoji, remove).catch(fail("Could not react.")),
    openThread: (id) => void act.openMessageThread(data, id).then((tid) => data.nav.openThread(tid), fail("Could not open the thread.")),
    remove: (id) => void act.deleteMessage(data, id).catch(fail("Could not delete it.")),
    openAgent: data.nav.openAgent,
    openBeside: data.nav.openBeside,
    answer: (blockId, answer) => void act.answerBlock(data, blockId, answer).catch(fail("Could not send the answer.")),
    approvePlan: (planId) => void act.approvePlan(data, planId).then(() => say("Plan approved. The steps run and tick off in the card."), fail("Could not approve the plan.")),
    retryTurn: (turnId) => void act.retryTurn(data, turnId).catch(fail("Could not retry.")),
    errorNext: (key) => say(`Choose ${key} in the model switcher or ask for access.`),
    retrySend: (id) => { const p = pending.find((x) => `pending:${x.key}` === id); if (p) { setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, state: "sending" as const } : x))); setLine(""); run(p); } },
    discardSend: (id) => { setPending((cur) => cur.filter((x) => `pending:${x.key}` !== id)); setLine(""); },
    showMenu: (entries, x, y, label) => menu.show(entries, x, y, "context", { label }),
    fork: (id) => void act.forkChat(data, id, data.newKey()).then((next) => { say("Branched into a new chat, linked back to this one"); data.nav.openThread(next); }, fail("Could not fork it.")),
    makeTask: (id) => {
      const m = all.find((x) => x.messageId === id);
      if (!m) return;
      void act.makeTask(data, thread, m, data.newKey()).then((taskId) => { say("Task made from this message"); data.nav.openBeside("task", taskId); }, fail("Could not make the task."));
    },
    files: data,
    nameOf,
    openMessage: (threadId, messageId) => data.nav.openThread(threadId, messageId),
  };

  const lists = { ...data.lists, commands: commandItems(data.pluginCommands?.()), records: suggested.records, files: suggested.files, folders: suggested.folders, channels: suggested.channels };
  const personMention = thread.kind === "chat" && thread.members.filter((m) => m.kind === "person").length <= 1
    ? mentionsIn(typed, data.directory.filter((c) => c.kind === "person" && c.id !== data.me.id))[0]
    : undefined;
  const closed = isClosed(thread);
  const note = threadKindNote(thread, nameOf);
  const title = titleOf(thread, nameOf);
  const q = queueNote(queued, lead ? nameOf(lead.agentId) : "");

  return (
    <View testID="conversation" accessibilityLabel={`Conversation, ${title}`} style={st.root}>
      <View testID="conversation-head" accessibilityRole="header" style={st.head}>
        <Text numberOfLines={1} testID="conversation-title" style={st.title}>{title}</Text>
        {leadFace ? <FaceButton key={leadFace.agentId} name={leadFace.name} mode={leadFace.mode} working={leadFace.working} title={modeTitle(leadFace)} testID={`face-${leadFace.agentId}`} label={leadFace.name} size={20} onPress={(x, y) => modeMenu(leadFace, x, y)} /> : null}
        <View testID="conversation-faces" accessibilityRole="toolbar" accessibilityLabel="Agents in this thread" style={st.faces}>
          {collect(narrow ? [] : otherFaces, (f) => <FaceButton key={f.agentId} name={f.name} mode={f.mode} working={f.working} title={modeTitle(f)} testID={`face-${f.agentId}`} onPress={(x, y) => modeMenu(f, x, y)} />)}
          {narrow ? null : <IconButton icon="plus" label="Add an agent" size={24} testID="add-agent" onPress={addMenu} />}
        </View>
        {isWorking ? <View testID="conversation-live" style={st.live}><View style={st.liveDot} />{narrow ? null : <Text style={st.liveText}>Working</Text>}</View> : null}
        <View style={{ flex: 1 }} />
        {online ? null : <Text testID="conversation-offline" style={st.meta}>Offline</Text>}
        {helpers.length > 0 ? <IconButton icon="helper" label={`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} running`} badge={helpers.length} testID="helpers-button" onPress={helpersMenu} /> : null}
        {isWorking ? <IconButton icon="stop" label={stopLabel(working, nameOf)} danger testID="stop-button" onPress={stopMenu} /> : null}
        <IconButton icon="people" label={`${thread.members.length} in this thread`} badge={thread.members.length} testID="participants-button" onPress={peopleMenu} />
        <IconButton icon="search" label="Find in chat" active={finding} testID="find-button" onPress={() => setFinding((f) => !f)} />
        <IconButton icon="pane" label="Show or hide the pane" testID="pane-button" onPress={() => data.nav.togglePane()} />
        <IconButton icon="more" label="More" testID="more-button" onPress={moreMenu} />
      </View>
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
      {note ? <Text testID="conversation-note" style={st.noteLine}>{note}</Text> : null}

      {liveView ? null : (
        <View testID="viewing-earlier" accessibilityRole="alert" style={st.earlierBar}>
          <Text style={st.earlierText}>Viewing earlier messages</Text>
          <TextButton label="Jump to latest" testID="viewing-earlier-latest" onPress={() => { setAround(null); setOlder([]); setFocusId(null); setShown(WINDOW); setJump((n) => n + 1); setAtEnd(true); }} />
        </View>
      )}
      <View style={st.feedBox}>
        <Feed key={jump} followKey={timelineMessages.length} {...(lastStream ? { store: lastStream } : {})} testID="conversation-feed" contentStyle={st.feedContent} onAtEndChange={setAtEnd}>
          <View style={st.col}>
            {hasEarlier ? (
              <View style={st.earlier}>
                <TextButton label="Show earlier messages" testID="earlier-button" onPress={() => { if (win.hiddenLocal > 0) setShown((n) => n + WINDOW); else { const c = beforeCursor(all); if (c !== null) setCursor(c); } }} />
              </View>
            ) : null}
            {items.length === 0 ? <States kind="empty" icon="chat" title="Say something to start" /> : null}
            {collect(items, (it) => {
              const key = it.key;
              const stream = it.kind === "other" ? data.streamOf(it.message.messageId) : undefined;
              const sending = it.kind === "me" ? pendingState.get(it.message.messageId) : undefined;
              return <MessageView key={key} item={it} actions={actions} meId={data.me.id} stream={stream} sending={sending} mark={markOf(it, matches, activeId)} />;
            })}
          </View>
        </Feed>
        {atEnd ? null : (
          <Pressable testID="to-latest" accessibilityRole="button" accessibilityLabel="Jump to latest" onPress={() => { setJump((n) => n + 1); setAtEnd(true); }} style={st.toLatest}>
            <Glyph name="down" size={14} color="var(--ink-2)" /><Text style={st.toLatestText}>Jump to latest</Text>
          </Pressable>
        )}
      </View>
      {data.live ? <SettleTurns turns={liveTurns} rows={win.rows} settle={data.live.settle} /> : null}
      {focusId !== null ? <FocusLoader key={focusId} id={focusId} have={all.some((m) => m.messageId === focusId)} shownHas={win.rows.some((m) => m.messageId === focusId)} onWindow={(page) => setAround(page)} onWiden={() => setShown((n) => n + WINDOW)} onDone={() => setFocusId(null)} /> : null}
      {activeId ? <ScrollToMessage key={`${activeId}:${matchAt}`} id={activeId} /> : null}
      {cursor !== null ? <OlderPage key={cursor} before={cursor} onPage={(page) => { setOlder((cur) => mergePages(cur, page.messages)); setOlderMore(page.hasMore); setShown((n) => n + WINDOW); setCursor(null); }} /> : null}

      {data.waitingLine ?? null}
      {q ? <Text testID="queue-note" accessibilityLiveRegion="polite" style={st.queue}>{q}</Text> : null}
      {line ? <View testID="conversation-line" accessibilityLiveRegion="polite" style={st.lineBox}><Text style={st.lineText}>{line}</Text></View> : null}
      {personMention ? (
        <View testID="channel-offer" style={st.offer}>
          <Face name={nameOf(personMention.id)} seedId={personMention.id} kind="person" size={18} />
          <Text style={st.offerText}>{`${nameOf(personMention.id)} is not in this chat. A chat never gains people.`}</Text>
          <TextButton label={`Start a channel with ${nameOf(personMention.id).split(" ")[0]}`} testID="channel-start" onPress={() => void act.startChannel(data, personMention.id, data.newKey()).then(() => say("Channel started, linked back to this chat."), fail("Could not start the channel."))} />
        </View>
      ) : null}
      {closed ? (
        <View testID="conversation-closed" style={st.closed}><Text style={st.lineText}>This thread is closed.</Text><TextButton label="Reopen" onPress={() => void data.call("threads.reopen", { threadId: thread.threadId }).catch(fail("Could not reopen."))} testID="reopen" /></View>
      ) : (
        <View style={st.composerBox}>
          <Composer
            testID="composer" whoWillAnswer={whoLine(thread, nameOf)} placeholder={placeholderFor(thread, nameOf, isWorking)} working={isWorking}
            {...(lead ? { whoExtra: <ModelChip label={modelLabel(lead.model ?? "")} onPress={modelMenu} />, barExtra: <IconButton icon="monitor" label={`${nameOf(lead.agentId)}'s computer`} size={26} testID="computer-button" onPress={() => data.nav.openBeside("computer", lead.agentId)} /> } : {})}
            {...(lead ? { lead: nameOf(lead.agentId) } : {})} listening={collect(thread.agents.filter((a) => a.mode === "listen"), (a) => nameOf(a.agentId))}
            lists={lists} agentChat={thread.kind !== "channel"} onChange={setTyped} onCommand={(name) => void runSlash(`/${name}`, commandEnv())}
            onSubmit={(p) => submit(p, "queue")} onInterrupt={(p) => submit(p, "interrupt")}
            onStop={() => void (working.length > 1 ? act.stopAll(data) : act.stopAgent(data, working[0])).then(() => say("Stopped. The steps so far are kept."), fail("Could not stop it."))}
          />
        </View>
      )}
      {menu.element}
    </View>
  );
}

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

const markOf = (it: { kind: string; message?: { messageId: string } }, matches: readonly string[], active: string | undefined): "match" | "active" | undefined => {
  const id = it.message?.messageId;
  if (id === undefined || !matches.includes(id)) return undefined;
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

/** The model the lead answers with: its name and a chevron; a press opens the list under it. */
function ModelChip({ label, onPress }: { label: string; onPress: (x: number, y: number) => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${label}`} testID="model-chip" onPress={(e) => { const p = anchorOf(e); onPress(p.x, p.y); }} style={st.model}>
      <Text style={st.modelText}>{label}</Text>
      <Glyph name="chevd" size={11} color="var(--ink-3)" />
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { flexShrink: 1, minWidth: 40, maxWidth: 320, fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  faces: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  find: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  findInput: { flex: 1, minWidth: 0, height: 28, fontSize: 13.5, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  model: { height: 22, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderRadius: 6 },
  modelText: { fontSize: 12, fontWeight: "500", color: "var(--ink-2)" as string },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  liveText: { fontSize: 12, color: "var(--ink-2)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  earlierBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 34, backgroundColor: "var(--side)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  earlierText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  noteLine: { paddingHorizontal: 16, paddingTop: 6, fontSize: 12, color: "var(--ink-3)" as string },
  feedBox: { flex: 1, minHeight: 0 },
  feedContent: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 18 },
  col: { width: "100%", maxWidth: 760, paddingTop: 6 },
  earlier: { alignItems: "center", paddingVertical: 10 },
  toLatest: { position: "absolute", alignSelf: "center", bottom: 10, height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string },
  toLatestText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  queue: { paddingHorizontal: 24, paddingVertical: 4, fontSize: 12.5, color: "var(--ink-3)" as string, textAlign: "center" },
  lineBox: { paddingHorizontal: 24, paddingVertical: 4, alignItems: "center" },
  lineText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  offer: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", maxWidth: 760, paddingHorizontal: 24, paddingVertical: 4 },
  offerText: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
  closed: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  composerBox: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 16 },
  skTitle: { height: 12, width: 160, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  skComposer: { height: 84, marginHorizontal: 24, marginBottom: 16, borderRadius: 14, backgroundColor: "var(--sunk)" as string },
});
