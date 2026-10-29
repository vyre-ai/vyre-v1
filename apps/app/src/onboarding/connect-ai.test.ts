import test from "node:test";
import assert from "node:assert/strict";
import { API_KEYS, SUBSCRIPTIONS, finishSubscription, saveApiKey, startSubscription } from "./connect-ai.ts";
import type { CapCall } from "../shell/session/caps.ts";

const recorder = (answers: Record<string, unknown>): { call: CapCall; calls: Array<{ cap: string; input: unknown }> } => {
  const calls: Array<{ cap: string; input: unknown }> = [];
  return { calls, call: (async (cap: string, input: unknown) => { calls.push({ cap, input }); const a = answers[cap]; if (a instanceof Error) throw a; return a; }) as unknown as CapCall };
};

test("Claude, ChatGPT and Grok are the subscription tiles, with Grok beside the other two", () => {
  assert.deepEqual(SUBSCRIPTIONS.map((o) => o.key), ["claude-code", "codex", "grok"]);
  assert.ok(API_KEYS.some((o) => o.key === "xai"));
});

test("a subscription sign-in starts and finishes through the Vault providers", async () => {
  const r = recorder({ "providers.subscription_start": { flowId: "sub_1", instruction: "Sign in." }, "providers.subscription_complete": { provider: { id: "prv_1" } } });
  assert.deepEqual(await startSubscription(r.call, "grok", "k"), { flowId: "sub_1", instruction: "Sign in." });
  assert.equal(await finishSubscription(r.call, "sub_1"), "prv_1");
  await assert.rejects(() => startSubscription(r.call, "nope", "k"));
});

test("an unfinished sign-in says so in plain words", async () => {
  const r = recorder({ "providers.subscription_complete": Object.assign(new Error("x"), { code: "validation.precondition_failed" }) });
  await assert.rejects(() => finishSubscription(r.call, "sub_1"), /has not finished yet/);
});

test("an API key goes to providers.add in Mine and never appears in what comes back", async () => {
  const r = recorder({ "providers.add": { provider: { id: "prv_2" } } });
  const id = await saveApiKey(r.call, "anthropic", "  sk-secret-123  ", "k");
  assert.equal(id, "prv_2");
  assert.deepEqual(r.calls[0], { cap: "providers.add", input: { providerKey: "anthropic", connection: "api_key", apiKey: "sk-secret-123", scope: "mine", idempotencyKey: "k" } });
  const bad = recorder({ "providers.add": Object.assign(new Error("sk-secret-123 rejected"), { code: "validation.bad_input" }) });
  await assert.rejects(() => saveApiKey(bad.call, "openai", "sk-secret-123", "k"), (e: Error) => !e.message.includes("sk-secret-123"));
  await assert.rejects(() => saveApiKey(r.call, "openai", "   ", "k"), /Paste your API key/);
  await assert.rejects(() => saveApiKey(r.call, "bogus", "x", "k"));
});
