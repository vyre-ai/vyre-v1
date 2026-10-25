// AI providers (P-L7_10 follow-up; spec 2.17, 4.14): the engine finds accounts through providers.list, so a key or sign-in added here is what a turn runs on. A Mine account is its owner's alone, a Shared one
// is visible to people with Use, a subscription is Mine and linked when the person's computer has saved it, and providers.test reaches the provider only through the host.
// @reads /modules/vault/handlers/providers.ts
// @reads /modules/vault/migrations/0003_providers.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import { MAYA, ROB, SECRET, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `p-${++seq}`;
const sharedFolder = async (h: Harness): Promise<string> => String(out(out(await v.foldersCreate(h.ctx, { name: `shared ${key()}`, scope: "shared", idempotencyKey: key() })).folder).id);

test("the catalog names every engine driver and each connection it takes", async () => {
  const h = harness();
  const c = out(await p.catalog(h.ctx, {})).providers as Json[];
  assert.deepEqual(contractErrors("providers.catalog", "out", { providers: c }), []);
  for (const k of ["claude-code", "codex", "grok", "anthropic", "openai", "openrouter", "google", "xai", "opencode-go", "local"]) assert.ok(c.some((x) => x.key === k), k);
  h.cleanup();
});

test("a Shared API key is added, listed with its handle, visible to people with Use, and the key is in no row", async () => {
  const h = harness();
  const folder = await sharedFolder(h);
  const row = out(out(await p.add(h.ctx, { providerKey: "anthropic", connection: "api_key", scope: "shared", apiKey: SECRET, folderId: folder, idempotencyKey: key() })).provider);
  assert.deepEqual(contractErrors("providers.add", "out", { provider: row }), []);
  assert.deepEqual([row.providerKey, row.connection, row.scope, row.engine, row.spaceMayUse, row.state, row.handle, row.via], ["anthropic", "api_key", "shared", "anthropic", true, "ok", "#Anthropic", "API key, shared"]);
  const listed = out(await p.list(h.ctx, {}));
  assert.deepEqual(contractErrors("providers.list", "out", listed), []);
  assert.equal((listed.providers as Json[]).length, 1);
  assert.ok(!h.everything().includes(SECRET), "the key is sealed in the item, nowhere else");
  h.actAs("person", ROB);
  assert.deepEqual(out(await p.list(h.ctx, {})).providers, [], "no Use on the item, no account");
  h.grant(ROB, String(row.itemId), "use");
  assert.equal((out(await p.list(h.ctx, {})).providers as Json[]).length, 1);
  assert.equal(await refusedWith(p.remove(h.ctx, { providerId: String(row.id) })), "validation.not_found", "Use does not let someone remove it");
  h.cleanup();
});

test("a Mine key lives in the person's own AI providers folder and no one else lists it; acting for the person finds it", async () => {
  const h = harness();
  const row = out(out(await p.add(h.ctx, { providerKey: "openai", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: key() })).provider);
  assert.deepEqual([row.scope, row.spaceMayUse, row.via], ["mine", false, "API key, yours"]);
  const again = out(out(await p.add(h.ctx, { providerKey: "openai", connection: "api_key", scope: "mine", apiKey: `${SECRET}-2`, idempotencyKey: key() })).provider);
  assert.notEqual(again.itemId, row.itemId, "a second key is a second account");
  assert.equal((out(await p.list(h.ctx, {})).providers as Json[]).length, 2);
  h.actAs("person", ROB);
  assert.deepEqual(out(await p.list(h.ctx, {})).providers, []);
  h.actAs("agent", "agt_intake01");
  Object.assign(h.ctx, { actingFor: MAYA });
  assert.equal((out(await p.list(h.ctx, {})).providers as Json[]).length, 2, "an agent acting for Maya sees Maya's accounts");
  h.cleanup();
});

test("add refuses what cannot work: an unknown provider, a wrong connection, no key, no address, a Shared key with no folder", async () => {
  const h = harness();
  const base = { providerKey: "anthropic", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: "x" };
  assert.equal(await refusedWith(p.add(h.ctx, { ...base, providerKey: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(p.add(h.ctx, { ...base, providerKey: "claude-code" })), "validation.bad_input", "a subscription is connected with Sign in");
  assert.equal(await refusedWith(p.add(h.ctx, { ...base, apiKey: "  " })), "validation.bad_input");
  assert.equal(await refusedWith(p.add(h.ctx, { providerKey: "local", connection: "local_model", scope: "mine", idempotencyKey: "x" })), "validation.bad_input");
  assert.equal(await refusedWith(p.add(h.ctx, { ...base, scope: "shared" })), "validation.bad_input");
  h.cleanup();
});

test("providers.test reaches the provider only through the host, shows the models, and marks the account failing when it is refused", async () => {
  const h = harness();
  const folder = await sharedFolder(h);
  const row = out(out(await p.add(h.ctx, { providerKey: "anthropic", connection: "api_key", scope: "shared", apiKey: SECRET, folderId: folder, idempotencyKey: key() })).provider);
  u.configureVault(null);
  const no = out(await p.test(h.ctx, { providerId: String(row.id) }));
  assert.deepEqual([no.ok, no.models], [false, []], "no host probe: it says so");
  const seen: unknown[] = [];
  let answer = { ok: true, models: ["claude-sonnet-5-5"] } as { ok: boolean; models: string[]; detail?: string };
  u.configureVault({ sinks: {}, probe: async (q) => { seen.push(q); return answer; } });
  const good = out(await p.test(h.ctx, { providerId: String(row.id) }));
  assert.deepEqual(contractErrors("providers.test", "out", good), []);
  assert.deepEqual([good.ok, good.models], [true, ["claude-sonnet-5-5"]]);
  assert.deepEqual(seen, [{ providerKey: "anthropic", connection: "api_key", caller: MAYA, apiKey: SECRET }]);
  answer = { ok: false, models: [], detail: "The provider did not accept this key." };
  assert.equal(out(await p.test(h.ctx, { providerId: String(row.id) })).ok, false);
  assert.equal(out((out(await p.list(h.ctx, {})).providers as Json[])[0]).state, "failing");
  assert.ok(!h.everything().includes(SECRET));
  u.configureVault(null);
  h.cleanup();
});

test("a local model is added by address and tested with it", async () => {
  const h = harness();
  const folder = await sharedFolder(h);
  const row = out(out(await p.add(h.ctx, { providerKey: "local", connection: "local_model", scope: "shared", address: "http://localhost:11434", folderId: folder, idempotencyKey: key() })).provider);
  assert.equal(row.via, "Local model");
  const seen: unknown[] = [];
  u.configureVault({ sinks: {}, probe: async (q) => { seen.push(q); return { ok: true, models: ["llama3"] }; } });
  assert.equal(out(await p.test(h.ctx, { providerId: String(row.id) })).ok, true);
  assert.deepEqual(seen, [{ providerKey: "local", connection: "local_model", caller: MAYA, address: "http://localhost:11434" }]);
  u.configureVault(null);
  h.cleanup();
});

test("set_space_use lets the owner of a Mine account offer it to the Space, and remove deletes the item with the account", async () => {
  const h = harness();
  const row = out(out(await p.add(h.ctx, { providerKey: "xai", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: key() })).provider);
  assert.equal(out(out(await p.setSpaceUse(h.ctx, { providerId: String(row.id), allow: true })).provider).spaceMayUse, true);
  assert.equal(out(out(await p.setSpaceUse(h.ctx, { providerId: String(row.id), allow: false })).provider).spaceMayUse, false);
  h.actAs("person", ROB);
  assert.equal(await refusedWith(p.setSpaceUse(h.ctx, { providerId: String(row.id), allow: true })), "validation.not_found", "someone else's Mine account does not exist for them");
  h.actAs("person", MAYA);
  assert.deepEqual(await p.remove(h.ctx, { providerId: String(row.id) }), { ok: true });
  assert.deepEqual(out(await p.list(h.ctx, {})).providers, []);
  assert.equal(h.rows(`SELECT * FROM vault_meta WHERE id = ?`, String(row.itemId))[0]?.deleted_at !== null, true, "the item is in the trash");
  h.cleanup();
});

test("a subscription sign-in: start gives a flow, complete waits for the computer to save the credential, then links the Mine item", async () => {
  const h = harness();
  const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
  assert.deepEqual(contractErrors("providers.subscription_start", "out", started), []);
  assert.match(String(started.instruction), /claude setup-token/);
  assert.equal(await refusedWith(p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })), "validation.precondition_failed", "nothing saved yet");
  h.advance(1000);
  const mine = String(out(out(await v.foldersCreate(h.ctx, { name: "Mine keys", scope: "mine", idempotencyKey: key() })).folder).id);
  await v.itemPut(h.ctx, { folderId: mine, name: "Claude Code sign-in", kind: "ai_subscription", fields: [{ key: "credentials", value: SECRET }], idempotencyKey: key() } as Parameters<typeof v.itemPut>[1]);
  const row = out(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })).provider);
  assert.deepEqual(contractErrors("providers.subscription_complete", "out", { provider: row }), []);
  assert.deepEqual([row.connection, row.scope, row.engine, row.via, row.providerKey], ["subscription", "mine", "claude-code", "Subscription, yours", "claude-code"]);
  assert.equal(out(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })).provider).id, row.id, "pressing Done twice is one account");
  const tested = out(await p.test(h.ctx, { providerId: String(row.id) }));
  assert.deepEqual([tested.ok, (tested.models as string[]).length > 0], [true, true]);
  h.actAs("person", ROB);
  assert.equal(await refusedWith(p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })), "validation.not_found", "not their flow");
  assert.equal(await refusedWith(p.subscriptionStart(h.ctx, { providerKey: "anthropic", idempotencyKey: key() })), "validation.bad_input");
  assert.ok(!h.everything().includes(SECRET));
  h.cleanup();
});
