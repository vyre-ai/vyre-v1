// OpenID Connect for the firm's own sign-in app (Google, Microsoft, Okta): discovery, the authorization address with PKCE, the code exchange with the client secret from the Vault, and the check
// of the ID token (signature against the provider's published keys, issuer, audience, expiry, nonce, and that it names an address at the firm's domain). Nothing here knows about people:
// it answers which verified address signed in, and the caller decides who that is.
import { lookup } from "node:dns/promises";
import { refusesAddress } from "../../../lib/address-guard.ts";
import { refusedHost } from "../../../lib/oidc-issuer.ts";
import type { SeamFetch } from "./ports.ts";

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface SsoProvider { key: string; title: string; issuer: string; clientId: string; clientSecretHandle: string; enabled: boolean; domainHint?: string }
export interface Verified { email: string; subject: string; /** Microsoft only: the tenant and the person's immutable id in it; the Space links a person on these, never on the address alone */ tenant?: string; oid?: string }

const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class OidcError extends Error {}
const refuse = (why: string): never => { throw new OidcError(why); };

async function json(fetch: SeamFetch, url: string, init?: Parameters<SeamFetch>[1]): Promise<Record<string, unknown>> {
  const r = await fetch(url, init);
  if (r.status < 200 || r.status >= 300) refuse(`${new URL(url).hostname} answered ${r.status}`);
  try { return obj(JSON.parse(await r.text())); } catch { return refuse("the provider's answer was not JSON"); }
}

const https = (u: string | undefined, what: string): string => {
  let url: URL;
  try { url = new URL(u ?? ""); } catch { return refuse(`${what} is not an address`); }
  if (url.protocol !== "https:" || url.username || url.password) refuse(`${what} must be an https address`);
  return url.toString();
};

/** The provider's discovery document. Its issuer must be exactly the one expected (mix-up defence) before any address in it is used. */
export async function discover(fetch: SeamFetch, issuer: string): Promise<Discovery> {
  const want = https(issuer, "the issuer").replace(/\/+$/, "");
  const d = await json(fetch, `${want}/.well-known/openid-configuration`);
  const said = (text(d["issuer"]) ?? refuse("the provider names no issuer")).replace(/\/+$/, "");
  if (said !== want) refuse("the provider's discovery document names a different issuer");
  return { issuer: said, authorization_endpoint: https(text(d["authorization_endpoint"]), "the authorization address"), token_endpoint: https(text(d["token_endpoint"]), "the token address"), jwks_uri: https(text(d["jwks_uri"]), "the key address") };
}

/** A fetch for a provider whose issuer an admin typed: it dials no local or private host, by name or by what the name resolves to. */
export function guardAddresses(fetch: SeamFetch, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): SeamFetch {
  return (async (url: string, init?: Parameters<SeamFetch>[1]) => {
    const host = new URL(url).hostname;
    if (refusedHost(host)) throw new OidcError("that provider address is not a public one");
    if (!/^[\d.]+$|:/.test(host) && (await resolve(host)).some((a) => refusesAddress(a))) throw new OidcError("that provider address resolves to a private one");
    return fetch(url, init);
  }) as SeamFetch;
}

/** The published signing keys, kept for a short time. A token signed by a key the copy lacks fetches the list once more, so a rotation works without a fetch on every sign-in. */
export interface JwksCache { get(fetch: SeamFetch, uri: string, kid: string | undefined, now: number): Promise<Record<string, unknown>[]> }
export function createJwksCache(ttlMs = 10 * 60_000): JwksCache {
  const kept = new Map<string, { keys: Record<string, unknown>[]; at: number }>();
  const pick = (keys: Record<string, unknown>[], kid: string | undefined) => keys.some((k) => k["kty"] === "RSA" && (kid === undefined || k["kid"] === kid));
  return {
    async get(fetch, uri, kid, now) {
      const have = kept.get(uri);
      if (have && now - have.at < ttlMs && pick(have.keys, kid)) return have.keys;
      const list = await json(fetch, uri);
      const keys = (Array.isArray(list["keys"]) ? list["keys"] : []).map(obj);
      kept.set(uri, { keys, at: now });
      if (kept.size > 50) kept.delete(kept.keys().next().value as string);
      return keys;
    },
  };
}

/** A PKCE pair: the verifier stays with the Space, the challenge goes to the provider. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: b64url(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))) };
}

export function authorizeUrl(d: Discovery, p: { clientId: string; redirect: string; state: string; nonce: string; challenge: string; domainHint?: string | undefined }): string {
  const q = new URLSearchParams({ client_id: p.clientId, response_type: "code", scope: "openid email profile", redirect_uri: p.redirect, state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: "S256" });
  if (p.domainHint) { q.set("hd", p.domainHint); q.set("domain_hint", p.domainHint); }   // Google reads hd, Microsoft domain_hint; both only steer the page, the check is on the token
  return `${d.authorization_endpoint}${d.authorization_endpoint.includes("?") ? "&" : "?"}${q}`;
}

export async function exchangeCode(fetch: SeamFetch, d: Discovery, p: { clientId: string; clientSecret: string; code: string; redirect: string; verifier: string }): Promise<string> {
  const r = await json(fetch, d.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirect, client_id: p.clientId, client_secret: p.clientSecret, code_verifier: p.verifier }).toString(),
  });
  return text(r["id_token"]) ?? refuse("the provider sent no ID token");
}

const part = (s: string | undefined): Record<string, unknown> => { try { return obj(JSON.parse(Buffer.from(s ?? "", "base64url").toString("utf8"))); } catch { return {}; } };

/** The address an ID token proves, or a refusal saying why not. The signature is checked first; nothing in an unsigned token is believed. */
export async function verifyIdToken(fetch: SeamFetch, d: Discovery, token: string, p: { clientId: string; nonce: string; domain: string | undefined; now: number; jwks?: JwksCache; /** Microsoft: the one tenant this sign-in is for; the token must come from it */ tenant?: string }): Promise<Verified> {
  const [h, c, s] = token.split(".");
  if (!h || !c || !s) refuse("that is not an ID token");
  const header = part(h);
  if (header["alg"] !== "RS256") refuse("the ID token is not signed with RS256");
  const list = p.jwks ? await p.jwks.get(fetch, d.jwks_uri, text(header["kid"]), p.now) : await createJwksCache(0).get(fetch, d.jwks_uri, text(header["kid"]), p.now);
  const jwk = list.find((k) => k["kty"] === "RSA" && (header["kid"] === undefined || k["kid"] === header["kid"]));
  if (!jwk) refuse("the provider has no key for this token");
  const key = await globalThis.crypto.subtle.importKey("jwk", { kty: "RSA", n: text(jwk!["n"]), e: text(jwk!["e"]), alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await globalThis.crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`));
  if (!ok) refuse("the ID token's signature is not the provider's");
  const claims = part(c);
  if (claims["iss"] !== d.issuer) refuse("the ID token is from another issuer");
  const aud = claims["aud"];
  if (!(aud === p.clientId || (Array.isArray(aud) && aud.includes(p.clientId)))) refuse("the ID token is for another app");
  const exp = typeof claims["exp"] === "number" ? claims["exp"] * 1000 : 0;
  if (exp < p.now - 60_000) refuse("the ID token has expired");
  if (typeof claims["iat"] === "number" && claims["iat"] * 1000 > p.now + 5 * 60_000) refuse("the ID token is from the future");
  if (claims["nonce"] !== p.nonce) refuse("the ID token is not the one this sign-in asked for");
  if (!p.domain) refuse("this provider has no firm domain set, so it cannot sign anyone in");
  const ms = p.tenant !== undefined;
  if (ms) {
    // Microsoft's email claim is not verified (anyone can set it in a tenant they run), so for Microsoft the tenant is checked and the person is known by their immutable id; the address is the account name
    if (String(claims["tid"] ?? "").toLowerCase() !== p.tenant!.toLowerCase()) refuse("the ID token is from another Microsoft tenant");
    if (!/^[0-9a-f-]{36}$/i.test(text(claims["oid"]) ?? "")) refuse("the ID token names no user id");
  }
  const email = (ms ? (text(claims["preferred_username"]) ?? text(claims["upn"]) ?? "") : (text(claims["email"]) ?? text(claims["preferred_username"]) ?? "")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) refuse("the ID token names no email address");
  if (claims["email_verified"] === false || claims["email_verified"] === "false") refuse("the provider has not verified that address");
  if (!email.endsWith(`@${p.domain}`)) refuse(`that address is not at ${p.domain}`);
  if (claims["hd"] !== undefined && String(claims["hd"]).toLowerCase() !== p.domain) refuse("the account belongs to another domain");
  if (ms) return { email, subject: String(claims["oid"]).toLowerCase(), tenant: p.tenant!.toLowerCase(), oid: String(claims["oid"]).toLowerCase() };
  return { email, subject: text(claims["sub"]) ?? email };
}
