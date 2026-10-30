// Sign in with the firm's own Google or Microsoft app (OIDC), the browser leg. GET /auth/sso/<provider>/start sends the person to the provider (state bound to this browser by a cookie, PKCE, a
// nonce); GET /auth/sso/<provider>/callback checks all of it, exchanges the code with the client secret from the Vault, checks the ID token, and sends the browser back to the app with a one-use
// ticket in the URL FRAGMENT (never logged). The app then calls identity.sso_sign_in {provider, code: ticket}. The ticket names a verified address at the firm's domain and nothing else; who that is,
// and whether they may sign in, is decided there. The return address is the Space's own origin or a loopback address.
import http from "node:http";
import { authorizeUrl, createJwksCache, discover, exchangeCode, guardAddresses, pkce, verifyIdToken } from "../seams/oidc.ts";
import { pinIssuer } from "../../../lib/oidc-issuer.ts";
import type { Discovery, SsoProvider } from "../seams/oidc.ts";
import type { SeamFetch } from "../seams/ports.ts";

const COOKIE = "vyre_sso_state";
const STATE_MS = 10 * 60_000;
const TICKET_MS = 2 * 60_000;
const PATH = "/auth/sso";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** One-use tickets from a finished sign-in. Shared by the route (which makes them) and identity (which spends them). */
export interface SsoTickets {
  make(key: string, email: string): string;
  take(key: string, ticket: string): { email: string } | null;
}
export function createSsoTickets(now: () => number = Date.now): SsoTickets {
  const open = new Map<string, { key: string; email: string; exp: number }>();
  return {
    make(key, email) {
      for (const [k, v] of open) if (v.exp < now()) open.delete(k);
      if (open.size > 500) open.clear();
      const t = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
      open.set(t, { key, email, exp: now() + TICKET_MS });
      return t;
    },
    take(key, ticket) {
      const v = open.get(ticket);
      open.delete(ticket);
      return v && v.key === key && v.exp >= now() ? { email: v.email } : null;
    },
  };
}

export interface SsoSignInRouteDeps {
  /** the providers that are on and set up */
  providers(): Promise<SsoProvider[]>;
  /** a Vault item's value by handle, for one call */
  secret(handle: string): Promise<string>;
  fetch: SeamFetch;
  /** the addresses a name resolves to, for a provider whose issuer an admin typed; only a test replaces it */
  resolve?: (host: string) => Promise<string[]>;
  tickets: SsoTickets;
  now?: () => number;
  /** a refusal the person did not cause, for the server's log (never the token) */
  log?: (why: string, attrs: Record<string, unknown>) => void;
}

const same = (a: string, b: string): boolean => { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return d === 0; };
const token = (): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
const page = (res: http.ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void => { res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(text); };

export function createSsoSignInRoute(deps: SsoSignInRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const now = deps.now ?? Date.now;
  const jwks = createJwksCache();
  const states = new Map<string, { key: string; ret: string; nonce: string; verifier: string; disc: Discovery; exp: number }>();
  const origin = (req: http.IncomingMessage): string => {
    const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
    return `${proto === "https" ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
  };
  const allowedReturn = (own: string, ret: string): string | null => {
    try { const u = new URL(ret); return u.origin === own || (LOOPBACK.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")) ? u.origin + u.pathname + u.search : null; } catch { return null; }
  };

  async function serve(req: http.IncomingMessage, res: http.ServerResponse, key: string, leg: "start" | "callback", url: URL): Promise<void> {
    const found = (await deps.providers()).find((p) => p.key === key);
    const pin = found ? pinIssuer(key, found.issuer) : undefined;
    if (!found || !pin || "error" in pin) return page(res, 503, "That sign-in is not set up on this server.");
    const provider = { ...found, issuer: pin.issuer };
    const fetch = pin.free ? guardAddresses(deps.fetch, deps.resolve) : deps.fetch;   // an issuer an admin typed is never dialled at a private address
    const own = origin(req);
    const redirect = `${own}${PATH}/${key}/callback`;
    for (const [k, v] of states) if (v.exp < now()) states.delete(k);
    if (leg === "start") {
      const ret = allowedReturn(own, url.searchParams.get("return") ?? "");
      if (!ret) return page(res, 400, "That return address is not one this Space sends people back to.");
      if (states.size > 500) return page(res, 429, "Too many tries; wait a minute.");
      let disc: Discovery;
      try { disc = await discover(fetch, provider.issuer); } catch (e) { deps.log?.("sso discovery failed", { key, why: (e as Error).message }); return page(res, 502, "The sign-in provider did not answer."); }
      const state = token(), nonce = token(), pk = await pkce();
      states.set(state, { key, ret, nonce, verifier: pk.verifier, disc, exp: now() + STATE_MS });
      const secure = own.startsWith("https:") ? "; Secure" : "";
      res.writeHead(302, { location: authorizeUrl(disc, { clientId: provider.clientId, redirect, state, nonce, challenge: pk.challenge, domainHint: provider.domainHint }), "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": `${COOKIE}=${state}; Max-Age=600; Path=${PATH}; HttpOnly; SameSite=Lax${secure}` });
      return void res.end();
    }
    const state = url.searchParams.get("state") ?? "";
    const cookie = (req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    const clear = `${COOKIE}=; Max-Age=0; Path=${PATH}; HttpOnly; SameSite=Lax`;
    const rec = states.get(state);
    states.delete(state);
    // The state must be the one THIS browser was given at /start, and for this provider.
    if (!rec || rec.key !== key || rec.exp < now() || !cookie || !same(cookie.slice(COOKIE.length + 1), state)) return page(res, 400, "This sign-in link is not valid. Go back to Vyre and try again.", { "set-cookie": clear });
    const back = (frag: string): void => { res.writeHead(302, { location: `${rec.ret}#${frag}`, "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": clear }); res.end(); };
    const code = url.searchParams.get("code") ?? "";
    if (url.searchParams.get("error") || !code || code.length > 2000) return back("sso_error=denied");
    try {
      const idToken = await exchangeCode(fetch, rec.disc, { clientId: provider.clientId, clientSecret: await deps.secret(provider.clientSecretHandle), code, redirect, verifier: rec.verifier });
      const who = await verifyIdToken(fetch, rec.disc, idToken, { clientId: provider.clientId, nonce: rec.nonce, domain: provider.domainHint, now: now(), jwks });
      back(`sso_code=${encodeURIComponent(deps.tickets.make(key, who.email))}&sso_provider=${encodeURIComponent(key)}`);
    } catch (e) {
      deps.log?.("sso sign-in refused", { key, why: (e as Error).message });
      back("sso_error=refused");
    }
  }

  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      const m = /^\/auth\/sso\/([a-z]+)\/(start|callback)$/.exec(url.pathname);
      if (!m) return false;
      if (req.method !== "GET") { res.setHeader("allow", "GET"); page(res, 405, "Not a way in."); return true; }
      void serve(req, res, m[1]!, m[2] as "start" | "callback", url).catch(() => { if (!res.headersSent) page(res, 500, "Something went wrong on our side."); else res.end(); });
      return true;
    },
  };
}
