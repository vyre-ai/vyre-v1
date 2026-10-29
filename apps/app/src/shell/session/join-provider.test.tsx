import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { addJoinedApiKey } from "./join-provider.ts";
import { JoinProviderSetup } from "./JoinProviderSetup.tsx";
import type { StoredSession } from "./stored.ts";

test("joined API keys name their chosen provider and are stored as Mine through the provider contract", async () => {
  const calls: unknown[] = [];
  const call = async (cap: string, input: unknown) => { calls.push({ cap, input }); return { provider: { id: "prv_new" } }; };
  assert.equal(await addJoinedApiKey(call, { choice: "key", key: "  fixture-key  ", providerKey: "anthropic" }, "join-key"), "prv_new");
  assert.deepEqual(calls, [{ cap: "providers.add", input: { providerKey: "anthropic", connection: "api_key", apiKey: "fixture-key", scope: "mine", idempotencyKey: "join-key" } }]);
  await assert.rejects(addJoinedApiKey(call, { choice: "key", key: "fixture-key" }, "missing-provider"));
  assert.equal(calls.length, 1, "an untyped key is never guessed");
});

test("a failed provider setup rejects and can retry with the same account and idempotency key", async () => {
  const caps: string[] = [];
  let fail = true;
  const call = async (cap: string) => { caps.push(cap); if (fail) throw new Error("offline"); return { provider: { id: "prv_retry" } }; };
  const ai = { choice: "key" as const, key: "fixture-key", providerKey: "openrouter" as const };
  await assert.rejects(addJoinedApiKey(call, ai, "stable-attempt"));
  fail = false;
  assert.equal(await addJoinedApiKey(call, ai, "stable-attempt"), "prv_retry");
  assert.deepEqual(caps, ["providers.add", "providers.add"], "retry does not accept an invite or recreate the account");
});

test("the post-join page never labels an unverified provider connected or renders its API key", () => {
  const stored = { baseUrl: "https://space.test", token: "fixture-token", def: { name: "Northwind" } } as StoredSession;
  const out = renderToStaticMarkup(<JoinProviderSetup stored={stored} ai={{ choice: "key", key: "fixture-private-key", providerKey: "openai" }} onOpen={() => undefined} onClearSecret={() => undefined} />);
  assert.match(out, /Save API key/);
  assert.doesNotMatch(out, /fixture-private-key|account is connected/);
  const sub = renderToStaticMarkup(<JoinProviderSetup stored={stored} ai={{ choice: "sub" }} onOpen={() => undefined} onClearSecret={() => undefined} />);
  assert.match(sub, /Claude Code|Codex/);
  assert.doesNotMatch(sub, /account is connected|Connected as/);
});
