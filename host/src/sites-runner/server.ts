// The sites runner: a small server that alone holds the Docker socket and answers vyred over a private Unix socket with a token. It speaks the Docker Engine API, so vyred's runner
// (modules/sites/handlers/runner.ts) talks to it as it would to Docker, but every request goes through policy.ts first and anything it does not name is refused with 403.
// Requests on a container are checked against the container's own labels, read from Docker at the time, so a name or id of a container that is not a site's is refused whatever it says.
import fs from "node:fs";
import http from "node:http";
import { bare, buildQuery, containerBody, execBody, judge, networkBody, networkOf, SITE_ID } from "./policy.ts";

export interface RunnerOptions { dockerSocket: string; listen: string; token: string; log?: (line: string) => void }

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

function refuse(res: http.ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ message });
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return null; chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}

const sameToken = (a: string, b: string): boolean => {
  if (a.length !== b.length || b.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export function createSitesRunner(o: RunnerOptions): { server: http.Server; close(): Promise<void>; listening: Promise<void> } {
  const execs = new Set<string>();
  const say = o.log ?? (() => undefined);

  /** One request to Docker; the answer streams back to `res`, or is collected when `collect` is set. */
  function docker(method: string, path: string, body: Buffer | http.IncomingMessage | null, headers: http.OutgoingHttpHeaders, res: http.ServerResponse | null): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const up = http.request({ socketPath: o.dockerSocket, method, path, headers }, (r) => {
        if (res) {
          const out: http.OutgoingHttpHeaders = {};
          for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v;
          res.writeHead(r.statusCode ?? 502, out);
          r.pipe(res);
          r.on("end", () => resolve({ status: r.statusCode ?? 0, body: Buffer.alloc(0) }));
          r.on("error", reject);
          return;
        }
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks) }));
        r.on("error", reject);
      });
      up.on("error", reject);
      if (body instanceof http.IncomingMessage) body.pipe(up);
      else up.end(body ?? undefined);
    });
  }

  async function labelsOf(id: string): Promise<Record<string, string> | null> {
    const r = await docker("GET", `/containers/${encodeURIComponent(id)}/json`, null, {}, null);
    if (r.status !== 200) return null;
    try { return ((JSON.parse(r.body.toString("utf8")) as { Config?: { Labels?: Record<string, string> } }).Config?.Labels) ?? {}; } catch { return null; }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
    if (!sameToken(auth, o.token)) { refuse(res, 401, "the sites runner needs its token"); return; }
    const url = new URL(req.url ?? "/", "http://runner");
    const method = (req.method ?? "GET").toUpperCase();
    const v = judge({ method, path: url.pathname, query: url.searchParams });
    const label = `${method} ${bare(url.pathname)}`;
    if (!v.ok) { say(`refused ${label}: ${v.why}`); refuse(res, v.status, `Refused by the sites runner: ${v.why}.`); return; }
    const fwdHeaders: http.OutgoingHttpHeaders = { ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}) };
    if (v.kind === "plain") { await docker(method, `${url.pathname}${url.search}`, method === "GET" || method === "HEAD" || method === "DELETE" ? null : await readBody(req, 1024 * 1024) ?? Buffer.alloc(0), fwdHeaders, res); return; }
    if (v.kind === "build") {
      const b = buildQuery(url.searchParams);
      if ("why" in b) { say(`refused ${label}: ${b.why}`); refuse(res, 403, `Refused by the sites runner: ${b.why}.`); return; }
      await docker("POST", `${url.pathname}?${b.query.toString()}`, req, { ...fwdHeaders, ...(req.headers["content-length"] ? { "content-length": req.headers["content-length"] } : { "transfer-encoding": "chunked" }) }, res);
      return;
    }
    if (v.kind === "body") {
      const raw = await readBody(req, 1024 * 1024);
      let parsed: unknown;
      try { parsed = JSON.parse((raw ?? Buffer.alloc(0)).toString("utf8")); } catch { refuse(res, 400, "the container config is not JSON"); return; }
      const c = containerBody(v.path as string, parsed);
      if ("why" in c) { say(`refused create ${v.path}: ${c.why}`); refuse(res, 403, `Refused by the sites runner: ${c.why}.`); return; }
      const body = Buffer.from(JSON.stringify(c.body));
      await docker("POST", `${url.pathname}${url.search}`, body, { "content-type": "application/json", "content-length": body.length }, res);
      return;
    }
    if (v.kind === "container") {
      const labels = await labelsOf(v.id);
      if (labels === null) { refuse(res, 404, "No such container"); return; }
      if (!SITE_ID.test(labels["vyre.site"] ?? "")) { say(`refused ${label}: not a site container`); refuse(res, 403, "Refused by the sites runner: that container is not a site's."); return; }
      if (v.action === "exec") {
        const raw = await readBody(req, 64 * 1024);
        let parsed: unknown;
        try { parsed = JSON.parse((raw ?? Buffer.alloc(0)).toString("utf8")); } catch { refuse(res, 400, "the exec config is not JSON"); return; }
        const e = execBody(parsed);
        if ("why" in e) { say(`refused exec: ${e.why}`); refuse(res, 403, `Refused by the sites runner: ${e.why}.`); return; }
        const body = Buffer.from(JSON.stringify(e.body));
        const r = await docker("POST", `${url.pathname}${url.search}`, body, { "content-type": "application/json", "content-length": body.length }, null);
        try { const id = (JSON.parse(r.body.toString("utf8")) as { Id?: string }).Id; if (id) execs.add(id); } catch { /* Docker said no: passed on as is */ }
        res.writeHead(r.status, { "content-type": "application/json", "content-length": r.body.length });
        res.end(r.body);
        return;
      }
      const body = method === "PUT" ? req : method === "POST" ? await readBody(req, 1024 * 1024) : null;
      await docker(method, `${url.pathname}${url.search}`, body, { ...fwdHeaders, ...(method === "PUT" && req.headers["content-length"] ? { "content-length": req.headers["content-length"] } : method === "PUT" ? { "transfer-encoding": "chunked" } : {}) }, res);
      return;
    }
    if (v.kind === "network-create" || v.kind === "network-connect") {
      const raw = await readBody(req, 64 * 1024);
      let parsed: unknown;
      try { parsed = JSON.parse((raw ?? Buffer.alloc(0)).toString("utf8")); } catch { refuse(res, 400, "the network config is not JSON"); return; }
      let body: Record<string, unknown>;
      if (v.kind === "network-create") {
        const n = networkBody(parsed);
        if ("why" in n) { say(`refused network: ${n.why}`); refuse(res, 403, `Refused by the sites runner: ${n.why}.`); return; }
        body = n.body;
      } else {
        // only the site's own containers and the ingress (vyred and Caddy, labelled vyre.ingress) join a site's network
        const who = (parsed as { Container?: unknown })?.Container;
        const labels = typeof who === "string" ? await labelsOf(who) : null;
        const own = labels !== null && SITE_ID.test(labels["vyre.site"] ?? "") && networkOf(labels["vyre.site"] as string) === v.network;
        if (!labels || !(own || labels["vyre.ingress"] === "1")) { say(`refused joining ${v.network}`); refuse(res, 403, "Refused by the sites runner: only that site's containers and the ingress join a site's network."); return; }
        const aliases = (parsed as { EndpointConfig?: { Aliases?: unknown } })?.EndpointConfig?.Aliases;
        body = { Container: who, ...(Array.isArray(aliases) && aliases.every((a) => typeof a === "string") ? { EndpointConfig: { Aliases: aliases } } : {}) };
      }
      const data = Buffer.from(JSON.stringify(body));
      await docker("POST", `${url.pathname}`, data, { "content-type": "application/json", "content-length": data.length }, res);
      return;
    }
    if (v.kind === "exec-start" || v.kind === "exec-inspect") {
      if (!execs.has(v.id)) { refuse(res, 403, "Refused by the sites runner: that exec was not made here."); return; }
      const body = v.kind === "exec-start" ? Buffer.from(JSON.stringify({ Detach: false, Tty: false })) : null;
      await docker(method, `${url.pathname}`, body, body ? { "content-type": "application/json", "content-length": body.length } : {}, res);
      if (v.kind === "exec-inspect") execs.delete(v.id);
      return;
    }
    refuse(res, 403, "Refused by the sites runner.");
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e: unknown) => { if (!res.headersSent) refuse(res, 502, `Docker did not answer: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`); else res.destroy(); }); });
  try { fs.rmSync(o.listen, { force: true }); } catch { /* nothing there */ }
  const listening = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.listen, () => { fs.chmodSync(o.listen, 0o666); say(`listening on ${o.listen}`); resolve(); });
  });
  return { server, listening, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
