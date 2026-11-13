// What a chat's right pane opens on (K9, 13 Nov 2026): the thing the chat is. A one-to-one chat with a person opens on that person; a channel on the channel; a group chat on the group; an
// agent's chat on the agent. The rule is one function so a table can hold it. The pane's tabs (About first) and the shell's profile tabs do the drawing; this only says which one comes first.

export type PaneSubject =
  | { kind: "person"; id: string }
  | { kind: "channel"; channelId: string }
  | { kind: "group" }
  | { kind: "agent" };

export interface SubjectThread {
  kind: string;
  channelId?: string | undefined;
  members?: readonly { kind: string; id: string }[] | undefined;
  agents?: readonly { agentId: string }[] | undefined;
}

/**
 * One person and no agent: that person. Several people, or an agent beside a person, or two or more agents: the group. A channel: the channel.
 * Everything else (an agent's own chat, a reply thread, a helper, a run) keeps the agent it follows.
 */
export function paneSubject(t: SubjectThread, meId: string, assistantId: string): PaneSubject {
  if (t.kind === "channel") return { kind: "channel", channelId: t.channelId ?? "" };
  if (t.kind !== "chat") return { kind: "agent" };
  const people = new Set((t.members ?? []).filter((m) => m.kind === "person" && m.id !== meId).map((m) => m.id));
  const agents = new Set([...(t.agents ?? []).map((a) => a.agentId), ...(t.members ?? []).filter((m) => m.kind === "agent").map((m) => m.id)]);
  agents.delete(assistantId);
  if (people.size === 1 && agents.size === 0) return { kind: "person", id: [...people][0]! };
  if (people.size >= 1 || agents.size >= 2) return { kind: "group" };
  return { kind: "agent" };
}
