// Context windows: what a provider or engine reports wins; the table is the fallback; an Auto pick is sized by the model that ran.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WINDOW, clearWindows, reportWindow, windowFor, windowInfo, windowLabel } from "../src/transcript/windows.ts";
import { anthropic } from "../src/drivers/api/anthropic.ts";
import { openrouter } from "../src/drivers/api/openai.ts";
import { google } from "../src/drivers/api/google.ts";
import { createClaudeDecoder, createCodexDecoder } from "../src/drivers/cli/index.ts";
import { contextOf, decide } from "../src/transcript/index.ts";

test.beforeEach(() => clearWindows());

test("the fallback table follows the providers' docs (6 Nov 2026), not a flat 200k", () => {
  const want: Array<[string, string, number]> = [
    ["claude-fable-5-1", "anthropic", 1_000_000], ["claude-opus-5-5", "anthropic", 1_000_000], ["claude-sonnet-5-5", "anthropic", 1_000_000], ["claude-haiku-5-5", "anthropic", 1_000_000],
    ["claude-opus-4-8", "anthropic", 1_000_000], ["claude-sonnet-4-6", "anthropic", 1_000_000], ["opus", "claude", 1_000_000],
    ["claude-sonnet-4-5-20250929", "anthropic", 200_000], ["claude-opus-4-5", "anthropic", 200_000], ["claude-haiku-4-5", "anthropic", 200_000], ["claude-3-5-sonnet", "anthropic", 200_000],
    ["claude-opus-4[1m]", "anthropic", 1_000_000],
    ["gpt-6.1-sol", "openai", 1_050_000], ["gpt-5-codex", "openai", 258_400],
    ["grok-4.3", "xai", 1_000_000], ["grok-4.6", "xai", 500_000], ["grok-build-0.1", "xai", 256_000],
    ["gemini-2.5-pro", "google", 1_000_000], ["deepseek-v4-pro", "deepseek", 1_000_000],
    ["glm-5.3", "zai", 1_000_000], ["glm-4.7", "zai", 200_000],
    ["some-local-model", "local", DEFAULT_WINDOW],
  ];
  for (const [m, p, n] of want) assert.equal(windowFor(m, p), n, m);
  assert.equal(windowInfo("claude-opus-5-5", "anthropic").source, "table");
  assert.equal(windowInfo("mystery", "local").source, "default");
});

test("a reported window beats the table, per provider and model", () => {
  reportWindow("claude-sonnet-5-5", 200_000, "claude");   // an engine plan that holds 200k
  assert.deepEqual(windowInfo("claude-sonnet-5-5", "claude"), { tokens: 200_000, source: "reported" });
  assert.equal(windowFor("claude-sonnet-5-5", "anthropic"), 200_000, "the model name alone carries over when the provider key differs");
  reportWindow("claude-sonnet-5-5", 1_000_000, "anthropic");
  assert.equal(windowFor("claude-sonnet-5-5", "anthropic"), 1_000_000);
  assert.equal(windowFor("claude-sonnet-5-5", "claude"), 200_000, "the provider's own report stays for that provider");
  reportWindow("x", -5, "p"); reportWindow("x", "big", "p"); reportWindow("x", 12, "p");
  assert.equal(windowInfo("x", "p").source, "default", "nonsense is not a report");
});

test("Auto resolves to the window of the model the provider last ran, never a flat 200k", () => {
  assert.equal(windowFor(null, "claude"), 1_000_000, "no report yet: the newest Claude family");
  assert.equal(windowFor("", "codex"), 258_400, "no report yet: the Codex table row");
  assert.equal(windowFor("", "local"), DEFAULT_WINDOW);
  reportWindow("gpt-6.1-sol", 1_050_000, "codex");
  assert.deepEqual(windowInfo(null, "codex"), { tokens: 1_050_000, source: "reported" });
  reportWindow("claude-opus-5-5", 400_000, "claude");
  assert.equal(windowFor(undefined, "claude"), 400_000);
});

test("API model lists carry the window: OpenRouter context_length, Anthropic max_input_tokens, Gemini inputTokenLimit", () => {
  assert.deepEqual(openrouter.parseModels({ data: [{ id: "z-ai/glm-5.3", context_length: 1_000_000 }, { id: "a/b", top_provider: { context_length: 64_000 } }, { id: "c/d" }] }),
    [{ id: "z-ai/glm-5.3", contextTokens: 1_000_000 }, { id: "a/b", contextTokens: 64_000 }, { id: "c/d" }]);
  assert.deepEqual(anthropic.parseModels({ data: [{ id: "claude-opus-5-5", display_name: "Opus 5.5", max_input_tokens: 1_000_000 }] }), [{ id: "claude-opus-5-5", label: "Opus 5.5", contextTokens: 1_000_000 }]);
  assert.deepEqual(google.parseModels({ models: [{ name: "models/gemini-4-argon", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1_048_576 }] }), [{ id: "gemini-4-argon", contextTokens: 1_048_576 }]);
});

test("Claude Code reports the window per model in the result line", () => {
  const d = createClaudeDecoder();
  const out = d.push(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "S", usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000, inputTokens: 10 } } }));
  const u = out.find((e) => e.type === "usage");
  assert.equal(u?.type === "usage" ? u.contextWindow : undefined, 1_000_000);
  assert.equal(u?.type === "usage" ? u.model : undefined, "claude-opus-5-5");
});

test("Codex exec JSON carries no window (checked in openai/codex exec_events.rs: Usage is tokens only), so Codex sizes from the table", () => {
  const d = createCodexDecoder();
  const out = d.push(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0 } }));
  const u = out.find((e) => e.type === "usage");
  assert.ok(u?.type === "usage" && u.contextWindow === undefined);
  assert.equal(windowFor("gpt-5-codex", "codex"), 258_400);
});

test("compaction and rollover thresholds are a share of the real window", () => {
  const used = 340_000;
  const small = contextOf({ used, window: 400_000 });
  const big = contextOf({ used, window: 1_000_000 });
  assert.equal(small.share, 0.85);
  assert.equal(big.share, 0.34);
  assert.equal(decide({ ctx: small }).roll, true);
  assert.equal(decide({ ctx: big }).roll, false, "340k of 1M is not full");
  reportWindow("claude-opus-5-5", 1_000_000, "claude");
  assert.equal(contextOf({ used, model: "claude-opus-5-5", provider: "claude" }).window, 1_000_000, "with no window passed, the reported one sizes it");
});

test("pickers read 1M, 258k", () => {
  assert.equal(windowLabel(1_000_000), "1M context");
  assert.equal(windowLabel(1_050_000), "1.05M context");
  assert.equal(windowLabel(258_400), "258k context");
});
