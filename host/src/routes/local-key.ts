// Unlock and lock the signed-in person's Mine items on their own node (ruling 62, 63): POST /local/vault/key/unlock { key } hands this daemon the person key their client unwrapped after a password sign-in,
// POST /local/vault/key/lock takes it away. Local only: the socket must be loopback, the Host must be a loopback name, and no proxy header may be present (a reverse proxy on this machine is loopback too, and
// a remote caller through it carries its own Host and forwarded headers). The key is for the person the bearer token belongs to and nobody else; a node that is not that person's refuses.
import type http from "node:http";
import { httpOf, makeError } from "./errors.ts";
import type { Keyring } from "../seams/keyring.ts";

export interface LocalKeyDeps {
  /** the person the request's bearer token belongs to, or null */
  person(headers: http.IncomingHttpHeaders): Promise<string | null> | string | null;
  keyring: Keyring;
  /** whether this node is that person's own */
  allowed(personId: string): boolean;
}

const TRACE = "0".repeat(32);
const LOOPBACK_ADDR = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "via"];
const PATH = /^\/local\/vault\/key\/(unlock|lock)$/;

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) { res.writeHead(status, { "cache-control": "no-store" }); res.end(); return; }
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}
const refuse = (res: http.ServerResponse, code: "permission.no_grant" | "auth.unauthenticated" | "validation.bad_input", message: string): void =>
  send(res, httpOf(code), { error: makeError(code, TRACE, { message }) });

export function isLocal(req: http.IncomingMessage): boolean {
  if (!LOOPBACK_ADDR.has(req.socket.remoteAddress ?? "")) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = String(req.headers["host"] ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_HOST.has(host);
}

async function bodyOf(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 1024) throw new Error("too large"); chunks.push(c as Buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function createLocalKeyRoute(deps: LocalKeyDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  async function serve(req: http.IncomingMessage, res: http.ServerResponse, op: "unlock" | "lock"): Promise<void> {
    if (!isLocal(req)) return refuse(res, "permission.no_grant", "This only works on your own computer.");
    const person = await deps.person(req.headers);
    if (!person) return refuse(res, "auth.unauthenticated", "Sign in first.");
    if (!deps.allowed(person)) return refuse(res, "permission.no_grant", "This computer is not yours, so it does not hold your key.");
    if (op === "lock") { deps.keyring.clear(person); return send(res, 204); }
    let key: Buffer;
    try {
      const k = (await bodyOf(req) as { key?: unknown }).key;
      key = typeof k === "string" ? Buffer.from(k, "base64") : Buffer.alloc(0);
    } catch { return refuse(res, "validation.bad_input", "Send { key } as base64."); }
    if (key.length !== 32) { key.fill(0); return refuse(res, "validation.bad_input", "The key is 32 bytes, base64."); }
    deps.keyring.hold(person, key);
    key.fill(0);
    send(res, 204);
  }
  return {
    handle(req, res) {
      const m = PATH.exec(new URL(req.url ?? "/", "http://vyred").pathname);
      if (!m) return false;
      if ((req.method ?? "GET").toUpperCase() !== "POST") { send(res, 405, { error: makeError("validation.bad_input", TRACE, { message: "POST only." }) }); return true; }
      void serve(req, res, m[1] as "unlock" | "lock").catch(() => { if (!res.headersSent) refuse(res, "validation.bad_input", "That did not work."); else res.end(); });
      return true;
    },
  };
}
