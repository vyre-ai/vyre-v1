// The compute channel (computer to Space): POST /compute/poll, /compute/result and /compute/home. A computer that joined sends its credential as a bearer token and a short report; the Space notes that it is alive and answers with what it should do.
// There is no session: the credential, held only as a hash by the network module, is the whole authority, and a revoked or unknown one is a plain 401 that says nothing about which. The computer always
// dials out, so it needs no open port. Every answer is small and uncached.
import type http from "node:http";
import { makeError } from "./errors.ts";
import { sourceOf } from "../daemon/preauth.ts";

const TRACE = "0".repeat(32);
const MAX_BODY = 16 * 1024;
/** A job answer can carry a screenshot; a home call can carry a file of up to a few hundred kilobytes in base64; an upload to a slot (the cap `put_upload`) may carry a recording's video, up to MAX_PUT. */
const MAX_RESULT = 8 * 1024 * 1024;
const MAX_HOME = 4 * 1024 * 1024;
/** A file the node's home mirror sends to an upload slot (a recording's video is the large case), in base64. */
const MAX_PUT = 48 * 1024 * 1024;
const PER_MINUTE: Record<"poll" | "result" | "home", number> = { poll: 240, result: 600, home: 3000 };

export interface ComputeRouteDeps {
  /** The network module's host call: who holds this credential, if still admitted, noting that they are alive. */
  poll(credential: string, report: { docker?: boolean; version?: string }): Promise<{ serverId: string; owner?: string } | null>;
  /** The computers module's host call: the jobs waiting for this computer, each leased and carrying its one-time token. */
  jobs?(nodeId: string, running: string[]): Promise<unknown[]>;
  /** A job's answer; the first one is kept. */
  result?(nodeId: string, a: { jobId: string; ok: boolean; result?: unknown; error?: string }): Promise<{ status: string }>;
  /** One call on an agent's home for a job's computer, as that agent, if the token allows it. Null when it does not. */
  home?(nodeId: string, a: { token: string; computerId: string; cap: string; input: unknown }): Promise<{ ok: true; output: unknown } | null>;
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
  const limited = (key: string, max: number): boolean => {
    const at = now(), list = (hits.get(key) ?? []).filter((t) => at - t < 60_000);
    list.push(at); hits.delete(key); hits.set(key, list);
    if (hits.size > 5_000) hits.delete(hits.keys().next().value as string);
    return list.length > max;
  };
  async function body(req: http.IncomingMessage, res: http.ServerResponse, max: number): Promise<Record<string, unknown> | null> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > max) { send(res, 413, { error: makeError("validation.too_large" as never, TRACE, { message: "That request is too large." }) }); return null; } chunks.push(c as Buffer); }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
  }
  async function serve(req: http.IncomingMessage, res: http.ServerResponse, which: "poll" | "result" | "home"): Promise<void> {
    const source = sourceOf({ "x-vyre-remote": req.socket.remoteAddress ?? "", ...(typeof req.headers["x-forwarded-for"] === "string" ? { "x-forwarded-for": req.headers["x-forwarded-for"] } : {}) });
    if (limited(`${which}:${source}`, PER_MINUTE[which])) { res.setHeader("retry-after", "60"); return send(res, 429, { error: makeError("rate_limit.exceeded" as never, TRACE, { message: "Too many requests from this address." }) }); }
    const auth = req.headers["authorization"];
    const credential = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    // a home call may carry a large upload, so the computer is known before its body is read
    const early = which === "home" ? (credential.startsWith("vcc_") ? await deps.poll(credential, {}).catch(() => null) : null) : undefined;
    if (early === null) return send(res, 401, { error: makeError("auth.unauthenticated" as never, TRACE, { message: "This computer is not admitted." }) });
    const parsed = await body(req, res, which === "poll" ? MAX_BODY : which === "result" ? MAX_RESULT : MAX_PUT);
    if (parsed === null) return;
    const report: { docker?: boolean; version?: string } = {};
    if (typeof parsed["docker"] === "boolean") report.docker = parsed["docker"];
    if (typeof parsed["version"] === "string") report.version = parsed["version"].slice(0, 40);
    const who = early ?? (credential.startsWith("vcc_") ? await deps.poll(credential, report).catch(() => null) : null);
    if (!who) return send(res, 401, { error: makeError("auth.unauthenticated" as never, TRACE, { message: "This computer is not admitted." }) });
    if (which === "poll") {
      const running = Array.isArray(parsed["running"]) ? (parsed["running"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 50) : [];
      const jobs = deps.jobs ? await deps.jobs(who.serverId, running).catch(() => []) : [];
      return send(res, 200, { ok: true, serverId: who.serverId, jobs });
    }
    if (which === "result") {
      const jobId = typeof parsed["jobId"] === "string" ? parsed["jobId"] : "";
      if (!deps.result || !jobId) return send(res, 400, { error: makeError("validation.bad_input" as never, TRACE, { message: "Say which job." }) });
      const r = await deps.result(who.serverId, { jobId, ok: parsed["ok"] === true, ...(parsed["result"] !== undefined ? { result: parsed["result"] } : {}), ...(typeof parsed["error"] === "string" ? { error: parsed["error"].slice(0, 500) } : {}) }).catch(() => null);
      if (!r || r.status === "unknown") return send(res, 404, { error: makeError("validation.not_found" as never, TRACE, { message: "There is no such job for this computer." }) });
      return send(res, 200, { ok: true, status: r.status });
    }
    if (parsed["cap"] !== "put_upload" && JSON.stringify(parsed["input"] ?? null).length > MAX_HOME) return send(res, 413, { error: makeError("validation.too_large" as never, TRACE, { message: "That request is too large." }) });
    const token = typeof parsed["token"] === "string" ? parsed["token"] : "", computerId = typeof parsed["computerId"] === "string" ? parsed["computerId"] : "", cap = typeof parsed["cap"] === "string" ? parsed["cap"] : "";
    const out = deps.home && token && computerId && cap ? await deps.home(who.serverId, { token, computerId, cap, input: parsed["input"] }).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message.slice(0, 200) : "refused" })) : null;
    if (!out) return send(res, 403, { error: makeError("permission.no_grant" as never, TRACE, { message: "That job may not do that." }) });
    if (!out.ok) return send(res, 422, { error: makeError("validation.precondition_failed" as never, TRACE, { message: (out as { message?: string }).message ?? "The Space refused that." }) });
    send(res, 200, { ok: true, output: out.output });
  }
  const ROUTES: Record<string, "poll" | "result" | "home"> = { "/compute/poll": "poll", "/compute/result": "result", "/compute/home": "home" };
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://x");
      const which = ROUTES[url.pathname];
      if (!which) return false;
      if (req.method !== "POST") { send(res, 405, { error: makeError("validation.bad_input" as never, TRACE, { message: "Use POST." }) }); return true; }
      void serve(req, res, which).catch(() => { if (!res.headersSent) send(res, 500, { error: makeError("internal.unexpected" as never, TRACE) }); });
      return true;
    },
  };
}
