// The compute channel (computer to Space): POST /compute/poll. A computer that joined sends its credential as a bearer token and a short report; the Space notes that it is alive and answers with what it should do.
// There is no session: the credential, held only as a hash by the network module, is the whole authority, and a revoked or unknown one is a plain 401 that says nothing about which. The computer always
// dials out, so it needs no open port. Every answer is small and uncached.
import type http from "node:http";
import { makeError } from "./errors.ts";
import { sourceOf } from "../daemon/preauth.ts";

const TRACE = "0".repeat(32);
const MAX_BODY = 16 * 1024;
const PER_MINUTE = 240;

export interface ComputeRouteDeps {
  /** The network module's host call: who holds this credential, if still admitted, noting that they are alive. */
  poll(credential: string, report: { docker?: boolean; version?: string }): Promise<{ serverId: string; owner?: string } | null>;
  now?: () => number;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

export function createComputeRoute(deps: ComputeRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const now = deps.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const limited = (key: string): boolean => {
    const at = now(), list = (hits.get(key) ?? []).filter((t) => at - t < 60_000);
    list.push(at); hits.delete(key); hits.set(key, list);
    if (hits.size > 5_000) hits.delete(hits.keys().next().value as string);
    return list.length > PER_MINUTE;
  };
  async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const source = sourceOf({ "x-vyre-remote": req.socket.remoteAddress ?? "", ...(typeof req.headers["x-forwarded-for"] === "string" ? { "x-forwarded-for": req.headers["x-forwarded-for"] } : {}) });
    if (limited(source)) { res.setHeader("retry-after", "60"); return send(res, 429, { error: makeError("rate_limit.exceeded" as never, TRACE, { message: "Too many requests from this address." }) }); }
    const auth = req.headers["authorization"];
    const credential = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) return send(res, 413, { error: makeError("validation.too_large" as never, TRACE, { message: "That report is too large." }) }); chunks.push(c as Buffer); }
    let report: { docker?: boolean; version?: string } = {};
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>; if (typeof parsed["docker"] === "boolean") report.docker = parsed["docker"]; if (typeof parsed["version"] === "string") report.version = parsed["version"].slice(0, 40); } catch { report = {}; }
    const who = credential.startsWith("vcc_") ? await deps.poll(credential, report).catch(() => null) : null;
    if (!who) return send(res, 401, { error: makeError("auth.unauthenticated" as never, TRACE, { message: "This computer is not admitted." }) });
    send(res, 200, { ok: true, serverId: who.serverId, jobs: [] });
  }
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname !== "/compute/poll") return false;
      if (req.method !== "POST") { send(res, 405, { error: makeError("validation.bad_input" as never, TRACE, { message: "Use POST." }) }); return true; }
      void serve(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: makeError("internal.unexpected" as never, TRACE) }); });
      return true;
    },
  };
}
