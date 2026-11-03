// A team chat, a wake of one, or agent work whose model no Space AI account serves (owner ruling 9, 3 Nov): the resolver picks the cheapest Space account that covers the turn anyway, and the turn
// runs on that account's default model (space-key-turns.ts opens it so). The chat says so in one quiet line, once per chat, agent and swap: "Ran on GLM 5.3; Claude isn't on the team key."
import type { AccountQuery, ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import { providerOfModel } from "../../agent/src/accounts/provider.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { mintId } from "./projections.ts";

const MAKER: Readonly<Record<string, string>> = { anthropic: "Claude", openai: "GPT", google: "Gemini", xai: "Grok" };

/** "glm-5.3" reads "GLM 5.3", "kimi-k3" reads "Kimi K3": a model's name as a person says it. */
export function modelWords(model: string): string {
  const tail = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return tail.split(/[-_]/).filter((p) => p !== "").map((p) => (/^[a-z]{2,4}$/.test(p) && !/[aeiou]/.test(p.slice(1)) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

/** The chat's line for a swap. */
export function fallbackLine(f: { from: string; to?: string }): string {
  const asked = MAKER[providerOfModel(f.from) ?? ""] ?? modelWords(f.from);
  return f.to ? `Ran on ${modelWords(f.to)}; ${asked} isn't on the team key.` : `Ran on the team key's own model; ${asked} isn't on it.`;
}

export function noteModelFallback(d: { resolve(q: AccountQuery): Promise<ResolvedAccount | null>; postAs?: PostAs; log?: (msg: string, attrs?: Record<string, unknown>) => void }): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  const said = new Set<string>();
  return async (q) => {
    const got = await d.resolve(q);
    const f = got?.modelFallback;
    if (!got || !f) return got;
    const key = `${q.threadId}|${q.agentId}|${f.from}|${f.to ?? ""}`;
    if (d.postAs && !said.has(key)) {
      said.add(key);
      try {
        await d.postAs(q.agentId, { actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: fallbackLine(f) } }] });
      } catch (e) { d.log?.("the model swap could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
    }
    return got;
  };
}
