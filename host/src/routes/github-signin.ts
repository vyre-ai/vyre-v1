// Sign in with GitHub, the browser leg. GET /auth/github/start sends the person to GitHub (a state bound to this browser by a cookie);
// GET /auth/github/callback checks the state, then sends the browser back to the app with GitHub's one-use code in the URL FRAGMENT (never logged).
// The app then calls identity.github_sign_in {code}; the code is exchanged there, with the secret, and the Space's sign-in policy decides.
// The return address is the Space's own origin or a loopback address, so a crafted link cannot hand a code to a stranger's site.
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { GithubOAuth } from "../seams/people.ts";

const COOKIE = "vyre_gh_state";
const STATE_MS = 10 * 60_000;
const PATH = "/auth/github";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface GithubSignInRouteDeps { oauth: () => GithubOAuth | null; now?: () => number }

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const page = (res: http.ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void => { res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", ...headers }); res.end(text); };

export function createGithubSignInRoute(deps: GithubSignInRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const now = deps.now ?? Date.now;
  const states = new Map<string, { ret: string; exp: number }>();
  const origin = (req: http.IncomingMessage): string => {
    const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
    return `${proto === "https" ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
  };
  const allowedReturn = (own: string, ret: string): string | null => {
    try { const u = new URL(ret); return u.origin === own || (LOOPBACK.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")) ? u.origin + u.pathname + u.search : null; } catch { return null; }
  };
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      if (url.pathname !== `${PATH}/start` && url.pathname !== `${PATH}/callback`) return false;
      if (req.method !== "GET") { page(res, 405, "Not a way in."); return true; }
      const oauth = deps.oauth();
      if (!oauth) { page(res, 503, "GitHub sign-in is not set up on this server."); return true; }
      const own = origin(req);
      const redirect = `${own}${PATH}/callback`;
      for (const [k, v] of states) if (v.exp < now()) states.delete(k);
      if (url.pathname.endsWith("/start")) {
        const ret = allowedReturn(own, url.searchParams.get("return") ?? "");
        if (!ret) { page(res, 400, "That return address is not one this Space sends people back to."); return true; }
        if (states.size > 500) { page(res, 429, "Too many tries; wait a minute."); return true; }
        const state = randomBytes(24).toString("base64url");
        states.set(state, { ret, exp: now() + STATE_MS });
        const q = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: redirect, state, allow_signup: "false" });
        const secure = own.startsWith("https:") ? "; Secure" : "";
        res.writeHead(302, { location: `${oauth.authorizeUrl ?? "https://github.com/login/oauth/authorize"}?${q}`, "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": `${COOKIE}=${state}; Max-Age=${STATE_MS / 1000}; Path=${PATH}; HttpOnly; SameSite=Lax${secure}` });
        res.end();
        return true;
      }
      const state = url.searchParams.get("state") ?? "";
      const cookie = (req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
      const clear = `${COOKIE}=; Max-Age=0; Path=${PATH}; HttpOnly; SameSite=Lax`;
      const rec = states.get(state);
      states.delete(state);
      // The state must be the one THIS browser was given at /start: a callback opened from a link someone else started carries no such cookie.
      if (!rec || rec.exp < now() || !cookie || !same(cookie.slice(COOKIE.length + 1), state)) { page(res, 400, "This sign-in link is not valid. Go back to Vyre and try again.", { "set-cookie": clear }); return true; }
      const code = url.searchParams.get("code") ?? "";
      const frag = url.searchParams.get("error") || !code || code.length > 200 ? "github_error=denied" : `github_code=${encodeURIComponent(code)}`;
      res.writeHead(302, { location: `${rec.ret}#${frag}`, "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": clear });
      res.end();
      return true;
    },
  };
}
