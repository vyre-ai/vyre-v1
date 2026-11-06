// The Docker questions a Space asks a server that joined it (agent workspaces on a node, 6 Nov). The node only dials out, so the Space cannot reach its Docker; it asks over the node's live socket
// (`ask` kind "docker") and the node puts the request to its own Docker through the same runner a Team server uses (host/src/sites-runner), in this process, on a private socket with a token of its
// own. So every request is judged by workspaces-policy.ts before Docker sees it, whatever the Space sent: a Space that is wrong or taken over still cannot make a privileged container, bind a host
// folder or reach anything that is not a workspace. Bodies travel as base64 inside one frame of the socket (4 MB), so a request or answer over MAX_BODY is refused with a plain line.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createSitesRunner } from "../sites-runner/server.ts";

/** Bytes of a request body or an answer that fit one frame once base64 has grown them. */
export const MAX_BODY = 2_500_000;

export interface DockerAskInput { method: string; path: string; query?: Record<string, string>; jsonText?: string; bodyB64?: string; contentType?: string; timeoutMs?: number }
export interface DockerAskResult { status: number; bodyB64: string }

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
  if (typeof o["timeoutMs"] === "number") out.timeoutMs = Math.min(3_700_000, Math.max(1000, o["timeoutMs"]));
  return out;
}

/**
 * One function that puts a request to the runner at `socket` (bearer `token`) and returns its answer. The API version is negotiated once from the engine, as sandbox/src/docker.ts does, since
 * Docker 29 refuses the 1.43 this code was written for.
 */
export function createDockerAsk(o: { socket: string; token: string }): (input: unknown) => Promise<DockerAskResult> {
  const raw = (method: string, path: string, headers: http.OutgoingHttpHeaders, body: Buffer | undefined, timeoutMs: number): Promise<{ status: number; body: Buffer }> => new Promise((resolve, reject) => {
    const r = http.request({ socketPath: o.socket, method, path, headers: { authorization: `Bearer ${o.token}`, ...headers }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { r.destroy(new Error("That answer is too large to bring over the server link.")); return; } chunks.push(c); });
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
    const body = r.jsonText !== undefined ? Buffer.from(r.jsonText) : r.bodyB64 !== undefined ? Buffer.from(r.bodyB64, "base64") : undefined;
    if (body && body.length > MAX_BODY) throw new Error("That is too large to send over the server link.");
    const qs = r.query && Object.keys(r.query).length > 0 ? `?${new URLSearchParams(r.query).toString()}` : "";
    const headers: http.OutgoingHttpHeaders = body ? { "content-type": r.contentType ?? (r.jsonText !== undefined ? "application/json" : "application/octet-stream"), "content-length": body.length } : {};
    const res = await raw(r.method, `/v${await negotiate()}${r.path}${qs}`, headers, body, r.timeoutMs ?? 60_000);
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
