// /btw: a side question and its answer, as a small card above the composer. It is marked as an aside, the answer streams as the agent writes it, and it is dismissible. It is not part of the conversation:
// the agent working in the chat does not see it unless the person presses Keep, which posts the answer into the chat as one card. The same card draws on a phone.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StreamText, createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import { TextButton } from "./parts.tsx";
import { ActivityLine } from "./ActivityLine.tsx";
import { useConversationData } from "./data.tsx";
import * as act from "./actions.ts";

export interface AsideItem { id: string; question: string }

const NO_TURNS: readonly never[] = [];
const noSub = (): (() => void) => () => undefined;

/** The saved answer of an aside's thread, read until it is there (the live words are shown meanwhile, and are all there is when no live link carries them). */
function useAnswer(threadId: string): string | null {
  const data = useConversationData();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (n: number): void => {
      void data.call("chat.messages.list", { threadId, limit: 20 }).then((r) => {
        if (!live) return;
        const msgs = (r as { messages?: Array<{ author: { kind: string }; body: string }> }).messages ?? [];
        const a = [...msgs].reverse().find((m) => m.author.kind === "agent" && m.body.trim() !== "");
        if (a) setText(a.body.trim());
        else if (n < 150) timer = setTimeout(() => look(n + 1), 800);
      }, () => { if (live && n < 150) timer = setTimeout(() => look(n + 1), 1500); });
    };
    look(0);
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [data, threadId]);
  return text;
}

export function AsideCard({ item, onDismiss }: { item: AsideItem; onDismiss: (id: string) => void }): ReactElement {
  const data = useConversationData();
  const live = data.live;
  const turns = useSyncExternalStore(live ? live.subscribe : noSub, () => (live ? live.turnsOf(item.id) : NO_TURNS), () => (live ? live.turnsOf(item.id) : NO_TURNS));
  const turn = turns[0];
  const writing: StreamStore | undefined = turn ? data.streamOf(turn.messageId ?? `turn:${turn.turnId}`) : undefined;
  const saved = useAnswer(item.id);
  const done = useMemo<StreamStore | null>(() => {
    if (saved === null) return null;
    const s = createStreamStore();
    s.push(saved);
    s.end();
    return s;
  }, [saved]);
  const [kept, setKept] = useState(false);
  const [problem, setProblem] = useState("");
  const store = writing && !(writing.getSnapshot().done && done) ? writing : done;
  const answered = saved !== null;
  const keep = (): void => {
    if (kept) return;
    setKept(true);
    void act.keepAside(data, item.id, data.newKey()).catch(() => { setKept(false); setProblem("Could not keep it."); });
  };
  const dismiss = (): void => { void act.dismissAside(data, item.id); onDismiss(item.id); };
  return (
    <View testID={`aside-${item.id}`} accessibilityRole="summary" style={st.card}>
      <View style={st.head}>
        <Text style={st.tag}>Aside</Text>
        <Text numberOfLines={1} style={st.hint}>Only you see this. The agent in this chat does not.</Text>
        <View style={st.flex} />
        <TextButton link label="Dismiss" testID={`aside-dismiss-${item.id}`} onPress={dismiss} />
      </View>
      <Text numberOfLines={2} testID={`aside-question-${item.id}`} style={st.question}>{item.question}</Text>
      <View testID={`aside-answer-${item.id}`} style={st.answer}>
        {store ? <StreamText store={store} /> : null}
        {!answered && turn && data.activityOf?.(turn.messageId ?? `turn:${turn.turnId}`) ? <ActivityLine store={data.activityOf(turn.messageId ?? `turn:${turn.turnId}`)!} /> : !store ? <Text style={st.thinking}>Thinking</Text> : null}
      </View>
      {problem !== "" ? <Text style={st.problem}>{problem}</Text> : null}
      {answered ? <View style={st.foot}><TextButton link label={kept ? "Kept" : "Keep"} testID={`aside-keep-${item.id}`} onPress={keep} disabled={kept} /></View> : null}
    </View>
  );
}

/** The asides of this chat, newest last, above the composer. */
export function AsideList({ items, onDismiss }: { items: readonly AsideItem[]; onDismiss: (id: string) => void }): ReactElement | null {
  if (items.length === 0) return null;
  const rows: ReactElement[] = [];
  for (const it of items) rows.push(<AsideCard key={it.id} item={it} onDismiss={onDismiss} />);
  return <View testID="asides" style={st.list}>{rows}</View>;
}

const st = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 6, gap: 8 },
  card: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 6, backgroundColor: "var(--panel)" as string, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--accent)" as string },
  hint: { flexShrink: 1, fontSize: 12, color: "var(--ink-3)" as string },
  flex: { flex: 1 },
  question: { fontSize: 13, color: "var(--ink-3)" as string },
  answer: { minHeight: 22 },
  thinking: { fontSize: 13.5, color: "var(--ink-3)" as string },
  problem: { fontSize: 12, color: "var(--danger)" as string },
  foot: { flexDirection: "row", gap: 12 },
});
