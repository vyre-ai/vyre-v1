// OpenID Connect for the firm's own sign-in app: the authorization address, discovery rules and every way an ID token can be wrong. Signed with a throwaway key made in the test.
import test from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, createJwksCache, discover, exchangeCode, guardAddresses, OidcError, pkce, verifyIdToken } from "./oidc.ts";
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
  const T1 = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", T2 = "1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
  const t = await sign(good({ iss: `https://login.example.com/${T1}/v2.0`, tid: T1 }));
  assert.equal((await verifyIdToken(fetchKeys, ms, t, { clientId: "app", nonce: "n1", domain: "firm.test", now: NOW })).email, "ana@firm.test");
  const bad = await sign(good({ iss: `https://login.example.com/${T2}/v2.0`, tid: T1 }));
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

test("discovery whose issuer is not exactly the expected one is refused before any address in it is used", async () => {
  const answer = (b: unknown): SeamFetch => (async () => ({ status: 200, headers: {}, text: async () => JSON.stringify(b) })) as never;
  const doc = (issuer: string) => ({ issuer, authorization_endpoint: "https://evil.example.com/a", token_endpoint: "https://evil.example.com/t", jwks_uri: "https://evil.example.com/k" });
  await assert.rejects(discover(answer(doc("https://evil.example.com")), ISS), refused(/different issuer/));
  await assert.rejects(discover(answer(doc(`${ISS}.evil.example.com`)), ISS), refused(/different issuer/));
  const ms = "https://login.microsoftonline.com/common/v2.0";
  assert.equal((await discover(answer(doc("https://login.microsoftonline.com/{tenantid}/v2.0")), ms)).issuer, "https://login.microsoftonline.com/{tenantid}/v2.0");
  await assert.rejects(discover(answer(doc("https://login.microsoftonline.com/{tenantid}/v2.0")), ISS), refused(/different issuer/), "only Microsoft's shared tenants may say {tenantid}");
});

test("a Microsoft token whose tenant is not an id never matches the placeholder issuer", async () => {
  const ms: Discovery = { ...D, issuer: "https://login.example.com/{tenantid}/v2.0" };
  const t = await sign(good({ iss: "https://login.example.com/evil/v2.0", tid: "evil" }));
  await assert.rejects(verifyIdToken(fetchKeys, ms, t, { clientId: "app", nonce: "n1", domain: "firm.test", now: NOW }), refused(/another issuer/));
});

test("signing keys are kept for the TTL and fetched once more only for a key the copy lacks", async () => {
  let fetched = 0;
  const f: SeamFetch = (async () => { fetched += 1; return { status: 200, headers: {}, text: async () => JSON.stringify({ keys: [jwk] }) }; }) as never;
  const jwks = createJwksCache(60_000);
  const token = await sign(good());
  const run = (now: number) => verifyIdToken(f, D, token, { clientId: "app", nonce: "n1", domain: "firm.test", now, jwks });
  await run(NOW); await run(NOW + 1000);
  assert.equal(fetched, 1, "the second sign-in used the kept keys");
  await run(NOW + 61_000);
  assert.equal(fetched, 2, "after the TTL they are fetched again");
  const rotated = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode("x"));
  assert.ok(rotated.byteLength > 0);
  const h = b64({ alg: "RS256", kid: "k2" }), c = b64(good());
  const s2 = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${c}`));
  const unknownKid = `${h}.${c}.${Buffer.from(s2).toString("base64url")}`;
  fetched = 0;
  await assert.rejects(verifyIdToken(f, D, unknownKid, { clientId: "app", nonce: "n1", domain: "firm.test", now: NOW + 62_000, jwks }), refused(/no key/));
  assert.equal(fetched, 1, "an unknown key id refetches exactly once, then refuses");
});

test("a typed issuer is never dialled at a local or private address, by name or by what the name resolves to", async () => {
  const ok: SeamFetch = (async () => ({ status: 200, headers: {}, text: async () => "{}" })) as never;
  const g = guardAddresses(ok, async (h) => (h === "sneaky.example.com" ? ["10.0.0.5"] : ["93.184.216.34"]));
  await assert.rejects(g("https://localhost/x"), refused(/public/));
  await assert.rejects(g("https://127.0.0.1/x"), refused(/public/));
  await assert.rejects(g("https://169.254.169.254/x"), refused(/public/));
  await assert.rejects(g("https://intranet/x"), refused(/public/));
  await assert.rejects(g("https://sneaky.example.com/x"), refused(/private/));
  assert.equal((await g("https://idp.example.com/x")).status, 200);
});
