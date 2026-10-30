import test from "node:test";
import assert from "node:assert/strict";
import { API_KEYS, SUBSCRIPTIONS, saveApiKey, startSubscription } from "./connect-ai.ts";
import type { CapCall } from "../shell/session/caps.ts";

const recorder = (answers: Record<string, unknown>): { call: CapCall; calls: Array<{ cap: string; input: unknown }> } => {
  const calls: Array<{ cap: string; input: unknown }> = [];
  return { calls, call: (async (cap: string, input: unknown) => { calls.push({ cap, input }); const a = answers[cap]; if (a instanceof Error) throw a; return a; }) as unknown as CapCall };
};

test("Claude, ChatGPT and Grok are the subscription tiles, with Grok beside the other two", () => {
  assert.deepEqual(SUBSCRIPTIONS.map((o) => o.key), ["claude-code", "codex", "grok"]);
  assert.ok(API_KEYS.some((o) => o.key === "xai"));
});

test("a subscription sign-in starts through the Vault providers and answers the link, the code and whether a code comes back", async () => {
  const r = recorder({ "providers.subscription_start": { flowId: "sub_1", instruction: "Sign in.", url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", needsCode: false } });
  assert.deepEqual(await startSubscription(r.call, "codex", "k"), { flowId: "sub_1", instruction: "Sign in.", url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", needsCode: false });
  assert.deepEqual(r.calls[0], { cap: "providers.subscription_start", input: { providerKey: "codex", idempotencyKey: "k" } });
  await assert.rejects(() => startSubscription(r.call, "nope", "k"));
});

test("a sign-in that cannot start says why in the server's own words", async () => {
  const r = recorder({ "providers.subscription_start": new Error("Grok sign-in needs the Grok command line on this computer. Install it, or use an API key.") });
  await assert.rejects(() => startSubscription(r.call, "grok", "k"), /needs the Grok command line/);
});

test("an API key goes to providers.add in Mine and never appears in what comes back", async () => {
  const r = recorder({ "providers.add": { provider: { id: "prv_2" } } });
  const id = await saveApiKey(r.call, "anthropic", "  sk-secret-123  ", "k");
  assert.equal(id, "prv_2");
  assert.equal(r.calls.length, 1, "the key makes exactly one call, to the Vault; no chat, event or card carries it");
  assert.deepEqual(r.calls[0], { cap: "providers.add", input: { providerKey: "anthropic", connection: "api_key", apiKey: "sk-secret-123", scope: "mine", idempotencyKey: "k" } });
  const bad = recorder({ "providers.add": Object.assign(new Error("sk-secret-123 rejected"), { code: "validation.bad_input" }) });
  await assert.rejects(() => saveApiKey(bad.call, "openai", "sk-secret-123", "k"), (e: Error) => !e.message.includes("sk-secret-123"));
  await assert.rejects(() => saveApiKey(r.call, "openai", "   ", "k"), /Paste your API key/);
  await assert.rejects(() => saveApiKey(r.call, "bogus", "x", "k"));
});
