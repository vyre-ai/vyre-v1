// The site runner: builds a deployed site's image and runs it as its own container, through the sites runner (host/src/sites-runner): a sidecar on the server that alone holds the Docker
// socket and lets through only what a site needs (owner, 3 Nov: Vyre never holds the full socket). It speaks the Docker Engine API on a private Unix socket with a token, so this file
// talks to it as to Docker, and anything outside its policy comes back 403.
//   build   the source folder goes as a tar; the builder (the repo's own Dockerfile, or a standard one from images/site-builders) runs with a memory and CPU cap, and every line it prints
//           reaches onLine as it comes
//   network vyre-site-<site>: the site's own, joined by its app, its databases and the ingress (vyred and Caddy) and nothing else, so sites cannot reach each other
//   run     vyre-site-<site>-<deployment> on its site's network with PORT and the env given, every capability dropped, a CPU, memory, process and disk cap and rotated logs; the
//           image stays after the container goes, so a rollback starts it again without a build
//   addons  vyre-site-<site>-postgres / -redis, the official images run as their own user, a named volume each, reached as <kind>-<site> on the network
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { tarFiles } from "./tar.ts";
import type { TarEntry } from "./tar.ts";
import type { SitePlan } from "./plan.ts";

export interface Limits { cpus: number; memoryMb: number; diskMb?: number }
/** What a site gets unless someone gives it more: one CPU and 512 MB, which a dashboard or an API needs and which leaves a 4 CPU, 8 GB server room for many. */
export const DEFAULT_LIMITS: Limits = { cpus: 1, memoryMb: 512, diskMb: 2048 };
/** A build may use more than the site runs with (Next.js and Vite builds need memory), but never the whole server. */
export const BUILD_LIMITS = { cpus: 2, memoryMb: 3072 };
const ADDON_LIMITS: Record<AddonKind, Limits> = { postgres: { cpus: 1, memoryMb: 512 }, redis: { cpus: 0.5, memoryMb: 256 } };
const ADDON_IMAGE: Record<AddonKind, string> = { postgres: "postgres:16-alpine", redis: "redis:7-alpine" };
export const ADDON_PORT: Record<AddonKind, number> = { postgres: 5432, redis: 6379 };
const LOGS = { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } };
const CONTEXT_MAX = 300 * 1024 * 1024;
const BUILD_MS = 15 * 60_000;
/** Below this much free space on the engine's disk a build does not start: a full disk takes the whole server down, Vyre with it. */
export const MIN_FREE_MB = 2048;
const SKIP = new Set([".git", "node_modules", ".next", ".venv", "venv", "__pycache__", ".DS_Store", ".env", ".vercel", ".turbo"]);

export type AddonKind = "postgres" | "redis";

export interface Runner {
  ping(): Promise<boolean>;
  /** MB free where the engine keeps images, or null when the engine does not say */
  freeMb(): Promise<number | null>;
  build(a: { siteId: string; deploymentId: string; dir: string; plan: SitePlan; onLine(line: string): void }): Promise<{ ok: true; image: string } | { ok: false; reason: string }>;
  run(a: { siteId: string; deploymentId: string; image: string; port: number; env: Record<string, string>; limits: Limits }): Promise<{ containerId: string; name: string; note?: string }>;
  /** the site's own network, made when missing and joined by the ingress when this process runs in a container; its subnet is what the gateway refuses connections on */
  network(siteId: string): Promise<{ name: string; subnet: string | null }>;
  removeNetwork(siteId: string): Promise<void>;
  /** the address of a container on the vyre-sites network */
  address(containerId: string): Promise<string | null>;
  /** running, or how it ended: oom when the memory cap stopped it */
  state(containerId: string): Promise<{ running: boolean; exitCode?: number; oom?: boolean } | null>;
  logs(containerId: string, tail: number): Promise<string[]>;
  remove(containerId: string): Promise<void>;
  removeImage(image: string): Promise<void>;
  imageExists(image: string): Promise<boolean>;
  addon(a: { siteId: string; kind: AddonKind; password: string }): Promise<{ containerId: string; host: string; port: number }>;
  removeAddon(siteId: string, kind: AddonKind): Promise<void>;
  /** run a command in a site's container, as its own user; the env values go only through the exec's environment */
  exec(containerId: string, cmd: string[], env: Record<string, string>): Promise<{ code: number; out: string }>;
  /** put one file into a container's folder */
  put(containerId: string, dir: string, name: string, bytes: Uint8Array): Promise<void>;
}

const dec = new TextDecoder();
const parse = (b: Uint8Array): any => { try { return JSON.parse(dec.decode(b)); } catch { return null; } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const hex = (id: string): string => id.replace(/^[a-z]+_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const containerName = (siteId: string, deploymentId: string): string => `vyre-site-${hex(siteId).slice(-12)}-${hex(deploymentId).slice(-12)}`;
export const imageName = (siteId: string, deploymentId: string): string => `vyre-site/${hex(siteId)}:${hex(deploymentId)}`;
export const addonName = (siteId: string, kind: AddonKind): string => `vyre-site-${hex(siteId).slice(-12)}-${kind}`;

/** The source folder as a build context: no .git, node_modules or env files, at most 300 MB. The standard Dockerfile goes in beside it. */
export function contextTar(dir: string, extras: ReadonlyArray<{ name: string; text: string }>): Uint8Array {
  const replaced = new Set(extras.map((e) => e.name));
  const files: TarEntry[] = [];
  let size = 0;
  const walk = (abs: string, rel: string): void => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (SKIP.has(e.name) || /^\.env(\..*)?$/.test(e.name) && !/example|sample|template/.test(e.name)) continue;
      const a = path.join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (replaced.has(r)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(a, r); continue; }
      if (!e.isFile()) continue;
      const st = fs.statSync(a);
      size += st.size;
      if (size > CONTEXT_MAX) throw new Error("The project is over 300 MB without node_modules and .git. Leave build output and large files out of it.");
      files.push({ path: r, data: new Uint8Array(fs.readFileSync(a)), mode: st.mode & 0o111 ? 0o755 : 0o644, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  };
  walk(dir, "");
  for (const extra of extras) files.push({ path: extra.name, data: new TextEncoder().encode(extra.text) });
  return tarFiles(files);
}

/** Docker's log stream without a TTY: 8-byte frames, kept in the order they came. */
export function frames(body: Uint8Array): string[] {
  const out: string[] = [];
  let at = 0;
  let pending = "";
  while (at + 8 <= body.length) {
    const size = ((body[at + 4] ?? 0) << 24 | (body[at + 5] ?? 0) << 16 | (body[at + 6] ?? 0) << 8 | (body[at + 7] ?? 0)) >>> 0;
    pending += dec.decode(body.subarray(at + 8, at + 8 + size));
    at += 8 + size;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    out.push(...parts);
  }
  if (pending) out.push(pending);
  if (out.length === 0 && body.length > 0 && (body[0] ?? 0) > 2) return dec.decode(body).split("\n").filter(Boolean);
  return out.map((l) => l.replace(/\r$/, ""));
}

/** A site's own network (host/src/sites-runner/policy.ts names it the same). */
export const networkName = (siteId: string): string => `vyre-site-${hex(siteId).slice(-16)}`;
export const addonHost = (siteId: string, kind: AddonKind): string => `${kind}-${hex(siteId).slice(-12)}`;

export interface RunnerLink {
  /** the sites runner's Unix socket */
  socketPath: string;
  /** its token, read each time (the runner makes a new one when it restarts) */
  token(): string;
}

interface Req { method: string; path: string; query?: Record<string, string>; json?: unknown; body?: Uint8Array; contentType?: string; timeoutMs?: number }

/** The container this process runs in, if it does (the ingress: vyred, with Caddy in its network namespace). */
function selfContainer(): string | null {
  if (!fs.existsSync("/.dockerenv")) return null;
  try {
    const m = /\/docker\/containers\/([0-9a-f]{64})\//.exec(fs.readFileSync("/proc/self/mountinfo", "utf8"));
    if (m) return m[1] as string;
  } catch { /* not readable */ }
  return os.hostname();
}

export function dockerRunner(link: RunnerLink): Runner {
  let quota: boolean | null = null;
  const self = selfContainer();
  const nets = new Map<string, { name: string; subnet: string | null }>();

  async function ensureNetwork(siteId: string): Promise<{ name: string; subnet: string | null }> {
    const name = networkName(siteId);
    const had = nets.get(name);
    if (had) return had;
    let info = await call({ method: "GET", path: `/networks/${name}` });
    if (info.status === 404) {
      const made = await call({ method: "POST", path: "/networks/create", json: { Name: name, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.site": siteId } } });
      if (made.status !== 201 && made.status !== 409) throw new Error(`Could not make the site's network: ${message(made.body, made.status)}`);
      info = await call({ method: "GET", path: `/networks/${name}` });
    }
    const j = parse(info.body) as { IPAM?: { Config?: Array<{ Subnet?: string }> }; Containers?: Record<string, unknown> } | null;
    if (self && !Object.keys(j?.Containers ?? {}).some((id) => id.startsWith(self) || self.startsWith(id.slice(0, 12)))) {
      const joined = await call({ method: "POST", path: `/networks/${name}/connect`, json: { Container: self } });
      if (joined.status !== 200 && !/already exists|already attached|endpoint with name/i.test(dec.decode(joined.body))) throw new Error(`Vyre could not join the site's network: ${message(joined.body, joined.status)}`);
    }
    const out = { name, subnet: j?.IPAM?.Config?.find((c) => c.Subnet)?.Subnet ?? null };
    nets.set(name, out);
    return out;
  }

  /** One call to the runner, answered in full. */
  function call(r: Req): Promise<{ status: number; body: Uint8Array }> {
    return new Promise((resolve, reject) => {
      const qs = r.query && Object.keys(r.query).length ? `?${new URLSearchParams(r.query).toString()}` : "";
      const payload = r.json !== undefined ? Buffer.from(JSON.stringify(r.json)) : r.body ? Buffer.from(r.body) : undefined;
      const q = http.request({ socketPath: link.socketPath, method: r.method, path: `${r.path}${qs}`, timeout: r.timeoutMs ?? 60_000, headers: { authorization: `Bearer ${link.token()}`, ...(payload ? { "content-type": r.contentType ?? "application/json", "content-length": payload.length } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
      });
      q.on("timeout", () => q.destroy(new Error("the sites runner did not answer in time")));
      q.on("error", reject);
      q.end(payload);
    });
  }

  /** A call whose answer is read line by line as it arrives (build output, pulls). */
  function lines(r: { method: string; path: string; body?: Uint8Array; contentType?: string; timeoutMs: number }, onLine: (line: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const q = http.request({ socketPath: link.socketPath, method: r.method, path: r.path, headers: { authorization: `Bearer ${link.token()}`, ...(r.body ? { "content-type": r.contentType ?? "application/octet-stream", "content-length": r.body.length } : {}) } }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          buf += c;
          let at: number;
          while ((at = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, at).trim(); buf = buf.slice(at + 1); if (line) onLine(line); }
        });
        res.on("end", () => { if (buf.trim()) onLine(buf.trim()); resolve(res.statusCode ?? 0); });
        res.on("error", reject);
      });
      const timer = setTimeout(() => q.destroy(new Error("timed out")), r.timeoutMs);
      timer.unref?.();
      q.on("close", () => clearTimeout(timer));
      q.on("error", reject);
      q.end(r.body ? Buffer.from(r.body) : undefined);
    });
  }

  const message = (b: Uint8Array, status: number): string => String(parse(b)?.message ?? status).slice(0, 300);

  async function pull(image: string): Promise<void> {
    if ((await call({ method: "GET", path: `/images/${image}/json` })).status === 200) return;
    const [repo, tag] = image.split(":");
    let error = "";
    const status = await lines({ method: "POST", path: `/images/create?fromImage=${encodeURIComponent(repo ?? image)}&tag=${encodeURIComponent(tag ?? "latest")}`, timeoutMs: 5 * 60_000 }, (line) => { const j = parse(new TextEncoder().encode(line)); if (j?.error) error = String(j.error); else if (j?.message) error = String(j.message); });
    if (status !== 200 || error) throw new Error(`Could not fetch ${image}: ${error || status}`);
  }

  async function create(name: string, config: Record<string, unknown>): Promise<{ id: string; note?: string }> {
    await call({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } });
    const host = config["HostConfig"] as Record<string, unknown>;
    const disk = host["StorageOpt"];
    const without = { ...config, HostConfig: { ...host, StorageOpt: undefined } };
    let r = await call({ method: "POST", path: "/containers/create", query: { name }, json: quota === false ? without : config });
    let note: string | undefined;
    if (r.status !== 201 && disk && /storage-opt|quota|xfs|not supported/i.test(dec.decode(r.body))) {
      // a per-container disk cap needs overlay on XFS with project quotas; on other disks the free-space check before each build and the rotated logs guard the disk
      quota = false;
      note = "This server's disk cannot cap one container's size, so the free-space check and log rotation guard it instead.";
      r = await call({ method: "POST", path: "/containers/create", query: { name }, json: without });
    } else if (r.status === 201 && disk) quota = true;
    if (r.status !== 201) throw new Error(`The container was not made: ${message(r.body, r.status)}`);
    const id = String(parse(r.body)?.Id ?? "");
    const started = await call({ method: "POST", path: `/containers/${id}/start` });
    if (started.status !== 204 && started.status !== 304) throw new Error(`The container did not start: ${message(started.body, started.status)}`);
    return note ? { id, note } : { id };
  }

  const hostConfig = (network: string, limits: Limits, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    NetworkMode: network, RestartPolicy: { Name: "unless-stopped" }, LogConfig: LOGS,
    NanoCpus: Math.round(limits.cpus * 1e9), Memory: limits.memoryMb * 1024 * 1024, MemorySwap: limits.memoryMb * 1024 * 1024, PidsLimit: 512,
    SecurityOpt: ["no-new-privileges"], Init: true, CapDrop: ["ALL"],
    ...(limits.diskMb && quota !== false ? { StorageOpt: { size: `${limits.diskMb}M` } } : {}),
    ...extra,
  });

  return {
    async ping() { try { return (await call({ method: "GET", path: "/_ping", timeoutMs: 4000 })).status === 200; } catch { return false; } },

    async freeMb() {
      // the server's disk as this process sees it: the Docker data folder is on it unless an operator moved it
      try { const st = fs.statfsSync("/"); return Math.floor((st.bavail * st.bsize) / (1024 * 1024)); } catch { return null; }
    },

    async build(a) {
      const image = imageName(a.siteId, a.deploymentId);
      const own = a.plan.kind === "dockerfile";
      const dockerfile = own ? path.relative(a.dir, a.plan.dockerfile).split(path.sep).join("/") : ".vyre.Dockerfile";
      let tar: Uint8Array;
      const ignore = (() => { try { return fs.readFileSync(path.join(a.dir, ".dockerignore"), "utf8"); } catch { return ""; } })();
      const extras = own ? [] : [
        { name: ".vyre.Dockerfile", text: fs.readFileSync(a.plan.dockerfile, "utf8") },
        { name: ".dockerignore", text: `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}.vyre.Dockerfile\n.dockerignore\n.git\nnode_modules\n.env\n.env.*\n!.env.example\n` },
      ];
      try { tar = contextTar(a.dir, extras); } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
      const args = own ? {} : { ...a.plan.args, LOCK_HASH: a.plan.lockHash };
      const q = new URLSearchParams({
        t: image, dockerfile, rm: "1", forcerm: "1", buildargs: JSON.stringify(args), labels: JSON.stringify({ "vyre.site": a.siteId, "vyre.deployment": a.deploymentId }),
        memory: String(BUILD_LIMITS.memoryMb * 1024 * 1024), memswap: String(BUILD_LIMITS.memoryMb * 1024 * 1024 * 2), cpuperiod: "100000", cpuquota: String(BUILD_LIMITS.cpus * 100000),
      });
      let error = "";
      let built = false;
      try {
        const status = await lines({ method: "POST", path: `/build?${q.toString()}`, body: tar, contentType: "application/x-tar", timeoutMs: BUILD_MS }, (line) => {
          const j = parse(new TextEncoder().encode(line)) as { stream?: string; error?: string; message?: string; aux?: { ID?: string } } | null;
          if (!j) { a.onLine(line); return; }
          if (j.error || (j.message && !j.stream)) { error = String(j.error ?? j.message); a.onLine(error.trim()); }
          if (typeof j.stream === "string") for (const l of j.stream.split("\n")) { const t = l.replace(/\u001b\[[0-9;]*m/g, "").trimEnd(); if (t) a.onLine(t); }
          if (j.aux?.ID) built = true;
          if (/^Successfully (built|tagged)/.test(j.stream ?? "")) built = true;
        });
        if (status !== 200) return { ok: false, reason: error || `The build was refused (${status}).` };
      } catch (e) {
        return { ok: false, reason: /timed out/.test(String(e)) ? "The build took longer than 15 minutes." : `The build stopped: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (error || !built) return { ok: false, reason: error ? error.trim().split("\n").slice(-1)[0] ?? error : "The build ended without an image." };
      return { ok: true, image };
    },

    network: (siteId) => ensureNetwork(siteId),

    async removeNetwork(siteId) { nets.delete(networkName(siteId)); await call({ method: "DELETE", path: `/networks/${networkName(siteId)}` }); },

    async run(a) {
      const net = await ensureNetwork(a.siteId);
      const name = containerName(a.siteId, a.deploymentId);
      const env = { ...a.env, PORT: String(a.port), HOST: "0.0.0.0" };
      const made = await create(name, {
        Image: a.image, Env: Object.entries(env).map(([k, v]) => `${k}=${v}`), ExposedPorts: { [`${a.port}/tcp`]: {} },
        Labels: { "vyre.site": a.siteId, "vyre.deployment": a.deploymentId, "vyre.kind": "app" },
        HostConfig: hostConfig(net.name, a.limits, { CapAdd: ["NET_BIND_SERVICE"], Tmpfs: { "/tmp": `rw,nosuid,size=${Math.min(512, Math.max(64, Math.floor(a.limits.memoryMb / 2)))}m` } }),
      });
      return { containerId: made.id, name, ...(made.note ? { note: made.note } : {}) };
    },

    async address(containerId) {
      const r = await call({ method: "GET", path: `/containers/${containerId}/json` });
      if (r.status !== 200) return null;
      const info = parse(r.body) as { State?: { Running?: boolean }; HostConfig?: { NetworkMode?: string }; NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> } };
      if (info.State?.Running !== true) return null;
      return info.NetworkSettings?.Networks?.[info.HostConfig?.NetworkMode ?? ""]?.IPAddress || null;
    },

    async state(containerId) {
      const r = await call({ method: "GET", path: `/containers/${containerId}/json` });
      if (r.status !== 200) return null;
      const st = (parse(r.body) as { State?: { Running?: boolean; Restarting?: boolean; ExitCode?: number; OOMKilled?: boolean } }).State ?? {};
      return { running: st.Running === true && st.Restarting !== true, ...(typeof st.ExitCode === "number" ? { exitCode: st.ExitCode } : {}), ...(st.OOMKilled ? { oom: true } : {}) };
    },

    async logs(containerId, tail) {
      const n = Math.max(1, Math.min(Math.trunc(tail), 1000));
      const r = await call({ method: "GET", path: `/containers/${containerId}/logs`, query: { stdout: "1", stderr: "1", tail: String(n) }, timeoutMs: 15_000 });
      return r.status === 200 ? frames(r.body).slice(-n) : [];
    },

    async remove(containerId) {
      const r = await call({ method: "DELETE", path: `/containers/${containerId}`, query: { force: "true" } });
      if (r.status !== 204 && r.status !== 404) throw new Error(`Could not stop the container: ${message(r.body, r.status)}`);
    },

    async removeImage(image) { await call({ method: "DELETE", path: `/images/${image}`, query: { force: "true" } }); },

    async imageExists(image) { return (await call({ method: "GET", path: `/images/${image}/json` })).status === 200; },

    async addon(a) {
      const net = await ensureNetwork(a.siteId);
      const name = addonName(a.siteId, a.kind);
      const image = ADDON_IMAGE[a.kind];
      await pull(image);
      const running = await call({ method: "GET", path: `/containers/${name}/json` });
      if (running.status === 200 && (parse(running.body) as { State?: { Running?: boolean } }).State?.Running) return { containerId: String(parse(running.body).Id), host: addonHost(a.siteId, a.kind), port: ADDON_PORT[a.kind] };
      // run as the image's own user: a new named volume takes the owner of the image's folder, so neither needs a capability
      const cfg = a.kind === "postgres"
        ? { Env: ["POSTGRES_USER=app", `POSTGRES_PASSWORD=${a.password}`, "POSTGRES_DB=app"], mount: "/var/lib/postgresql/data", user: "postgres", cmd: undefined }
        : { Env: [], mount: "/data", user: "redis", cmd: ["redis-server", "--appendonly", "yes", "--requirepass", a.password, "--maxmemory", `${Math.floor(ADDON_LIMITS.redis.memoryMb * 0.8)}mb`, "--maxmemory-policy", "allkeys-lru"] };
      const made = await create(name, {
        Image: image, Env: cfg.Env, User: cfg.user, ...(cfg.cmd ? { Cmd: cfg.cmd } : {}), Labels: { "vyre.site": a.siteId, "vyre.kind": a.kind },
        HostConfig: hostConfig(net.name, ADDON_LIMITS[a.kind], { Binds: [`${name}-data:${cfg.mount}`] }),
        NetworkingConfig: { EndpointsConfig: { [net.name]: { Aliases: [addonHost(a.siteId, a.kind)] } } },
      });
      return { containerId: made.id, host: addonHost(a.siteId, a.kind), port: ADDON_PORT[a.kind] };
    },

    async removeAddon(siteId, kind) {
      const name = addonName(siteId, kind);
      await call({ method: "DELETE", path: `/containers/${name}`, query: { force: "true", v: "true" } });
      await call({ method: "DELETE", path: `/volumes/${name}-data` });
    },

    async put(containerId, dir, name, bytes) {
      const tar = tarFiles([{ path: name, data: bytes }]);
      const r = await call({ method: "PUT", path: `/containers/${containerId}/archive`, query: { path: dir }, body: tar, contentType: "application/x-tar", timeoutMs: 10 * 60_000 });
      if (r.status !== 200) throw new Error(`Could not copy the file in: ${message(r.body, r.status)}`);
    },

    async exec(containerId, cmd, env) {
      const made = await call({ method: "POST", path: `/containers/${containerId}/exec`, json: { Cmd: cmd, Env: Object.entries(env).map(([k, v]) => `${k}=${v}`), AttachStdout: true, AttachStderr: true } });
      if (made.status !== 201) throw new Error(`Could not run it in the container: ${message(made.body, made.status)}`);
      const id = String(parse(made.body)?.Id ?? "");
      const started = await call({ method: "POST", path: `/exec/${id}/start`, json: { Detach: false, Tty: false }, timeoutMs: 30 * 60_000 });
      const inspect = parse((await call({ method: "GET", path: `/exec/${id}/json` })).body) as { ExitCode?: number } | null;
      return { code: inspect?.ExitCode ?? 1, out: frames(started.body).join("\n") };
    },
  };
}
