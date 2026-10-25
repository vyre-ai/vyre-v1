// The conversation (spec 3.2 Chats, 2.5, 4.13, 4.6): the middle of the Chats place. A header with the thread's title, the faces of its agents with their mode marks (a press opens that
// agent's mode menu), Helpers while any run, Stop and Stop all while any work, the pane toggle and a menu. Under it the last 50 messages (older ones stream in on request), the agent's
// work folded into one line, and the shared composer with its who-will-reply line. A send shows on the page in the same frame, before chat.post answers; while an agent works, a plain
// send queues for its next step and Interrupt sends it now.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Feed, SkeletonMessage } from "../../../../../../ui/src/stream/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Face } from "../needsyou/parts.tsx";
import { ConversationDataProvider, useConversationData, useOnline, useOptionalConversationData, useScreenQuery } from "./data.tsx";
import type { ConversationData } from "./data.tsx";
import * as act from "./actions.ts";
import { MessageView } from "./MessageView.tsx";
import type { MessageActions } from "./MessageView.tsx";
import { FaceButton, Glyph, IconButton, TextButton } from "./parts.tsx";
import {
  WINDOW, beforeCursor, collect, faces, isClosed, lastMessages, leadOf, mentionsIn, mergePages, modeTitle, pendingMessage, placeholderFor, queueNote, queuedCount, sendKind, stillPending, stopLabel, swapNeeded,
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

function ConversationView(): ReactElement {
  const data = useConversationData();
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

  const say = useCallback((text: string) => { setLine(text); }, []);
  /** A rejected write: say what did not happen and that it can be tried again. The page keeps what it showed. */
  const fail = (what: string) => (): void => say(`${what} Try again.`);

  /* ---------- sending: the message is on the page before chat.post answers ---------- */
  const run = useCallback((p: Pending) => {
    void act.sendMessage(data, { text: p.body, mentions: p.mentions, key: p.key, kind: p.kind, working: p.working }).then(
      (r) => setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, messageId: r.messageId, state: "sending" as const } : x))),
      () => { setPending((cur) => collect(cur, (x) => (x.key === p.key ? { ...x, state: "failed" as const } : x))); say("Not sent. Retry or discard it."); },
    );
  }, [data, say]);

  if (threadQ.status === "loading" || messagesQ.status === "loading") return <ConversationLoading />;
  const thread: Thread = threadQ.data.thread;
  const live = messagesQ.data.messages;
  const all = mergePages(live, older);
  const win = lastMessages(all, shown);
  const writing = new Set(collect(win.rows.filter((m) => { const s = data.streamOf(m.messageId); return s !== undefined && !s.getSnapshot().done; }), (m) => m.messageId));
  const working = workingAgents(win.rows, writing);
  const isWorking = working.length > 0;
  const nameOf = data.nameOf;
  const lead = leadOf(thread);
  const hasEarlier = win.hiddenLocal > 0 || (olderMore ?? messagesQ.data.hasMore);

  const submit = (payload: ComposerSend, kind: SendKind): void => {
    const key = data.newKey();
    const mentions = mentionsIn(payload.text, data.directory);
    const p: Pending = { key, body: payload.text, at: data.clock().now, state: "sending", kind: sendKind(kind, isWorking), mentions, working: isWorking };
    setPending((cur) => [...cur, p]);
    setLine("");
    setTyped("");
    run(p);
  };

  const timelineMessages = [...win.rows, ...collect(stillPending(pending, win.rows), (p, i) => pendingMessage(p, data.me.id, thread.threadId, (win.rows[win.rows.length - 1]?.threadSeq ?? 0) + 1 + i))];
  const pendingState = new Map<string, "sending" | "failed">();
  for (const p of stillPending(pending, win.rows)) pendingState.set(`pending:${p.key}`, p.state);
  const items = timeline(timelineMessages, { meId: data.me.id, nameOf, kindOf: data.kindOf, clock: data.clock() });
  const lastLive = [...timelineMessages].reverse().find((m) => data.streamOf(m.messageId) !== undefined);
  const lastStream = lastLive ? data.streamOf(lastLive.messageId) : undefined;
  const queued = queuedCount(timelineMessages, data.me.id, isWorking);
  const helpers = (helpersQ.status === "loading" ? [] : helpersQ.data.helpers).filter((h) => h.status === "running");

  /* ---------- menus: all open under the button that asked ---------- */
  const faceList = faces(thread, nameOf, working);
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
  const moreMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [
      { label: "Plan Mode", checked: thread.planMode, onSelect: () => void act.setPlanMode(data, !thread.planMode).then(() => say(thread.planMode ? "Plan mode is off" : "Plan mode is on: the agent plans and changes nothing until you approve"), fail("Could not change plan mode.")) },
      ...(lead ? [{ label: `Open ${nameOf(lead.agentId)}'s Page`, onSelect: () => data.nav.openAgent(lead.agentId) } as MenuEntry] : []),
      ...(isWorking ? [{ separator: true } as MenuEntry, { label: "Stop All", danger: true, onSelect: () => void act.stopAll(data).then(() => say("Everything stopped. The steps so far are kept."), fail("Could not stop.")) } as MenuEntry] : []),
    ];
    menu.show(items, x, y, "other", { label: "Chat" });
  };

  /* ---------- the message actions, one object for every row ---------- */
  const actions: MessageActions = {
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
  };

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
        <View testID="conversation-faces" accessibilityRole="toolbar" accessibilityLabel="Agents in this thread" style={st.faces}>
          {collect(faceList, (f) => <FaceButton key={f.agentId} name={f.name} mode={f.mode} working={f.working} title={modeTitle(f)} testID={`face-${f.agentId}`} onPress={(x, y) => modeMenu(f, x, y)} />)}
          <IconButton icon="plus" label="Add an agent" size={24} testID="add-agent" onPress={addMenu} />
        </View>
        {isWorking ? <View testID="conversation-live" style={st.live}><View style={st.liveDot} /><Text style={st.liveText}>Working</Text></View> : null}
        <View style={{ flex: 1 }} />
        {online ? null : <Text testID="conversation-offline" style={st.meta}>Offline</Text>}
        {helpers.length > 0 ? <IconButton icon="helper" label={`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} running`} badge={helpers.length} testID="helpers-button" onPress={helpersMenu} /> : null}
        {isWorking ? <IconButton icon="stop" label={stopLabel(working, nameOf)} danger testID="stop-button" onPress={stopMenu} /> : null}
        <IconButton icon="pane" label="Show or hide the pane" testID="pane-button" onPress={() => data.nav.togglePane()} />
        <IconButton icon="more" label="More" testID="more-button" onPress={moreMenu} />
      </View>
      {note ? <Text testID="conversation-note" style={st.noteLine}>{note}</Text> : null}

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
              return <MessageView key={key} item={it} actions={actions} meId={data.me.id} stream={stream} sending={sending} />;
            })}
          </View>
        </Feed>
        {atEnd ? null : (
          <Pressable testID="to-latest" accessibilityRole="button" accessibilityLabel="Jump to latest" onPress={() => { setJump((n) => n + 1); setAtEnd(true); }} style={st.toLatest}>
            <Glyph name="down" size={14} color="var(--ink-2)" /><Text style={st.toLatestText}>Jump to latest</Text>
          </Pressable>
        )}
      </View>
      {cursor !== null ? <OlderPage key={cursor} before={cursor} onPage={(page) => { setOlder((cur) => mergePages(cur, page.messages)); setOlderMore(page.hasMore); setShown((n) => n + WINDOW); setCursor(null); }} /> : null}

      {q ? <Text testID="queue-note" accessibilityLiveRegion="polite" style={st.queue}>{q}</Text> : null}
      {line ? <View testID="conversation-line" accessibilityLiveRegion="polite" style={st.lineBox}><Text style={st.lineText}>{line}</Text></View> : null}
      {personMention ? (
        <View testID="channel-offer" style={st.offer}>
          <Face name={nameOf(personMention.id)} kind="person" size={18} />
          <Text style={st.offerText}>{`${nameOf(personMention.id)} is not in this chat. A chat never gains people.`}</Text>
          <TextButton label={`Start a channel with ${nameOf(personMention.id).split(" ")[0]}`} testID="channel-start" onPress={() => void act.startChannel(data, personMention.id, data.newKey()).then(() => say("Channel started, linked back to this chat."), fail("Could not start the channel."))} />
        </View>
      ) : null}
      {closed ? (
        <View testID="conversation-closed" style={st.closed}><Text style={st.lineText}>This thread is closed.</Text><TextButton label="Reopen" onPress={() => void data.call("threads.reopen", { threadId: thread.threadId }).catch(fail("Could not reopen."))} testID="reopen" /></View>
      ) : (
        <View style={st.composerBox}>
          <Composer
            testID="composer" whoWillAnswer={whoLine(thread, nameOf)} placeholder={placeholderFor(thread, nameOf)} working={isWorking}
            {...(lead ? { lead: nameOf(lead.agentId) } : {})} listening={collect(thread.agents.filter((a) => a.mode === "listen"), (a) => nameOf(a.agentId))}
            lists={data.lists} agentChat={thread.kind !== "channel"} onChange={setTyped}
            onSubmit={(p) => submit(p, "queue")} onInterrupt={(p) => submit(p, "interrupt")}
            onStop={() => void (working.length > 1 ? act.stopAll(data) : act.stopAgent(data, working[0])).then(() => say("Stopped. The steps so far are kept."), fail("Could not stop it."))}
          />
        </View>
      )}
      {menu.element}
    </View>
  );
}

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
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { flexShrink: 1, maxWidth: 320, fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  faces: { flexDirection: "row", alignItems: "center", gap: 2 },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  liveText: { fontSize: 12, color: "var(--ink-2)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
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
