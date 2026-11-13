// The details of a channel or a group chat, in the right pane (K9, 13 Nov 2026): what the chat is, then who is in it. A channel shows its name, its topic and who can read it; a group chat shows its
// name. People and agents below, each a row that opens their profile. Reads the chat's own row (threads.get) and, for a channel, its topic (channels.get). Nothing here is sample text.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type ThreadOut = CapMap["threads.get"]["out"]["thread"];
type ChannelOut = CapMap["channels.get"]["out"]["channel"];

export interface ChatDetailsProps {
  threadId: string;
  call: Call;
  nameOf(id: string): string;
  meId: string;
  /** Opens a person's or an agent's profile in this pane. */
  openProfile(id: string, asPerson: boolean): void;
}

export interface ChatDetailsRead { thread: ThreadOut | null; channel: ChannelOut | null }

/** The words under the name: who can read a channel, or what a group is. */
export function detailsLine(thread: Pick<ThreadOut, "kind"> | null, channel: Pick<ChannelOut, "visibility"> | null): string {
  if (thread?.kind === "channel") return channel?.visibility === "invite" ? "Private channel. Only the people below can read it." : "Channel. Anyone in the Space can join.";
  return "Group chat";
}

function useDetails(call: Call, threadId: string): ChatDetailsRead {
  const [v, setV] = useState<ChatDetailsRead>({ thread: null, channel: null });
  useEffect(() => {
    let live = true;
    void Promise.resolve(call("threads.get", { threadId })).then((o) => {
      const thread = (o as CapMap["threads.get"]["out"]).thread;
      if (live) setV((p) => ({ ...p, thread }));
      if (thread.channelId) void Promise.resolve(call("channels.get", { channelId: thread.channelId })).then((c) => { if (live) setV((p) => ({ ...p, channel: (c as CapMap["channels.get"]["out"]).channel })); }, () => undefined);
    }, () => undefined);
    return () => { live = false; };
  }, [call, threadId]);
  return v;
}

export function ChatDetails({ threadId, call, nameOf, meId, openProfile }: ChatDetailsProps): ReactElement {
  const { thread, channel } = useDetails(call, threadId);
  const people = (thread?.members ?? []).filter((m) => m.kind === "person");
  // a chat's agents are on the chat's own agent list; a channel also lists them as members
  const agents = [...new Set([...(thread?.members ?? []).filter((m) => m.kind === "agent").map((m) => m.id), ...(thread?.agents ?? []).map((a) => a.agentId)])].map((id) => ({ id }));
  const title = channel ? `#${channel.name}` : thread?.title ?? (agents.length > 0 ? agents.map((a) => nameOf(a.id)).join(" and ") : "Group chat");
  const face = (id: string, kind: "person" | "agent"): ReactElement => <Avatar {...avatarOf({ id, name: nameOf(id), kind })} size={20} />;
  return (
    <ScrollView testID="chat-details" style={st.root} contentContainerStyle={st.content}>
      <Text testID="chat-details-title" style={st.title}>{title}</Text>
      <Text testID="chat-details-line" style={st.line}>{detailsLine(thread, channel)}</Text>
      {channel?.topic ? <Text testID="chat-details-topic" style={st.topic}>{channel.topic}</Text> : null}
      {people.length > 0 ? <Text style={st.label}>{`People ${people.length}`}</Text> : null}
      {people.map((p) => <Row key={p.id} id={`chat-person-${p.id}`} title={nameOf(p.id)} {...(p.id === meId ? { note: "You" } : {})} leading={<View style={st.face}>{face(p.id, "person")}</View>} onPress={() => openProfile(p.id, true)} />)}
      {agents.length > 0 ? <Text style={st.label}>{`Agents ${agents.length}`}</Text> : null}
      {agents.map((a) => <Row key={a.id} id={`chat-agent-${a.id}`} title={nameOf(a.id)} leading={<View style={st.face}>{face(a.id, "agent")}</View>} onPress={() => openProfile(a.id, false)} />)}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16 },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string, paddingTop: 4 },
  topic: { fontSize: 13.5, lineHeight: 19, color: "var(--ink)" as string, paddingTop: 10 },
  label: { fontSize: 11.5, color: "var(--ink-4)" as string, paddingTop: 18, paddingBottom: 6 },
  face: { width: 24, alignItems: "center", justifyContent: "center", marginRight: 6 },
});
