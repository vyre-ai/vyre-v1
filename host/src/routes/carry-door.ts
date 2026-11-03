// The carry door (rc.17, lead ruling 3 Nov): "I already have a Vyre account" on another Space's web page reaches this Space from a foreign https origin. Only these cross, with CORS:
//   POST /v1/identity/sign_in_options and /v1/identity/recovery_fetch   anonymous, as they are (recovery_fetch keeps its rate limit)
//   POST /v1/identity/sign_in            never a session from a foreign origin: a carry token (modules/identity/handlers/carry.ts), 5 minutes, bound to that Origin
//   POST /v1/identity/keys_get           with the carry token, once
//   POST /v1/identity/whoami, sign_out   with the carry token
// A carry token (vct_) is answered here and nowhere else: every other route and capability refuses it, from a browser or not. Nothing else gets CORS headers for a foreign origin
// (host/src/daemon/desktop-cors.ts stays the rule for the desktop app), so a foreign page can call nothing else in a browser.
import type http from "node:http";
import { packagedOrigin } from "../daemon/desktop-cors.ts";

export interface CarryDoorDeps {
  /** this Space's own public origin, when it has one */
  ownOrigin(): string | null;
  /** the identity module's host calls (identity.carry_sign_in, identity.carry_use) */
  call(name: string, input: unknown): Promise<unknown>;
  now?(): number;
}

const CARRY = "vct_";
const CROSS = new Set(["/v1/identity/sign_in_options", "/v1/identity/sign_in", "/v1/identity/recovery_fetch", "/v1/identity/keys_get", "/v1/identity/whoami", "/v1/identity/sign_out"]);
const BY_TOKEN: Record<string, "keys_get" | "whoami" | "sign_out"> = { "/v1/identity/keys_get": "keys_get", "/v1/identity/whoami": "whoami", "/v1/identity/sign_out": "sign_out" };
const HEADERS = new Set(["accept", "authorization", "content-type", "idempotency-key", "x-vyre-trace"]);
const TRACE = "0".repeat(32);

const bearerOf = (h: string | string[] | undefined): string | null => (typeof h === "string" && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : null);

/** The Origin of a request from another site's https page: not this Space's own, not the request's own host, not the desktop app. Null for everything else. */
export function foreignOrigin(req: http.IncomingMessage, own: string | null): string | null {
  const o = req.headers.origin;
  if (typeof o !== "string" || o === "" || packagedOrigin(o)) return null;
  let u: URL;
  try { u = new URL(o); } catch { return null; }
  if (u.protocol !== "https:" || u.origin !== o) return null;
  if (own && o === own) return null;
  const host = String(req.headers.host ?? "").toLowerCase();
  if (host && (o === `https://${host}` || o === `http://${host}`)) return null;
  return o;
}

function send(res: http.ServerResponse, status: number, body: unknown, origin: string | null): void {
  const text = JSON.stringify(body);
  const h: Record<string, string | number> = { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", vary: "Origin" };
  if (origin) { h["access-control-allow-origin"] = origin; h["access-control-expose-headers"] = "x-vyre-trace, retry-after"; }
  res.writeHead(status, h);
  res.end(text);
}
const refuse = (res: http.ServerResponse, status: number, code: string, message: string, origin: string | null): void => send(res, status, { error: { code, message, retryable: false, traceId: TRACE } }, origin);

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 4096) throw new Error("too large"); chunks.push(c as Buffer); }
  const v: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

export function createCarryDoor(deps: CarryDoorDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const now = deps.now ?? Date.now;
  // a carry sign-in is a sign-in: at most 10 a minute from one origin and one address
  const tries = new Map<string, number[]>();
  const limited = (key: string): boolean => {
    const t = now(), recent = (tries.get(key) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    tries.set(key, recent);
    if (tries.size > 2000) tries.clear();
    return recent.length > 10;
  };
  async function serveToken(req: http.IncomingMessage, res: http.ServerResponse, path: string, token: string, origin: string | null): Promise<void> {
    req.resume();
    const op = BY_TOKEN[path];
    if (!op || (req.method ?? "GET").toUpperCase() !== "POST") return refuse(res, 401, "auth.unauthenticated", "This sign-in only brings your account to another Space.", origin);
    const out = await deps.call("identity.carry_use", { token, origin: typeof req.headers.origin === "string" ? req.headers.origin : "", op });
    if (out === null || out === undefined) return refuse(res, 401, "auth.unauthenticated", "This sign-in has ended. Sign in again.", origin);
    send(res, 200, { data: out }, origin);
  }
  async function serveSignIn(req: http.IncomingMessage, res: http.ServerResponse, origin: string): Promise<void> {
    if (limited(`${origin}|${req.socket.remoteAddress ?? ""}`)) { req.resume(); return refuse(res, 429, "rate_limit.exceeded", "Too many tries. Wait a minute, then try again.", origin); }
    let input: Record<string, unknown>;
    try { input = await body(req); } catch { return refuse(res, 400, "validation.bad_input", "Send the username and password.", origin); }
    const username = typeof input["username"] === "string" ? input["username"] : "", password = typeof input["password"] === "string" ? input["password"] : "";
    const totp = typeof input["totp"] === "string" && /^\d{6}$/.test(input["totp"]) ? input["totp"] : undefined;
    if (!username || !password || username.length > 64 || password.length > 1024) return refuse(res, 400, "validation.bad_input", "Send the username and password.", origin);
    const out = await deps.call("identity.carry_sign_in", { username, password, origin, ...(totp ? { totp } : {}) }) as { token?: string; expiresAt?: number; refused?: string };
    if (out.refused === "second_factor_required") return send(res, 200, { data: { status: "second_factor_required" } }, origin);
    if (out.refused === "invalid_code") return refuse(res, 401, "auth.invalid_code", "That code is not right.", origin);
    if (out.refused === "unavailable") return refuse(res, 503, "internal.unavailable", "Try again in a moment.", origin);
    if (out.refused || !out.token) return refuse(res, 401, "auth.bad_credentials", "Check the username and password.", origin);
    // a carry token, never a session: the page that asked can read this account's bundle once, its name, and end it
    send(res, 200, { data: { status: "ok", carry: true, session: { token: out.token, expiresAt: out.expiresAt } } }, origin);
  }
  return {
    handle(req, res) {
      const path = new URL(req.url ?? "/", "http://vyred").pathname;
      const token = bearerOf(req.headers.authorization);
      const origin = foreignOrigin(req, deps.ownOrigin());
      if (token?.startsWith(CARRY)) {
        void serveToken(req, res, path, token, origin && CROSS.has(path) ? origin : null).catch(() => { if (!res.headersSent) refuse(res, 401, "auth.unauthenticated", "This sign-in has ended. Sign in again.", null); else res.end(); });
        return true;
      }
      if (!origin || !CROSS.has(path)) return false;
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        const asked = req.headers["access-control-request-method"], requested = req.headers["access-control-request-headers"];
        const list = typeof requested === "string" ? requested.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) : [];
        if (asked !== "POST" || list.some((h) => !HEADERS.has(h))) { res.writeHead(403, { vary: "Origin" }); res.end(); return true; }
        res.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", ...(list.length ? { "access-control-allow-headers": list.join(", ") } : {}), "access-control-max-age": "600", vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers" });
        res.end();
        return true;
      }
      // from a foreign page, only a carry token or nothing: a session token there is one the page should never have
      if (token) { req.resume(); refuse(res, 403, "permission.no_grant", "Not from another Space's page.", origin); return true; }
      if (path === "/v1/identity/sign_in") { void serveSignIn(req, res, origin).catch(() => { if (!res.headersSent) refuse(res, 503, "internal.unavailable", "Try again in a moment.", origin); else res.end(); }); return true; }
      if (BY_TOKEN[path]) { req.resume(); refuse(res, 401, "auth.unauthenticated", "Sign in first.", origin); return true; }
      // sign_in_options and recovery_fetch: as they are, through the gateway, with CORS for this origin
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-expose-headers", "x-vyre-trace, retry-after");
      res.setHeader("vary", "Origin");
      return false;
    },
  };
}
