// The site runner: builds a deployed site's image and runs it as its own container on a server of the Space, through the Docker Engine API on that server's socket. Site code never runs in
// vyred: each site is a container of its own with a CPU, memory, process and disk cap, rotated logs, every capability dropped, on a network of its own that only holds the site and its
// Postgres or Redis. vyred reaches the site's port on that network to serve it.
//   build   the source folder goes to the engine as a tar; the builder (the repo's own Dockerfile, or a standard one from images/site-builders) runs with a memory and CPU cap and every
//           line it prints reaches onLine as it comes
//   run     vyre-site-<site>-<deployment>, PORT and the env given, restart unless-stopped; the image stays after the container goes, so a rollback starts it again without a build
//   addons  vyre-site-<site>-postgres / -redis, official images, a named volume each, on the site's network under the names postgres and redis
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import type { TarFile } from "../../../sandbox/src/tar.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";
import type { DockerHttp } from "../../../sandbox/src/docker.ts";
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
  /** the address of a container on its site's network */
  address(containerId: string): Promise<string | null>;
  /** running, or how it ended: oom when the memory cap stopped it */
  state(containerId: string): Promise<{ running: boolean; exitCode?: number; oom?: boolean } | null>;
  logs(containerId: string, tail: number): Promise<string[]>;
  remove(containerId: string): Promise<void>;
  removeImage(image: string): Promise<void>;
  imageExists(image: string): Promise<boolean>;
  addon(a: { siteId: string; kind: AddonKind; password: string }): Promise<{ containerId: string; host: string; port: number }>;
  removeAddon(siteId: string, kind: AddonKind): Promise<void>;
  /** run a command in a container: stdin goes in, and the env values only through the exec's environment */
  exec(containerId: string, cmd: string[], env: Record<string, string>, stdin?: Uint8Array): Promise<{ code: number; out: string }>;
  /** put one file into a container's folder */
  put(containerId: string, dir: string, name: string, bytes: Uint8Array): Promise<void>;
}

const dec = new TextDecoder();
const parse = (b: Uint8Array): any => { try { return JSON.parse(dec.decode(b)); } catch { return null; } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const hex = (id: string): string => id.replace(/^[a-z]+_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const containerName = (siteId: string, deploymentId: string): string => `vyre-site-${hex(siteId).slice(-12)}-${hex(deploymentId).slice(-12)}`;
export const imageName = (siteId: string, deploymentId: string): string => `vyre-site/${hex(siteId)}:${hex(deploymentId)}`;
export const networkName = (siteId: string): string => `vyre-site-${hex(siteId).slice(-16)}`;
export const addonName = (siteId: string, kind: AddonKind): string => `vyre-site-${hex(siteId).slice(-12)}-${kind}`;

/** The source folder as a build context: no .git, node_modules or env files, at most 300 MB. The standard Dockerfile goes in beside it. */
export function contextTar(dir: string, extras: ReadonlyArray<{ name: string; text: string }>): Uint8Array {
  const replaced = new Set(extras.map((e) => e.name));
  const files: TarFile[] = [];
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
      files.push({ path: r, data: new Uint8Array(fs.readFileSync(a)), mode: st.mode & 0o111 ? 0o755 : 0o644, uid: 0, gid: 0, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  };
  walk(dir, "");
  for (const extra of extras) files.push({ path: extra.name, data: new TextEncoder().encode(extra.text), mode: 0o644, uid: 0, gid: 0, mtime: Math.floor(Date.now() / 1000) });
  return tarFiles(files);
}

/** A request whose answer is read line by line as it arrives (build output, pulls). */
function streamLines(socketPath: string, req: { method: string; path: string; body?: Uint8Array; contentType?: string; timeoutMs: number }, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = http.request({ socketPath, method: req.method, path: req.path, headers: req.body ? { "content-type": req.contentType ?? "application/octet-stream", "content-length": req.body.length } : {} }, (res) => {
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
    const timer = setTimeout(() => r.destroy(new Error("timed out")), req.timeoutMs);
    timer.unref?.();
    r.on("close", () => clearTimeout(timer));
    r.on("error", reject);
    r.end(req.body ? Buffer.from(req.body) : undefined);
  });
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
  // an engine that answers with a TTY stream sends plain text
  if (out.length === 0 && body.length > 0 && (body[0] ?? 0) > 2) return dec.decode(body).split("\n").filter(Boolean);
  return out.map((l) => l.replace(/\r$/, ""));
}

/** The container id of this process, when it runs in one: so it can join a site's network and reach the site. */
function selfContainer(): string | null {
  if (!fs.existsSync("/.dockerenv")) return null;
  try {
    const m = /\/docker\/containers\/([0-9a-f]{64})\//.exec(fs.readFileSync("/proc/self/mountinfo", "utf8"));
    if (m) return m[1] as string;
  } catch { /* not readable */ }
  return os.hostname();
}

export function dockerRunner(o: { socketPath?: string; http?: DockerHttp; log?: (msg: string) => void } = {}): Runner {
  const socketPath = o.socketPath ?? "/var/run/docker.sock";
  const api = o.http ?? unixSocketHttp(socketPath);
  const self = selfContainer();
  let quota: boolean | null = null;
  const networks = new Set<string>();

  async function ensureNetwork(siteId: string): Promise<string> {
    const name = networkName(siteId);
    if (networks.has(name)) return name;
    const have = await api({ method: "GET", path: `/networks/${name}` });
    if (have.status === 404) {
      const made = await api({ method: "POST", path: "/networks/create", json: { Name: name, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.site": siteId } } });
      if (made.status !== 201 && made.status !== 409) throw new Error(`Could not make the site's network: ${String(parse(made.body)?.message ?? made.status).slice(0, 200)}`);
    }
    if (self) {
      const joined = await api({ method: "POST", path: `/networks/${name}/connect`, json: { Container: self } });
      if (joined.status !== 200 && !/already exists|already attached/i.test(dec.decode(joined.body))) throw new Error(`Vyre could not join the site's network: ${dec.decode(joined.body).slice(0, 200)}`);
    }
    networks.add(name);
    return name;
  }

  async function pull(image: string): Promise<void> {
    const ok = await api({ method: "GET", path: `/images/${image}/json` });
    if (ok.status === 200) return;
    const [repo, tag] = image.split(":");
    let error = "";
    const status = await streamLines(socketPath, { method: "POST", path: `/images/create?fromImage=${encodeURIComponent(repo ?? image)}&tag=${encodeURIComponent(tag ?? "latest")}`, timeoutMs: 5 * 60_000 }, (line) => { const j = parse(new TextEncoder().encode(line)); if (j?.error) error = String(j.error); });
    if (status !== 200 || error) throw new Error(`Could not fetch ${image}: ${error || status}`);
  }

  async function create(name: string, config: Record<string, unknown>): Promise<{ id: string; note?: string }> {
    await api({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } });
    const host = config["HostConfig"] as Record<string, unknown>;
    const disk = host["StorageOpt"];
    let r = await api({ method: "POST", path: "/containers/create", query: { name }, json: quota === false ? { ...config, HostConfig: { ...host, StorageOpt: undefined } } : config });
    let note: string | undefined;
    if (r.status !== 201 && disk && /storage-opt|quota|xfs|not supported/i.test(dec.decode(r.body))) {
      // a per-container disk cap needs overlay on XFS with project quotas; on other disks the cap is the free-space check before each build and the rotated logs
      quota = false;
      note = "This server's disk cannot cap one container's size, so the free-space check and log rotation guard it instead.";
      r = await api({ method: "POST", path: "/containers/create", query: { name }, json: { ...config, HostConfig: { ...host, StorageOpt: undefined } } });
    } else if (r.status === 201 && disk) quota = true;
    if (r.status !== 201) throw new Error(`The container was not made: ${String(parse(r.body)?.message ?? r.status).slice(0, 300)}`);
    const id = String(parse(r.body)?.Id ?? "");
    const started = await api({ method: "POST", path: `/containers/${id}/start` });
    if (started.status !== 204 && started.status !== 304) throw new Error(`The container did not start: ${String(parse(started.body)?.message ?? started.status).slice(0, 300)}`);
    return note ? { id, note } : { id };
  }

  const hostConfig = (network: string, limits: Limits, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    NetworkMode: network, RestartPolicy: { Name: "unless-stopped" }, LogConfig: LOGS,
    NanoCpus: Math.round(limits.cpus * 1e9), Memory: limits.memoryMb * 1024 * 1024, MemorySwap: limits.memoryMb * 1024 * 1024, PidsLimit: 512,
    SecurityOpt: ["no-new-privileges"], Init: true,
    ...(limits.diskMb && quota !== false ? { StorageOpt: { size: `${limits.diskMb}M` } } : {}),
    ...extra,
  });

  return {
    async ping() { try { return (await api({ method: "GET", path: "/_ping", timeoutMs: 4000 })).status === 200; } catch { return false; } },

    async freeMb() {
      try {
        const info = parse((await api({ method: "GET", path: "/info", timeoutMs: 10_000 })).body) as { DockerRootDir?: string } | null;
        const root = info?.DockerRootDir;
        // the engine's disk, seen from here when it is the same machine; else the disk this process is on
        const st = fs.statfsSync(root && fs.existsSync(root) ? root : "/");
        return Math.floor((st.bavail * st.bsize) / (1024 * 1024));
      } catch { return null; }
    },

    async build(a) {
      const image = imageName(a.siteId, a.deploymentId);
      const own = a.plan.kind === "dockerfile";
      const dockerfile = own ? path.relative(a.dir, a.plan.dockerfile).split(path.sep).join("/") : ".vyre.Dockerfile";
      let tar: Uint8Array;
      // a standard builder's Dockerfile goes in beside the code, and a .dockerignore keeps it (and env files) out of what the image copies
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
        const status = await streamLines(socketPath, { method: "POST", path: `/build?${q.toString()}`, body: tar, contentType: "application/x-tar", timeoutMs: BUILD_MS }, (line) => {
          const j = parse(new TextEncoder().encode(line)) as { stream?: string; status?: string; error?: string; aux?: { ID?: string } } | null;
          if (!j) { a.onLine(line); return; }
          if (j.error) { error = j.error; a.onLine(j.error.trim()); }
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

    async run(a) {
      const network = await ensureNetwork(a.siteId);
      const name = containerName(a.siteId, a.deploymentId);
      const env = { ...a.env, PORT: String(a.port), HOST: "0.0.0.0" };
      const made = await create(name, {
        Image: a.image, Env: Object.entries(env).map(([k, v]) => `${k}=${v}`), ExposedPorts: { [`${a.port}/tcp`]: {} },
        Labels: { "vyre.site": a.siteId, "vyre.deployment": a.deploymentId, "vyre.kind": "app" },
        HostConfig: hostConfig(network, a.limits, { CapDrop: ["ALL"], CapAdd: ["NET_BIND_SERVICE"], Tmpfs: { "/tmp": `rw,nosuid,size=${Math.min(512, Math.max(64, Math.floor(a.limits.memoryMb / 2)))}m` } }),
      });
      return { containerId: made.id, name, ...(made.note ? { note: made.note } : {}) };
    },

    async address(containerId) {
      const r = await api({ method: "GET", path: `/containers/${containerId}/json` });
      if (r.status !== 200) return null;
      const info = parse(r.body) as { State?: { Running?: boolean }; HostConfig?: { NetworkMode?: string }; NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> } };
      if (info.State?.Running !== true) return null;
      const nets = info.NetworkSettings?.Networks ?? {};
      return nets[info.HostConfig?.NetworkMode ?? ""]?.IPAddress || Object.values(nets).find((n) => n.IPAddress)?.IPAddress || null;
    },

    async state(containerId) {
      const r = await api({ method: "GET", path: `/containers/${containerId}/json` });
      if (r.status !== 200) return null;
      const s = (parse(r.body) as { State?: { Running?: boolean; Restarting?: boolean; ExitCode?: number; OOMKilled?: boolean } }).State ?? {};
      return { running: s.Running === true && s.Restarting !== true, ...(typeof s.ExitCode === "number" ? { exitCode: s.ExitCode } : {}), ...(s.OOMKilled ? { oom: true } : {}) };
    },

    async logs(containerId, tail) {
      const n = Math.max(1, Math.min(Math.trunc(tail), 1000));
      const r = await api({ method: "GET", path: `/containers/${containerId}/logs`, query: { stdout: "1", stderr: "1", tail: String(n) }, timeoutMs: 15_000 });
      if (r.status !== 200) return [];
      return frames(r.body).slice(-n);
    },

    async remove(containerId) {
      const r = await api({ method: "DELETE", path: `/containers/${containerId}`, query: { force: "true" } });
      if (r.status !== 204 && r.status !== 404) throw new Error(`Could not stop the container: ${dec.decode(r.body).slice(0, 200)}`);
    },

    async removeImage(image) { await api({ method: "DELETE", path: `/images/${image}`, query: { force: "true" } }); },

    async imageExists(image) { return (await api({ method: "GET", path: `/images/${image}/json` })).status === 200; },

    async addon(a) {
      const network = await ensureNetwork(a.siteId);
      const name = addonName(a.siteId, a.kind);
      const image = ADDON_IMAGE[a.kind];
      await pull(image);
      const running = await api({ method: "GET", path: `/containers/${name}/json` });
      if (running.status === 200 && (parse(running.body) as { State?: { Running?: boolean } }).State?.Running) return { containerId: String(parse(running.body).Id), host: a.kind, port: ADDON_PORT[a.kind] };
      const volume = `${name}-data`;
      const cfg = a.kind === "postgres"
        ? { Env: ["POSTGRES_USER=app", `POSTGRES_PASSWORD=${a.password}`, "POSTGRES_DB=app"], mount: "/var/lib/postgresql/data", cmd: undefined }
        : { Env: [], mount: "/data", cmd: ["redis-server", "--appendonly", "yes", "--requirepass", a.password, "--maxmemory", `${Math.floor(ADDON_LIMITS.redis.memoryMb * 0.8)}mb`, "--maxmemory-policy", "allkeys-lru"] };
      const made = await create(name, {
        Image: image, Env: cfg.Env, ...(cfg.cmd ? { Cmd: cfg.cmd } : {}), Labels: { "vyre.site": a.siteId, "vyre.kind": a.kind },
        HostConfig: hostConfig(network, ADDON_LIMITS[a.kind], { Binds: [`${volume}:${cfg.mount}`] }),
        NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: [a.kind] } } },
      });
      return { containerId: made.id, host: a.kind, port: ADDON_PORT[a.kind] };
    },

    async removeAddon(siteId, kind) {
      const name = addonName(siteId, kind);
      await api({ method: "DELETE", path: `/containers/${name}`, query: { force: "true", v: "true" } });
      await api({ method: "DELETE", path: `/volumes/${name}-data`, query: { force: "true" } });
    },

    async put(containerId, dir, name, bytes) {
      const tar = tarFiles([{ path: name, data: bytes, mode: 0o644, uid: 0, gid: 0, mtime: Math.floor(Date.now() / 1000) }]);
      const r = await api({ method: "PUT", path: `/containers/${containerId}/archive`, query: { path: dir }, body: tar, contentType: "application/x-tar", timeoutMs: 10 * 60_000 });
      if (r.status !== 200) throw new Error(`Could not copy the file in: ${dec.decode(r.body).slice(0, 200)}`);
    },

    async exec(containerId, cmd, env, stdin) {
      const made = await api({ method: "POST", path: `/containers/${containerId}/exec`, json: { Cmd: cmd, Env: Object.entries(env).map(([k, v]) => `${k}=${v}`), AttachStdout: true, AttachStderr: true, AttachStdin: stdin !== undefined } });
      if (made.status !== 201) throw new Error(`Could not run it in the container: ${dec.decode(made.body).slice(0, 200)}`);
      const id = String(parse(made.body)?.Id ?? "");
      const out = await new Promise<string>((resolve, reject) => {
        const body = JSON.stringify({ Detach: false, Tty: false });
        const r = http.request({ socketPath, method: "POST", path: `/exec/${id}/start`, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "Upgrade", upgrade: "tcp" } });
        const chunks: Buffer[] = [];
        const finish = (sock: NodeJS.ReadableStream & { write?: (b: Buffer) => void; end?: () => void }): void => {
          sock.on("data", (c: Buffer) => chunks.push(c));
          sock.on("end", () => resolve(frames(new Uint8Array(Buffer.concat(chunks))).join("\n")));
          sock.on("error", reject);
        };
        r.on("upgrade", (_res, socket) => {
          finish(socket);
          if (stdin) { socket.write(Buffer.from(stdin)); }
          // the stream closes when the command ends; closing our half tells it stdin is done
          if (stdin !== undefined) (socket as unknown as { end(): void }).end();
        });
        r.on("response", (res) => finish(res));
        r.on("error", reject);
        r.setTimeout(30 * 60_000, () => r.destroy(new Error("timed out")));
        r.end(body);
      });
      const inspect = parse((await api({ method: "GET", path: `/exec/${id}/json` })).body) as { ExitCode?: number } | null;
      return { code: inspect?.ExitCode ?? 1, out };
    },
  };
}
