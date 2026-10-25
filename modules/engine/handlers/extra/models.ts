// What can run (spec 4.14, 3.10): engine.models.list and engine.providers.list.
// Both read the person's connected providers (providers.list, which answers for the person the call acts for) and the Space's AI policy. A model or provider
// the policy or the open label forbids is still listed, greyed, with the reason, so the picker can say why. Nothing here holds a secret value.
import { raise } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { blockedBy, readPolicy } from "./config.ts";
import type { Label, Policy } from "./config.ts";

interface ProviderRow {
  id: string; providerKey: string; name: string; connection: "subscription" | "api_key" | "local_model"; scope: "mine" | "shared"; handle?: string; itemId: string;
  engine: string; spaceMayUse: boolean; state: "ok" | "needs_sign_in" | "failing";
}

export const DRIVERS = ["anthropic", "openai", "openrouter", "google", "xai", "opencode_go", "local", "claude_code", "codex", "grok"] as const;
type Driver = (typeof DRIVERS)[number];
const DRIVER_SET: ReadonlySet<string> = new Set(DRIVERS);
const CLI: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);
const DRIVER_TITLE: Readonly<Record<Driver, string>> = {
  anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", xai: "xAI", opencode_go: "OpenCode Go", local: "A local model",
  claude_code: "Claude Code", codex: "Codex", grok: "Grok",
};
const LABEL_WORDS: ReadonlySet<string> = new Set(["public", "internal", "confidential", "restricted"]);

/** The driver that serves a provider row: its engine when that is one we ship, else local for a local model, else the provider key, else OpenRouter. */
export function driverOf(p: Pick<ProviderRow, "engine" | "connection" | "providerKey">): Driver {
  const e = p.engine.replace(/-/g, "_");
  if (DRIVER_SET.has(e)) return e as Driver;
  if (p.connection === "local_model") return "local";
  return DRIVER_SET.has(p.providerKey) ? (p.providerKey as Driver) : "openrouter";
}

async function myProviders(ctx: EngineCtx): Promise<ProviderRow[]> {
  const out = (await ctx.call("providers.list", {})) as { providers: ProviderRow[] };
  return out.providers;
}

/** The label of the open thread, when threads.get says one. Without a thread or a label, only the Space policy applies. */
async function threadLabel(ctx: EngineCtx, threadId: string | undefined): Promise<Label | undefined> {
  if (threadId === undefined) return undefined;
  try {
    const out = (await ctx.call("threads.get", { threadId })) as { thread?: { label?: unknown } };
    const l = out.thread?.label;
    return typeof l === "string" && LABEL_WORDS.has(l) ? (l as Label) : undefined;
  } catch {
    raise(ctx, "validation.not_found", "There is no such conversation.", { threadId });
  }
}

function prettyModel(model: string): string {
  const tail = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return tail.split(/[-_]/).filter((p) => p !== "").map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

interface ModelInfo {
  provider: string; model: string; title: string; driver: Driver; allowed: boolean; reason?: "label_provider" | "policy_model" | "not_connected";
}

export async function modelsList(ctx: EngineCtx, input: { accountRef?: string; threadId?: string; recordLabel?: Label }): Promise<{ models: ModelInfo[] }> {
  const [all, policy, tl] = await Promise.all([myProviders(ctx), readPolicy(ctx), threadLabel(ctx, input.threadId)]);
  const label = input.recordLabel ?? tl;
  const chosen = input.accountRef === undefined ? all : all.filter((p) => (p.handle ?? p.itemId) === input.accountRef);
  if (input.accountRef !== undefined && chosen.length === 0) raise(ctx, "validation.not_found", "There is no such account.", { accountRef: input.accountRef });
  const found = await Promise.all(chosen.map(async (p) => {
    // A provider that is not signed in cannot list its models; it is shown as one greyed row so the person sees what to reconnect.
    if (p.state !== "ok") return { p, models: [] as string[] };
    try {
      const r = (await ctx.call("providers.test", { providerId: p.id })) as { ok: boolean; models: string[] };
      return { p, models: r.ok ? r.models : [] };
    } catch (e) {
      ctx.log.warn("model list was not read", { provider: p.providerKey, error: e instanceof Error ? e.message : "unknown" });
      return { p, models: [] as string[] };
    }
  }));
  const byKey = new Map<string, ModelInfo>();
  for (const { p, models } of found) {
    for (const model of models) {
      const why = blockedBy(policy, { provider: p.providerKey, model, ...(label === undefined ? {} : { label }) });
      const row: ModelInfo = { provider: p.providerKey, model, title: prettyModel(model), driver: driverOf(p), allowed: why === null, ...(why === null ? {} : { reason: why }) };
      const key = `${row.provider}/${row.model}`;
      const had = byKey.get(key);
      if (!had || (!had.allowed && row.allowed)) byKey.set(key, row);
    }
  }
  // Signed-out providers: one greyed row each, with the model unknown, so the picker can offer "Sign in again".
  for (const { p, models } of found) {
    if (p.state !== "ok" && models.length === 0) {
      byKey.set(`${p.providerKey}/-`, { provider: p.providerKey, model: p.providerKey, title: p.name, driver: driverOf(p), allowed: false, reason: "not_connected" });
    }
  }
  const out = [...byKey.values()].sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  return { models: out };
}

interface ProviderOut { driver: Driver; kind: "api" | "cli"; title: string; connected: boolean; allowed: boolean; reason?: string }

function reasonText(why: "label_provider" | "policy_model", label: Label | undefined): string {
  return why === "label_provider" ? `${label ?? "This"} records may not go to this provider.` : "This Space's AI policy does not allow this provider.";
}

export async function providersList(ctx: EngineCtx, input: { threadId?: string }): Promise<{ providers: ProviderOut[] }> {
  const [all, policy, label] = await Promise.all([myProviders(ctx), readPolicy(ctx), threadLabel(ctx, input.threadId)]);
  return { providers: DRIVERS.map((driver) => providerState(driver, all, policy, label)) };
}

function providerState(driver: Driver, all: readonly ProviderRow[], policy: Policy, label: Label | undefined): ProviderOut {
  const mine = all.filter((p) => driverOf(p) === driver);
  const connected = mine.some((p) => p.state === "ok");
  // The policy names providers by key (anthropic, openai); a CLI engine is allowed when its own name or its provider key is.
  const keys = [driver, ...mine.map((p) => p.providerKey)];
  let why: "label_provider" | "policy_model" | null = null;
  for (const k of keys) {
    const w = blockedBy(policy, { provider: k, ...(label === undefined ? {} : { label }) });
    if (w === null) { why = null; break; }
    why = w;
  }
  return {
    driver, kind: CLI.has(driver) ? "cli" : "api", title: DRIVER_TITLE[driver], connected, allowed: why === null,
    ...(why === null ? {} : { reason: reasonText(why, label) }),
  };
}
