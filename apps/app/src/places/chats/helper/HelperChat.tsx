// Helper chat (spec 3.2 Helper chats): a helper's chat opens in the same pane with an address bar at the top ("Research > Firms 1-3"; each part links back). It is read-only:
// no composer, because helpers take no messages; a note says so, and "Reply in ..." goes to the parent thread, where steering happens. While the helper runs there is Stop. The
// brief, the steps and the result are the messages, drawn from the kept copy as they arrive.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Button, Face, Icon } from "../needsyou/parts.tsx";
import { HelperDataProvider, useHelperData, useOnline, useOptionalHelperData, useScreenQuery } from "./data.tsx";
import type { HelperChatData } from "./data.tsx";
import { READ_ONLY_NOTE, addressParts, blockLine, byOrder, helperStatus, metaLine, parentOf, whenLabel, workSummary } from "./model.ts";
import type { Message } from "./model.ts";
import { LoadFailed, failureOf } from "../../../../../../ui/src/States/Loads.tsx";

type ThreadOut = CapMap["threads.get"]["out"];
type MessagesOut = CapMap["chat.messages.list"]["out"];

import { HelperHooks } from "./HelperHooks.tsx";
import type { HelperHooksOut } from "./HelperHooks.tsx";
export const HELPER_SCREEN = "chats.helper-chat";

export function HelperChat({ data }: { data?: HelperChatData }): ReactElement {
  const ctx = useOptionalHelperData();
  const value = data ?? ctx;
  if (!value) return <HelperChatLoading />;
  return <HelperDataProvider value={value}><HelperView /></HelperDataProvider>;
}

/** The frame before data: the address bar and a feed the size of the real one, so nothing moves when the data arrives. */
export function HelperChatLoading(): ReactElement {
  return <View testID="helper-loading" accessibilityLabel="Loading" style={st.root}><View style={st.bar}><View style={st.skBar} /></View><View style={st.feed}><View style={st.skLine} /><View style={[st.skLine, { width: "60%" }]} /></View></View>;
}

function HelperView(): ReactElement {
  const data = useHelperData();
  const online = useOnline();
  const [line, setLine] = useState("");
  const threadQ = useScreenQuery<ThreadOut>(HELPER_SCREEN, "thread", { threadId: data.threadId });
  const messagesQ = useScreenQuery<MessagesOut>(HELPER_SCREEN, "messages", { threadId: data.threadId });
  const hooksQ = useScreenQuery<HelperHooksOut>(HELPER_SCREEN, "hooks", { threadId: data.threadId });
  const stop = useMemo(() => async (): Promise<void> => {
    try { await data.call("engine.stop", { threadId: data.threadId }); setLine("Stopped. The helper's steps so far are kept."); } catch { setLine("Could not stop it. Try again."); }
  }, [data]);

  const failed = failureOf(threadQ, messagesQ);
  if (failed) return <LoadFailed what="this helper" failure={failed} testID="helper-load-failed" />;
  if (threadQ.status === "loading" || messagesQ.status === "loading") return <HelperChatLoading />;
  const thread = threadQ.data.thread;
  const messages = byOrder(messagesQ.data.messages);
  const status = helperStatus(thread, messages);
  const parent = parentOf(thread);
  const parts = addressParts(thread);
  const clock = data.clock();
  const agentId = thread.agents[0]?.agentId;
  const owner = agentId ? data.nameOf(agentId) : "the agent";
  // who started it: the author of the brief, the first message
  const startedBy = messages[0] ? data.nameOf(messages[0].author.id) : owner;

  const crumbs: ReactElement[] = [];
  for (const [i, p] of parts.entries()) {
    if (i > 0) crumbs.push(<Text key={`s${i}`} style={st.sep}>›</Text>);
    crumbs.push(
      p.current ? (
        <View key={p.threadId} testID="helper-current" style={st.cur}><Icon name="helper" size={13} color="var(--ink-2)" /><Text numberOfLines={1} style={st.curText}>{p.title}</Text></View>
      ) : (
        <Pressable key={p.threadId} accessibilityRole="link" accessibilityLabel={`Back to ${p.title}`} onPress={() => data.nav.openThread(p.threadId)} testID={`helper-crumb-${p.threadId}`} style={st.seg}>
          <Text numberOfLines={1} style={st.segText}>{p.title}</Text>
        </Pressable>
      ),
    );
  }

  const feed: ReactElement[] = [];
  const noteOf = (m: Message): { data: Record<string, unknown> } | undefined => { const b = m.blocks.find((x) => x.type === "helper_note"); return b ? { data: (b.data ?? {}) as Record<string, unknown> } : undefined; };
  const work = messages.filter((m) => m.blocks.some((b) => b.type !== "helper_note"));
  const summary = workSummary(thread, messages, status);
  let workShown = false;
  for (const m of messages) {
    const who = data.nameOf(m.author.id);
    const note = noteOf(m);
    const hasWork = m.blocks.some((b) => b.type !== "helper_note");
    // the first message is the brief the helper was given, not the helper speaking: a block labelled with who gave it
    if (m === messages[0]) {
      feed.push(
        <View key={m.messageId} testID="helper-brief" accessibilityLabel={`Brief from ${who}`} style={st.brief}>
          <Text style={st.briefHead}>{`Brief from ${who}`}</Text>
          {m.body ? <Text style={st.body}>{m.body}</Text> : null}
        </View>,
      );
      continue;
    }
    // a note between the helper and the agent that started it keeps its sender: a follow-up is the agent's, a question or progress is the helper's, a steer is the person's (own words, no block)
    if (note) {
      const down = note.data["direction"] === "down";
      const asking = note.data["kind"] === "question";
      feed.push(
        <View key={m.messageId} testID={`note-${m.messageId}`} accessibilityLabel={down ? `Follow-up from ${who}` : asking ? "Question from the helper" : "Note from the helper"} style={[st.noteBlock, down && st.noteDown]}>
          <Text style={st.briefHead}>{down ? `Follow-up from ${who}${note.data["seenAt"] !== undefined ? " · seen" : ""}` : asking ? `${owner} asks${note.data["state"] === "answered" ? " · answered" : ""}` : `${owner} · ${note.data["kind"] === "result" ? "result" : "progress"}`}</Text>
          <Text style={st.body}>{m.body}</Text>
        </View>,
      );
      continue;
    }
    const byPerson = m.author.id.startsWith("usr_");
    feed.push(
      <View key={m.messageId} testID={`msg-${m.messageId}`} style={st.msg}>
        <View style={st.by}><Face name={who} seedId={m.author.id} size={20} /><Text style={st.who}>{byPerson && data.me?.id === m.author.id ? "You" : who}</Text><Text style={st.time}>{whenLabel(m.createdAt, clock)}</Text></View>
        {hasWork && !workShown ? <Work summary={summary} messages={work} /> : null}
        {m.body ? <Text style={st.body}>{m.body}</Text> : null}
      </View>,
    );
    if (hasWork) workShown = true;
  }

  return (
    <View testID="helper-chat" accessibilityLabel="Helper chat" style={st.root}>
      <View testID="helper-address" accessibilityRole="header" style={st.bar}>
        <View style={st.crumbs}>{crumbs}</View>
        {status === "running" ? <View testID="helper-live" style={st.live}><View style={st.liveDot} /><Text style={st.liveText}>Working</Text></View> : <Text testID="helper-meta" style={st.meta}>{metaLine(thread, status)}</Text>}
        {status === "failed" ? <Text testID="helper-failed" style={st.failed}>Failed</Text> : null}
        {status === "running" ? <Button label="Stop" onPress={() => void stop()} testID="helper-stop" /> : null}
        {online ? null : <Text testID="helper-offline" style={st.meta}>Offline</Text>}
      </View>
      {parent ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Back to the message that started this helper in ${parent.title}`} testID="helper-started-by"
          onPress={() => (data.nav.openMessage && thread.parentMessageId ? data.nav.openMessage(parent.threadId, thread.parentMessageId) : data.nav.openThread(parent.threadId))} style={st.startedBy}>
          <Text numberOfLines={1} style={st.startedByText}>{`Helper chat · started by ${startedBy} in ${parent.title}`}</Text>
        </Pressable>
      ) : null}
      <ScrollView testID="helper-feed" style={{ flex: 1 }} contentContainerStyle={st.feed}>
        <Text style={st.daysep}>{`Helper of ${owner}${parent ? ` · from “${parent.title}”` : ""}`}</Text>
        {messages.length === 0 ? <States kind="empty" icon="chat" title="Nothing yet. The helper has not started." /> : feed}
        {hooksQ.status === "ready" ? <HelperHooks hooks={hooksQ.data.hooks} helperThreadId={data.threadId} lead={owner} name={thread.title ?? "this helper"} {...(data.nav.openHooks ? { open: data.nav.openHooks } : {})} /> : null}
      </ScrollView>
      {line ? <View testID="helper-line" style={st.note}><Text style={st.noteText}>{line}</Text></View> : null}
      {status === "running" && data.me?.id !== undefined && thread.starter === data.me.id ? <AskBox threadId={data.threadId} call={data.call} say={setLine} /> : null}
      <View testID="helper-readonly" style={st.readonly}>
        <Icon name="lock" size={14} />
        <Text style={st.readonlyText}>{READ_ONLY_NOTE}</Text>
        {parent ? <Button label={`Reply in “${parent.title}”`} onPress={() => data.nav.openThread(parent.threadId)} testID="helper-reply" /> : null}
      </View>
    </View>
  );
}

/** Ask the helper something while it works: it goes to the helper as the person's own words (chat.helper.steer). */
function AskBox({ threadId, call, say }: { threadId: string; call: (cap: string, input: unknown) => Promise<unknown>; say: (t: string) => void }): ReactElement {
  const [text, setText] = useState("");
  const send = (): void => {
    const body = text.trim();
    if (body === "") return;
    void Promise.resolve(call("chat.helper.steer", { threadId, body, idempotencyKey: `steer-${threadId}-${Date.now()}` })).then(() => { setText(""); say("Sent. It reads this on its next step."); }, () => say("It could not take that. Ask in the chat that started it."));
  };
  return (
    <View style={st.ask}>
      <TextInput testID="helper-ask" value={text} onChangeText={setText} onSubmitEditing={send} placeholder="Message this helper" placeholderTextColor="var(--ink-4)" style={st.askInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Send" testID="helper-ask-send" onPress={send} style={st.askSend}><Text style={st.askSendT}>↑</Text></Pressable>
    </View>
  );
}

/** The helper's steps as one fold, open: "Worked for 31s, 3 steps" with a line per step. */
function Work({ summary, messages }: { summary: string; messages: readonly Message[] }): ReactElement {
  const lines: ReactElement[] = [];
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type === "helper_note") continue;
      const l = blockLine(b);
      lines.push(
        <View key={b.id} testID={`step-${b.id}`} style={st.step}>
          <View style={[st.stepDot, l.state === "live" && st.stepLive, l.state === "error" && st.stepError]} />
          <Text style={st.stepTitle}>{l.title}</Text>
          {l.sub ? <Text style={st.stepSub}>{l.sub}</Text> : null}
        </View>,
      );
    }
  }
  return (
    <View testID="helper-work" style={st.work}>
      <Text style={st.workHead}>{summary}</Text>
      {lines}
    </View>
  );
}

const st = StyleSheet.create({
  noteBlock: { alignSelf: "stretch", gap: 6, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string },
  noteDown: { borderLeftWidth: 3, borderLeftColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  ask: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  askInput: { flex: 1, height: 36, paddingHorizontal: 12, borderRadius: 18, fontSize: 13.5, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string },
  askSend: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  askSendT: { fontSize: 16, color: "var(--accent-ink)" as string },
  brief: { alignSelf: "stretch", gap: 6, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  briefHead: { fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-4)" as string },
  startedBy: { minHeight: 28, justifyContent: "center", paddingHorizontal: 16 },
  startedByText: { fontSize: 12.5, color: "var(--accent)" as string },
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  bar: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  crumbs: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  sep: { fontSize: 13, color: "var(--ink-4)" as string },
  seg: { height: 26, justifyContent: "center", paddingHorizontal: 6, borderRadius: 6 },
  segText: { fontSize: 13, color: "var(--ink-2)" as string },
  cur: { flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  curText: { flexShrink: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  live: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  liveText: { fontSize: 12, color: "var(--ink-2)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  failed: { fontSize: 12, fontWeight: "600", color: "var(--danger)" as string },
  feed: { paddingHorizontal: 24, paddingVertical: 18, gap: 16, maxWidth: 760 },
  daysep: { fontSize: 12, color: "var(--ink-3)" as string },
  msg: { gap: 6 },
  by: { flexDirection: "row", alignItems: "center", gap: 8 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  time: { fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  work: { gap: 6, paddingLeft: 4 },
  workHead: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  stepLive: { backgroundColor: "var(--ok)" as string },
  stepError: { backgroundColor: "var(--danger)" as string },
  stepTitle: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
  stepSub: { fontSize: 12, color: "var(--ink-4)" as string },
  note: { paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  noteText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  readonly: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  readonlyText: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  skBar: { height: 12, width: "40%", borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  skLine: { height: 10, width: "80%", borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});
