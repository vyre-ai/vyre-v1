// What can run (spec 4.14, 3.10): engine.models.list and engine.providers.list.
// Both read the person's connected providers (providers.list, which answers for the person the call acts for) and the Space's AI policy. A model or provider
// the policy or the open label forbids is still listed, greyed, with the reason, so the picker can say why. Nothing here holds a secret value.
// A subscription engine (Codex, Claude Code, Grok) lists what the vendor's own CLI offers that account, saved per account and refreshed when the menu opens (live-models.ts); an API key's
// models are the provider's own list (providers.test). Every row is named the way the vendor names it.
import { windowFor } from "../../../../agent/src/transcript/windows.ts";
import { actorOf, raise } from "../../projections.ts";
import { ensureRuntime } from "../../runtime.ts";
import { LIVE_DRIVERS, modelsFor, savedTested, saveTested } from "../../live-models.ts";
import type { LiveModel, ModelsState } from "../../live-models.ts";
import type { EngineCtx } from "../../projections.ts";
import { blockedBy, readPolicy } from "./config.ts";
import { modelLimits } from "../usage.ts";
import { cliSandboxGap } from "../../sandbox-default.ts";
import { engineHost } from "../../runtime.ts";
import type { Label, Policy } from "./config.ts";

interface ProviderRow {
  id: string; providerKey: string; name: string; connection: "subscription" | "api_key" | "local_model"; scope: "mine" | "shared"; handle?: string; itemId: string;
  engine: string; spaceMayUse: boolean; state: "ok" | "needs_sign_in" | "failing"; spaceKey?: boolean;
  /** Handles of sign-ins of the same account folded into this row. */
  aliases?: string[];
}

export const DRIVERS = ["anthropic", "openai", "openrouter", "google", "xai", "opencode_go", "local", "custom", "claude_code", "codex", "grok"] as const;
type Driver = (typeof DRIVERS)[number];
const DRIVER_SET: ReadonlySet<string> = new Set(DRIVERS);
const CLI: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);
const DRIVER_TITLE: Readonly<Record<Driver, string>> = {
  anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", xai: "xAI", opencode_go: "OpenCode Go", local: "A local model", custom: "A custom endpoint",
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
  return tail.split(/[-_]/).filter((p) => p !== "").map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ").replace(/(?<=\b\d{1,2}) (?=\d{1,2}\b)/g, ".");
}

interface ModelInfo {
  provider: string; model: string; title: string; driver: Driver; contextTokens?: number; allowed: boolean; reason?: "label_provider" | "policy_model" | "not_connected" | "usage_limit"; resetsAt?: number;
  /** The CLI's own name that resolves to this model today (Claude Code's opus): a pick saved as the alias is this row. */
  alias?: string; isDefault?: boolean; efforts?: string[]; defaultEffort?: string;
}
/** How fresh the subscription lists in this answer are: the menu says "Updated just now" or "Couldn't refresh, showing saved list" from it. Left out when no subscription engine is listed. */
interface ListState { source: "live" | "saved" | "shipped"; updatedAt?: number; refreshing: boolean; failed: boolean }

/** A menu's second call waits this long for the refresh its first call started. */
const WAIT_MS = 8_000;
/** "Updated just now" is a list fetched within this long. */
const JUST_NOW_MS = 60_000;

function listState(states: readonly ModelsState[], now: number): ListState | undefined {
  if (states.length === 0) return undefined;
  const failed = states.some((s) => s.failed), refreshing = states.some((s) => s.refreshing);
  const live = states.filter((s) => s.source === "live");
  if (live.length === 0) return { source: "shipped", refreshing, failed };
  const updatedAt = Math.min(...live.map((s) => s.updatedAt ?? 0));
  return { source: !failed && now - updatedAt <= JUST_NOW_MS ? "live" : "saved", ...(updatedAt > 0 ? { updatedAt } : {}), refreshing, failed };
}

/**
 * `probe: false` is the background read (memory learning after a turn): the saved or shipped lists only. It never asks a vendor and never starts a CLI, so it cannot change an account's
 * state; an API key with no saved list lists nothing here.
 */
export async function modelsList(ctx: EngineCtx, input: { accountRef?: string; threadId?: string; recordLabel?: Label; refresh?: boolean; wait?: boolean; probe?: boolean }): Promise<{ models: ModelInfo[]; listed?: ListState }> {
  const passive = input.probe === false;
  const [all, policy, tl] = await Promise.all([myProviders(ctx), readPolicy(ctx), threadLabel(ctx, input.threadId)]);
  const label = input.recordLabel ?? tl;
  // a pin that still names a folded handle reads the row that kept the account
  const chosen = input.accountRef === undefined ? all : all.filter((p) => (p.handle ?? p.itemId) === input.accountRef || (p.aliases ?? []).includes(input.accountRef as string));
  if (input.accountRef !== undefined && chosen.length === 0) raise(ctx, "validation.not_found", "There is no such account.", { accountRef: input.accountRef });
  const states: ModelsState[] = [];
  const live = new Map<string, LiveModel>();
  const subs = chosen.filter((p) => p.state === "ok" && p.connection === "subscription" && LIVE_DRIVERS.has(driverOf(p)));
  // the runtime's opener runs the engines; without a runtime (no host half) the saved and shipped lists answer
  if (subs.length > 0 && !passive) await ensureRuntime(ctx).catch(() => null);
  const found = await Promise.all(chosen.map(async (p) => {
    // A provider that is not signed in cannot list its models; it is shown as one greyed row so the person sees what to reconnect.
    if (p.state !== "ok") return { p, models: [] as string[] };
    if (subs.includes(p)) {
      const got = await modelsFor(ctx.db, { ref: p.handle ?? p.itemId, driver: driverOf(p) }, actorOf(ctx), passive ? { now: ctx.now, passive: true } : { now: ctx.now, ...(input.refresh === true ? { refresh: true } : {}), ...(input.wait === true ? { waitMs: WAIT_MS } : {}) });
      states.push(got.state);
      for (const m of got.models) live.set(`${p.providerKey}/${m.id}`, m);
      return { p, models: got.models.map((m) => m.id) };
    }
    try {
      // the Space AI key: no member may test it, so its models are the list the Vault keeps (asked again from the provider when it is old)
      if (p.spaceKey === true) return { p, models: ((await ctx.call("providers.space_key.get", {})) as { models?: string[] }).models ?? [] };
      if (passive) return { p, models: savedTested(ctx.db, p.handle ?? p.itemId) };
      const r = (await ctx.call("providers.test", { providerId: p.id })) as { ok: boolean; models: string[] };
      if (r.ok) saveTested(ctx.db, p.handle ?? p.itemId, driverOf(p), ctx.now(), r.models);
      return { p, models: r.ok ? r.models : [] };
    } catch (e) {
      ctx.log.warn("model list was not read", { provider: p.providerKey, error: e instanceof Error ? e.message : "unknown" });
      return { p, models: [] as string[] };
    }
  }));
  const byKey = new Map<string, ModelInfo>();
  for (const { p, models } of found) {
    // a model this account ran out of is listed greyed, with when it comes back when the provider said (engine.usage.get shows its meter full)
    const out = modelLimits(ctx.db, p.handle ?? p.itemId, ctx.now());
    for (const model of models) {
      const why = blockedBy(policy, { provider: p.providerKey, model, ...(label === undefined ? {} : { label }) });
      const spent = why === null ? out.get(model) : undefined;
      const lm = live.get(`${p.providerKey}/${model}`);
      // a pick saved as the alias (sonnet) ran out under that name: the row it resolves to is greyed too
      const spentAs = spent ?? (why === null && lm?.alias ? out.get(lm.alias) : undefined);
      const row: ModelInfo = {
        provider: p.providerKey, model, title: lm?.title ?? prettyModel(model), driver: driverOf(p), contextTokens: windowFor(model, p.providerKey), allowed: why === null && spentAs === undefined,
        ...(why !== null ? { reason: why } : spentAs ? { reason: "usage_limit" as const, ...(spentAs.resetsAt !== undefined ? { resetsAt: spentAs.resetsAt } : {}) } : {}),
        ...(lm?.alias ? { alias: lm.alias } : {}), ...(lm?.isDefault ? { isDefault: true } : {}), ...(lm?.efforts ? { efforts: lm.efforts } : {}), ...(lm?.defaultEffort ? { defaultEffort: lm.defaultEffort } : {}),
      };
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
  // a subscription engine's rows keep the vendor's order (its own menu's); the rest sort by name
  const order = new Map([...live.keys()].map((k, i) => [k, i]));
  const rank = (m: ModelInfo): number => order.get(`${m.provider}/${m.model}`) ?? Number.MAX_SAFE_INTEGER;
  const out = [...byKey.values()].sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.provider.localeCompare(b.provider) || rank(a) - rank(b) || a.model.localeCompare(b.model));
  const listed = listState(states, ctx.now());
  return { models: out, ...(listed ? { listed } : {}) };
}

interface ProviderOut { driver: Driver; kind: "api" | "cli"; title: string; connected: boolean; allowed: boolean; reason?: string }

function reasonText(why: "label_provider" | "policy_model", label: Label | undefined): string {
  return why === "label_provider" ? `${label ?? "This"} records may not go to this provider.` : "This Space's AI policy does not allow this provider.";
}

export async function providersList(ctx: EngineCtx, input: { threadId?: string }): Promise<{ providers: ProviderOut[] }> {
  const [all, policy, label] = await Promise.all([myProviders(ctx), readPolicy(ctx), threadLabel(ctx, input.threadId)]);
  const gap = sandboxGap();
  return { providers: DRIVERS.map((driver) => providerState(driver, all, policy, label, gap)) };
}

/** What a CLI account needs before it can run turns here, in one line with what to do, or null. The host's own sandbox plan, when it gave one, decides; otherwise this computer's (sandbox-default.ts). */
export const NEEDS_SANDBOX = "Needs a sandbox Vyre cannot set up on this computer yet. Use an API key for now.";
/** Windows without WSL: what turns it on. */
export const NEEDS_WSL = "Needs WSL: turn it on once (admin and a restart: wsl --install --no-distribution), or use an API key.";
function sandboxGap(): string | null {
  const h = engineHost();
  if (h?.sandbox) return null;
  if (cliSandboxGap() === null) return null;
  return process.platform === "win32" ? NEEDS_WSL : NEEDS_SANDBOX;
}

export function providerState(driver: Driver, all: readonly ProviderRow[], policy: Policy, label: Label | undefined, gap: string | null = null): ProviderOut {
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
  // a CLI engine this computer cannot sandbox never runs here: the account is listed with what it needs
  if (CLI.has(driver) && gap !== null) return { driver, kind: "cli", title: DRIVER_TITLE[driver], connected, allowed: false, reason: gap };
  return {
    driver, kind: CLI.has(driver) ? "cli" : "api", title: DRIVER_TITLE[driver], connected, allowed: why === null,
    ...(why === null ? {} : { reason: reasonText(why, label) }),
  };
}
