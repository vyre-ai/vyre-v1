// engine.models_catalog (for helpers that pick models across accounts): every account the asker can use with its models, what each can do, a cost tier, and availability from the probe.
import test from "node:test";
import assert from "node:assert/strict";
import { abilities, costTier, modelsCatalog } from "../handlers/extra/models.ts";
import { markConfirmed, markUnavailable, resetProbes } from "../model-health.ts";
import { saveTested, bindModelLister, resetLiveModels } from "../live-models.ts";
import { bindCompleter } from "../runtime.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const API = { id: "prv_o", providerKey: "opencode_go", name: "OpenCode", connection: "api_key", scope: "mine", spaceMayUse: false, state: "ok", engine: "opencode-go", handle: "#Dana_Opencode", itemId: "vit_o" };
const ANTHROPIC = { id: "prv_a", providerKey: "anthropic", name: "Anthropic key", connection: "api_key", scope: "mine", spaceMayUse: false, state: "ok", engine: "anthropic", handle: "#Dana_Anthropic", itemId: "vit_a" };
const OUT = { id: "prv_x", providerKey: "openai", name: "OpenAI", connection: "api_key", scope: "mine", spaceMayUse: false, state: "needs_sign_in", engine: "openai", handle: "#Dana_OpenAI", itemId: "vit_x" };
const CODEX = { id: "prv_c", providerKey: "codex", name: "Codex", connection: "subscription", scope: "mine", spaceMayUse: false, state: "ok", engine: "codex", handle: "#Dana_Codex", itemId: "vit_c" };

test("cost tiers come from the list price when Vyre has one, else from the name, and an unknown name is standard", () => {
  assert.equal(costTier("claude-fable-5-1", "anthropic"), "strong");
  assert.equal(costTier("claude-opus-5-5", "anthropic"), "standard");
  assert.equal(costTier("claude-sonnet-5-5", "anthropic"), "standard");
  assert.equal(costTier("claude-haiku-5-5", "claude-code"), "cheap");
  assert.equal(costTier("gpt-6-mini", "openai"), "cheap");
  assert.equal(costTier("gemini-3-flash", "google"), "cheap");
  assert.equal(costTier("beam-free", "opencode_go"), "cheap");
  assert.equal(costTier("some-opus-pro", "openrouter"), "strong");
  assert.equal(costTier("glm-5.3", "opencode_go"), "standard");
});

test("abilities by family: hosted families call tools and read images; an embedding model calls nothing; a local model is taken to call tools and not to see", () => {
  assert.deepEqual(abilities("claude-sonnet-5-5", "anthropic"), { tools: true, vision: true });
  assert.deepEqual(abilities("text-embedding-4", "openai"), { tools: false, vision: false });
  assert.deepEqual(abilities("llama-7b", "local"), { tools: true, vision: false });
});

test("the catalog lists each usable account with its models, tier, context and availability from the probe; a signed-out account is listed as not usable", async () => {
  resetLiveModels(); resetProbes();
  const h = harness();
  const ctx: EngineCtx = { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "providers.list" ? { providers: [API, ANTHROPIC, OUT] } : h.ctx.call(cap, input)) };
  saveTested(ctx.db, "#Dana_Opencode", "opencode_go", ctx.now(), ["beam-free", "glm-5.3", "kimi-k3"]);
  saveTested(ctx.db, "#Dana_Anthropic", "anthropic", ctx.now(), ["claude-sonnet-5-5", "claude-haiku-5-5"]);
  markUnavailable(ctx.db, "#Dana_Opencode", "beam-free", ctx.now());
  markConfirmed(ctx.db, "#Dana_Opencode", "glm-5.3", ctx.now());
  markConfirmed(ctx.db, "#Dana_Anthropic", "claude-sonnet-5-5", ctx.now());
  const out = await modelsCatalog(ctx, {});
  assert.deepEqual(contractErrors("engine.models_catalog", "out", out), []);
  const by = (ref: string) => out.accounts.find((a) => a.ref === ref)!;
  assert.deepEqual(by("#Dana_Opencode").models.map((m) => [m.id, m.available, m.tier]), [["beam-free", "unavailable", "cheap"], ["glm-5.3", "ok", "standard"], ["kimi-k3", "unverified", "standard"]]);
  assert.equal(by("#Dana_Opencode").usable, true, "two of its models can answer");
  assert.deepEqual(by("#Dana_Anthropic").models.map((m) => [m.id, m.available, m.tier, m.vision, m.context]), [["claude-sonnet-5-5", "ok", "standard", true, 200_000], ["claude-haiku-5-5", "unverified", "cheap", true, 200_000]]);
  assert.deepEqual([by("#Dana_OpenAI").usable, by("#Dana_OpenAI").why, by("#Dana_OpenAI").models], [false, "Sign in again", []]);
  assert.deepEqual(by("#Dana_Anthropic").kind, "api_key");
  assert.equal((await modelsCatalog(ctx, { accountRef: "#Dana_Anthropic" })).accounts.length, 1);
});

test("while the probe runs, a model not yet confirmed reads checking; a CLI sign-in's own list reads ok", async () => {
  resetLiveModels(); resetProbes();
  bindCompleter(async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }));
  bindModelLister(async () => [{ id: "gpt-7-nova", title: "GPT-7-Nova" }]);
  try {
    const h = harness();
    const ctx: EngineCtx = { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "providers.list" ? { providers: [API, CODEX] } : h.ctx.call(cap, input)) };
    saveTested(ctx.db, "#Dana_Opencode", "opencode_go", ctx.now(), ["glm-5.3"]);
    const out = await modelsCatalog(ctx, {});
    assert.deepEqual(out.accounts.find((a) => a.ref === "#Dana_Opencode")!.models.map((m) => m.available), ["checking"]);
    const codex = out.accounts.find((a) => a.ref === "#Dana_Codex")!;
    assert.equal(codex.kind, "subscription");
    assert.ok(codex.models.length > 0, "the shipped list answers before any refresh");
    assert.equal(codex.models.every((m) => m.available === "checking" || m.available === "ok"), true);
  } finally { bindCompleter(null); bindModelLister(null); resetProbes(); resetLiveModels(); }
});
