// "Auto" is a promise that a model is chosen for the account: it never reaches a provider as an empty name (a fresh install's first "hello" failed with provider.bad_request, `model` must be a non-empty
// string, 5 Nov 2026). For an account that runs on an API driver and a chat whose model is Auto (unset, empty or "auto"), the turn opens on a concrete model: the account's own list (what it listed, what a
// test saved, what ships with Vyre) by the standard tier first, else the one pinned model of its provider. Nothing chosen at all stops the turn BEFORE any request with a plain sentence and the Model menu.
import { readFileSync } from "node:fs";
import { pick } from "../../lib/model-tiers.ts";
import type { OpenSession } from "../../agent/src/turn-engine/types.ts";

/** The drivers that call a vendor's HTTP API with a model name. The CLI engines (Claude Code, Codex, Grok) have a default of their own and are left alone. */
export const API_DRIVERS: ReadonlySet<string> = new Set(["anthropic", "openai", "openrouter", "google", "xai", "opencode_go", "custom", "local"]);

const json = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;

/**
 * The model a provider falls back to when its own list cannot be read (a stale list, a refresh that failed, an empty catalog). Only names this release ships are used, from the catalogs the rest of Vyre
 * reads: Anthropic's from the prices table, OpenCode Go's from its provider entry in the Vault. A provider the release names no model for (OpenAI, xAI, Google, OpenRouter, a custom endpoint) has no
 * pin: nothing is guessed, and the turn asks the person to pick a model.
 */
export const PINNED_MODEL: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(([
  // Anthropic's everyday model by its id, when the table names it (Auto is the sensible default, not the dearest); a table without it leaves Anthropic unpinned and the person is asked
  ["anthropic", Object.keys(json<{ providers: { anthropic?: Record<string, unknown> } }>("./prices.json").providers.anthropic ?? {}).find((m) => m === "claude-sonnet-5-5")],
  ["opencode_go", pick(json<{ models?: string[] }>("../vault/providers/opencode-go.json").models ?? [], "standard")],
] as Array<[string, string | undefined]>).filter((e): e is [string, string] => e[1] !== undefined)));

/** Is the chat's model "Auto": nothing named, or the word itself. */
export const isAuto = (model: string | undefined | null): boolean => model === undefined || model === null || model.trim() === "" || model.trim().toLowerCase() === "auto";

/** The model Auto runs on: the account's allowed models by the standard tier, else the provider's pinned one, else nothing. Pure. */
export function chooseAuto(account: { driver: string; provider: string }, listed: readonly string[]): string | undefined {
  const usable = listed.filter((m) => typeof m === "string" && m.trim() !== "" && m.trim().toLowerCase() !== "auto");
  const found = pick(usable, "standard");
  return found ?? PINNED_MODEL[account.driver] ?? PINNED_MODEL[account.provider.replace(/-/g, "_")];
}

export const NO_MODEL_PICKED = "engine.no_model_picked";
export const pickWords = (account: string): string => `Pick a model for ${account}.`;

/** The opener, wrapped: an API account on Auto gets its concrete model, or the turn ends with NO_MODEL_PICKED before anything is sent. */
export function withConcreteModel(open: OpenSession, d: { models(ref: string, payer: string): Promise<string[]> }): OpenSession {
  return async (spec) => {
    const account = spec.account;
    if (!account || !API_DRIVERS.has(account.driver) || !isAuto(spec.agent.model)) return open(spec);
    let listed: string[] = [];
    try { listed = await d.models(account.ref, account.payer); } catch { listed = []; }   // a list that cannot be read is the pinned model, not a failed turn
    const model = chooseAuto(account, listed);
    if (model === undefined) throw Object.assign(new Error(pickWords(account.name ?? account.ref)), { code: NO_MODEL_PICKED });
    return open({ ...spec, agent: { ...spec.agent, model } });
  };
}
