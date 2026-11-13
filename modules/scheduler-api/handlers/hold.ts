// scheduler.can_hold: may a person hold scheduled work for an agent, and read the channel it posts to? One answer for every hand-over (P1 contract, "Who may call what"): a routine given to someone
// who is not in the Space, cannot use the agent or cannot read the channel would run on an account that may not do what the routine does.
// The person is judged by their OWN grants (ctx.mayAll, never the caller's); the caller only has to be a member.
import { raise } from "../projections.ts";
import type { SchedCtx } from "../projections.ts";

export type HoldReason = "not_in_space" | "cannot_use_agent" | "cannot_read_channel" | "agent_missing";
type In = { person: string; agentId: string; channelId?: string };
interface AgentRow {
  kind?: string;
  runtime?: string;
  ownerId?: string;
}

export async function canHold(ctx: SchedCtx, input: In): Promise<{ ok: boolean; reasons: HoldReason[] }> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "This server cannot check who may hold work for an agent.");
  const call = ctx.call.bind(ctx);
  const reasons: HoldReason[] = [];
  const person = await call("access.principals.get", { principal: { kind: "person", id: input.person } }).then(
    (r) => (r as { principal?: { status?: string } } | null)?.principal,
    () => undefined,
  );
  if (!person || person.status === "removed") reasons.push("not_in_space");
  const agent = await call("agents.get", { agentId: input.agentId }).then(
    (r) => (r as { agent?: AgentRow } | null)?.agent,
    () => undefined,
  );
  if (!agent) reasons.push("agent_missing");
  if (reasons.includes("not_in_space")) return { ok: false, reasons };
  const may = (level: "use" | "view", type: "agent" | "channel", id: string): boolean =>
    ctx.mayAll ? ctx.mayAll([input.person], { perm: null, level }, { type, id }) : true;
  if (agent) {
    // an outside agent takes work from its owner only, and a person's Assistant is theirs alone; any other agent needs Can use
    const own = agent.ownerId === input.person;
    const mine = agent.runtime === "outside" || agent.kind === "assistant";
    if (mine ? !own : !own && !may("use", "agent", input.agentId)) reasons.push("cannot_use_agent");
  }
  if (input.channelId !== undefined && !may("view", "channel", input.channelId)) reasons.push("cannot_read_channel");
  return { ok: reasons.length === 0, reasons };
}
