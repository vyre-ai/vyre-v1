// Shared test support for the sandbox tests: the roots and a good spec, a Docker engine in memory that records what it was asked, and small real servers for the proxy tests.
import http from "node:http";
import net from "node:net";
import type { ContainerConfig, DockerApi } from "../src/docker.ts";
import type { Roots, SandboxSpec } from "../src/types.ts";

export const ROOTS: Roots = { work: ["/srv/vyre/people/dana"], scratch: ["/srv/vyre/scratch/dana"] };

export function spec(over: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    id: "vyre-sbx-dana", person: "usr_dana", kind: "docker",
    mounts: [{ host: "/srv/vyre/people/dana/site", mode: "rw" }, { host: "/srv/vyre/people/dana/reference", mode: "ro" }],
    egressHosts: ["api.anthropic.com", "*.openai.com"],
    ...over,
  };
}

export function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T };
}

export interface FakeDocker {
  api: DockerApi;
  calls: string[];
  networks: Map<string, { id: string; gateway: string }>;
  containers: Map<string, { name: string; config: ContainerConfig; running: boolean }>;
  archives: Array<{ id: string; dir: string; tar: Uint8Array }>;
  execs: Array<{ id: string; cmd: readonly string[]; env: readonly string[]; workingDir?: string }>;
  /** Answers for exec; default exit 0 with no output. */
  script: (cmd: readonly string[]) => { exitCode: number | null; stdout?: string; stderr?: string };
  /** Names of steps that throw (networkCreate, containerCreate, containerStart, ...). */
  failOn: Set<string>;
  hasImage: boolean;
}

export function fakeDocker(): FakeDocker {
  const f: FakeDocker = {
    calls: [], networks: new Map(), containers: new Map(), archives: [], execs: [], failOn: new Set(), hasImage: true,
    script: () => ({ exitCode: 0 }),
    api: undefined as unknown as DockerApi,
  };
  let n = 0;
  const step = (name: string): void => { f.calls.push(name); if (f.failOn.has(name)) throw new Error(`${name} failed (injected)`); };
  f.api = {
    async ping() { return true; },
    async imageExists() { step("imageExists"); return f.hasImage; },
    async networkCreate(name) { step("networkCreate"); const r = { id: `net${++n}`, gateway: `172.30.${n}.1` }; f.networks.set(name, r); return r; },
    async networkRemove(id) { step("networkRemove"); for (const [k, v] of f.networks) if (v.id === id) f.networks.delete(k); },
    async containerCreate(name, config) { step("containerCreate"); const id = `ctr${++n}`; f.containers.set(id, { name, config, running: false }); return id; },
    async containerStart(id) { step("containerStart"); (f.containers.get(id) as { running: boolean }).running = true; },
    async containerStop(id) { step("containerStop"); const c = f.containers.get(id); if (c) c.running = false; },
    async containerRemove(id) { step("containerRemove"); f.containers.delete(id); },
    async containerRunning(id) { return f.containers.get(id)?.running === true; },
    async exec(id, a) {
      step("exec");
      f.execs.push({ id, cmd: a.cmd, env: a.env, ...(a.workingDir ? { workingDir: a.workingDir } : {}) });
      const r = f.script(a.cmd);
      return { exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    async putArchive(id, dir, tar) { step("putArchive"); f.archives.push({ id, dir, tar }); },
  };
  return f;
}

/** A TCP server that echoes what it reads. */
export function echoServer(): Promise<{ port: number; connections: () => number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    let conns = 0;
    const sockets = new Set<net.Socket>();
    const s = net.createServer((c) => { conns++; sockets.add(c); c.on("close", () => sockets.delete(c)); c.on("error", () => undefined); c.pipe(c); });
    s.listen(0, "127.0.0.1", () => resolve({
      port: (s.address() as net.AddressInfo).port,
      connections: () => conns,
      close: () => new Promise<void>((r) => { for (const c of sockets) c.destroy(); s.close(() => r()); }),
    }));
  });
}

export interface SeenRequest { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

/** An HTTP server that records requests and answers 200 `upstream says hello`. */
export function httpUpstream(): Promise<{ port: number; seen: SeenRequest[]; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const seen: SeenRequest[] = [];
    const s = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
        res.writeHead(200, { "content-type": "text/plain", "x-upstream": "yes" }).end("upstream says hello");
      });
    });
    s.listen(0, "127.0.0.1", () => resolve({
      port: (s.address() as net.AddressInfo).port, seen,
      close: () => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); }),
    }));
  });
}

/** Speak to a proxy by hand: send raw bytes, collect what comes back until it hangs up, matches `until`, or the time is up. */
export function rawExchange(port: number, request: string, o: { until?: RegExp; afterHeaders?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = net.connect(port, "127.0.0.1");
    let got = "";
    let sentMore = false;
    const done = (): void => { c.destroy(); resolve(got); };
    const timer = setTimeout(done, o.timeoutMs ?? 1500);
    c.on("connect", () => c.write(request));
    c.on("data", (d) => {
      got += d.toString("latin1");
      if (o.afterHeaders !== undefined && !sentMore && got.includes("\r\n\r\n")) { sentMore = true; c.write(o.afterHeaders); }
      if (o.until && o.until.test(got)) { clearTimeout(timer); done(); }
    });
    c.on("end", () => { clearTimeout(timer); done(); });
    c.on("error", (e) => { clearTimeout(timer); if (got) resolve(got); else reject(e); });
  });
}
