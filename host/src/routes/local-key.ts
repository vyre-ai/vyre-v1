// Unlock and lock the signed-in person's Mine items on their own node (ruling 62, 63): POST /local/vault/key/unlock { key } hands this daemon the person key their client unwrapped after a password sign-in,
// POST /local/vault/key/lock takes it away. Local only: the socket must be loopback, the Host must be a loopback name, and no proxy header may be present (a reverse proxy on this machine is loopback too, and
// a remote caller through it carries its own Host and forwarded headers). The key is for the person the bearer token belongs to and nobody else; a node that is not that person's refuses.
// Owner ruling 3 Nov (R62 amended): a Space server may also hold a person's key while that person is signed in, so a member's own AI account works on the Space with nothing to set up. That door is
// POST /vault/key/unlock | lock | status on the Space's own address: https only (or this machine), a signed-in device session only (never the admin token), and the key is bound to that session, so it is
// dropped when the person's sessions end. It is held for the bearer's own person and opened only for their own turns (the vault's KeyPort); it is never written to disk or readable through any API.
import type http from "node:http";
import { httpOf, makeError } from "./errors.ts";
import type { Keyring } from "../seams/keyring.ts";
import { linkIsSecure } from "./compute-stream.ts";

export interface LocalKeyDeps {
  /** who the request's bearer token belongs to, and the device session it is (none for the local admin token), or null */
  caller(headers: http.IncomingHttpHeaders): Promise<{ person: string; sessionId?: string } | null> | { person: string; sessionId?: string } | null;
  keyring: Keyring;
  /** whether this node may hold that person's key for this session (their own computer, or a Space server while the session is signed in) */
  allowed(personId: string, sessionId?: string): boolean;
  /** told when a key is handed over or taken away (ids only, never the key) */
  log?(msg: string, attrs: Record<string, unknown>): void;
}

const TRACE = "0".repeat(32);
const LOOPBACK_ADDR = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "via"];
const PATH = /^\/(local\/)?vault\/key\/(unlock|lock|status)$/;

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
  async function serve(req: http.IncomingMessage, res: http.ServerResponse, op: "unlock" | "lock" | "status", local: boolean): Promise<void> {
    // the Space's door: the same test as a node link that carries an account key (TLS here, or https as told by a proxy on this machine); never plain http from another machine
    if (local ? !isLocal(req) : !linkIsSecure(req)) return refuse(res, "permission.no_grant", local ? "This only works on your own computer." : "Your key goes to the Space over https only.");
    const caller = await deps.caller(req.headers);
    const person = caller?.person;
    if (!person || !caller) return refuse(res, "auth.unauthenticated", "Sign in first.");
    // the Space's door takes a key only from a signed-in session of the person themselves, and binds it to that session
    if (!local && caller.sessionId === undefined) return refuse(res, "permission.no_grant", "Sign in on a device to open your Vault.");
    if (!deps.allowed(person, caller.sessionId)) return refuse(res, "permission.no_grant", "This computer is not yours, so it does not hold your key.");
    // whether this node holds the person's key (a yes or no; the key never leaves). The app asks at launch, to show its lock screen only when it is needed, and while it runs, to hand the key over again after a restart.
    if (op === "status") { const k = deps.keyring.get(person); const held = k !== null; k?.fill(0); return send(res, 200, { held }); }
    if (op === "lock") { deps.keyring.clear(person); deps.log?.("vault.key_dropped", { person, door: local ? "local" : "space" }); return send(res, 204); }
    let key: Buffer;
    try {
      const k = (await bodyOf(req) as { key?: unknown }).key;
      key = typeof k === "string" ? Buffer.from(k, "base64") : Buffer.alloc(0);
    } catch { return refuse(res, "validation.bad_input", "Send { key } as base64."); }
    if (key.length !== 32) { key.fill(0); return refuse(res, "validation.bad_input", "The key is 32 bytes, base64."); }
    const held = deps.keyring.hold(person, key, caller.sessionId);
    key.fill(0);
    if (!held) return refuse(res, "permission.no_grant", "This computer is not yours, so it does not hold your key.");
    deps.log?.("vault.key_held", { person, door: local ? "local" : "space", ...(caller.sessionId ? { session: caller.sessionId } : {}) });
    send(res, 204);
  }
  return {
    handle(req, res) {
      const m = PATH.exec(new URL(req.url ?? "/", "http://vyred").pathname);
      if (!m) return false;
      if ((req.method ?? "GET").toUpperCase() !== "POST") { send(res, 405, { error: makeError("validation.bad_input", TRACE, { message: "POST only." }) }); return true; }
      void serve(req, res, m[2] as "unlock" | "lock" | "status", m[1] !== undefined).catch(() => { if (!res.headersSent) refuse(res, "validation.bad_input", "That did not work."); else res.end(); });
      return true;
    },
  };
}
