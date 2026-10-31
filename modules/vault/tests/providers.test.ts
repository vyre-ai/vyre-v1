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
  assert.deepEqual(h.named("provider.added").map((e) => e.payload), [{ providerId: row.id, providerKey: "anthropic", connection: "api_key", scope: "shared" }]);
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
  assert.deepEqual(seen, [{ providerKey: "anthropic", connection: "api_key", caller: MAYA, apiKey: SECRET, engine: "anthropic" }]);
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
  assert.deepEqual(seen, [{ providerKey: "local", connection: "local_model", caller: MAYA, address: "http://localhost:11434", engine: "local" }]);
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
  assert.match(String(started.instruction), /Sign in with Claude/);
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

test("the provider list shows this month's tokens on the account, from the turns the engine metered on its item", async () => {
  const h = harness();
  const folder = await sharedFolder(h);
  const row = out(out(await p.add(h.ctx, { providerKey: "anthropic", connection: "api_key", scope: "shared", apiKey: SECRET, folderId: folder, idempotencyKey: key() })).provider);
  assert.equal((out(row.usage)).tokens, 0, "nothing metered yet");
  h.setUsage("agent", String(row.itemId), [{ key: "agt_a", turns: 2, tokensIn: 1000, tokensOut: 40 }, { key: "agt_b", turns: 1, tokensIn: 200, tokensOut: 10 }]);
  const listed = (out(await p.list(h.ctx, {})).providers as Json[])[0]!;
  assert.equal(out(listed.usage).tokens, 1250);
  assert.deepEqual(contractErrors("providers.list", "out", { providers: [listed] }), []);
});

// ---- direct sign-in: the server starts the provider's own sign-in and the credential goes straight into the person's Mine folder

function fakeSignin(script: Array<{ state: "waiting" } | { state: "done"; fields: { key: string; value: string; secret: boolean }[] } | { state: "failed"; message: string }>, failStart?: string): { port: u.SigninPort; seen: { codes: (string | undefined)[]; people: string[] } } {
  const seen = { codes: [] as (string | undefined)[], people: [] as string[] };
  const live = new Set<string>();
  const finished = new Map<string, { state: "done"; fields: { key: string; value: string; secret: boolean }[] }>();
  return {
    seen,
    port: {
      has: (k) => k === "claude-code" || k === "codex",
      active: (id) => live.has(id),
      async start({ id, provider, person }) { if (failStart && provider === "codex") throw new Error(failStart); live.add(id); seen.people.push(person); return provider === "codex" ? { url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", needsCode: false, expiresInSec: 900 } : { url: "https://claude.ai/oauth/authorize?state=s", needsCode: true, expiresInSec: 900 }; },
      // like the host: a finished flow keeps its answer until the module saves it and lets go (cancel); a failed one is gone
      async step({ id, code }) { const held = finished.get(id); if (held) return held; seen.codes.push(code); const next = script.shift() ?? { state: "waiting" as const }; if (next.state === "failed") live.delete(id); if (next.state === "done") finished.set(id, next); return next; },
      cancel: (id) => { live.delete(id); finished.delete(id); },
    },
  };
}

test("sign in with Claude: start answers the link and says a code comes back, complete takes it, and the token is saved as a Mine ai_subscription item that no answer carries", async () => {
  const h = harness();
  const TOKEN = "sk-ant-oat01-direct-login-TOKEN-0123456789"; // secret-scan: fake
  const { port, seen } = fakeSignin([{ state: "waiting" }, { state: "done", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    assert.deepEqual(contractErrors("providers.subscription_start", "out", started), []);
    assert.deepEqual([started.url, started.needsCode, started.userCode], ["https://claude.ai/oauth/authorize?state=s", true, undefined]);
    assert.match(String(started.instruction), /paste the code Claude Code shows/);
    const waiting = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) }));
    assert.deepEqual(waiting, { waiting: true });
    assert.deepEqual(contractErrors("providers.subscription_complete", "out", waiting), []);
    const done = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" }));
    assert.deepEqual(contractErrors("providers.subscription_complete", "out", done), []);
    const row = out(done.provider);
    assert.deepEqual([row.connection, row.scope, row.providerKey, row.state], ["subscription", "mine", "claude-code", "ok"]);
    assert.deepEqual(seen.codes, [undefined, "CODE#STATE"]);
    const item = h.rows(`SELECT * FROM vault_meta WHERE id = ?`, String(row.itemId))[0]!;
    assert.equal(item["kind"], "ai_subscription");
    assert.equal(h.everything().includes(TOKEN), false, "the token is sealed in the item and in no answer, event or row");
    assert.equal(JSON.stringify([started, waiting, done]).includes(TOKEN), false);
    assert.equal(out(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })).provider).id, row.id, "Done twice is one account");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("a locked vault key is asked for before the pasted code goes to the provider, so the code still works once the person unlocks", async () => {
  const h = harness();
  const TOKEN = "sk-ant-oat01-locked-then-open-TOKEN-0123456789"; // secret-scan: fake
  const { port, seen } = fakeSignin([{ state: "done", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    h.lock(MAYA);
    const locked = await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" }).catch((e: unknown) => e as { error?: { code?: string; details?: { reason?: string } } });
    assert.deepEqual([locked.error?.code, locked.error?.details?.reason], ["auth.unauthenticated", "vault_locked"]);
    assert.deepEqual(seen.codes, [], "the code was not spent while the key was locked");
    assert.equal(port.active(String(started.flowId)), true, "the sign-in is still open");
    h.unlock(MAYA);
    const done = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" }));
    assert.deepEqual([out(done.provider).providerKey, out(done.provider).scope], ["claude-code", "mine"]);
    assert.deepEqual(seen.codes, ["CODE#STATE"], "the provider was asked once");
    assert.equal(port.active(String(started.flowId)), false, "saved, so the host let go of it");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("a sign-in that finished but could not be saved is saved on the next Finish without asking the provider again", async () => {
  const h = harness();
  const TOKEN = "sk-ant-oat01-save-retry-TOKEN-0123456789"; // secret-scan: fake
  const { port, seen } = fakeSignin([{ state: "done", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    // the provider finishes, then the save fails (the key locks between the check and the save)
    const step = port.step.bind(port);
    port.step = async (a) => { const r = await step(a); h.lock(MAYA); return r; };
    assert.equal(await refusedWith(p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" })), "auth.unauthenticated");
    port.step = step;
    h.unlock(MAYA);
    assert.equal(port.active(String(started.flowId)), true, "the finished sign-in is held for the retry");
    const done = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "CODE#STATE" }));
    assert.equal(out(done.provider).providerKey, "claude-code");
    assert.deepEqual(seen.codes, ["CODE#STATE"], "the code went to the provider once");
    assert.equal(h.everything().includes(TOKEN), false);
  } finally { u.configureVault(null); h.cleanup(); }
});

test("sign in with ChatGPT: the code to type comes back with the link, and the person is waited for until they approve", async () => {
  const h = harness();
  const { port } = fakeSignin([{ state: "waiting" }, { state: "waiting" }, { state: "done", fields: [{ key: "credentials", value: '{".codex/auth.json":"{}"}', secret: true }] }]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "codex", idempotencyKey: key() }));
    assert.deepEqual([started.url, started.userCode, started.needsCode], ["https://auth.openai.com/codex/device", "ABCD-1234", false]);
    assert.match(String(started.instruction), /enter the code ABCD-1234/);
    assert.deepEqual(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })), { waiting: true });
    assert.deepEqual(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })), { waiting: true });
    assert.equal(out(out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) })).provider).providerKey, "codex");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("a sign-in the provider refuses is an error with its words, and nothing is saved; a sign-in that cannot start leaves no flow", async () => {
  const h = harness();
  const { port } = fakeSignin([{ state: "failed", message: "Claude did not accept that code. It may have expired. Start again." }], "ChatGPT has not turned on device sign-in for this account type.");
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    const failed = await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "x" }).catch((e: unknown) => e as { error?: { code?: string; message?: string } });
    assert.equal((failed as { error: { code: string } }).error.code, "provider.auth_failed");
    assert.match(String((failed as { error: { message: string } }).error.message), /did not accept that code/);
    assert.deepEqual(out(await p.list(h.ctx, {})).providers, []);
    assert.equal(await refusedWith(p.subscriptionStart(h.ctx, { providerKey: "codex", idempotencyKey: key() })), "validation.bad_input");
    assert.equal(h.rows(`SELECT * FROM vault_provider_flow`).length, 1, "the sign-in that could not start left no row");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("an agent cannot start or finish a sign-in, and another person cannot finish yours", async () => {
  const h = harness();
  const { port } = fakeSignin([]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    h.actAs("agent", MAYA);
    assert.equal(await refusedWith(p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() })), "validation.bad_input");
    assert.equal(await refusedWith(p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "x" })), "validation.bad_input");
    h.actAs("person", ROB);
    assert.equal(await refusedWith(p.subscriptionComplete(h.ctx, { flowId: String(started.flowId), code: "x" })), "validation.not_found");
  } finally { u.configureVault(null); h.cleanup(); }
});

test("the person's client saved the sign-in in Mine while the flow was still open: Done with no code links it and answers the provider, and the open flow is dropped", async () => {
  const h = harness();
  const { port, seen } = fakeSignin([]);
  u.configureVault({ sinks: {}, signin: port });
  try {
    const started = out(await p.subscriptionStart(h.ctx, { providerKey: "claude-code", idempotencyKey: key() }));
    const mine = String(out(out(await v.foldersCreate(h.ctx, { name: "Mine keys", scope: "mine", idempotencyKey: key() })).folder).id);
    await v.itemPut(h.ctx, { folderId: mine, name: "Claude Code sign-in", kind: "ai_subscription", fields: [{ key: "setup_token", value: SECRET, secret: true }], idempotencyKey: key() } as Parameters<typeof v.itemPut>[1]);
    assert.equal(port.active(String(started.flowId)), true, "the flow is still open");
    const done = out(await p.subscriptionComplete(h.ctx, { flowId: String(started.flowId) }));
    assert.deepEqual(contractErrors("providers.subscription_complete", "out", done), []);
    assert.equal(out(done.provider).providerKey, "claude-code");
    assert.equal(port.active(String(started.flowId)), false, "the open flow was dropped");
    assert.deepEqual(seen.codes, [], "the provider was not asked for a step");
  } finally { u.configureVault(null); h.cleanup(); }
});
