// The Docker questions a Space asks a server that joined it (agent workspaces on a node, 6 Nov). The node only dials out, so the Space cannot reach its Docker; it asks over the node's live socket
// (`ask` kind "docker") and the node puts the request to its own Docker through the same runner a Team server uses (host/src/sites-runner), in this process, on a private socket with a token of its
// own. So every request is judged by workspaces-policy.ts before Docker sees it, whatever the Space sent: a Space that is wrong or taken over still cannot make a privileged container, bind a host
// folder or reach anything that is not a workspace. A frame of the socket holds 4 MB, so a body travels in pieces of CHUNK bytes as base64: a request body larger than that is staged on the node piece by
// piece (`stage`) and the request then names it (`stagedId`); an answer larger than that comes back as its first piece with `more`, and the rest is fetched piece by piece (`chunk`). Both are bounded by
// MAX_TOTAL and kept only for STALE_MS, so an abandoned transfer does not fill the node.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createSitesRunner } from "../sites-runner/server.ts";

/** Bytes of a body in one frame once base64 has grown them. */
export const CHUNK = 2_000_000;
/** The most a request body or an answer may hold, in all its pieces: the size the Files and project mirrors read and write at most. */
export const MAX_TOTAL = 300 * 1024 * 1024;
/** How long a half-sent request or a half-fetched answer is kept. */
export const STALE_MS = 120_000;
/** Kept for the callers that named the old single-frame limit. */
export const MAX_BODY = CHUNK;

export interface DockerAskInput {
  method: string; path: string; query?: Record<string, string>; jsonText?: string; bodyB64?: string; contentType?: string; timeoutMs?: number;
  /** One piece of a request body to keep until the request that names `id` arrives. */
  stage?: { id: string; index: number; total: number };
  /** The request's body is the staged pieces of this id. */
  stagedId?: string;
  /** Fetch one more piece of an answer that came back with `more`. */
  chunk?: { id: string; index: number };
}
export interface DockerAskResult { status: number; bodyB64: string; /** The answer goes on: fetch pieces 1 to chunks-1 of this id. */ more?: { id: string; chunks: number } }

const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "HEAD"]);
const WANTED = "1.43";
const cmp = (a: string, b: string): number => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 2; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d; } return 0; };

/** Parse what arrived over the socket; throws a plain sentence for anything that is not a Docker request of the shape the Space sends. */
export function readInput(v: unknown): DockerAskInput {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("That is not a Docker request.");
  const o = v as Record<string, unknown>;
  const method = String(o["method"] ?? "").toUpperCase();
  const path = String(o["path"] ?? "");
  if (!METHODS.has(method)) throw new Error("That Docker call is refused.");
  if (!path.startsWith("/") || path.includes("?") || path.includes("..") || path.startsWith("//")) throw new Error("That Docker path is refused.");
  const q = o["query"];
  const query: Record<string, string> = {};
  if (q !== undefined && q !== null) {
    if (typeof q !== "object" || Array.isArray(q)) throw new Error("That Docker query is refused.");
    for (const [k, x] of Object.entries(q)) { if (typeof x !== "string") throw new Error("That Docker query is refused."); query[k] = x; }
  }
  const out: DockerAskInput = { method, path, query };
  if (typeof o["jsonText"] === "string") out.jsonText = o["jsonText"];
  if (typeof o["bodyB64"] === "string") out.bodyB64 = o["bodyB64"];
  if (typeof o["contentType"] === "string") out.contentType = o["contentType"];
  const id = (v: unknown): string | null => (typeof v === "string" && /^[a-f0-9]{8,64}$/.test(v) ? v : null);
  const st = o["stage"] as { id?: unknown; index?: unknown; total?: unknown } | undefined;
  if (st !== undefined) {
    if (st === null || typeof st !== "object" || id(st.id) === null || !Number.isInteger(st.index) || !Number.isInteger(st.total) || (st.index as number) < 0 || (st.total as number) < 1 || (st.index as number) >= (st.total as number) || (st.total as number) * CHUNK > MAX_TOTAL + CHUNK) throw new Error("That staged piece is refused.");
    out.stage = { id: id(st.id) as string, index: st.index as number, total: st.total as number };
  }
  if (o["stagedId"] !== undefined) { if (id(o["stagedId"]) === null) throw new Error("That staged body is refused."); out.stagedId = o["stagedId"] as string; }
  const ck = o["chunk"] as { id?: unknown; index?: unknown } | undefined;
  if (ck !== undefined) { if (ck === null || typeof ck !== "object" || id(ck.id) === null || !Number.isInteger(ck.index) || (ck.index as number) < 1) throw new Error("That piece is refused."); out.chunk = { id: id(ck.id) as string, index: ck.index as number }; }
  if (typeof o["timeoutMs"] === "number") out.timeoutMs = Math.min(3_700_000, Math.max(1000, o["timeoutMs"]));
  return out;
}

/**
 * One function that puts a request to the runner at `socket` (bearer `token`) and returns its answer. The API version is negotiated once from the engine, as sandbox/src/docker.ts does, since
 * Docker 29 refuses the 1.43 this code was written for.
 */
export function createDockerAsk(o: { socket: string; token: string; maxTotal?: number; now?: () => number }): (input: unknown) => Promise<DockerAskResult> {
  const maxTotal = o.maxTotal ?? MAX_TOTAL;
  const now = o.now ?? Date.now;
  const staged = new Map<string, { parts: Buffer[]; total: number; bytes: number; at: number }>();
  const outbox = new Map<string, { body: Buffer; at: number }>();
  const sweep = (): void => { for (const [k, v] of staged) if (now() - v.at > STALE_MS) staged.delete(k); for (const [k, v] of outbox) if (now() - v.at > STALE_MS) outbox.delete(k); };
  const held = (): number => [...staged.values()].reduce((n, v) => n + v.bytes, 0) + [...outbox.values()].reduce((n, v) => n + v.body.length, 0);
  const raw = (method: string, path: string, headers: http.OutgoingHttpHeaders, body: Buffer | undefined, timeoutMs: number): Promise<{ status: number; body: Buffer }> => new Promise((resolve, reject) => {
    const r = http.request({ socketPath: o.socket, method, path, headers: { authorization: `Bearer ${o.token}`, ...headers }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n > maxTotal) { r.destroy(new Error("That answer is too large to bring over the server link.")); return; } chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    r.on("timeout", () => r.destroy(new Error("Docker did not answer in time.")));
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
  let version: Promise<string> | undefined;
  const negotiate = (): Promise<string> => (version ??= raw("GET", "/version", {}, undefined, 10_000).then((r) => {
    let max = WANTED, min = "1.12";
    try { const v = JSON.parse(r.body.toString("utf8")) as { ApiVersion?: string; MinAPIVersion?: string }; if (typeof v.ApiVersion === "string") max = v.ApiVersion; if (typeof v.MinAPIVersion === "string") min = v.MinAPIVersion; } catch { /* the version this was written for */ }
    let pick = WANTED;
    if (cmp(pick, min) < 0) pick = min;
    if (cmp(pick, max) > 0) pick = max;
    return pick;
  }).catch((e: unknown) => { version = undefined; throw e; }));
  return async (input) => {
    const r = readInput(input);
    sweep();
    // one more piece of an answer kept from before
    if (r.chunk) {
      const e = outbox.get(r.chunk.id);
      if (!e || r.chunk.index * CHUNK >= e.body.length) throw new Error("That answer is no longer here.");
      const last = (r.chunk.index + 1) * CHUNK >= e.body.length;
      const piece = e.body.subarray(r.chunk.index * CHUNK, (r.chunk.index + 1) * CHUNK);
      if (last) outbox.delete(r.chunk.id);
      return { status: 200, bodyB64: piece.toString("base64") };
    }
    // one piece of a request body to keep
    if (r.stage) {
      const piece = Buffer.from(r.bodyB64 ?? "", "base64");
      if (piece.length > CHUNK) throw new Error("That piece is too large.");
      let e = staged.get(r.stage.id);
      if (!e) { e = { parts: new Array<Buffer>(r.stage.total), total: r.stage.total, bytes: 0, at: now() }; staged.set(r.stage.id, e); }
      if (e.total !== r.stage.total) throw new Error("That staged body changed size.");
      if (held() + piece.length > maxTotal) { staged.delete(r.stage.id); throw new Error("The server has too much waiting to be sent to Docker."); }
      if (!e.parts[r.stage.index]) e.bytes += piece.length;
      e.parts[r.stage.index] = piece;
      e.at = now();
      return { status: 204, bodyB64: "" };
    }
    let body = r.jsonText !== undefined ? Buffer.from(r.jsonText) : r.bodyB64 !== undefined ? Buffer.from(r.bodyB64, "base64") : undefined;
    if (r.stagedId !== undefined) {
      const e = staged.get(r.stagedId);
      staged.delete(r.stagedId);
      if (!e || e.parts.length !== e.total || Array.from({ length: e.total }, (_, i) => e.parts[i]).some((p) => p === undefined)) throw new Error("That body did not all arrive.");
      body = Buffer.concat(e.parts);
    }
    if (body && body.length > maxTotal) throw new Error("That is too large to send over the server link.");
    const qs = r.query && Object.keys(r.query).length > 0 ? `?${new URLSearchParams(r.query).toString()}` : "";
    const headers: http.OutgoingHttpHeaders = body ? { "content-type": r.contentType ?? (r.jsonText !== undefined ? "application/json" : "application/octet-stream"), "content-length": body.length } : {};
    const res = await raw(r.method, `/v${await negotiate()}${r.path}${qs}`, headers, body, r.timeoutMs ?? 60_000);
    if (res.body.length > CHUNK) {
      const id = randomBytes(16).toString("hex");
      outbox.set(id, { body: res.body, at: now() });
      return { status: res.status, bodyB64: res.body.subarray(0, CHUNK).toString("base64"), more: { id, chunks: Math.ceil(res.body.length / CHUNK) } };
    }
    return { status: res.status, bodyB64: res.body.toString("base64") };
  };
}

/**
 * What a node answers a Docker question with: the runner a Team server runs beside vyred, started here in this process on a private socket with a token of its own, and a client for it. Started on the
 * first question. `close` ends the runner.
 */
export async function startWorkspaceDocker(dataDir: string, o: { dockerSocket?: string; log?: (line: string) => void } = {}): Promise<{ ask: (input: unknown) => Promise<DockerAskResult>; close(): Promise<void> }> {
  const dir = path.join(dataDir, "run");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const listen = path.join(dir, "workspaces-runner.sock");
  fs.rmSync(listen, { force: true });
  const token = randomBytes(24).toString("hex");
  const runner = createSitesRunner({ dockerSocket: o.dockerSocket ?? process.env["VYRE_DOCKER_SOCKET"] ?? "/var/run/docker.sock", listen, token, ...(o.log ? { log: o.log } : {}) });
  await runner.listening;
  return { ask: createDockerAsk({ socket: listen, token }), close: async () => { runner.server.closeAllConnections?.(); await runner.close(); } };
}
