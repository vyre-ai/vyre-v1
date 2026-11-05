// A team chat, a wake of one, or agent work whose model no Space AI account serves (owner ruling 9, 3 Nov): the resolver picks the cheapest Space account that covers the turn anyway, and the turn
// runs on that account's default model (space-key-turns.ts opens it so). The chat says so in one quiet line, once per chat, agent and swap: "Ran on GLM 5.3; Claude isn't on the team key."
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

/** A model as a person says it: claude-sonnet-5-5 is Claude Sonnet 5.5. */
export function modelName(id: string): string {
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (c) return `Claude ${c[1]!.charAt(0).toUpperCase()}${c[1]!.slice(1)} ${c[2]}${c[3] ? `.${c[3]}` : ""}`;
  const g = /^gpt-([\d.]+)(?:-([a-z]+))?$/.exec(id);
  return g ? `GPT-${g[1]}${g[2] ? ` ${g[2]!.charAt(0).toUpperCase()}${g[2]!.slice(1)}` : ""}` : modelWords(id);
}

/** The line for a turn whose picked model no account that can pay serves: it says so and names what can run. It never runs another model in its place. */
export function noModelWords(model: string | null, served: readonly string[]): string {
  const what = model ? modelName(model) : "That model";
  const list = served.slice(0, 6).map(modelName);
  return `${what} cannot run here: none of the AI accounts you can use on this server serve it.${list.length > 0 ? ` Models that can: ${list.join(", ")}.` : ""} Pick another model, or run this chat on the computer where your own sign-in is.`;
}

/** The chat's line for a swap. */
export function fallbackLine(f: { from: string; to?: string }): string {
  const asked = modelName(f.from);
  return f.to ? `${asked} isn't available here, ran ${modelName(f.to)}.` : `${asked} isn't available here, ran the key's own model.`;
}

export function noteModelFallback(d: { postAs?: PostAs; log?: (msg: string, attrs?: Record<string, unknown>) => void }): (q: { threadId: string; agentId: string; askerId: string }, f: { from: string; to?: string }) => Promise<void> {
  const said = new Set<string>();
  return async (q, f) => {
    const key = `${q.threadId}|${q.agentId}|${f.from}|${f.to ?? ""}`;
    if (!d.postAs || said.has(key)) return;
    said.add(key);
    try {
      await d.postAs(q.agentId, { actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: fallbackLine(f) } }] });
    } catch (e) { d.log?.("the model swap could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
  };
}
