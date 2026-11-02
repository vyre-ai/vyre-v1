// One profile for everyone with a face, in a right tab (DESIGN-chat-system "Profiles"): pressing any face or name opens it, person or agent, and the page is the same from Chats and Records. It carries the actions:
// Message and, for a person, Mention. An agent shows what it does, what it is on now, its model, tools and what it knows; Edit opens the one page where an agent is changed. Reads are the agent's own capabilities;
// nothing here is sample text, and a field the Space does not have is left out.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";

type AgentOut = CapMap["agents.get"]["out"]["agent"];
type SummaryOut = CapMap["agents.summary"]["out"];

export interface ProfileTab { key: string; id: string; title: string; kind: "agent" | "assistant" | "person" }

/** The tab for a face: one per person or agent, opening it again finds it. */
export function profileTab(id: string, name: string, kind: ProfileTab["kind"]): ProfileTab {
  return { key: `profile:${id}`, id, title: kind === "assistant" ? "Assistant" : name.split(/\s+/)[0] ?? name, kind };
}

/** Adds a tab, or finds the one already open. */
export function withTab(tabs: readonly ProfileTab[], tab: ProfileTab): ProfileTab[] {
  return tabs.some((t) => t.key === tab.key) ? [...tabs] : [...tabs, tab];
}

/** The tab shown after `key` closes: the one before it, else the one after it, else none. */
export function afterClose(tabs: readonly ProfileTab[], key: string): string | null {
  const at = tabs.findIndex((t) => t.key === key);
  const rest = tabs.filter((t) => t.key !== key);
  return rest[Math.max(0, at - 1)]?.key ?? null;
}

export interface ProfileProps {
  tab: ProfileTab;
  name: string;
  call(cap: string, input: unknown): Promise<unknown>;
  onMessage(): void;
  onMention(): void;
  /** An agent's one page: where it is edited. */
  onEdit(): void;
}

export function ProfilePane({ tab, name, call, onMessage, onMention, onEdit }: ProfileProps): ReactElement {
  const person = tab.kind === "person";
  const [agent, setAgent] = useState<AgentOut | null>(null);
  const [summary, setSummary] = useState<SummaryOut | null>(null);
  useEffect(() => {
    if (person) return undefined;
    let live = true;
    void Promise.resolve(call("agents.get", { agentId: tab.id })).then((o) => { if (live) setAgent((o as CapMap["agents.get"]["out"]).agent); }, () => undefined);
    void Promise.resolve(call("agents.summary", { agentId: tab.id })).then((o) => { if (live) setSummary(o as SummaryOut); }, () => undefined);
    return () => { live = false; };
  }, [call, tab.id, person]);
  const shown = tab.kind === "assistant" ? "Assistant" : name;
  const line = person ? "Member" : agent?.role ?? (tab.kind === "assistant" ? "Yours, private to you" : "Agent");
  const row = (label: string, value: string | number | undefined): ReactElement | null => (value === undefined || value === "" ? null : <View key={label} style={st.kv}><Text style={st.k}>{label}</Text><Text numberOfLines={1} style={st.v}>{String(value)}</Text></View>);
  const working = summary?.workingOn ?? [];
  return (
    <ScrollView testID={`profile-${tab.id}`} style={st.root} contentContainerStyle={st.content}>
      <View style={st.band} />
      <View style={st.face}><Avatar {...avatarOf({ id: tab.id, name, kind: tab.kind })} size={72} {...(agent?.status === "working" ? { state: "working" as const } : {})} /></View>
      <Text accessibilityRole="header" aria-level={2} style={st.name}>{shown}</Text>
      <Text style={st.line}>{line}</Text>
      <View style={st.acts}>
        <Pressable role="button" testID="profile-message" onPress={onMessage} style={st.primary}><Text style={st.primaryText}>Message</Text></Pressable>
        {person ? <Pressable role="button" testID="profile-mention" onPress={onMention} style={st.quiet}><Text style={st.quietText}>Mention</Text></Pressable> : null}
        {person ? null : <Pressable role="button" testID="profile-edit" onPress={onEdit} style={st.quiet}><Text style={st.quietText}>Edit</Text></Pressable>}
      </View>
      {working.length > 0 ? <Text style={st.label}>Right now</Text> : null}
      {working.slice(0, 5).map((w) => <View key={w.id} style={st.kv}><Text numberOfLines={1} style={st.v}>{w.title}</Text></View>)}
      {person ? null : <Text style={st.label}>Set up</Text>}
      {person ? null : row("Model", agent?.model ?? "Auto")}
      {person ? null : row("Can use", agent ? (agent.toolsAllowed.length > 0 ? `${agent.toolsAllowed.length} tools` : "Nothing yet") : undefined)}
      {person ? null : row("Knows", summary ? `${summary.memoryFacts} things` : undefined)}
      {tab.kind === "assistant" ? <Text style={st.cap}>Private to you. Nobody else in the Space can open this.</Text> : null}
      {tab.kind === "agent" ? <Text style={st.cap}>Records, Chats and its computer all read this one agent.</Text> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 16 },
  band: { height: 84, marginTop: -6, marginHorizontal: -14, opacity: 0.28, backgroundImage: "linear-gradient(120deg,var(--accent),transparent 85%)" } as object,
  face: { marginTop: -44, alignSelf: "flex-start", borderRadius: 24, boxShadow: "0 0 0 4px var(--side)" } as object,
  name: { marginTop: 12, marginBottom: 2, fontSize: 22, fontWeight: "600", letterSpacing: -0.3, color: "var(--ink)" as string },
  line: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", gap: 6, paddingTop: 12 },
  primary: { height: 30, paddingHorizontal: 13, borderRadius: 11, justifyContent: "center", backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13, fontWeight: "600", color: "var(--accent-ink)" as string },
  quiet: { height: 30, paddingHorizontal: 9, borderRadius: 11, justifyContent: "center" },
  quietText: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  label: { fontSize: 11.5, color: "var(--ink-4)" as string, paddingTop: 18, paddingBottom: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 7 },
  k: { fontSize: 13.5, color: "var(--ink-3)" as string },
  v: { flexShrink: 1, fontSize: 13.5, color: "var(--ink)" as string },
  cap: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, paddingTop: 12 },
});
