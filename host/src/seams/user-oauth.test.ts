// The per-person sign-in seam against a fake Vault and a fake network: the app client, the code exchange (PKCE, offline), access tokens made from a refresh token and kept by account,
// and the refusals. Google and Microsoft share the code and differ in the token address, the tenant and the scope.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../routes/errors.ts";
import { createUserOauth } from "./user-oauth.ts";
import type { SeamCtx, SeamFetch } from "./ports.ts";

const NOW = 1_760_000_000_000;
const code = (c: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === c;
const GOOGLE = { name: "Google", tokenUrl: () => "https://oauth2.googleapis.com/token", domains: ["oauth2.googleapis.com"] } as const;
const MS = { name: "Microsoft", tokenUrl: (t: string | undefined) => `https://login.microsoftonline.com/${t ?? "common"}/oauth2/v2.0/token`, domains: ["login.microsoftonline.com"], scope: "offline_access Mail.ReadWrite" } as const;

interface Sent { url: string; body: string }
function world(o: { replies?: { status: number; body?: string }[]; items?: Record<string, string>; publicUrl?: boolean } = {}) {
  const sent: Sent[] = [];
  const replies = [...(o.replies ?? [])];
  const items = o.items ?? { "#App.client_id": "cid-1", "#App.client_secret": "sec-1" };
  const fetch: SeamFetch = async (url, init) => {
    sent.push({ url, body: String(init?.body ?? "") });
    const r = replies.shift() ?? { status: 200, body: "{}" };
    return { status: r.status, text: async () => r.body ?? "", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const deps = {
    vault: { secret: async (handle: string) => { const v = items[handle]; if (v === undefined) throw new Error("no item"); return v; } },
    fetch,
    ...(o.publicUrl === false ? {} : { publicUrl: async (space: string) => `https://${space}.vyre.test` }),
  };
  let clock = NOW;
  const ctx: SeamCtx = { space: "spc_1", trace: { traceId: "e".repeat(32) }, now: () => clock, db: { all: () => [] } };
  return { sent, deps, ctx, advance: (ms: number) => { clock += ms; } };
}
const form = (b: string): URLSearchParams => new URLSearchParams(b);
const ok = (o: object) => ({ status: 200, body: JSON.stringify(o) });

test("userApp: the client id, whether a secret is there, the tenant; a missing id or a bad handle is a refusal", async () => {
  const w = world({ items: { "#App.client_id": "cid-1", "#App.tenant": "contoso.test" } });
  assert.deepEqual(await createUserOauth(w.deps, MS).userApp(w.ctx, "#App"), { clientId: "cid-1", hasSecret: false, tenant: "contoso.test" });
  const full = world();
  assert.deepEqual(await createUserOauth(full.deps, GOOGLE).userApp(full.ctx, "#App"), { clientId: "cid-1", hasSecret: true });
  await assert.rejects(createUserOauth(world({ items: {} }).deps, GOOGLE).userApp(w.ctx, "#App"), code("provider.auth_failed"));
  await assert.rejects(createUserOauth(full.deps, GOOGLE).userApp(full.ctx, "App"), code("validation.bad_input"));
  await assert.rejects(createUserOauth(full.deps, GOOGLE).userApp(full.ctx, "#App.client_secret"), code("validation.bad_input"));
});

test("userPublicUrl: the server's address, or a plain refusal when it has none", async () => {
  const w = world();
  assert.equal(await createUserOauth(w.deps, GOOGLE).userPublicUrl(w.ctx), "https://spc_1.vyre.test");
  const none = world({ publicUrl: false });
  await assert.rejects(createUserOauth(none.deps, GOOGLE).userPublicUrl(none.ctx), code("internal.unavailable"));
});

test("userExchange: posts the code with the verifier, the redirect, the client and its secret; returns both tokens and when the access one ends", async () => {
  const w = world({ replies: [ok({ access_token: "acc-1", refresh_token: "ref-1", expires_in: 1800 })] });
  const out = await createUserOauth(w.deps, GOOGLE).userExchange(w.ctx, { appHandle: "#App", code: "the-code", verifier: "ver-1", redirectUri: "https://x.vyre.test/oauth/callback" });
  assert.deepEqual(out, { refreshToken: "ref-1", accessToken: "acc-1", expiresAt: NOW + 1_800_000 });
  assert.equal(w.sent[0]!.url, "https://oauth2.googleapis.com/token");
  const f = form(w.sent[0]!.body);
  assert.deepEqual(
    ["grant_type", "code", "code_verifier", "redirect_uri", "client_id", "client_secret"].map((k) => f.get(k)),
    ["authorization_code", "the-code", "ver-1", "https://x.vyre.test/oauth/callback", "cid-1", "sec-1"],
  );
});

test("userExchange: no refresh token is a refusal that names offline access; a rejected code says to sign in again and leaks nothing", async () => {
  const w = world({ replies: [ok({ access_token: "acc-1" }), { status: 400, body: JSON.stringify({ error: "invalid_grant", error_description: "Code the-code was used" }) }] });
  const seam = createUserOauth(w.deps, GOOGLE);
  const a = { appHandle: "#App", code: "the-code", verifier: "v", redirectUri: "https://x/cb" };
  await assert.rejects(seam.userExchange(w.ctx, a), (e: unknown) => code("provider.bad_response")(e) && /offline/.test((e as HostError).error.message ?? ""));
  await assert.rejects(seam.userExchange(w.ctx, a), (e: unknown) => {
    const t = JSON.stringify((e as HostError).error);
    return code("provider.auth_failed")(e) && !t.includes("the-code") && !t.includes("sec-1") && t.includes("invalid_grant");
  });
});

test("userRefresh: Microsoft goes to the tenant's address and names the scope; the access token is kept per account until a minute before it ends, then refreshed; fresh skips the copy", async () => {
  const w = world({ items: { "#App.client_id": "cid-1", "#App.tenant": "contoso.test" }, replies: [ok({ access_token: "a1", expires_in: 3600 }), ok({ access_token: "a2", expires_in: 3600 }), ok({ access_token: "a3", expires_in: 3600 }), ok({ access_token: "a4", expires_in: 3600 })] });
  const seam = createUserOauth(w.deps, MS);
  const call = (cacheKey: string, fresh = false) => seam.userRefresh(w.ctx, { appHandle: "#App", refreshToken: "ref-1", cacheKey, ...(fresh ? { fresh: true } : {}) });
  assert.equal((await call("mua_1")).token, "a1");
  assert.equal(w.sent[0]!.url, "https://login.microsoftonline.com/contoso.test/oauth2/v2.0/token");
  const f = form(w.sent[0]!.body);
  assert.deepEqual([f.get("grant_type"), f.get("refresh_token"), f.get("scope"), f.get("client_secret")], ["refresh_token", "ref-1", "offline_access Mail.ReadWrite", null]);
  assert.equal((await call("mua_1")).token, "a1");              // kept
  assert.equal((await call("mua_2")).token, "a2");              // another account is its own
  assert.equal((await call("mua_1", true)).token, "a3");        // asked for a fresh one
  w.advance(3600_000 - 30_000);
  assert.equal((await call("mua_1")).token, "a4");              // less than a minute left
  assert.equal(w.sent.length, 4);
});

test("userRefresh: an empty token, a rejected one, a dead network and a server error each have their own answer; the address is limited to the provider's domain", async () => {
  const w = world({ replies: [{ status: 401, body: JSON.stringify({ error: "invalid_grant" }) }, { status: 503 }] });
  const seam = createUserOauth(w.deps, GOOGLE);
  const a = { appHandle: "#App", cacheKey: "gua_1" };
  await assert.rejects(seam.userRefresh(w.ctx, { ...a, refreshToken: "" }), code("provider.auth_failed"));
  await assert.rejects(seam.userRefresh(w.ctx, { ...a, refreshToken: "r" }), code("provider.auth_failed"));
  await assert.rejects(seam.userRefresh(w.ctx, { ...a, refreshToken: "r" }), (e: unknown) => e instanceof HostError && e.error.code !== "provider.auth_failed");
  const down = createUserOauth({ ...w.deps, fetch: async () => { throw new Error("socket"); } }, GOOGLE);
  await assert.rejects(down.userRefresh(w.ctx, { ...a, refreshToken: "r" }), code("provider.network"));
  const wrong = createUserOauth(w.deps, { ...GOOGLE, tokenUrl: () => "https://evil.test/token" });
  await assert.rejects(wrong.userRefresh(w.ctx, { ...a, refreshToken: "r" }), code("permission.no_grant"));
});
