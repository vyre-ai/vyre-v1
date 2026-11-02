// A key pasted under the wrong provider is caught before it is saved, and the right provider is named.
import test from "node:test";
import assert from "node:assert/strict";
import { checkKey, providerOfKey } from "./key-prefix.ts";

const TITLES: Record<string, string> = { "opencode-go": "OpenCode Go", anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", openrouter: "OpenRouter" };
const titleOf = (k: string): string | null => TITLES[k] ?? null;

test("the prefix names the provider, most specific first", () => {
  assert.equal(providerOfKey("sk-ant-api03-abc"), "anthropic");
  assert.equal(providerOfKey("sk-or-v1-abc"), "openrouter");
  assert.equal(providerOfKey("xai-abc"), "xai");
  assert.equal(providerOfKey("sk-proj-abc"), "openai");
  assert.equal(providerOfKey("ocg_live_123456"), null);
});

test("an OpenCode Go key chosen as Anthropic is caught before saving, and OpenCode Go is suggested", () => {
  assert.deepEqual(checkKey("anthropic", "ocg_live_1234567890", titleOf), { line: "Anthropic keys start with sk-ant-. Is this an OpenCode Go key?", suggest: "opencode-go" });
});

test("a key from another prefixed provider names that provider", () => {
  assert.deepEqual(checkKey("anthropic", "sk-or-v1-123456", titleOf), { line: "This looks like an OpenRouter key (it starts with sk-or-), not Anthropic.", suggest: "openrouter" });
  assert.equal(checkKey("openai", "sk-ant-api03-123", titleOf)?.suggest, "anthropic");
  assert.equal(checkKey("opencode-go", "xai-1234567", titleOf)?.suggest, "xai");
});

test("a key that fits says nothing, and so does a short or empty field", () => {
  assert.equal(checkKey("anthropic", "sk-ant-api03-123", titleOf), null);
  assert.equal(checkKey("opencode-go", "ocg_live_123456", titleOf), null);
  assert.equal(checkKey("opencode-go", "sk-123456789", titleOf), null, "a plain sk- key may be OpenCode Go's own");
  assert.equal(checkKey("anthropic", "sk", titleOf), null);
});
