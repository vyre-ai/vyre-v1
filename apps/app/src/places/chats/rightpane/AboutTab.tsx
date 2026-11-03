// Right pane > About: what the agent is responsible for, what it is doing right now, how it responds in this chat, and what it shares with the chat. Every line comes from the Space (the agent's record,
// its summary, the chat's own agent settings); a line the Space has no answer for is left out. An agent without a computer gets one quiet row that offers to set one up.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { AGENT_PAGE_SCREEN } from "./ThreadsTab.tsx";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { Icon, LeadIcon, TextButton } from "./parts.tsx";

type AgentOut = CapMap["agents.get"]["out"]["agent"];
type ThreadAgent = CapMap["threads.get"]["out"]["thread"]["agents"][number];

/** "Leads this chat" or "Listens": how the chat's own settings have the agent answer. */
export const respondsWord = (mode: ThreadAgent["mode"] | undefined): string | undefined => (mode === "lead" ? "Leads this chat" : mode === "listen" ? "Listens, answers when asked" : undefined);

/** The one quiet row for an agent with no computer. */
export function NoComputerRow({ name, onGive }: { name: string; onGive?: (() => void) | undefined }): ReactElement {
  return (
    <View testID="about-no-computer" style={st.quiet}>
      <Icon name="terminal" size={16} color="var(--ink-3)" />
      <Text style={st.quietText}><Text style={st.quietLead}>No computer.</Text> {name} works through tools and your Chrome.</Text>
      {onGive ? <TextButton label={`Give ${name} a computer`} onPress={onGive} testID="about-give" /> : null}
    </View>
  );
}

export function AboutTab({ agent, name, hasComputer, computerNote, onGive, onOpenFiles, onOpenKnows }: {
  agent: AgentOut | null; name: string; hasComputer: boolean; computerNote?: string | undefined; onGive?: (() => void) | undefined; onOpenFiles(): void; onOpenKnows(): void;
}): ReactElement {
  const data = usePaneData();
  const summary = useScreenQuery<CapMap["agents.summary"]["out"]>(AGENT_PAGE_SCREEN, "summary", { agentId: data.agent.agentId });
  const [mine, setMine] = useState<ThreadAgent | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("threads.get", { threadId: data.threadId })).then((o) => {
      if (live) setMine((o as CapMap["threads.get"]["out"]).thread.agents.find((a) => a.agentId === data.agent.agentId) ?? null);
    }, () => undefined);
    return () => { live = false; };
  }, [data, data.threadId, data.agent.agentId]);
  const working = summary.status === "ready" ? summary.data.workingOn : [];
  const facts = summary.status === "ready" ? summary.data.memoryFacts : 0;
  const responds = respondsWord(mine?.mode);
  const kv = (k: string, v: string | undefined): ReactElement | null => (v === undefined || v === "" ? null : <View key={k} style={st.kv}><Text style={st.k}>{k}</Text><Text numberOfLines={1} style={st.v}>{v}</Text></View>);
  const label = (t: string, key?: string): ReactElement => <Text key={key ?? t} style={st.label}>{t}</Text>;
  return (
    <ScrollView testID="about-tab" style={st.root} contentContainerStyle={st.content}>
      {agent?.role ? <>{label("Responsible for")}<Text testID="about-role" style={st.body}>{agent.role}</Text></> : null}
      {working.length > 0 || computerNote ? label("Right now") : null}
      {working.slice(0, 4).map((w) => <View key={w.id} style={st.now}><View style={st.nowDot} /><Text numberOfLines={2} style={st.v}>{w.title}</Text></View>)}
      {working.length === 0 && computerNote ? <View style={st.now}><View style={[st.nowDot, { backgroundColor: "var(--ink-4)" as string }]} /><Text style={st.v}>{computerNote}</Text></View> : null}
      {responds || mine?.model || mine?.effort ? label("How it responds here") : null}
      {kv("Responds", responds)}{kv("Model", mine?.model ?? agent?.model)}{kv("Effort", mine?.effort ? `${mine.effort.charAt(0).toUpperCase()}${mine.effort.slice(1)}` : undefined)}
      {label("Shared context")}
      <Pressable role="button" testID="about-files" onPress={onOpenFiles} style={st.row}><LeadIcon name="folder" /><View style={st.rowText}><Text style={st.v}>{`${name}'s folder`}</Text><Text style={st.sub}>Shared with Vyre Files</Text></View></Pressable>
      {facts > 0 ? <Pressable role="button" testID="about-knows" onPress={onOpenKnows} style={st.row}><LeadIcon name="doc" /><View style={st.rowText}><Text style={st.v}>What it knows</Text><Text style={st.sub}>{facts === 1 ? "1 thing" : `${facts} things`}</Text></View></Pressable> : null}
      {hasComputer ? null : <NoComputerRow name={name} onGive={onGive} />}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 18 },
  label: { fontSize: 11.5, color: "var(--ink-4)" as string, paddingTop: 16, paddingBottom: 6 },
  body: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string },
  now: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 3 },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: "var(--ok)" as string },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 7 },
  k: { fontSize: 13.5, color: "var(--ink-3)" as string },
  v: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 42, paddingVertical: 6 },
  rowText: { flex: 1, minWidth: 0 },
  quiet: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 20, padding: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  quietText: { flex: 1, minWidth: 140, fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string },
  quietLead: { color: "var(--ink-2)" as string, fontWeight: "500" },
});
