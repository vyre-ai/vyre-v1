// The Add people and agents host, pure part: what the sheet is opened on, how the directory, the "Here now" rows and each agent's answers are read from the capabilities' rows, how the
// picks become calls (the plan lives in ui/AccessSheet addCalls; this adds what only the app knows: a project's chat, a new project teammate) and the words said afterwards.
// Nothing here calls a capability, so every rule is tested without a mount.
import type { CapMap } from "../../../../../../generated/types.ts";
import { isAssistantRow } from "../../../../../../lib/agent-kind.ts";
import { DEFAULT_AGENT_SETTINGS, joinNames } from "../../../../../../ui/src/AccessSheet/index.tsx";
import type { AccessDirectory, AccessEntry, AccessPick, AddCall, AddTarget, AgentHow, AgentSettings, ShareLevel } from "../../../../../../ui/src/AccessSheet/index.tsx";

type Principals = CapMap["access.principals.list"]["out"]["principals"];
type AgentRows = CapMap["agents.list"]["out"]["agents"];
type Connected = CapMap["mcp.connected.list"]["out"]["agents"];
export type ThreadRow = CapMap["threads.get"]["out"]["thread"];
export type ThreadAgentRow = ThreadRow["agents"][number];

/** What the sheet is opened on: a chat, a channel or a reply thread (all by their thread; the host reads which it is), or a project. */
export type AddOpen = { threadId: string; name?: string } | { projectId: string; name?: string };

/** Everything the host needs to make a call, say a line and name people. The place passes what it already holds. */
export interface AddSheetDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  nameOf(id: string): string;
  newKey(): string;
  toast(text: string): void;
}

/* ---------- how an agent answers in a chat ---------- */

/** The row a chat keeps for an agent, in the sheet's words: answers everything, answers when tagged, or listens and posts only when poked. */
export function settingsOf(a: Pick<ThreadAgentRow, "mode" | "quiet" | "when" | "topics" | "hoursFrom" | "hoursTo" | "style">): AgentSettings {
  const how: AgentHow = a.quiet === true ? "listen" : a.mode === "lead" ? "lead" : "tag";
  return {
    how,
    when: a.when ?? "always",
    topics: a.topics ?? "",
    hoursFrom: a.hoursFrom ?? DEFAULT_AGENT_SETTINGS.hoursFrom,
    hoursTo: a.hoursTo ?? DEFAULT_AGENT_SETTINGS.hoursTo,
    style: a.style ?? "short",
  };
}

/** The line under an agent on a Here now row. */
export function hereSub(a: Pick<ThreadAgentRow, "mode" | "quiet" | "owned">, only: boolean): string {
  const how = a.quiet === true ? "Listening" : a.mode === "lead" ? (only ? "In this chat" : "Answers everything") : "Answers when tagged";
  return a.owned === true ? `${how} · made for this chat` : how;
}

/* ---------- reading the directory ---------- */

export interface DirectoryInput {
  me: string;
  principals: Principals;
  agents: AgentRows;
  connected: Connected;
  /** The project this sheet adds to: its own teammates are offered here and nowhere else. */
  projectId?: string;
}

/** People first, then agents (the person's own Assistant first), then the person's outside agents. Another person's Assistant and a chat's own agent are never offered. */
export function directoryOf(i: DirectoryInput): AccessDirectory {
  const people: AccessEntry[] = i.principals
    .filter((p) => p.kind === "person" && p.status === "active" && p.id !== i.me)
    .map((p) => ({ id: p.id, name: p.name, sub: p.title ?? "Space member", kind: "person" as const }));
  const usable = i.agents.filter((a) => a.runtime !== "outside" && a.chatOf === undefined && (a.teammateOf === undefined || a.teammateOf === i.projectId) && !(isAssistantRow(a) && a.ownerId !== i.me));
  const mine = usable.filter((a) => isAssistantRow(a) && a.ownerId === i.me);
  const rest = usable.filter((a) => !mine.includes(a));
  const agents: AccessEntry[] = [
    ...mine.map((a) => ({ id: a.agentId, name: "Assistant", sub: "Yours, private to you", kind: "agent" as const, assistant: true })),
    ...rest.map((a) => ({ id: a.agentId, name: a.name, sub: a.role ?? (a.teammateOf !== undefined ? "Project teammate" : "Space agent"), kind: "agent" as const })),
  ];
  const outside: AccessEntry[] = i.connected.filter((c) => c.setup !== true).map((c) => ({ id: c.agentId, name: c.clientName, sub: c.redirectHost ?? "Outside agent", kind: "outside" as const }));
  // the few the person reaches for most: the two agents used last, and the first person
  const recent = [...rest].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)).slice(0, 2).map((a) => agents.find((e) => e.id === a.agentId) as AccessEntry);
  const suggested = [...recent, ...people.slice(0, 1)];
  return { suggested, people, agents, outside };
}

/** The person's own access to the target, as the most they can give: the sheet greys what they do not hold. Left out when unknown: nothing is greyed. */
export function maxLevelOf(allowed: Readonly<Record<"manage" | "edit" | "use", boolean>>): ShareLevel {
  return allowed.manage ? "manage" : allowed.edit ? "edit" : allowed.use ? "use" : "view";
}

/* ---------- picks to calls ---------- */

/** The four caller-side steps beyond addCalls: a project's new agent is made for the project, and an outside agent or a guest on a project go to the project's own chat. */
export interface ProjectExtras {
  /** agents.create with projectId, for each new agent picked on a project. */
  creates: { name: string; role?: string; model?: string; key: string }[];
  /** The picks that belong to the project's chat: outside agents and guests. */
  viaChat: AccessPick[];
}

export function projectExtras(unsupported: readonly AccessPick[], newKey: (p: AccessPick) => string): ProjectExtras {
  const creates = unsupported.filter((p) => p.kind === "new").map((p) => ({
    name: p.name,
    ...(p.brief !== undefined && p.brief.trim() !== "" ? { role: p.brief.trim() } : {}),
    ...(p.model !== undefined && p.model !== "" ? { model: p.model } : {}),
    key: newKey(p),
  }));
  return { creates, viaChat: unsupported.filter((p) => p.kind === "outside" || p.kind === "guest") };
}

/** "Docs and Sara were added", "Docs, Sara and Mira were added", "Docs was added": the line after the calls ran. */
export function addedLine(names: readonly string[]): string {
  if (names.length === 0) return "";
  return `${joinNames(names)} ${names.length === 1 ? "was" : "were"} added`;
}

/** What a call that ran is called for the line when some fail: the sheet closed, so the line says which did not go. */
export function failedLine(names: readonly string[]): string {
  return `Could not add ${joinNames(names)}. Try again.`;
}

export function titleOfTarget(kind: AddTarget["kind"], name: string): string {
  return kind === "channel" && !name.startsWith("#") ? `#${name}` : name;
}

/** The calls that change who is in, with the agent's id for the line (a call that is only settings adds nobody). */
export const addsSomeone = (c: AddCall): boolean => c.cap !== "threads.agent_settings.set";
