// What a chat's right pane opens on (K9, 13 Nov 2026): the thing the chat is. A one-to-one chat with a person opens on that person; a channel on the channel; a group chat on the group; an
// agent's chat on the agent. The rule is one function so a table can hold it. The pane's tabs (About first) and the shell's profile tabs do the drawing; this only says which one comes first.

export type PaneSubject =
  | { kind: "person"; id: string }
  | { kind: "channel"; channelId: string }
  | { kind: "group" }
  | { kind: "agent" };

export interface SubjectThread {
  kind: string;
  /** What the chat is about: a goal's or a task's chat is that goal's or task's, not a group, and keeps its own pane (the agent's) as before. */
  scopeType?: string | undefined;
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
  if (t.scopeType === "goal" || t.scopeType === "task") return { kind: "agent" };
  const people = new Set((t.members ?? []).filter((m) => m.kind === "person" && m.id !== meId).map((m) => m.id));
  const agents = new Set([
    ...(t.agents ?? []).map((a) => a.agentId),
    ...(t.members ?? []).filter((m) => m.kind === "agent").map((m) => m.id),
  ]);
  agents.delete(assistantId);
  if (people.size === 1 && agents.size === 0) return { kind: "person", id: [...people][0]! };
  if (people.size >= 1 || agents.size >= 2) return { kind: "group" };
  return { kind: "agent" };
}

export type PaneAction = "clear" | "skip" | "keep" | "select";
/**
 * What the pane does about its first tab on this render. "clear": the pane is closed, drop the tab it chose. "skip": nothing to choose, or this chat's choice is already made (a hook line, Knows or Skills
 * asked for a tab: those requests settle the chat, even when they open a closed pane). "keep": the person is looking at something they chose; leave it. "select": show the thing the chat is.
 */
export function paneAction(s: {
  paneOpen: boolean;
  hasSubject: boolean;
  threadId: string | null;
  settledFor: string | null;
  rightOn: string | null;
  autoTab: string | null;
}): PaneAction {
  if (!s.paneOpen) return "clear";
  if (!s.hasSubject || s.threadId === null || s.settledFor === s.threadId) return "skip";
  if (s.rightOn !== null && s.rightOn !== s.autoTab) return "keep";
  return "select";
}
