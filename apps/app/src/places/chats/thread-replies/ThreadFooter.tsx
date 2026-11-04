// The live footer under a message whose thread an agent answers in: the agent's face, "Working · 0:23" while it writes, how many replies, when the last came. A press opens the thread beside the chat
// (a wide screen) or as a full-screen sheet (a phone). Nothing blinks: the line is drawn again when the thread changes and once a second while a turn runs.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { ReplyLine } from "../conversation/ReplyLine.tsx";
import { useConversationData } from "../conversation/data.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import type { LiveTurn } from "../../../shell/session/turn-streams.ts";
import type { ReplySummary } from "../conversation/replies.ts";
import type { Clock } from "../rightpane/model.ts";
import { CONVERSATION_SCREEN } from "../conversation/Conversation.tsx";
import { useLive } from "../mounts/live.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { footerOf, parkedTask, showsFooter } from "./model.ts";
import type { Waiting } from "./model.ts";

const NO_TURNS: readonly LiveTurn[] = [];
const noSub = (): (() => void) => () => undefined;

/**
 * The live turns of one thread, from the live socket. A host with no live link has none. A chat opened while an agent is already writing in the thread under a message asks what it has written so far
 * (engine.live_turns), as the thread's own page does, and the live pieces carry on from there.
 */
export function useThreadTurns(threadId: string): readonly LiveTurn[] {
  const data = useConversationData();
  return useTurnsOf(data, threadId);
}

/** The same, from the conversation data itself: for a part drawn outside the conversation's own provider (the thread beside the chat). */
export function useTurnsOf(data: Pick<ConversationData, "live" | "call" | "connection">, threadId: string, seed = true): readonly LiveTurn[] {
  const { live } = data;
  const online = useSyncExternalStore(data.connection.subscribe, () => data.connection.get() === "online", () => data.connection.get() === "online");
  useEffect(() => {
    if (!live || !online || !seed) return undefined;
    let gone = false;
    const fetchNow = (): void => {
      try {
        void Promise.resolve(data.call("engine.live_turns", { threadId })).then((r) => { if (!gone) live.seed(threadId, (r as { turns?: { turnId: string; agentId: string; text: string }[] }).turns ?? []); }, () => undefined);
      } catch { /* no live read here: the footer then waits for the live pieces */ }
    };
    fetchNow();
    const off = live.onGap((th) => { if (th === threadId) fetchNow(); });
    return () => { gone = true; off(); };
  }, [data, live, online, threadId, seed]);
  const read = (): readonly LiveTurn[] => (live ? live.turnsOf(threadId) : NO_TURNS);
  return useSyncExternalStore(live ? live.subscribe : noSub, read, read);
}

type MessagesOut = CapMap["chat.messages.list"]["out"];

/** A turn in the thread that is parked on an approval: the one line of the approval and who must say yes. Read only when an agent wrote last, so a thread of people costs nothing. */
function useWaiting(threadId: string, lastByAgent: boolean): Waiting | undefined {
  const data = useConversationData();
  const q = useLive<MessagesOut>(data.screens, CONVERSATION_SCREEN, "messages", lastByAgent ? { threadId } : null);
  const taskId = lastByAgent && q.status === "ready" ? parkedTask(q.data.messages as never) : null;
  const [w, setW] = useState<Waiting | undefined>(undefined);
  useEffect(() => {
    if (taskId === null) { setW(undefined); return undefined; }
    let gone = false;
    const say = (title: string, who: string): void => { if (!gone) setW({ line: title, who }); };
    say("", "");   // parked now; the line follows once the approval is read
    try {
      void Promise.resolve(data.call("tasks.get", { taskId })).then((r) => {
        const t = (r as { task?: { title?: string; assigned?: { kind?: string; id?: string } } }).task;
        const to = t?.assigned?.kind === "person" && t.assigned.id !== data.me.id ? t.assigned.id : undefined;
        say(String(t?.title ?? "").replace(/^.*? (asks|wants to): ?/, "").replace(/^.*? wants to /, "").replace(/^Approve: /, "").replace(/^(message|text) (\S+) \S+$/, "$1 $2"), to ? `${data.nameOf(to).split(" ")[0]}'s` : "");
      }, () => undefined);
    } catch { /* the approval cannot be read here: the footer still says it waits */ }
    return () => { gone = true; };
  }, [taskId, data]);
  return w;
}

export function ThreadFooter({ s, clock, nameOf, onOpen, mine = false, testID, threadId }: { s: ReplySummary | undefined; clock: Clock; nameOf(id: string): string; onOpen(): void; mine?: boolean; testID: string; threadId: string }): ReactElement | null {
  const turns = useThreadTurns(threadId);
  const writing = turns.some((t) => t.state === "writing");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!writing) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    (t as { unref?: () => void }).unref?.();   // a timer must never keep a process alive
    return () => clearInterval(t);
  }, [writing]);
  const waiting = useWaiting(threadId, s?.lastBy?.kind === "agent" && !writing);
  const f = footerOf(s, turns, now, clock, waiting);
  if (!showsFooter(f, s) || f === null) return null;
  if (f.waiting) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Open the thread: ${f.label}`} onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.line, mine && st.mine, hovered === true && st.over]}>
        <View style={st.face}><Face name={nameOf(s?.lastBy?.id ?? "")} seedId={s?.lastBy?.id} kind="agent" size={18} /></View>
        <Text testID={`${testID}-waiting`} numberOfLines={1} style={st.doneText}><Text style={st.head}>{f.head}</Text>{f.waiting.line !== "" ? ` \u00b7 ${f.waiting.line}` : ""}</Text>
        {f.count !== "0 replies" ? <Text testID={`${testID}-count`} style={[st.muted, f.bold && st.bold]}>{`\u00b7 ${f.count}`}</Text> : null}
      </Pressable>
    );
  }
  if (f.done && s) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Open the thread: Done, ${f.done.line}, ${f.label}`} onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.line, mine && st.mine, hovered === true && st.over]}>
        <View style={st.face}><Face name={nameOf(f.done.agentId)} seedId={f.done.agentId} kind="agent" size={18} /></View>
        <Text testID={`${testID}-done`} numberOfLines={1} style={st.doneText}><Text style={st.head}>Done</Text>{` \u00b7 ${f.done.line}`}</Text>
        <Text testID={`${testID}-count`} style={[st.muted, f.bold && st.bold]}>{`\u00b7 ${f.count}`}</Text>
      </Pressable>
    );
  }
  // nobody writing and no outcome to say: the quiet reply line as it always was
  if (!f.writing && s) return <ReplyLine s={s} clock={clock} nameOf={nameOf} onOpen={onOpen} mine={mine} testID={testID} />;
  const who = f.agentId ?? "";
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Open the thread: ${f.label}`} onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.line, mine && st.mine, hovered === true && st.over]}>
      <View style={st.face}><Face name={nameOf(who)} seedId={who} kind="agent" size={18} /></View>
      <Text testID={`${testID}-head`} style={st.working}>{f.head}</Text>
      {f.count !== "0 replies" ? <Text testID={`${testID}-count`} style={[st.muted, f.bold && st.bold]}>{`\u00b7 ${f.count}`}</Text> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 6, paddingVertical: 4, paddingHorizontal: 6, marginLeft: -6, borderRadius: 8 },
  mine: { alignSelf: "flex-end" },
  over: { backgroundColor: "var(--hover)" as string },
  face: { flexShrink: 0 },
  doneText: { flexShrink: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)" as string },
  head: { fontSize: 13, color: "var(--ink)" as string, fontWeight: "500" },
  working: { fontSize: 13, color: "var(--accent)" as string, fontWeight: "500" },
  muted: { fontSize: 12.5, color: "var(--ink-3)" as string },
  count: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  bold: { fontWeight: "700" },
  when: { fontSize: 12, color: "var(--ink-3)" as string },
});
