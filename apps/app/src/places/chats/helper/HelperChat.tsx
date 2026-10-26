// Helper chat (spec 3.2 Helper chats): a helper's chat opens in the same pane with an address bar at the top ("Research > Firms 1-3"; each part links back). It is read-only:
// no composer, because helpers take no messages; a note says so, and "Reply in ..." goes to the parent thread, where steering happens. While the helper runs there is Stop. The
// brief, the steps and the result are the messages, drawn from the kept copy as they arrive.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Button, Face, Icon } from "../needsyou/parts.tsx";
import { HelperDataProvider, useHelperData, useOnline, useOptionalHelperData, useScreenQuery } from "./data.tsx";
import type { HelperChatData } from "./data.tsx";
import { READ_ONLY_NOTE, addressParts, blockLine, byOrder, helperStatus, metaLine, parentOf, whenLabel, workSummary } from "./model.ts";
import type { Message } from "./model.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type MessagesOut = CapMap["chat.messages.list"]["out"];

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
  const stop = useMemo(() => async (): Promise<void> => {
    try { await data.call("engine.stop", { threadId: data.threadId }); setLine("Stopped. The helper's steps so far are kept."); } catch { setLine("Could not stop it. Try again."); }
  }, [data]);

  if (threadQ.status === "loading" || messagesQ.status === "loading") return <HelperChatLoading />;
  const thread = threadQ.data.thread;
  const messages = byOrder(messagesQ.data.messages);
  const status = helperStatus(thread, messages);
  const parent = parentOf(thread);
  const parts = addressParts(thread);
  const clock = data.clock();
  const agentId = thread.agents[0]?.agentId;
  const owner = agentId ? data.nameOf(agentId) : "the agent";

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
  const work = messages.filter((m) => m.blocks.length > 0);
  const summary = workSummary(thread, messages, status);
  let workShown = false;
  for (const m of messages) {
    const who = data.nameOf(m.author.id);
    const hasWork = m.blocks.length > 0;
    feed.push(
      <View key={m.messageId} testID={`msg-${m.messageId}`} style={st.msg}>
        <View style={st.by}><Face name={who} seedId={m.author.id} size={20} /><Text style={st.who}>{who}</Text><Text style={st.time}>{whenLabel(m.createdAt, clock)}</Text></View>
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
      <ScrollView testID="helper-feed" style={{ flex: 1 }} contentContainerStyle={st.feed}>
        <Text style={st.daysep}>{`Helper of ${owner}${parent ? ` · from “${parent.title}”` : ""}`}</Text>
        {messages.length === 0 ? <States kind="empty" icon="chat" title="Nothing yet. The helper has not started." /> : feed}
      </ScrollView>
      {line ? <View testID="helper-line" style={st.note}><Text style={st.noteText}>{line}</Text></View> : null}
      <View testID="helper-readonly" style={st.readonly}>
        <Icon name="lock" size={14} />
        <Text style={st.readonlyText}>{READ_ONLY_NOTE}</Text>
        {parent ? <Button label={`Reply in “${parent.title}”`} onPress={() => data.nav.openThread(parent.threadId)} testID="helper-reply" /> : null}
      </View>
    </View>
  );
}

/** The helper's steps as one fold, open: "Worked for 31s, 3 steps" with a line per step. */
function Work({ summary, messages }: { summary: string; messages: readonly Message[] }): ReactElement {
  const lines: ReactElement[] = [];
  for (const m of messages) {
    for (const b of m.blocks) {
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
