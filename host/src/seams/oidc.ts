// OpenID Connect for the firm's own sign-in app (Google, Microsoft, Okta): discovery, the authorization address with PKCE, the code exchange with the client secret from the Vault, and the check
// of the ID token (signature against the provider's published keys, issuer, audience, expiry, nonce, and that it names an address at the firm's domain). Nothing here knows about people:
// it answers which verified address signed in, and the caller decides who that is.
import type { SeamFetch } from "./ports.ts";

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface SsoProvider { key: string; title: string; issuer: string; clientId: string; clientSecretHandle: string; enabled: boolean; domainHint?: string }
export interface Verified { email: string; subject: string }

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

export async function discover(fetch: SeamFetch, issuer: string): Promise<Discovery> {
  const d = await json(fetch, `${https(issuer, "the issuer").replace(/\/+$/, "")}/.well-known/openid-configuration`);
  return { issuer: text(d["issuer"]) ?? refuse("the provider names no issuer"), authorization_endpoint: https(text(d["authorization_endpoint"]), "the authorization address"), token_endpoint: https(text(d["token_endpoint"]), "the token address"), jwks_uri: https(text(d["jwks_uri"]), "the key address") };
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
export async function verifyIdToken(fetch: SeamFetch, d: Discovery, token: string, p: { clientId: string; nonce: string; domain: string | undefined; now: number }): Promise<Verified> {
  const [h, c, s] = token.split(".");
  if (!h || !c || !s) refuse("that is not an ID token");
  const header = part(h);
  if (header["alg"] !== "RS256") refuse("the ID token is not signed with RS256");
  const keys = await json(fetch, d.jwks_uri);
  const jwk = (Array.isArray(keys["keys"]) ? keys["keys"] : []).map(obj).find((k) => k["kty"] === "RSA" && (header["kid"] === undefined || k["kid"] === header["kid"]));
  if (!jwk) refuse("the provider has no key for this token");
  const key = await globalThis.crypto.subtle.importKey("jwk", { kty: "RSA", n: text(jwk!["n"]), e: text(jwk!["e"]), alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await globalThis.crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`));
  if (!ok) refuse("the ID token's signature is not the provider's");
  const claims = part(c);
  const issuer = d.issuer.includes("{tenantid}") ? d.issuer.replace("{tenantid}", text(claims["tid"]) ?? "") : d.issuer;
  if (claims["iss"] !== issuer) refuse("the ID token is from another issuer");
  const aud = claims["aud"];
  if (!(aud === p.clientId || (Array.isArray(aud) && aud.includes(p.clientId)))) refuse("the ID token is for another app");
  const exp = typeof claims["exp"] === "number" ? claims["exp"] * 1000 : 0;
  if (exp < p.now - 60_000) refuse("the ID token has expired");
  if (typeof claims["iat"] === "number" && claims["iat"] * 1000 > p.now + 5 * 60_000) refuse("the ID token is from the future");
  if (claims["nonce"] !== p.nonce) refuse("the ID token is not the one this sign-in asked for");
  if (!p.domain) refuse("this provider has no firm domain set, so it cannot sign anyone in");
  const email = (text(claims["email"]) ?? text(claims["preferred_username"]) ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) refuse("the ID token names no email address");
  if (claims["email_verified"] === false || claims["email_verified"] === "false") refuse("the provider has not verified that address");
  if (!email.endsWith(`@${p.domain}`)) refuse(`that address is not at ${p.domain}`);
  if (claims["hd"] !== undefined && String(claims["hd"]).toLowerCase() !== p.domain) refuse("the account belongs to another domain");
  return { email, subject: text(claims["sub"]) ?? email };
}
