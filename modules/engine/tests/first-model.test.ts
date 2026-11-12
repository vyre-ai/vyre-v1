// The first-hour default model (lead, 12 Nov 2026): a turn that names no model (no chat pick, no thread record, no agent model) on a person's API key runs on a chat model that key lists,
// picked without spending a completion: chat models only, a model already run on this account first, then the provider's balanced tier (in the vendor's order where that order means newest first, as Anthropic's; else newest first by name), then the vendor's order; never a
// pro, preview, audio, realtime, search, transcribe or image model unless nothing else passes; and only what the Space's AI policy allows. Never for a subscription or OpenRouter.
import test from "node:test";
import assert from "node:assert/strict";
import { BALANCED_TIER, afterDefaultTurn, defaultModelFor, pickDefault } from "../first-model.ts";
import { confirmedFor, markConfirmed, markRan, ranFor, unavailableFor } from "../model-health.ts";
import { harness } from "../fixtures/harness.ts";

const none = new Set<string>();
const open = (): boolean => false;

test("OpenAI: image, speech and embedding models are not chat models; with no balanced flagship listed, the vendor's first chat model", () => {
  assert.equal(pickDefault(["dall-e-3", "whisper-1", "text-embedding-3-small", "gpt-4o-mini"], { provider: "openai", confirmed: none, blocked: open }), "gpt-4o-mini");
});

test("OpenAI: the plain flagship, newest first; not pro, not mini", () => {
  assert.equal(pickDefault(["dall-e-3", "o3-pro", "gpt-5-mini", "gpt-5", "gpt-4.1", "whisper-1"], { provider: "openai", confirmed: none, blocked: open }), "gpt-5");
});

test("Anthropic: Sonnet, newest first", () => {
  assert.equal(pickDefault(["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-4-5"], { provider: "anthropic", confirmed: none, blocked: open }), "claude-sonnet-5-5");
});

test("a provider with no balanced-tier entry takes the first chat model in the vendor's order", () => {
  assert.equal(pickDefault(["deepseek-chat", "deepseek-reasoner"], { provider: "deepseek", confirmed: none, blocked: open }), "deepseek-chat");
});

test("a model the person already ran on this account wins over the table", () => {
  assert.equal(pickDefault(["claude-opus-5-5", "claude-sonnet-5-5"], { provider: "anthropic", confirmed: new Set(["claude-opus-5-5"]), blocked: open }), "claude-opus-5-5");
});

test("the Space's policy: a blocked table pick gives the next allowed one; allowing only the second chat model picks it; allowing none gives none", () => {
  assert.equal(pickDefault(["gpt-5", "gpt-4.1", "gpt-5-mini"], { provider: "openai", confirmed: none, blocked: (m) => m === "gpt-5" }), "gpt-4.1");
  assert.equal(pickDefault(["dall-e-3", "gpt-4o-mini", "gpt-4.1-nano"], { provider: "openai", confirmed: none, blocked: (m) => m !== "gpt-4.1-nano" }), "gpt-4.1-nano");
  assert.equal(pickDefault(["gpt-5", "gpt-4.1"], { provider: "openai", confirmed: none, blocked: () => true }), undefined);
});

test("a pro, preview, audio or realtime model only when nothing else passes", () => {
  assert.equal(pickDefault(["gpt-4o-realtime-preview", "gpt-4o-audio-preview", "o3-pro", "gpt-4o-mini"], { provider: "openai", confirmed: none, blocked: open }), "gpt-4o-mini");
  assert.equal(pickDefault(["o3-pro"], { provider: "openai", confirmed: none, blocked: open }), "o3-pro");
});

test("Anthropic in its own order (newest first): the first Sonnet listed, not the one a number sort ranks first", () => {
  assert.equal(BALANCED_TIER["anthropic"]?.order, "vendor");
  const listed = ["claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219"];
  assert.equal(pickDefault(listed, { provider: "anthropic", confirmed: none, blocked: open }), "claude-sonnet-4-5-20250929");
});

test("Anthropic with a -latest alias: a dated model listed later wins over an alias listed first, and the alias serves when it is the only Sonnet", () => {
  assert.equal(pickDefault(["claude-3-5-sonnet-latest", "claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514"], { provider: "anthropic", confirmed: none, blocked: open }), "claude-sonnet-4-5-20250929");
  assert.equal(pickDefault(["claude-opus-4-1-20250805", "claude-3-7-sonnet-latest", "claude-haiku-4-5-20251001"], { provider: "anthropic", confirmed: none, blocked: open }), "claude-3-7-sonnet-latest");
});

test("OpenAI's order means nothing, so its tier is sorted newest first by name", () => {
  assert.equal(BALANCED_TIER["openai"]?.order, "newest");
  assert.equal(pickDefault(["gpt-4o", "gpt-4.1", "gpt-5", "gpt-5.5"], { provider: "openai", confirmed: none, blocked: open }), "gpt-5.5");
});

test("Google: a policy written with bare ids allows a model the key lists as models/<id>; the model keeps the id the key listed", async () => {
  const d = { db: undefined as never, now: 0, call: async () => { throw new Error("no call expected"); }, policy: { allowedModels: ["gemini-2.5-flash"], allowedProviders: [], labelProviders: {} } };
  const out = await defaultModelFor(d, { ref: "#G", driver: "google", provider: "google", kind: "api_key", models: ["models/gemini-2.5-pro", "models/gemini-2.5-flash"] });
  assert.deepEqual(out, { model: "models/gemini-2.5-flash" });
  const none2 = await defaultModelFor({ ...d, policy: { ...d.policy, allowedModels: ["gemini-1.5-flash"] } }, { ref: "#G", driver: "google", provider: "google", kind: "api_key", models: ["models/gemini-2.5-flash"] });
  assert.deepEqual(none2, { why: "policy" });
});

// real-model gate, 13 Nov 2026: the model menu's one-word checks (no tools, no effort) confirmed gpt-5.6-luna, and the default took it over the plain flagship; it then failed the first tool turn
test("only a model a chat turn ran on wins over the table: a model the menu's check answered does not", async () => {
  const h = harness();
  const listed = ["gpt-5.6-luna", "gpt-4.1", "gpt-5", "gpt-5-mini"];
  const d = { db: h.ctx.db as never, now: 10_000, call: async () => { throw new Error("no call expected"); }, policy: { allowedModels: [], allowedProviders: [], labelProviders: {} } };
  const acct = { ref: "#OA", driver: "openai", provider: "openai", kind: "api_key", models: listed };
  markConfirmed(h.ctx.db as never, "#OA", "gpt-5.6-luna", 9_000);   // a probe answered it
  assert.deepEqual(await defaultModelFor(d, acct), { model: "gpt-5" });
  markRan(h.ctx.db as never, "#OA", "openai/gpt-4.1", 9_500);   // a chat turn completed on it (the turn names the model with its provider)
  assert.deepEqual(await defaultModelFor(d, acct), { model: "gpt-4.1" });
  assert.ok(confirmedFor(h.ctx.db as never, "#OA", 10_000).has("openai/gpt-4.1"), "a ran model still reads as confirmed in the menu");
  assert.equal(ranFor(h.ctx.db as never, "#OA", 10_000).has("gpt-5.6-luna"), false);
});

test("safety net: a default model refused with provider.bad_request before any output is marked failed for the account, and the next turn takes the next candidate; a named model is never marked", async () => {
  const h = harness();
  const db = h.ctx.db as never;
  const d = { db, now: 10_000, call: async () => { throw new Error("no call expected"); }, policy: { allowedModels: [], allowedProviders: [], labelProviders: {} } };
  const acct = { ref: "#OA", driver: "openai", provider: "openai", kind: "api_key", models: ["gpt-5", "gpt-4.1", "gpt-4o"] };
  assert.deepEqual(await defaultModelFor(d, acct), { model: "gpt-5" });
  afterDefaultTurn(db, { state: "failed", model: "gpt-5", tokensOut: 0, error: { code: "provider.bad_request", message: "no" } }, "#OA", 10_100);
  assert.ok(unavailableFor(db, "#OA", 10_200).has("gpt-5"));
  assert.deepEqual(await defaultModelFor({ ...d, now: 10_200 }, acct), { model: "gpt-4.1" });
  // a turn on a model nobody defaulted (a person's pick) that fails the same way leaves no mark; a completed turn marks the model ran
  afterDefaultTurn(db, { state: "failed", model: "gpt-4o", tokensOut: 0, error: { code: "provider.bad_request", message: "no" } }, "#OA", 10_300);
  assert.equal(unavailableFor(db, "#OA", 10_400).has("gpt-4o"), false);
  afterDefaultTurn(db, { state: "completed", model: "gpt-4.1", tokensOut: 12, error: null }, "#OA", 10_500);
  assert.ok(ranFor(db, "#OA", 10_600).has("gpt-4.1"));
});
