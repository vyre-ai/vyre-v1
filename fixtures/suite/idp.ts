// A stand-in OpenID Connect provider for the sign-in tests: discovery, a token endpoint that checks the client, the secret and the PKCE verifier, and the published key. It signs ID
// tokens with a key made here, so a token it issues is really verified by the code under test, and a tampered one is really refused.
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import type { SeamApi } from "./world.ts";

export interface Idp {
  api: SeamApi;
  issuer: string;
  /** what the provider does when the person approves: it remembers the nonce and challenge from the authorize address and hands back a code for these claims */
  approve(authorizeUrl: string, claims: Record<string, unknown>, o?: { tamper?: boolean; wrongKey?: boolean }): string;
  secret: string;
}

export function createIdp(o: { issuer: string; clientId: string; secret: string; kid?: string }): Idp {
  const kid = o.kid ?? "k1";
  const mine = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = mine.publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown>; tamper: boolean; wrongKey: boolean }>();
  const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");
  const sign = (key: typeof mine.privateKey, data: string): string => createSign("RSA-SHA256").update(data).sign(key, "base64url");
  const api: SeamApi = ({ method, url, body }) => {
    if (url === `${o.issuer}/.well-known/openid-configuration`) return { json: { issuer: o.issuer, authorization_endpoint: `${o.issuer}/authorize`, token_endpoint: `${o.issuer}/token`, jwks_uri: `${o.issuer}/jwks` } };
    if (url === `${o.issuer}/jwks`) return { json: { keys: [{ kty: "RSA", kid, alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] } };
    if (url === `${o.issuer}/token` && method === "POST") {
      const f = new URLSearchParams(String(body));
      const rec = codes.get(f.get("code") ?? "");
      codes.delete(f.get("code") ?? "");
      if (!rec || f.get("client_id") !== o.clientId || f.get("client_secret") !== o.secret || f.get("grant_type") !== "authorization_code") return { status: 400, json: { error: "invalid_grant" } };
      const verifier = f.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== rec.challenge) return { status: 400, json: { error: "invalid_grant", error_description: "PKCE verification failed" } };
      const now = Math.floor(Date.now() / 1000);
      const head = b64({ alg: "RS256", kid, typ: "JWT" });
      const payload = b64({ iss: o.issuer, aud: o.clientId, iat: now, exp: now + 300, nonce: rec.nonce, sub: "sub-1", ...rec.claims });
      const signed = `${head}.${payload}`;
      let sig = sign(rec.wrongKey ? other.privateKey : mine.privateKey, signed);
      const token = rec.tamper ? `${head}.${b64({ iss: o.issuer, aud: o.clientId, iat: now, exp: now + 300, nonce: rec.nonce, sub: "sub-1", ...rec.claims, email: "intruder@firm.test" })}.${sig}` : `${signed}.${sig}`;
      sig = "";
      return { json: { id_token: token, access_token: "unused", token_type: "Bearer" } };
    }
    return undefined;
  };
  return {
    api, issuer: o.issuer, secret: o.secret,
    approve(authorizeUrl, claims, flags = {}) {
      const u = new URL(authorizeUrl);
      const code = `code-${codes.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
      codes.set(code, { nonce: u.searchParams.get("nonce") ?? "", challenge: u.searchParams.get("code_challenge") ?? "", claims, tamper: flags.tamper === true, wrongKey: flags.wrongKey === true });
      return code;
    },
  };
}
