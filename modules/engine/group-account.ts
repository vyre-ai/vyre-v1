// Group setup checks a usable account first (DESIGN-chat-system, Who pays): each turn in a group runs on the account of the person who asked, so someone with no account learns it only when an agent fails to answer them.
// When a person or an agent joins a group, anyone an agent there could not answer is named in one line. Nothing is refused: they can still read and talk to the people there, and a line appears once.
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { AgentPost } from "./handlers/bridge.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
export interface GroupAccountDeps { call: Call; postAs?: (agentId: string, post: AgentPost) => Promise<unknown>; log?: (msg: string, attrs?: Record<string, unknown>) => void }
interface ThreadOut { thread: { starter?: string; members: Array<{ kind: string; id: string }>; agents: Array<{ agentId: string }> } }
interface ResolveOut { allowed?: boolean; accountRef?: string | null }

export const NO_ACCOUNT_LINE = (name: string): string => `${name} has no AI account here yet, so the agents in this chat cannot answer them until one is connected.`;

/** The people in a group no agent there could run a turn for. An answer that could not be read counts as fine: the line is a warning, and a false one is worse than none. */
async function withoutAccount(d: GroupAccountDeps, threadId: string, agents: readonly string[], people: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const person of people) {
    const can = await Promise.all(agents.map((agentId) => d.call("engine.account.resolve", { threadId, agentId, askerId: person }, person).then((r) => {
      const res = r as ResolveOut;
      return res.allowed === true && Boolean(res.accountRef);
    }, () => true)));
    if (!can.some(Boolean)) out.push(person);
  }
  return out;
}

/** `people` is who just joined; absent, everyone in the group (an agent just joined). Answers who was named. */
export async function checkGroupAccount(d: GroupAccountDeps, threadId: string, people?: readonly string[]): Promise<string[]> {
  const got = (await d.call("threads.get", { threadId })) as ThreadOut;
  const everyone = got.thread.members.filter((m) => m.kind === "person").map((m) => m.id);
  const agents = got.thread.agents.map((a) => a.agentId);
  if (everyone.length < 2 || agents.length === 0 || !d.postAs) return [];
  const missing = await withoutAccount(d, threadId, agents, people ?? everyone);
  if (missing.length === 0) return [];
  const list = (await d.call("access.principals.list", { limit: 500 }).catch(() => null)) as { principals?: Array<{ id: string; name?: string }> } | null;
  const nameOf = (id: string): string => list?.principals?.find((p) => p.id === id)?.name?.split(" ")[0] || "This person";
  for (const person of missing) {
    // the same id for the same person in the same chat, so a replay or a second agent joining says it once
    const clientId = BRIDGE_PREFIX + (await sha256Hex(`group-account|${threadId}|${person}`)).slice(0, 24);
    const actingFor = got.thread.starter ?? person;
    try { await d.postAs(agents[0]!, { actingFor, threadId, body: "", mentions: [], clientId, blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: NO_ACCOUNT_LINE(nameOf(person)) } }] }); }
    catch (e) { d.log?.("the group's account check could not be shown in the chat", { threadId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return missing;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
