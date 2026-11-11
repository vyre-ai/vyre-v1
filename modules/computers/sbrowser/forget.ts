// An agent was deleted (agent.deleted: removed by a person, or a person's Assistant that went with them when they left the Space). Its Space browser profile holds its cookies and sign-ins; nothing of an agent
// that is gone should stay signed in anywhere, so the profile's folder is removed (SpaceBrowser.forget), its hold and its room on the host go too. An agent brought back from Trash starts with a fresh browser
// and signs in again: that is the safe default for sign-in data.
import { releaseRoom } from "../capacity.ts";
import type { CompCtx } from "../projections.ts";
import { dropHold } from "./hold.ts";
import { profileIdOf } from "./policy.ts";
import { spaceBrowser } from "./port.ts";

export async function forgetBrowserOf(ctx: CompCtx, agentId: unknown): Promise<boolean> {
  if (typeof agentId !== "string") return false;
  const id = profileIdOf(agentId);
  const sb = spaceBrowser();
  if (!id || !sb) return false;
  dropHold(ctx, id);
  releaseRoom(ctx, id);
  if (!(await sb.available().catch(() => false))) { ctx.log.warn("sbrowser: a deleted agent's browser profile could not be removed: the container runtime does not answer", { agentId: id }); return false; }
  try { await sb.forget(id); return true; } catch (e) {
    ctx.log.warn("sbrowser: a deleted agent's browser profile could not be removed", { agentId: id, reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
    return false;
  }
}
