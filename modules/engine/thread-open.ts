// The one way an engine thread is built from the chat's record, whoever opens it first: the bridge for a new message, or control.ts open() for boot recovery, a control call, a routine, a task.
// Before 12 Nov 2026 the two built different threads, and whichever came first won ("already open"): after a restart in the middle of a tool call, recovery opened the chat with no model on its
// agent, no name, no listening settings, no outside flag and no task lead, and every later turn of the chat went out with model "" (release gate).
//   model      the chat's saved pick (engine_agent_state), else the chat record's, else the agent's own (agents.get); an empty string is no model. With none, the turn's resolver still chooses one.
//   mode       the saved mode, else the record's.
//   account    the saved account, else the record's.
//   outside    an agent that runs outside (agents.get runtime outside) is asked, never run here.
//   task lead  a task's thread with several agents and no lead: the one that works the task, else the one that made it, answers without an @.
//   personal   a task, note or goal thread.
import type { EngineAgent, OpenThread, ThreadKind } from "../../agent/src/turn-engine/types.ts";

export type RosterAgent = {
  agentId: string; name?: string; mode: "lead" | "listen"; model?: string; accountRef?: string; watches?: unknown; quiet?: boolean; when?: "always" | "topics" | "hours"; topics?: string;
  hoursFrom?: string; hoursTo?: string; style?: "short" | "full";
};
export type ThreadGet = { thread: { kind?: string; scopeType?: string; scopeId?: string; starter?: string; members?: Array<{ kind?: string; id: string }>; agents: RosterAgent[] } };
export type Saved = { mode: string | null; model: string | null; accountRef: string | null } | null;
type Read = (cap: string, input: unknown) => Promise<unknown>;

export const peopleOf = (g: ThreadGet): string[] | undefined => (g.thread.members ? g.thread.members.filter((x) => (x.kind ?? "person") === "person").map((x) => x.id) : undefined);
/** How and when an agent answers in this chat, as the chat holds it, for the engine's routing and for the turn. */
export const settingsOf = (a: RosterAgent): Pick<EngineAgent, "quiet" | "when" | "topics" | "hoursFrom" | "hoursTo" | "style"> => ({
  ...(a.quiet === true ? { quiet: true as const } : {}), ...(a.when && a.when !== "always" ? { when: a.when } : {}), ...(a.topics ? { topics: a.topics } : {}),
  ...(a.hoursFrom ? { hoursFrom: a.hoursFrom } : {}), ...(a.hoursTo ? { hoursTo: a.hoursTo } : {}), ...(a.style ? { style: a.style } : {}),
} as Pick<EngineAgent, "quiet" | "when" | "topics" | "hoursFrom" | "hoursTo" | "style">);

/** The engine thread for a chat record. `read` reads as whoever may (the bridge: the message's person; recovery: the person whose work is queued); `agentInfo` reads agents.get. */
export async function engineThreadOf(o: {
  threadId: string; got: ThreadGet; read: Read; agentInfo: (agentId: string) => Promise<{ model?: string; runtime?: string } | null>; saved?: (agentId: string) => Saved; starter?: string; kind?: ThreadKind;
}): Promise<OpenThread> {
  const { got } = o;
  const own = new Map<string, string>();
  const outside = new Set<string>();
  for (const a of got.thread.agents) {
    const info = await o.agentInfo(a.agentId).catch(() => null);
    if (info?.runtime === "outside") { outside.add(a.agentId); continue; }
    if (info?.model) own.set(a.agentId, info.model);
  }
  let taskLead: string | undefined;
  if (got.thread.scopeType === "task" && !got.thread.agents.some((a) => a.mode === "lead") && got.thread.agents.length > 1) {
    try {
      const t = ((await o.read("tasks.get", { taskId: got.thread.scopeId })) as { task?: { assigned?: { kind?: string; id?: string }; createdBy?: string } } | null)?.task;
      const ids = new Set(got.thread.agents.map((a) => a.agentId));
      taskLead = [t?.assigned?.kind === "agent" ? t.assigned.id : undefined, t?.createdBy].find((x): x is string => typeof x === "string" && ids.has(x));
    } catch { /* no task to read: the agents listen as before */ }
  }
  const agents: EngineAgent[] = got.thread.agents.map((a) => {
    const s = o.saved?.(a.agentId) ?? null;
    const mode = (s?.mode || a.mode) === "lead" ? "lead" : "listen";
    const model = s?.model || a.model || own.get(a.agentId) || undefined;
    const accountRef = s?.accountRef || a.accountRef || undefined;
    return {
      id: a.agentId, ...(a.name ? { name: a.name } : {}), mode, ...(taskLead === a.agentId ? { taskLead: true as const } : {}), ...(model ? { model } : {}), ...(accountRef ? { accountRef } : {}),
      ...(a.watches !== undefined && a.watches !== false ? { watching: true } : {}), ...(outside.has(a.agentId) ? { outside: true } : {}), ...settingsOf(a),
    } as EngineAgent;
  });
  // Two leads in one thread would break the unique lead rule; the saved mode wins for the agent that was set last, so demote extras.
  let leadSeen = false;
  for (const a of agents) { if (a.mode === "lead") { if (leadSeen) a.mode = "listen"; leadSeen = true; } }
  const people = peopleOf(got);
  return {
    id: o.threadId, kind: o.kind ?? ((got.thread.kind ?? "chat") as ThreadKind), starter: got.thread.starter ?? o.starter ?? "", agents,
    ...(["task", "note", "goal"].includes(got.thread.scopeType ?? "") ? { personal: true } : {}), ...(people ? { people } : {}),
  };
}
