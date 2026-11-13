// The details of a channel or a group chat, in the right pane (K9, 13 Nov 2026): what the chat is, then who is in it. A channel shows its name, its topic and who can read it; a group chat shows its name. People and
// agents below, each a row that opens their profile. Reads the chat's own row (threads.get) and, for a channel, its topic and visibility (channels.get). Nothing is drawn about a channel's access until the channel
// has been read, and a read that fails shows the pane's error state: a private channel is never described as open because its read has not arrived. Nothing here is sample text.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { LoadFailed } from "../../../../../../ui/src/States/Loads.tsx";
import type { LoadFailure } from "../../../../../../ui/src/States/Loads.tsx";
import { PaneList } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

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

export type ChatDetailsRead =
  | { status: "loading" }
  | { status: "failed"; failure: LoadFailure }
  | { status: "ready"; thread: ThreadOut; channel: ChannelOut | null };

/**
 * The words under the name, or null when nothing true can be said yet. An invite-only channel is read only by the people in it (modules/chat/handlers/post.ts mayEnterChannel: its members and the person who
 * started it; Space admins are not in that list); a public one is open to the Space. A channel whose own read has not come back says nothing, never the public sentence.
 */
export function detailsLine(
  thread: Pick<ThreadOut, "kind">,
  channel: Pick<ChannelOut, "visibility"> | null,
): string | null {
  if (thread.kind !== "channel") return "Group chat";
  if (channel === null) return null;
  return channel.visibility === "invite"
    ? "Private channel. Only the people in it can read it."
    : "Channel. Anyone in the Space can join.";
}

const failureOf = (e: unknown): LoadFailure => {
  const x = (e ?? {}) as { message?: unknown; code?: unknown; traceId?: unknown };
  return {
    message: typeof x.message === "string" && x.message !== "" ? x.message : "The details could not be read.",
    ...(typeof x.code === "string" ? { code: x.code } : {}),
    ...(typeof x.traceId === "string" ? { traceId: x.traceId } : {}),
  };
};

function useDetails(call: Call, threadId: string): ChatDetailsRead {
  const [v, setV] = useState<ChatDetailsRead>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setV({ status: "loading" });
    void (async () => {
      try {
        const thread = ((await call("threads.get", { threadId })) as CapMap["threads.get"]["out"]).thread;
        const channel = thread.channelId
          ? ((await call("channels.get", { channelId: thread.channelId })) as CapMap["channels.get"]["out"]).channel
          : null;
        if (live) setV({ status: "ready", thread, channel });
      } catch (e) {
        if (live) setV({ status: "failed", failure: failureOf(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [call, threadId]);
  return v;
}

export function ChatDetails({ threadId, call, nameOf, meId, openProfile }: ChatDetailsProps): ReactElement {
  const read = useDetails(call, threadId);
  if (read.status === "failed")
    return <LoadFailed what="this chat's details" failure={read.failure} testID="chat-details-failed" />;
  if (read.status === "loading") return <View testID="chat-details-loading" style={st.loading} />;
  const { thread, channel } = read;
  const people = thread.members.filter((m) => m.kind === "person");
  // a chat's agents are on the chat's own agent list; a channel also lists them as members
  const agents = [
    ...new Set([
      ...thread.members.filter((m) => m.kind === "agent").map((m) => m.id),
      ...thread.agents.map((a) => a.agentId),
    ]),
  ];
  const title = channel
    ? `#${channel.name}`
    : (thread.title ?? (agents.length > 0 ? agents.map((id) => nameOf(id)).join(" and ") : "Group chat"));
  const line = detailsLine(thread, channel);
  const face = (id: string, kind: "person" | "agent"): ReactElement => (
    <View style={st.face}>
      <Avatar {...avatarOf({ id, name: nameOf(id), kind })} size={20} />
    </View>
  );
  const entries: Entry[] = [
    {
      key: "head",
      type: "block",
      node: (
        <View style={st.head}>
          <Text testID="chat-details-title" style={st.title}>
            {title}
          </Text>
          {line ? (
            <Text testID="chat-details-line" style={st.line}>
              {line}
            </Text>
          ) : null}
          {channel?.topic ? (
            <Text testID="chat-details-topic" style={st.topic}>
              {channel.topic}
            </Text>
          ) : null}
        </View>
      ),
    },
    ...(people.length > 0
      ? [{ key: "l-people", type: "label" as const, text: "People", right: String(people.length) }]
      : []),
    ...people.map(
      (p): Entry => ({
        key: `p-${p.id}`,
        type: "row",
        testID: `chat-person-${p.id}`,
        title: nameOf(p.id),
        ...(p.id === meId ? { suffix: "You" } : {}),
        leading: face(p.id, "person"),
        onPress: () => openProfile(p.id, true),
      }),
    ),
    ...(agents.length > 0
      ? [{ key: "l-agents", type: "label" as const, text: "Agents", right: String(agents.length) }]
      : []),
    ...agents.map(
      (id): Entry => ({
        key: `a-${id}`,
        type: "row",
        testID: `chat-agent-${id}`,
        title: nameOf(id),
        leading: face(id, "agent"),
        onPress: () => openProfile(id, false),
      }),
    ),
  ];
  return (
    <View testID="chat-details" style={st.root}>
      <PaneList entries={entries} plain />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  loading: { flex: 1 },
  head: { paddingHorizontal: 24, paddingTop: 18, gap: 4 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  topic: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string, paddingTop: 6 },
  face: { width: 24, alignItems: "center", justifyContent: "center", marginRight: 6 },
});
