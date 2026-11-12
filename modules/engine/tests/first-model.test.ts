// The first-hour default model (lead, 12 Nov 2026): a turn that names no model (no chat pick, no thread record, no agent model) on a person's API key runs on a chat model that key lists,
// picked without spending a completion: chat models only, a model already run on this account first, then the provider's balanced tier (newest first), then the vendor's order; never a
// pro, preview, audio, realtime, search, transcribe or image model unless nothing else passes; and only what the Space's AI policy allows. Never for a subscription or OpenRouter.
import test from "node:test";
import assert from "node:assert/strict";
import { pickDefault } from "../first-model.ts";

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
