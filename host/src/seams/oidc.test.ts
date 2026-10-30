// OpenID Connect for the firm's own sign-in app: the authorization address, discovery rules and every way an ID token can be wrong. Signed with a throwaway key made in the test.
import test from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, discover, exchangeCode, OidcError, pkce, verifyIdToken } from "./oidc.ts";
import type { Discovery } from "./oidc.ts";
import type { SeamFetch } from "./ports.ts";

const NOW = 1_760_000_000_000;
const ISS = "https://idp.example.com";
const D: Discovery = { issuer: ISS, authorization_endpoint: `${ISS}/auth`, token_endpoint: `${ISS}/token`, jwks_uri: `${ISS}/keys` };
const refused = (m: RegExp) => (e: unknown): boolean => e instanceof OidcError && m.test(e.message);
const b64 = (v: unknown): string => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

const pair = await globalThis.crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await globalThis.crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await globalThis.crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const fetchKeys: SeamFetch = async () => ({ status: 200, headers: {}, text: async () => JSON.stringify({ keys: [jwk] }) }) as never;

async function sign(claims: Record<string, unknown>, o: { key?: CryptoKeyPair; alg?: string } = {}): Promise<string> {
  const h = b64({ alg: o.alg ?? "RS256", kid: "k1" });
  const c = b64(claims);
  const s = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", (o.key ?? pair).privateKey, new TextEncoder().encode(`${h}.${c}`));
  return `${h}.${c}.${Buffer.from(s).toString("base64url")}`;
}
const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ iss: ISS, aud: "app", exp: NOW / 1000 + 600, iat: NOW / 1000, nonce: "n1", email: "Ana@Firm.test", email_verified: true, sub: "u1", ...over });
const check = (token: string, over: { domain?: string | undefined; nonce?: string } = {}) => verifyIdToken(fetchKeys, D, token, { clientId: "app", nonce: over.nonce ?? "n1", domain: "domain" in over ? over.domain : "firm.test", now: NOW });

test("an ID token that is right names the lower-cased address and the subject", async () => {
  assert.deepEqual(await check(await sign(good())), { email: "ana@firm.test", subject: "u1" });
});

test("every wrong ID token is refused with its reason", async () => {
  await assert.rejects(check(await sign(good(), { key: other })), refused(/signature/));
  await assert.rejects(check(await sign(good(), { alg: "none" })), refused(/RS256/));
  await assert.rejects(check("a.b"), refused(/not an ID token/));
  await assert.rejects(check(await sign(good({ iss: "https://evil.example.com" }))), refused(/another issuer/));
  await assert.rejects(check(await sign(good({ aud: "someone-else" }))), refused(/another app/));
  await assert.rejects(check(await sign(good({ exp: NOW / 1000 - 3600 }))), refused(/expired/));
  await assert.rejects(check(await sign(good({ iat: NOW / 1000 + 3600 }))), refused(/future/));
  await assert.rejects(check(await sign(good({ nonce: "other" }))), refused(/asked for/));
  await assert.rejects(check(await sign(good({ email: "ana@other.test" }))), refused(/not at firm.test/));
  await assert.rejects(check(await sign(good({ email: "ana@firm.test.evil.test" }))), refused(/not at firm.test/));
  await assert.rejects(check(await sign(good({ email_verified: false }))), refused(/not verified/));
  await assert.rejects(check(await sign(good({ hd: "other.test" }))), refused(/another domain/));
  await assert.rejects(check(await sign(good({ email: undefined }))), refused(/no email/));
});

test("a provider with no firm domain signs nobody in", async () => {
  await assert.rejects(check(await sign(good()), { domain: undefined }), refused(/no firm domain/));
});

test("a Microsoft issuer with the tenant placeholder matches the tenant the token names", async () => {
  const ms: Discovery = { ...D, issuer: "https://login.example.com/{tenantid}/v2.0" };
  const t = await sign(good({ iss: "https://login.example.com/t-1/v2.0", tid: "t-1" }));
  assert.equal((await verifyIdToken(fetchKeys, ms, t, { clientId: "app", nonce: "n1", domain: "firm.test", now: NOW })).email, "ana@firm.test");
  const bad = await sign(good({ iss: "https://login.example.com/t-2/v2.0", tid: "t-1" }));
  await assert.rejects(verifyIdToken(fetchKeys, ms, bad, { clientId: "app", nonce: "n1", domain: "firm.test", now: NOW }), refused(/another issuer/));
});

test("the authorization address carries PKCE S256, state, nonce and the domain hint", async () => {
  const { verifier, challenge } = await pkce();
  assert.notEqual(verifier, challenge);
  const u = new URL(authorizeUrl(D, { clientId: "app", redirect: "https://s.example.com/cb", state: "st", nonce: "n1", challenge, domainHint: "firm.test" }));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), challenge);
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("nonce"), "n1");
  assert.equal(u.searchParams.get("hd"), "firm.test");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
});

test("discovery refuses a provider that is not https or leaves out an address", async () => {
  const answer = (b: unknown): SeamFetch => (async () => ({ status: 200, headers: {}, text: async () => JSON.stringify(b) })) as never;
  await assert.rejects(discover(answer({}), "http://idp.example.com"), refused(/https/));
  await assert.rejects(discover(answer({ issuer: ISS, authorization_endpoint: "http://x.test/a", token_endpoint: `${ISS}/t`, jwks_uri: `${ISS}/k` }), ISS), refused(/https/));
  await assert.rejects(discover(answer({ issuer: ISS }), ISS), refused(/not an address/));
  assert.deepEqual(await discover(answer({ issuer: ISS, authorization_endpoint: `${ISS}/a`, token_endpoint: `${ISS}/t`, jwks_uri: `${ISS}/k` }), `${ISS}/`), { issuer: ISS, authorization_endpoint: `${ISS}/a`, token_endpoint: `${ISS}/t`, jwks_uri: `${ISS}/k` });
});

test("the code exchange posts the secret and verifier to the token address and needs an ID token back", async () => {
  let sent: { url: string; body: string } | undefined;
  const ok: SeamFetch = (async (url: string, init?: { body?: string }) => { sent = { url, body: String(init?.body) }; return { status: 200, headers: {}, text: async () => JSON.stringify({ id_token: "tok" }) }; }) as never;
  assert.equal(await exchangeCode(ok, D, { clientId: "app", clientSecret: "shh", code: "c1", redirect: "https://s.example.com/cb", verifier: "v1" }), "tok");
  assert.equal(sent?.url, D.token_endpoint);
  assert.match(sent?.body ?? "", /code_verifier=v1/);
  const none: SeamFetch = (async () => ({ status: 200, headers: {}, text: async () => "{}" })) as never;
  await assert.rejects(exchangeCode(none, D, { clientId: "app", clientSecret: "shh", code: "c1", redirect: "r", verifier: "v1" }), refused(/no ID token/));
  const down: SeamFetch = (async () => ({ status: 400, headers: {}, text: async () => "{}" })) as never;
  await assert.rejects(exchangeCode(down, D, { clientId: "app", clientSecret: "shh", code: "c1", redirect: "r", verifier: "v1" }), refused(/answered 400/));
});
