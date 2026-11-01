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

/** The one line: "Maya and 1 other wrote. 2 decisions, 1 task, and you're mentioned." Message counts only when there is nothing else to say. Empty when there is nothing to catch up on. */
export function catchUpLine(c: CatchUp, nameOf: (id: string) => string, mine: number, o: { meId?: string; kindOf?: (id: string) => "person" | "agent" } = {}): string {
  // A person is never told they wrote: their own messages are not news, whatever name the server counted them under
  if (o.meId !== undefined) {
    const others = c.people.filter((p) => p.id !== o.meId);
    if (others.length === 0) return "";
    c = { ...c, people: others, unread: others.reduce((n, p) => n + p.count, 0) };
  }
  if (c.unread < 2) return "";
  const first = c.people[0];
  if (!first) return `${c.unread} new messages.`;
  const rest = c.people.length - 1;
  const who = nameOf(first.id).split(" ")[0]!;
  const parts = [`${rest === 0 ? who : `${who} and ${plural(rest, "other", "others")}`} ${o.kindOf?.(first.id) === "agent" ? "replied" : "wrote"}.`];
  const work: string[] = [];
  if (c.decisions.length > 0) work.push(plural(c.decisions.length, "decision", "decisions"));
  if (c.tasks.length > 0) work.push(plural(c.tasks.length, "task", "tasks"));
  if (mine > 0) work.push("you're mentioned");
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  if (work.length > 0) parts.push(cap(`${work.length > 1 ? `${work.slice(0, -1).join(", ")}${work.length > 2 ? "," : ""} and ${work[work.length - 1]}` : work[0]}.`));
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
  const line = catchUpLine(c, data.nameOf, mine, { meId: data.me.id, kindOf: data.kindOf });
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
