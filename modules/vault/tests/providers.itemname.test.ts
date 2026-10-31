// providers.list names the Vault item behind each account (itemName), so two accounts of one provider read differently in the model panel. The name is metadata; no secret comes with it.
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../handlers/providers.ts";
import { SECRET, harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
let seq = 0;
const key = (): string => `n-${++seq}`;

test("two accounts of one provider are listed with their own Vault item names, and no secret is in the rows", async () => {
  const h = harness();
  const a = (await p.add(h.ctx, { providerKey: "openai", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: key() }) as { provider: Json }).provider;
  const b = (await p.add(h.ctx, { providerKey: "openai", connection: "api_key", scope: "mine", apiKey: `${SECRET}-2`, idempotencyKey: key() }) as { provider: Json }).provider;
  const listed = (await p.list(h.ctx, {}) as { providers: Json[] }).providers;
  assert.deepEqual(listed.map((r) => [r.id, r.name, r.itemName]).sort(), [[a.id, "OpenAI", "OpenAI"], [b.id, "OpenAI", "OpenAI 2"]].sort());
  assert.ok(!JSON.stringify(listed).includes(SECRET));
  h.cleanup();
});
