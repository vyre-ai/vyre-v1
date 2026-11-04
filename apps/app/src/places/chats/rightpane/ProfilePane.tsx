// One profile for everyone with a face, in a right tab (DESIGN-chat-system "Profiles"): pressing any face or name opens it, person or agent, and the page is the same from Chats and Records. It carries the actions:
// Message and, for a person, Mention. An agent shows what it does, what it is on now, its model, tools and what it knows; Edit opens the one page where an agent is changed. Reads are the agent's own capabilities;
// nothing here is sample text, and a field the Space does not have is left out.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { each } from "../../../shell/sidebar/model.ts";
import { ProfileHeader, roleLine } from "./ProfileHeader.tsx";
import { PersonProfile } from "./PersonProfile.tsx";
import { ChatRightPane } from "./ChatRightPane.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import type { PersonProfileProps } from "./PersonProfile.tsx";

type AgentOut = CapMap["agents.get"]["out"]["agent"];
type SummaryOut = CapMap["agents.summary"]["out"];

export interface ProfileTab { key: string; id: string; title: string; kind: "agent" | "assistant" | "person" | "details";
  /** A reply's Details tab (kind "details"): id is the message, and these say where it is and whose face leads the tab. */
  threadId?: string; agentId?: string }

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
  /** A person's pane: what the shell can do beside Message and Mention, and where its lists open. */
  /** An agent opened from a face: the full agent pane (About, Computer, Chats, Files, Terminal) for it, drawn inside this tab. Absent: the short body. */
  agentPane?: ChatRightPaneData | null | undefined;
  person?: Pick<PersonProfileProps, "now" | "dial" | "onAdd" | "openThread" | "openFile" | "openProject" | "threadId" | "nameOf" | "meId" | "openTask" | "copy"> | undefined;
}

export function ProfilePane({ tab, name, call, onMessage, onMention, onEdit, person: more, agentPane }: ProfileProps): ReactElement {
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
  if (person) return <PersonProfile id={tab.id} name={name} call={call} now={more?.now ?? Date.now} onMessage={onMessage} onMention={onMention} {...(more ?? {})} />;
  if (agentPane) return <ChatRightPane data={agentPane} embedded open onToggle={() => undefined} />;
  const shown = tab.kind === "assistant" ? "Assistant" : name;
  const line = "Member";
  const row = (label: string, value: string | number | undefined): ReactElement | null => (value === undefined || value === "" ? null : <View key={label} style={st.kv}><Text style={st.k}>{label}</Text><Text numberOfLines={1} style={st.v}>{String(value)}</Text></View>);
  const working = summary?.workingOn ?? [];
  return (
    <ScrollView testID={`profile-${tab.id}`} style={st.root} contentContainerStyle={st.content}>
      <ProfileHeader name={shown} seedId={tab.id} kind={tab.kind === "assistant" ? "assistant" : person ? "person" : "agent"} pulse={agent?.status === "working"} line={person ? line : roleLine(tab.kind === "assistant" ? "Assistant" : "Agent", agent?.role ?? (tab.kind === "assistant" ? "Yours, private to you" : undefined))}
        actions={[{ key: "message", icon: "chat", label: "Message", onPress: onMessage }, person ? { key: "mention", icon: "plus", label: "Mention", hint: `Mention ${name} in this chat`, onPress: onMention } : { key: "edit", icon: "edit", label: "Edit", hint: "Open this agent's page", onPress: onEdit }]} />
      {working.length > 0 ? <Text style={st.label}>Right now</Text> : null}
      {each(working.slice(0, 5), (w) => <View key={w.id} style={st.kv}><Text numberOfLines={1} style={st.v}>{w.title}</Text></View>)}
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
  line: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-3)" as string },
  label: { fontSize: 11.5, color: "var(--ink-4)" as string, paddingTop: 18, paddingBottom: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 7 },
  k: { fontSize: 13.5, color: "var(--ink-3)" as string },
  v: { flexShrink: 1, fontSize: 13.5, color: "var(--ink)" as string },
  cap: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, paddingTop: 12 },
});
