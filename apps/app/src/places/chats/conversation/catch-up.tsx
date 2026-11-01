// "Catch me up" (rc.9 flow 3): one line at the top of a thread with things you have not read: who wrote, what was decided, what was made into a task, and who @named you. It reads the server's
// plain summary (chat.catch_up), shows once on open, and goes away with one tap that also marks the thread read. Nothing here calls a model.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextButton } from "./parts.tsx";
import { useConversationData } from "./data.tsx";
import { mentionsIn } from "./model.ts";

export interface CatchUp {
  unread: number; firstMessageId: string | null;
  people: { id: string; count: number }[]; tasks: { messageId: string; title: string }[]; decisions: { messageId: string; text: string }[];
  at: { messageId: string; author: string; text: string }[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The one line: "3 new from Maya. 1 decision, 1 task. 1 mentions you." Empty when there is nothing to catch up on. */
export function catchUpLine(c: CatchUp, nameOf: (id: string) => string, mine: number): string {
  if (c.unread < 2) return "";
  const parts: string[] = [];
  const first = c.people[0];
  const who = c.people.length === 0 ? "" : c.people.length === 1 ? ` from ${nameOf(first!.id).split(" ")[0]}` : ` from ${nameOf(first!.id).split(" ")[0]} and ${plural(c.people.length - 1, "other", "others")}`;
  parts.push(`${c.unread} new${who}.`);
  const work: string[] = [];
  if (c.decisions.length > 0) work.push(plural(c.decisions.length, "decision", "decisions"));
  if (c.tasks.length > 0) work.push(plural(c.tasks.length, "task", "tasks"));
  if (work.length > 0) parts.push(`${work.join(", ")}.`);
  if (mine > 0) parts.push(mine === 1 ? "1 message names you." : `${mine} messages name you.`);
  return parts.join(" ");
}

export function CatchUpLine({ onJump }: { onJump: (messageId: string) => void }): ReactElement | null {
  const data = useConversationData();
  const [c, setC] = useState<CatchUp | null>(null);
  useEffect(() => {
    let live = true;
    void data.call("chat.catch_up", { threadId: data.threadId }).then((r) => { if (live) setC(r as CatchUp); }, () => undefined);
    return () => { live = false; };
  }, [data, data.threadId]);
  if (!c) return null;
  const me = [{ kind: "person" as const, id: data.me.id, name: data.me.name }];
  const mine = c.at.filter((m) => m.author !== data.me.id && mentionsIn(m.text, me).length > 0).length;
  const line = catchUpLine(c, data.nameOf, mine);
  if (line === "") return null;
  return (
    <View testID="catch-up" accessibilityRole="summary" style={s.box}>
      <Text testID="catch-up-line" style={s.text}>{line}</Text>
      {c.firstMessageId ? <TextButton link label="Jump to first" testID="catch-up-jump" onPress={() => onJump(c.firstMessageId!)} /> : null}
      <TextButton link label="Got it" testID="catch-up-done" onPress={() => { setC(null); void data.call("threads.mark_read", { threadId: data.threadId }).catch(() => undefined); }} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  text: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
});
