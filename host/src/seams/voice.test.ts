// The Talk grant from the server: what each provider answer becomes, that a key goes in one header only, and that no provider text or key reaches a message.
import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceHost } from "./voice.ts";
import type { SeamFetch } from "./ports.ts";

const KEY = "dg_test_key_not_a_real_key"; // secret-scan: fake
const ctx = { space: "spc_1", trace: { traceId: "0".repeat(32) } };
const answer = (status: number, body: string): SeamFetch => async () => ({ status, text: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
const vault = { secret: async () => KEY };
const fails = async (p: Promise<unknown>): Promise<{ code: string; message: string; reason?: string }> => {
  try { await p; } catch (e) { const x = (e as { error: { code: string; message: string; details?: { reason?: string } } }).error; return { code: x.code, message: x.message, ...(x.details?.reason ? { reason: x.details.reason } : {}) }; }
  throw new Error("it did not refuse");
};

test("a grant asks with the key in one header and a 30 second life, and returns only the token", async () => {
  const seen: { url: string; init: unknown }[] = [];
  const host = createVoiceHost({ vault, fetch: async (url, init) => { seen.push({ url, init }); return { status: 200, text: async () => JSON.stringify({ access_token: "jwt", expires_in: 30 }), arrayBuffer: async () => new ArrayBuffer(0) }; } });
  assert.deepEqual(await host.mint(ctx, { provider: "deepgram", handle: "#Deepgram.api_key", asker: "usr_1", own: true }), { token: "jwt", expiresIn: 30 });
  assert.equal(seen[0]!.url, "https://api.deepgram.com/v1/auth/grant");
  assert.deepEqual(seen[0]!.init, { method: "POST", headers: { authorization: `Token ${KEY}`, "content-type": "application/json" }, body: '{"ttl_seconds":30}' });
});

test("the check tells a wrong key, a low role, a busy provider, a down provider and no network apart, in plain words", async () => {
  const check = (f: SeamFetch) => fails(createVoiceHost({ vault, fetch: f }).check(ctx, { provider: "deepgram", apiKey: KEY }));
  assert.deepEqual(await check(answer(401, "")), { code: "provider.auth_failed", message: "Deepgram did not accept that key. Check it and try again.", reason: "revoked" });
  assert.equal((await check(answer(403, ""))).reason, "role");
  assert.match((await check(answer(403, ""))).message, /Member role/);
  assert.equal((await check(answer(429, ""))).code, "provider.rate_limited");
  assert.equal((await check(answer(503, "boom"))).code, "provider.unavailable");
  assert.equal((await check(answer(200, "not json"))).code, "provider.unavailable");
  assert.equal((await check(async () => { throw new Error("getaddrinfo"); })).code, "provider.network");
});

test("a stored key that stopped working says whose it is and where to fix it", async () => {
  const host = createVoiceHost({ vault, fetch: answer(401, "") });
  assert.match((await fails(host.mint(ctx, { provider: "deepgram", handle: "#x.api_key", asker: "usr_1", own: true }))).message, /your key.*Settings, AI, Voice/);
  assert.match((await fails(host.mint(ctx, { provider: "deepgram", handle: "#x.api_key", own: false }))).message, /Space's key.*Console, Voice/);
});

test("a provider's error text and the key never reach a message", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const f = await fails(createVoiceHost({ vault, fetch: answer(status, `bad key ${KEY}`) }).mint(ctx, { provider: "deepgram", handle: "#x.api_key", asker: "usr_1", own: true }));
    assert.ok(!JSON.stringify(f).includes(KEY));
  }
});

test("a locked Vault and a gone Space key say so", async () => {
  const locked = createVoiceHost({ vault: { secret: async () => { throw new Error("Your vault key is locked on this computer."); } }, fetch: answer(200, "{}") });
  assert.equal((await fails(locked.mint(ctx, { provider: "deepgram", handle: "#x.api_key", asker: "usr_1", own: true }))).reason, "vault_locked");
  const gone = createVoiceHost({ vault: { secret: async () => { throw new Error("The Vault has no shared item #x."); } }, fetch: answer(200, "{}") });
  const f = await fails(gone.mint(ctx, { provider: "deepgram", handle: "#x.api_key", own: false }));
  assert.equal(f.reason, "no_key");
  assert.match(f.message, /Console, Voice/);
});
