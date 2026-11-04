// The memory tools every model gets, the same everywhere (memory design, "Native for any model"): memory.remember saves a fact with its source, memory.forget closes facts by id. They are thin:
// the rules of where a fact lands and who may change it are memory.propose_fact's and memory.facts.remove's, so a model on an API key and a CLI agent over MCP end up in the same place.
import { factAccept, factsRemove, proposeFact } from "./facts.ts";
import { raise, actorOf } from "../projections.ts";
import { privateIntent } from "../place.ts";
import type { Layer, MemCtx } from "../projections.ts";

interface RememberIn { text: string; layer?: Layer; agentId?: string; projectId?: string; kind?: string; threadId?: string; sourceRef?: string }

export async function remember(ctx: MemCtx, input: RememberIn) {
  const sourceKind = input.threadId ? "chat" : "manual";
  // A model remembering for the person it works for saves into that person's memory of this agent (People/<person>/memory/<agent>): the agent is the one calling.
  const agentId = input.agentId ?? (ctx.principal.kind === "agent" ? ctx.principal.id : undefined);
  // when the person said this is for them only, it is theirs and stays in their own layer, whatever the model asked for and whatever kind of place this is: decided here, not left to the prompt
  let layer = input.layer;
  if (input.threadId && layer !== "person") {
    try {
      const me = actorOf(ctx);
      const said = (((await ctx.call("chat.messages.list", { threadId: input.threadId, limit: 8 })) as { messages?: Array<{ author?: { kind?: string; id?: string }; body?: string }> }).messages ?? [])
        .filter((m) => m.author?.kind === "person" && m.author.id === me).at(-1);
      if (privateIntent(`${said?.body ?? ""} ${input.text}`)) layer = "person";
    } catch { /* a chat that cannot be read gives no hint: the layer stays as asked */ }
  }
  const out = await proposeFact(ctx, {
    text: input.text, ...(layer ? { layer } : {}), ...(agentId ? { agentId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.kind ? { kind: input.kind } : {}), ...(input.threadId ? { threadId: input.threadId } : {}), sourceKind, sourceRef: input.sourceRef ?? input.threadId ?? "tool",
  });
  // Someone asked for this to be remembered: in the asker's own layer it is current at once. A shared layer keeps its own review rule.
  if (!out.merged && out.fact.layer === "person") {
    const accepted = await factAccept(ctx, { factId: out.fact.factId });
    return { fact: accepted.fact, merged: true };
  }
  return out;
}

export async function forget(ctx: MemCtx, input: { factIds: string[] }) {
  if (input.factIds.length === 0) raise(ctx, "validation.bad_input", "Name the facts to forget.");
  return factsRemove(ctx, { factIds: input.factIds });
}
