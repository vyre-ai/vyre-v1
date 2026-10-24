// The person's sandbox on the Space host: one Docker container, built by the Engine API over its unix socket (S8, ARCH 6.6).
//
//   container   vyre-sbx-<person> from images/person-sandbox: non-root, read-only root filesystem, a tmpfs home, the person's folders bound at /work/<name>, all capabilities dropped,
//               no-new-privileges, CPU, memory and process limits, no devices, no docker socket, private PID, IPC and network namespaces
//   network     one internal bridge per sandbox: containers on it have no route out. The only address they can reach is the host side of the bridge, where the egress proxy listens
//   proxy       policy + egress.ts on that address, with the person's allow-list; HTTP(S)_PROXY point at it
//   credentials CLI sign-in files are written into the container's tmpfs through the archive endpoint (never the host's disk) and removed with the container
// Before a container is created its config goes through reviewContainerConfig: whatever built it, a config that gives more than the above is refused.
import http from "node:http";
import { createEgressProxy } from "./egress.ts";
import type { EgressOptions } from "./egress.ts";
import { validateSpec } from "./policy.ts";
import type { PolicyOptions } from "./policy.ts";
import { tarFiles, tarPath } from "./tar.ts";
import { DEFAULT_LIMITS, SandboxError } from "./types.ts";
import type { CredentialFile, ExecResult, ExecSpec, Roots, Sandbox, SandboxSpec } from "./types.ts";

// ---- the Engine API ---------------------------------------------------------------------------------------------------------------------------

export interface DockerRequest { method: string; path: string; query?: Record<string, string>; json?: unknown; body?: Uint8Array; contentType?: string; timeoutMs?: number }
export interface DockerResponse { status: number; body: Uint8Array }
export type DockerHttp = (req: DockerRequest) => Promise<DockerResponse>;

/** Compare two `1.43` style versions as numbers per part, so 1.9 < 1.44. */
const versionCmp = (a: string, b: string): number => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d; }
  return 0;
};
/** The API version this code was written against. A daemon that no longer serves it (Docker 29 starts at 1.44) is asked for its oldest, one that does not reach it for its newest. */
export const WANTED_API_VERSION = "1.43";

/**
 * HTTP over the Engine's unix socket. The only place a socket path appears.
 * Without an `apiVersion` the daemon is asked once (an unversioned GET /version) what it serves, and the request path uses WANTED_API_VERSION clamped into that range:
 * a pinned 1.43 is refused outright by Docker 29 ("client version 1.43 is too old", minimum 1.44), which a real daemon showed.
 */
export function unixSocketHttp(socketPath = "/var/run/docker.sock", apiVersion?: string): DockerHttp {
  const call = (path: string, req: DockerRequest): Promise<DockerResponse> => new Promise((resolve, reject) => {
    const qs = req.query && Object.keys(req.query).length > 0 ? `?${new URLSearchParams(req.query).toString()}` : "";
    const payload = req.json !== undefined ? Buffer.from(JSON.stringify(req.json)) : req.body ? Buffer.from(req.body) : undefined;
    const r = http.request({
      socketPath, method: req.method, path: `${path}${qs}`, timeout: req.timeoutMs ?? 60_000,
      headers: { ...(payload ? { "content-type": req.contentType ?? "application/json", "content-length": payload.length } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)) }));
      res.on("error", reject);
    });
    r.on("timeout", () => { r.destroy(new Error("the Docker engine did not answer in time")); });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
  let negotiated: Promise<string> | undefined;
  const version = (): Promise<string> => {
    if (apiVersion !== undefined) return Promise.resolve(apiVersion.replace(/^v/, ""));
    negotiated ??= call("/version", { method: "GET", path: "/version", timeoutMs: 10_000 }).then((res) => {
      let max = WANTED_API_VERSION, min = "1.12";
      try {
        const v = JSON.parse(new TextDecoder().decode(res.body)) as { ApiVersion?: string; MinAPIVersion?: string };
        if (typeof v.ApiVersion === "string") max = v.ApiVersion;
        if (typeof v.MinAPIVersion === "string") min = v.MinAPIVersion;
      } catch { /* an engine that does not answer /version: use the version this was written against */ }
      let pick = WANTED_API_VERSION;
      if (versionCmp(pick, min) < 0) pick = min;
      if (versionCmp(pick, max) > 0) pick = max;
      return pick;
    });
    return negotiated;
  };
  return async (req) => call(`/v${await version()}${req.path}`, req);
}

const dec = new TextDecoder();
const parse = (b: Uint8Array): any => { try { return JSON.parse(dec.decode(b)); } catch { return null; } };

export interface DockerApi {
  ping(): Promise<boolean>;
  imageExists(name: string): Promise<boolean>;
  networkCreate(name: string, labels: Record<string, string>): Promise<{ id: string; gateway: string }>;
  networkRemove(id: string): Promise<void>;
  containerCreate(name: string, config: ContainerConfig): Promise<string>;
  containerStart(id: string): Promise<void>;
  containerStop(id: string, graceSec: number): Promise<void>;
  containerRemove(id: string): Promise<void>;
  containerRunning(id: string): Promise<boolean>;
  exec(id: string, a: { cmd: readonly string[]; env: readonly string[]; workingDir?: string; user?: string }): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  putArchive(id: string, dir: string, tar: Uint8Array): Promise<void>;
}

function fail(what: string, res: DockerResponse): never {
  const msg = (parse(res.body) as { message?: string } | null)?.message ?? dec.decode(res.body).slice(0, 200);
  throw new SandboxError("sandbox.docker", `${what} failed (${res.status}): ${String(msg).slice(0, 200)}`);
}

/** The 8-byte-framed stream an exec returns when it has no TTY: 1 is stdout, 2 is stderr. */
export function demux(body: Uint8Array): { stdout: string; stderr: string } {
  const out: number[][] = [[], [], []];
  for (let at = 0; at + 8 <= body.length;) {
    const kind = body[at] ?? 1;
    const size = ((body[at + 4] ?? 0) << 24 | (body[at + 5] ?? 0) << 16 | (body[at + 6] ?? 0) << 8 | (body[at + 7] ?? 0)) >>> 0;
    const chunk = body.subarray(at + 8, at + 8 + size);
    const into = out[kind === 2 ? 2 : 1] as number[];
    for (const b of chunk) into.push(b);
    at += 8 + size;
  }
  return { stdout: dec.decode(new Uint8Array(out[1] as number[])), stderr: dec.decode(new Uint8Array(out[2] as number[])) };
}

export function createDockerApi(http_: DockerHttp): DockerApi {
  const json = (r: DockerResponse): any => parse(r.body);
  return {
    async ping() { try { const r = await http_({ method: "GET", path: "/_ping", timeoutMs: 5000 }); return r.status === 200; } catch { return false; } },
    async imageExists(name) {
      const r = await http_({ method: "GET", path: `/images/${name}/json` });
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      return fail("image check", r);
    },
    async networkCreate(name, labels) {
      const r = await http_({ method: "POST", path: "/networks/create", json: { Name: name, Driver: "bridge", Internal: true, CheckDuplicate: true, Labels: labels, Options: { "com.docker.network.bridge.enable_icc": "false" } } });
      if (r.status !== 201) fail("network create", r);
      const id = String(json(r).Id);
      const info = await http_({ method: "GET", path: `/networks/${id}` });
      if (info.status !== 200) fail("network inspect", info);
      const gateway = (json(info).IPAM?.Config as Array<{ Gateway?: string }> | undefined)?.find((c) => c.Gateway)?.Gateway;
      if (!gateway) throw new SandboxError("sandbox.docker", "the sandbox network has no gateway address to put the egress proxy on");
      return { id, gateway };
    },
    async networkRemove(id) { const r = await http_({ method: "DELETE", path: `/networks/${id}` }); if (r.status !== 204 && r.status !== 404) fail("network remove", r); },
    async containerCreate(name, config) {
      const r = await http_({ method: "POST", path: "/containers/create", query: { name }, json: config });
      if (r.status !== 201) fail("container create", r);
      return String(json(r).Id);
    },
    async containerStart(id) { const r = await http_({ method: "POST", path: `/containers/${id}/start` }); if (r.status !== 204 && r.status !== 304) fail("container start", r); },
    async containerStop(id, graceSec) { const r = await http_({ method: "POST", path: `/containers/${id}/stop`, query: { t: String(graceSec) }, timeoutMs: (graceSec + 30) * 1000 }); if (![204, 304, 404].includes(r.status)) fail("container stop", r); },
    async containerRemove(id) { const r = await http_({ method: "DELETE", path: `/containers/${id}`, query: { force: "true", v: "true" } }); if (r.status !== 204 && r.status !== 404) fail("container remove", r); },
    async containerRunning(id) { const r = await http_({ method: "GET", path: `/containers/${id}/json` }); return r.status === 200 && json(r).State?.Running === true; },
    async exec(id, a) {
      const c = await http_({ method: "POST", path: `/containers/${id}/exec`, json: { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: a.cmd, Env: a.env, ...(a.workingDir ? { WorkingDir: a.workingDir } : {}), ...(a.user ? { User: a.user } : {}) } });
      if (c.status !== 201) fail("exec create", c);
      const execId = String(json(c).Id);
      const s = await http_({ method: "POST", path: `/exec/${execId}/start`, json: { Detach: false, Tty: false }, timeoutMs: 3_600_000 });
      if (s.status !== 200) fail("exec start", s);
      const { stdout, stderr } = demux(s.body);
      const i = await http_({ method: "GET", path: `/exec/${execId}/json` });
      if (i.status !== 200) fail("exec inspect", i);
      const code = json(i).ExitCode;
      return { exitCode: typeof code === "number" ? code : null, stdout, stderr };
    },
    async putArchive(id, dir, tar) {
      const r = await http_({ method: "PUT", path: `/containers/${id}/archive`, query: { path: dir }, body: tar, contentType: "application/x-tar" });
      if (r.status !== 200) fail("credential upload", r);
    },
  };
}

// ---- the container ------------------------------------------------------------------------------------------------------------------------------

export interface ContainerConfig {
  Image: string;
  Hostname: string;
  User: string;
  WorkingDir: string;
  Cmd: string[];
  Env: string[];
  Labels: Record<string, string>;
  StopTimeout: number;
  NetworkDisabled?: false;
  HostConfig: {
    Binds: string[];
    ReadonlyRootfs: boolean;
    Tmpfs: Record<string, string>;
    CapDrop: string[];
    CapAdd: string[];
    SecurityOpt: string[];
    Privileged: boolean;
    NetworkMode: string;
    PidMode: string;
    IpcMode: string;
    UsernsMode: string;
    Devices: unknown[];
    PidsLimit: number;
    Memory: number;
    MemorySwap: number;
    NanoCpus: number;
    Init: boolean;
    AutoRemove: boolean;
    Ulimits: Array<{ Name: string; Soft: number; Hard: number }>;
    LogConfig: { Type: string; Config: Record<string, string> };
    ExtraHosts: string[];
    Dns: string[];
  };
}

export const HOME = "/home/agent";
export const CRED_DIR = "/run/vyre-creds";
export const DEFAULT_IMAGE = "vyre/person-sandbox:1";
const UID = 10001;

export function networkName(id: string): string { return `${id}-net`; }

/** Proxy variables for a process inside: the only route out. */
export function proxyEnv(proxyUrl: string): Record<string, string> {
  return { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1" };
}

export function containerConfig(spec: SandboxSpec, mounts: ReadonlyArray<{ host: string; guest: string; mode: "ro" | "rw" }>, proxyUrl: string): ContainerConfig {
  const limits = { ...DEFAULT_LIMITS, ...spec.limits };
  const uid = spec.user?.uid ?? UID;
  const gid = spec.user?.gid ?? UID;
  const memory = Math.round(limits.memoryMb * 1024 * 1024);
  const env = { ...(spec.env ?? {}), HOME, ...proxyEnv(proxyUrl), VYRE_CRED_DIR: CRED_DIR };
  return {
    Image: spec.image ?? DEFAULT_IMAGE,
    Hostname: spec.id,
    User: `${uid}:${gid}`,
    WorkingDir: "/work",
    Cmd: ["sleep", "infinity"],
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    Labels: { "vyre.sandbox": "1", "vyre.person": spec.person },
    StopTimeout: 5,
    HostConfig: {
      Binds: mounts.map((m) => `${m.host}:${m.guest}:${m.mode}`),
      ReadonlyRootfs: true,
      Tmpfs: {
        [HOME]: `rw,nosuid,nodev,size=512m,uid=${uid},gid=${gid},mode=0700`,
        "/tmp": `rw,nosuid,nodev,noexec,size=256m,uid=${uid},gid=${gid},mode=1777`,
        [CRED_DIR]: `rw,nosuid,nodev,noexec,size=1m,uid=${uid},gid=${gid},mode=0700`,
      },
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      NetworkMode: networkName(spec.id),
      PidMode: "",
      IpcMode: "private",
      UsernsMode: "",
      Devices: [],
      PidsLimit: limits.pids,
      Memory: memory,
      MemorySwap: memory,
      NanoCpus: Math.round(limits.cpus * 1e9),
      Init: true,
      AutoRemove: false,
      Ulimits: [{ Name: "nofile", Soft: 4096, Hard: 8192 }, { Name: "core", Soft: 0, Hard: 0 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "5m", "max-file": "2" } },
      ExtraHosts: [],
      Dns: [],
    },
  };
}

/**
 * The review S8 asks for, as code: what a person's sandbox container must never have. Returns what is wrong; empty means the config is within the profile. Run on every config before it is created,
 * so a change to containerConfig that gave more than the profile is caught here, not in production.
 */
export function reviewContainerConfig(c: ContainerConfig, id: string, workRoots: readonly string[]): string[] {
  const bad: string[] = [];
  const h = c.HostConfig;
  if (h.Privileged) bad.push("privileged");
  if (h.CapAdd.length > 0) bad.push(`adds capabilities: ${h.CapAdd.join(",")}`);
  if (!h.CapDrop.includes("ALL")) bad.push("does not drop all capabilities");
  if (!h.ReadonlyRootfs) bad.push("root filesystem is writable");
  if (!h.SecurityOpt.includes("no-new-privileges:true")) bad.push("allows new privileges");
  if (h.SecurityOpt.some((s) => /unconfined|seccomp=|apparmor=/.test(s))) bad.push(`weakens the default profile: ${h.SecurityOpt.join(",")}`);
  if (h.NetworkMode !== networkName(id)) bad.push(`network is ${h.NetworkMode}, not the sandbox's own internal one`);
  if (h.PidMode !== "") bad.push("shares a PID namespace");
  if (h.IpcMode !== "private") bad.push("shares an IPC namespace");
  if (h.UsernsMode !== "") bad.push("changes the user namespace");
  if (h.Devices.length > 0) bad.push("has devices");
  if (h.ExtraHosts.length > 0 || h.Dns.length > 0) bad.push("overrides name resolution");
  if (h.Memory <= 0 || h.PidsLimit <= 0 || h.NanoCpus <= 0) bad.push("a limit is missing");
  if (h.MemorySwap !== h.Memory) bad.push("swap is not pinned to memory");
  const user = /^(\d+):(\d+)$/.exec(c.User);
  if (!user || Number(user[1]) === 0 || Number(user[2]) === 0) bad.push(`runs as ${c.User}`);
  for (const b of h.Binds) {
    const m = /^(.*):(\/[^:]*):(ro|rw)$/.exec(b);
    if (!m) { bad.push(`bind ${b} is not host:guest:mode`); continue; }
    const host = m[1] as string;
    const guest = m[2] as string;
    if (/docker\.sock|containerd\.sock|\.sock$/.test(host) || host.startsWith("/var/run") || host.startsWith("/run")) bad.push(`binds a socket or runtime folder: ${host}`);
    if (!workRoots.some((r) => host === r || host.startsWith(`${r}/`))) bad.push(`binds ${host}, outside the person's folders`);
    if (!(guest === "/work" || guest.startsWith("/work/") || guest.startsWith(`${HOME}/`))) bad.push(`binds into ${guest}`);
  }
  for (const k of Object.keys(h.Tmpfs)) if (k !== HOME && k !== "/tmp" && k !== CRED_DIR) bad.push(`unexpected tmpfs ${k}`);
  if (!(c.Hostname === id)) bad.push("hostname is not the sandbox id");
  return bad;
}

// ---- the sandbox --------------------------------------------------------------------------------------------------------------------------------

export interface ProxyHandle { port: number; close(): Promise<void> }

export interface DockerSandboxDeps {
  api: DockerApi;
  roots: Roots;
  policy?: PolicyOptions;
  /** Start the egress proxy for this sandbox on the bridge's host-side address. Default: createEgressProxy with the person's allow-list. */
  startProxy?: (a: { allow: readonly string[]; host: string }) => Promise<ProxyHandle>;
  egress?: Partial<EgressOptions>;
  now?: () => number;
}

const SAFE_PATH_IN_HOME = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/;

/** Create and start the person's container. Everything that was set up is undone if a later step fails. */
export async function startDockerSandbox(spec: SandboxSpec, deps: DockerSandboxDeps): Promise<Sandbox> {
  if (spec.kind !== "docker") throw new SandboxError("sandbox.policy", "this is the Docker sandbox");
  const checked = validateSpec(spec, deps.roots, deps.policy);
  const { api } = deps;
  const now = deps.now ?? Date.now;
  const image = spec.image ?? DEFAULT_IMAGE;
  if (!(await api.imageExists(image))) throw new SandboxError("sandbox.image_missing", `the sandbox image ${image} is not on this host`);

  const undo: Array<() => Promise<void>> = [];
  const cleanup = async (): Promise<void> => { for (const f of undo.reverse()) { try { await f(); } catch { /* keep undoing the rest */ } } undo.length = 0; };
  try {
    const net = await api.networkCreate(networkName(spec.id), { "vyre.sandbox": "1", "vyre.person": spec.person });
    undo.push(() => api.networkRemove(net.id));
    const proxy = await (deps.startProxy ?? defaultProxy(deps.egress))({ allow: spec.egressHosts, host: net.gateway });
    undo.push(() => proxy.close());
    const proxyUrl = `http://${net.gateway}:${proxy.port}`;
    const config = containerConfig(spec, checked.mounts, proxyUrl);
    const problems = reviewContainerConfig(config, spec.id, deps.roots.work);
    if (problems.length > 0) throw new SandboxError("sandbox.policy", `the container config is outside the sandbox profile: ${problems.join("; ")}`);
    const cid = await api.containerCreate(spec.id, config);
    undo.push(() => api.containerRemove(cid));
    await api.containerStart(cid);
    undo.push(() => api.containerStop(cid, 2));

    let stopped = false;
    let hasCreds = false;
    const credPaths = new Set<string>();
    const env = (): Readonly<Record<string, string>> => ({ ...(spec.env ?? {}), HOME, ...proxyEnv(proxyUrl) });
    // The tmpfs is RAM, so removing is erasing; shred first for the case a swap device is configured on the host.
    const wipe = async (): Promise<void> => {
      if (!hasCreds) return;
      const paths = [...credPaths];
      await api.exec(cid, { cmd: ["sh", "-c", 'for f in "$@"; do shred -n 1 -z -u "$f" 2>/dev/null || rm -f "$f"; done', "sh", ...paths], env: [] }).catch(() => undefined);
      credPaths.clear();
      hasCreds = false;
    };
    const sandbox: Sandbox = {
      id: spec.id,
      kind: "docker",
      env,
      async exec(e: ExecSpec): Promise<ExecResult> {
        if (stopped) throw new SandboxError("sandbox.stopped", "the sandbox is stopped");
        if (e.argv.length === 0) throw new SandboxError("sandbox.policy", "nothing to run");
        const secs = Math.max(1, Math.ceil((e.timeoutMs ?? 600_000) / 1000));
        const run = await api.exec(cid, {
          // `timeout` inside the container ends the process on time; 124 is its "timed out".
          cmd: ["timeout", "-k", "2", String(secs), ...e.argv],
          env: Object.entries({ ...env(), ...(e.env ?? {}), ...proxyEnv(proxyUrl) }).map(([k, v]) => `${k}=${v}`),
          ...(e.cwd !== undefined ? { workingDir: e.cwd } : {}),
        });
        return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, timedOut: run.exitCode === 124 };
      },
      async putCredentials(files: readonly CredentialFile[]): Promise<void> {
        if (stopped) throw new SandboxError("sandbox.stopped", "the sandbox is stopped");
        const uid = spec.user?.uid ?? UID;
        const gid = spec.user?.gid ?? UID;
        for (const f of files) { tarPath(f.path); if (!SAFE_PATH_IN_HOME.test(f.path)) throw new SandboxError("sandbox.policy", `not a path credentials may go to: ${f.path.slice(0, 60)}`); }
        // Straight into the home tmpfs: the archive is built in memory and goes to the container, so the file is never on the host's disk.
        await api.putArchive(cid, HOME, tarFiles(files.map((f) => ({ path: f.path, data: f.data, mode: 0o600, uid, gid, mtime: Math.floor(now() / 1000) }))));
        hasCreds = true;
        for (const f of files) credPaths.add(`${HOME}/${f.path}`);
      },
      async wipeCredentials(): Promise<void> {
        if (!stopped) await wipe();
      },
      async stop(): Promise<void> {
        if (stopped) return;
        await wipe();
        stopped = true;
        await cleanup();
      },
    };
    return sandbox;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

function defaultProxy(opts: Partial<EgressOptions> | undefined): (a: { allow: readonly string[]; host: string }) => Promise<ProxyHandle> {
  return async (a) => {
    const p = createEgressProxy({ ...opts, allow: a.allow });
    const { port } = await p.listen(0, a.host);
    return { port, close: () => p.close() };
  };
}
