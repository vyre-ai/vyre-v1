// models_for_helpers (owner, 4 Nov 2026): the catalogue an agent reads before it starts helpers: every AI account the person asking may use (their own, shared with them, the Space's), each with its provider, a
// label, and its models with what they can do, a cost tier and whether they are available now. It also says where a helper goes by default: inside the provider the parent runs on, a cheap model for reading,
// searching and checking, a strong one for reasoning, code and writing. Only accounts the asker may use are ever listed: the own-inference rule.
import { modelCaps, pick, tierFor, tierOf } from "../../../lib/model-tiers.ts";
import type { Tier } from "../../../lib/model-tiers.ts";
import { actorOf, ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const WORD: Readonly<Record<string, string>> = { anthropic: "Claude", openai: "OpenAI", google: "Gemini", xai: "Grok", openrouter: "OpenRouter", "opencode-go": "OpenCode Go", opencode_go: "OpenCode Go" };
export const providerWord = (p: string): string => WORD[p] ?? p;

export interface CatalogueModel { model: string; title?: string; tier: Tier; tools: boolean; vision: boolean; contextTokens?: number; available: boolean; why?: string }
export interface CatalogueAccount { ref: string; provider: string; label: string; mine: boolean; shared: boolean; spaceKey: boolean; models: CatalogueModel[] }

export async function helperModels(ctx: EngineCtx, input: { threadId?: string; agentId?: string }) {
  ensure(ctx.db);
  const accounts = ((await ctx.call("engine.accounts.list", {})) as { accounts: Row[] }).accounts.filter((a) => str(a["status"]) === "ok" || a["status"] === undefined);
  const out: CatalogueAccount[] = [];
  for (const a of accounts) {
    const ref = str(a["ref"]);
    let listed: Row[] = [];
    try { listed = ((await ctx.call("engine.models.list", { accountRef: ref, probe: false })) as { models: Row[] }).models; } catch { /* an account that cannot list has no models to offer */ }
    const names = listed.length > 0 ? listed : (Array.isArray(a["models"]) ? (a["models"] as unknown[]).map((m) => ({ model: String(m), allowed: true })) : []);
    const provider = str(a["provider"]);
    out.push({
      ref, provider, label: `${providerWord(provider)} · ${str(a["spaceKey"] === true ? "Space" : a["name"] ?? a["title"])}`.replace(/ · $/, ""), mine: a["mine"] === true, shared: a["mine"] !== true && a["spaceKey"] !== true, spaceKey: a["spaceKey"] === true,
      models: names.map((m) => {
        const model = str(m["model"]);
        return { model, ...(str(m["title"]) ? { title: str(m["title"]) } : {}), tier: tierOf(model), ...modelCaps(model), ...(typeof m["contextTokens"] === "number" ? { contextTokens: m["contextTokens"] as number } : {}), available: m["allowed"] !== false, ...(m["reason"] ? { why: str(m["reason"]) } : {}) };
      }).filter((m) => m.tools),
    });
  }
  // where the parent runs: its resolved account and model, else its own configuration
  let parent: { provider?: string; accountRef?: string; model?: string } = {};
  if (input.threadId && input.agentId) {
    try {
      const r = (await ctx.call("engine.account.resolve", { threadId: input.threadId, agentId: input.agentId, askerId: actorOf(ctx), dry: true })) as { accountRef?: string | null };
      const acct = out.find((x) => x.ref === r.accountRef);
      if (acct) parent = { provider: acct.provider, accountRef: acct.ref };
    } catch { /* the default then stays open to every account */ }
  }
  let policy: "same_provider" | "any" | "ask" = "same_provider";
  if (input.agentId) { try { const a = ((await ctx.call("agents.get", { agentId: input.agentId })) as { agent?: { helperModels?: string; model?: string } }).agent; if (a?.helperModels === "any" || a?.helperModels === "ask") policy = a.helperModels; if (a?.model) parent.model = a.model; } catch { /* the default policy stands */ } }
  const within = out.filter((x) => (policy === "same_provider" && parent.provider ? x.provider === parent.provider : true));
  const suggest = (job: "read" | "think", why: string) => {
    const account = within.find((x) => x.ref === parent.accountRef && x.models.some((m) => m.available)) ?? within.find((x) => x.models.some((m) => m.available));
    const model = account ? pick(account.models.filter((m) => m.available).map((m) => m.model), tierFor(job)) : undefined;
    return account && model ? { account: account.ref, accountLabel: account.label, model, why } : null;
  };
  return {
    accounts: out, parent, policy,
    suggest: { read: suggest("read", "cheap reader"), think: suggest("think", "strong for reasoning") },
    rule: policy === "ask" ? "Ask the person which model each helper should use before you start it."
      : policy === "any" ? "Stay in the parent's provider unless the person names another; match an account by provider and label, and a model by name. If it is unclear which account they mean, ask one short question with the choices."
      : "Stay inside the provider the parent runs on; pick a cheap model to read, search and check, a strong one to reason, write code and write. Another provider only when the person names it and says which account; if unclear, ask one short question with the choices.",
  };
}
