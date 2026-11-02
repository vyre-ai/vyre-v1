// Threads, at the top of Chats: the threads you are in. You join by replying or being mentioned; a thread opens where it lives.
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { useEffect, useState } from "react";

type Thread = CapMap["threads.list"]["out"]["threads"][number];

export function ThreadsPage({ rt, nameOf, openChat }: { rt: ShellRuntime; nameOf(id: string): string; openChat(id: string): void }): ReactElement {
  const [rows, setRows] = useState<readonly Thread[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("threads.list", { kind: ["thread"], limit: 100 })).then((o) => { if (live) setRows((o as CapMap["threads.list"]["out"]).threads.filter((t) => t.members?.some((m) => m.id === rt.me.id) !== false)); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [rt]);
  return (
    <ScrollView testID="threads-page" style={st.root} contentContainerStyle={st.content}>
      <View style={st.col}>
        <Text accessibilityRole="header" aria-level={1} style={st.title}>Threads</Text>
        {rows !== null && rows.length === 0 ? <Text style={st.empty}>Threads you reply in or are mentioned in show here.</Text> : null}
        {(rows ?? []).map((t) => {
          const who = t.agents[0]?.agentId;
          return <Row key={t.threadId} id={`thread-${t.threadId}`} title={t.title ?? "Thread"} {...(t.replyCount !== undefined ? { note: `${t.replyCount} ${t.replyCount === 1 ? "reply" : "replies"}` } : {})} leading={who ? <View style={st.lead}><Avatar name={nameOf(who)} seedId={who} kind="agent" size={28} /></View> : null} onPress={() => openChat(t.threadId)} />;
        })}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  content: { alignItems: "center", paddingHorizontal: 24, paddingTop: 34, paddingBottom: 40 },
  col: { width: "100%", maxWidth: 660 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string, marginBottom: 12 },
  lead: { marginRight: 12 },
  empty: { fontSize: 14, color: "var(--ink-3)" as string },
});
