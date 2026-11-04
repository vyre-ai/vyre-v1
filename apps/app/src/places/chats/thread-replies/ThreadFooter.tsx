// The live footer under a message whose thread an agent answers in: the agent's face, "Working · 0:23" while it writes, how many replies, when the last came. A press opens the thread beside the chat
// (a wide screen) or as a full-screen sheet (a phone). Nothing blinks: the line is drawn again when the thread changes and once a second while a turn runs.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { ReplyLine } from "../conversation/ReplyLine.tsx";
import { useConversationData } from "../conversation/data.tsx";
import type { LiveTurn } from "../../../shell/session/turn-streams.ts";
import type { ReplySummary } from "../conversation/replies.ts";
import type { Clock } from "../rightpane/model.ts";
import { footerOf, showsFooter } from "./model.ts";

const NO_TURNS: readonly LiveTurn[] = [];
const noSub = (): (() => void) => () => undefined;

/** The live turns of one thread, from the live socket. A host with no live link has none. */
export function useThreadTurns(threadId: string): readonly LiveTurn[] {
  const { live } = useConversationData();
  const read = (): readonly LiveTurn[] => (live ? live.turnsOf(threadId) : NO_TURNS);
  return useSyncExternalStore(live ? live.subscribe : noSub, read, read);
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
  const f = footerOf(s, turns, now, clock);
  if (!showsFooter(f, s) || f === null) return null;
  // nobody writing: the quiet reply line as it always was
  if (!f.writing && s) return <ReplyLine s={s} clock={clock} nameOf={nameOf} onOpen={onOpen} mine={mine} testID={testID} />;
  const who = f.agentId ?? "";
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Open the thread: ${f.label}`} onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [st.line, mine && st.mine, hovered === true && st.over]}>
      <View style={st.face}><Face name={nameOf(who)} seedId={who} kind="agent" size={18} /></View>
      <Text testID={`${testID}-head`} style={st.head}>{f.head}</Text>
      {f.count !== "0 replies" ? <Text testID={`${testID}-count`} style={[st.count, f.bold && st.bold]}>{f.count}</Text> : null}
      {f.when ? <Text style={st.when}>{f.when}</Text> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "var(--raised)" as string },
  mine: { alignSelf: "flex-end" },
  over: { backgroundColor: "var(--hover)" as string },
  face: { flexShrink: 0 },
  head: { fontSize: 13, color: "var(--ink)" as string, fontWeight: "500" },
  count: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  bold: { fontWeight: "700" },
  when: { fontSize: 12, color: "var(--ink-3)" as string },
});
