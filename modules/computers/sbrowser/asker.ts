// Which browser profile a turn of a shared agent uses (owner, 13 Nov 2026, P7 section 10 item 6: "uses only the sign-ins the asker may use"). The agent's own profile, as before, for the agent's owner and for a
// turn acting for nobody (so what was signed in before this rule is the owner's, found again after an update); a profile of its own for each other person who uses the agent, so person B's turn never browses
// as person A in a site A signed in to. The rule of who gets a place is lib/asker-place.ts, the terminal's too.
import { hasOwnPlace } from "../../../lib/asker-place.ts";
import type { CompCtx } from "../projections.ts";
import { agentInfo } from "./agentinfo.ts";
import { askerProfileId, profileIdOf } from "./policy.ts";

/**
 * The Personal root of the person's own Files (files.tree answers an agent working for a person with that person's own root), where what their turn of a shared agent produces is kept: their downloads and the
 * pictures of their browsing. Never the agent's shared folder. Null when it cannot be reached: nothing is kept then.
 */
export async function askerFolder(ctx: CompCtx): Promise<string | null> {
  try {
    const tree = (await ctx.call("files.tree", {})) as { roots?: Array<{ key?: string; folderId?: string }> };
    return tree.roots?.find((r) => r.key === "personal" && r.folderId)?.folderId ?? null;
  } catch {
    return null;
  }
}

/** The person whose own profile this agent turn uses, or undefined when it uses the agent's own. Facts that cannot be read leave the agent's own profile (nothing changes for it). */
export async function askerOfTurn(ctx: CompCtx): Promise<string | undefined> {
  if (ctx.principal.kind !== "agent" || ctx.actingFor === undefined) return undefined;
  const who = await agentInfo(ctx, ctx.principal.id);
  return hasOwnPlace(who, ctx.principal.id, ctx.actingFor) ? ctx.actingFor : undefined;
}

/** The browser profile of this agent turn, and the person it belongs to when it is not the agent's own. */
export async function profileOfTurn(ctx: CompCtx): Promise<{ profileId: string | null; asker?: string }> {
  const asker = await askerOfTurn(ctx);
  return asker === undefined
    ? { profileId: profileIdOf(ctx.principal.id) }
    : { profileId: askerProfileId(ctx.principal.id, asker), asker };
}
