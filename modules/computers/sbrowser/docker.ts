// The Docker adapter of the Space browser: one container `vyre-sbrowser` per Space host from images/space-browser, a named volume for the profiles at /data, and browserd inside, which this adapter talks
// to by running its control program (`docker exec <container> /opt/browserd/ctl <action> '<json>'`, one JSON object on stdout, a refusal is {"code","message"} on stderr with a non-zero exit), the same way
// the agent computer's host talks to agentd (modules/computers/impl.ts). The container is started on the first browser tool and stays up: it holds nothing while no profile runs a browser.
import type { ContainerConfig, DockerApi, DockerHttp } from "../../../sandbox/src/docker.ts";
import { computerSeccomp, reviewComputerConfig, toolErrorOf } from "../impl.ts";
import { LIMITS } from "../capacity.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { Readable } from "node:stream";
import { createSealedStore, streamsOf } from "../handlers/seal.ts";
import { createBrowserSeal } from "./seal.ts";
import type { BrowserAnswer, BrowserToolCall, ProfileRow, SpaceBrowser } from "./port.ts";

export const DEFAULT_BROWSER_IMAGE = "vyre/space-browser:1";
export const BROWSERD_CTL = "/opt/browserd/ctl";
export const BROWSER_DATA_GUEST = "/data";
export const BROWSER_NETWORK = "vyre-sbrowsernet";
const MAX_ARG = 125_000;

export interface DockerSpaceBrowserOptions {
  api: DockerApi;
  image?: string;
  /** Container name. Default `vyre-sbrowser`; the volume is `<name>-data`. */
  name?: string;
  cmd?: readonly string[];
  limits?: Partial<{ cpus: number; memoryMb: number; pids: number }>;
  user?: { uid: number; gid: number };
  /** How many browsers may run at once inside it (VYRE_BROWSER_MAX_RUNNING). Default 6. */
  maxRunning?: number;
  /** Minutes of quiet before a profile's browser stops. Default 10. */
  idleMinutes?: number;
  /** How often browserd looks for quiet profiles, in seconds. Default 30. */
  sweepSeconds?: number;
  /** Raw Engine access: for the image pull and, behind the runner, the network. Without it the image must already be on the machine and the container uses the default bridge. */
  http?: DockerHttp;
  /**
   * Run behind the container runner (a Team server: vyred holds no Docker socket). The container then gets a network of its own, `vyre-sbrowsernet`, so it cannot reach an agent computer or a site, and the
   * ingress (vyred) joins it under `alias` so the browser can reach the one route it posts to (the Vault channel).
   */
  runner?: { ingress?: string; alias?: string };
  sleep?: (ms: number) => Promise<void>;
  startTimeoutMs?: number;
  /** The key and the folder for sealed profiles (handlers/seal.ts). With it and `http`, a profile whose browser is not running has no Chrome folder on the volume. */
  profileSeal?: { key(): Uint8Array; dir: string };
  /** How often idle profiles are looked for, to be sealed. Default 30 s; 0 turns the timer off (tests call sweep). */
  sealSweepMs?: number;
  /** How long a profile must have been left alone, not running, before it is sealed. Default 20 s. */
  sealQuietMs?: number;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

export function browserContainerConfig(o: DockerSpaceBrowserOptions): ContainerConfig {
  const name = o.name ?? "vyre-sbrowser";
  // the service holds up to maxRunning browsers; each gets half its cap of the service's memory (a browser bursts to its cap when the host has room, capacity.ts LIMITS.browser) on top of a base for browserd
  const many = o.maxRunning ?? 6;
  const limits = { cpus: Math.min(4, Math.max(1, Math.round((many * LIMITS.browser.cpus) / 2))), memoryMb: Math.min(8192, 512 + Math.round((many * LIMITS.browser.memoryMb) / 2)), pids: 2048, ...o.limits };
  const memory = Math.round(limits.memoryMb * 1024 * 1024);
  const uid = o.user?.uid ?? 10001;
  const gid = o.user?.gid ?? 10001;
  return {
    Image: o.image ?? DEFAULT_BROWSER_IMAGE,
    Hostname: name,
    User: "",
    WorkingDir: "/home/browser",
    Cmd: [...(o.cmd ?? [])],
    Env: [`VYRE_BROWSER_MAX_RUNNING=${o.maxRunning ?? 6}`, `VYRE_BROWSER_IDLE_MINUTES=${o.idleMinutes ?? 10}`, ...(o.sweepSeconds !== undefined ? [`VYRE_BROWSER_SWEEP_SECONDS=${o.sweepSeconds}`] : [])],
    Labels: { "vyre.sbrowser": "1" },
    StopTimeout: 10,
    HostConfig: {
      Binds: [`${name}-data:${BROWSER_DATA_GUEST}:rw`],
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=512m,uid=${uid},gid=${gid},mode=1777`, "/dev/shm": "rw,nosuid,nodev,noexec,size=1g" },
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true", `seccomp=${computerSeccomp()}`],
      Privileged: false,
      NetworkMode: o.runner ? BROWSER_NETWORK : "bridge",
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
      Ulimits: [{ Name: "nofile", Soft: 16384, Hard: 32768 }, { Name: "core", Soft: 0, Hard: 0 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      ExtraHosts: [],
      Dns: [],
    },
  };
}

const bodyText = (b: Uint8Array): string => { const t = new TextDecoder().decode(b); try { return String((JSON.parse(t) as { message?: string }).message ?? t).slice(0, 200); } catch { return t.slice(0, 200); } };
const decode64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createDockerSpaceBrowser(o: DockerSpaceBrowserOptions): SpaceBrowser & { recover(): Promise<string[]>; sweep(): Promise<string[]>; oversize(): string[]; close(): void } {
  const name = o.name ?? "vyre-sbrowser";
  const sleep = o.sleep ?? realSleep;
  let up: Promise<void> | null = null;

  async function exec(action: string, body: Record<string, unknown>): Promise<BrowserAnswer> {
    const arg = JSON.stringify(body);
    if (arg.length > MAX_ARG) throw new ToolError("bad_input", "That call is too large to send to the browser.");
    const r = await o.api.exec(name, { cmd: [BROWSERD_CTL, action, arg], env: [], ...(o.user ? { user: `${o.user.uid}:${o.user.gid}` } : {}) });
    if (r.exitCode !== 0) throw toolErrorOf(r.stderr, r.exitCode);
    const text = r.stdout.trim();
    if (text === "") return {};
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new ToolError("unavailable", "The Space browser answered with something that is not JSON."); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ToolError("unavailable", "The Space browser answered with something that is not an object.");
    return parsed as BrowserAnswer;
  }

  /** The service's own network behind the runner, with the ingress joined: made once, again if it is gone. */
  async function makeNetwork(): Promise<void> {
    if (!o.runner || !o.http) return;
    const made = await o.http({ method: "POST", path: "/networks/create", json: { Name: BROWSER_NETWORK, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" } } });
    if (made.status !== 201 && made.status !== 409) throw new ToolError("unavailable", `The Space browser's network was not made (${made.status}: ${bodyText(made.body)})`);
    if (o.runner.ingress) {
      const joined = await o.http({ method: "POST", path: `/networks/${BROWSER_NETWORK}/connect`, json: { Container: o.runner.ingress, EndpointConfig: { Aliases: [o.runner.alias ?? "vyre-host"] } } });
      if (joined.status !== 200 && joined.status !== 403 && !/already exists/i.test(bodyText(joined.body))) throw new ToolError("unavailable", `vyred could not join the Space browser's network (${joined.status}: ${bodyText(joined.body)})`);
      if (joined.status === 403 && !/already/i.test(bodyText(joined.body))) throw new ToolError("unavailable", `The runner refused to join vyred to the Space browser's network: ${bodyText(joined.body)}`);
    }
  }

  /** The container exists and runs; made and started on first use, with browserd answering. Calls that arrive together share one check. */
  function ensureUp(): Promise<void> {
    up ??= (async () => {
      if (await o.api.containerRunning(name)) return;
      const config = browserContainerConfig(o);
      const wrong = reviewComputerConfig(config);
      if (wrong.length > 0) throw new ToolError("unavailable", `The Space browser's container config is outside its profile: ${wrong.join(", ")}`);
      if (!(await o.api.imageExists(config.Image))) {
        // a server that has never run one fetches the image itself (the runner allows only this image)
        let why = "";
        if (o.http) {
          const byDigest = config.Image.includes("@");
          const at = config.Image.lastIndexOf(":");
          const query = byDigest ? { fromImage: config.Image } : { fromImage: config.Image.slice(0, at), tag: config.Image.slice(at + 1) };
          try { const r = await o.http({ method: "POST", path: "/images/create", query, timeoutMs: 15 * 60_000 }); if (r.status !== 200) why = bodyText(r.body); } catch (e) { why = e instanceof Error ? e.message : "no answer"; }
        }
        if (!(await o.api.imageExists(config.Image))) throw new ToolError("unavailable", `The Space browser image ${config.Image} is not on this server${why ? ` and could not be fetched (${why.slice(0, 80)})` : ""}. Update the server to fetch it.`);
      }
      await makeNetwork();
      try { await o.api.containerCreate(name, config); } catch (e) { if (!/already in use|409|conflict/i.test(e instanceof Error ? e.message : "")) throw e; }
      await o.api.containerStart(name);
      const deadline = Date.now() + (o.startTimeoutMs ?? 30_000);
      for (;;) {
        try { await exec("status", {}); return; } catch (e) {
          if (Date.now() >= deadline) throw new ToolError("unavailable", `The Space browser did not answer in time: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
          await sleep(400);
        }
      }
    })().finally(() => { up = null; });
    return up;
  }

  const call = async (action: string, body: Record<string, unknown>): Promise<BrowserAnswer> => { await ensureUp(); return exec(action, body); };
  const rowsNow = async (): Promise<ProfileRow[]> => {
    if (!(await o.api.containerRunning(name))) return [];
    const s = await exec("status", {}) as { profiles?: ProfileRow[] };
    return Array.isArray(s.profiles) ? s.profiles : [];
  };

  // a profile's Chrome folder is sealed on the Space's data folder whenever its browser is not running (seal.ts); every call that starts the browser puts it back first
  const streams = o.http ? streamsOf(o.http) : null;
  const seal = o.profileSeal && o.http && streams
    ? createBrowserSeal({
      store: createSealedStore({ key: o.profileSeal.key, dir: `${o.profileSeal.dir}/browser`, kind: "sbrowser" }),
      async read(id) { return streams.get({ path: `/containers/${name}/archive`, query: { path: `${BROWSER_DATA_GUEST}/profiles/${id}/chrome` }, timeoutMs: 10 * 60_000 }) as never; },
      async put(id, body) { await ensureUp(); return streams.put({ path: `/containers/${name}/archive`, query: { path: `${BROWSER_DATA_GUEST}/profiles/${id}` }, contentType: "application/x-tar", body: Readable.from(body), timeoutMs: 10 * 60_000 }); },
      async reset(id) { await call("reset_chrome", { profileId: id }); },
      async stop(id) { await call("stop", { profileId: id }); },
      // the guard is what keeps a browser off an emptied folder: when it cannot be set (an image from before it existed, or browserd does not answer) the profile is not sealed, and when it cannot be lifted the call fails and is repeated
      async guard(id, on) { await call("guard", { profileId: id, on }); },
      rows: rowsNow,
      async disk() {
        if (!(await o.api.containerRunning(name))) return [];
        try {
          const r = await exec("disk", {}) as { ids?: unknown; bytes?: Record<string, unknown> };
          return Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === "string").map((id) => ({ id, ...(typeof r.bytes?.[id] === "number" ? { bytes: r.bytes[id] as number } : {}) })) : [];
        } catch (e) { o.log?.("warn", "computers.browser.disk_unavailable", { error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); return []; }
      },
      ...(o.sealQuietMs !== undefined ? { quietMs: o.sealQuietMs } : {}),
      ...(o.log ? { log: o.log } : {}),
    })
    : null;
  const used = <T>(id: string, fn: () => Promise<T>): Promise<T> => (seal ? seal.use(id, fn) : fn());
  /** A container that died or was stopped while profiles were plain: it is started again and they are sealed, not left until the next call. */
  const sweepAll = async (): Promise<string[]> => {
    if (!seal) return [];
    const wasUp = await o.api.containerRunning(name);
    if (!wasUp) {
      // only a container that still exists is started, only for the plain profiles it holds, and it is stopped again afterwards: a Space browser a person removed is not brought back
      if (seal.pending().length === 0 || !o.http) return [];
      if ((await o.http({ method: "GET", path: `/containers/${name}/json` })).status !== 200) return [];
      await ensureUp();
    }
    try { return await seal.sweep(); } finally { if (!wasUp) await o.api.containerStop(name, 10).catch(() => undefined); }
  };
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  if (seal && o.sealSweepMs !== 0) { const t = sweepTimer = setInterval(() => { void sweepAll().catch((e: unknown) => o.log?.("warn", "computers.browser.sweep_failed", { error: e instanceof Error ? e.message.slice(0, 160) : "unknown" })); }, o.sealSweepMs ?? 30_000); t.unref?.(); }

  return {
    /** At boot: the Space browser, if it has ever run here, is started and every profile that is not running is sealed before a call is served. */
    async recover() {
      if (!seal || !o.http) return [];
      const r = await o.http({ method: "GET", path: `/containers/${name}/json` });
      if (r.status !== 200) return [];
      await ensureUp();
      return seal.recover();
    },
    async sweep() { return sweepAll(); },
    oversize: () => seal?.oversize() ?? [],
    /** The sweep timer stops (the host is unbound or replaced). */
    close() { if (sweepTimer) clearInterval(sweepTimer); sweepTimer = null; },
    available: () => o.api.ping().catch(() => false),
    async tool(a: BrowserToolCall) {
      return used(a.profileId, () => call("tool", { profileId: a.profileId, tool: a.tool, args: a.args, timeoutMs: a.timeoutMs, ...(a.by ? { by: a.by } : {}), ...(a.fill ? { fillUrl: a.fill.url, fillToken: a.fill.token } : {}), ...(a.space ? { spaceId: a.space } : {}), ...(a.agent ? { agentName: a.agent.name, ...(a.agent.faceSvg ? { faceSvg: a.agent.faceSvg } : {}) } : {}) }));
    },
    async downloads(profileId) {
      if (!(await o.api.containerRunning(name))) return [];
      const r = (await exec("downloads", { profileId })) as { downloads?: Array<{ name: string; size: number; at: number }> };
      return Array.isArray(r.downloads) ? r.downloads : [];
    },
    async downloadRead(profileId, file) {
      const r = (await call("download_read", { profileId, name: file })) as { base64?: string };
      if (typeof r.base64 !== "string") throw new ToolError("unavailable", "The Space browser gave no file.");
      return decode64(r.base64);
    },
    async downloadAck(profileId, file) { await call("download_ack", { profileId, name: file }); },
    async takeover(a) { await call("takeover", { profileId: a.profileId, personId: a.personId }); },
    async giveBack(profileId) { await call("give_back", { profileId }); },
    async screenshot(profileId) {
      const s = await used(profileId, () => call("screenshot", { profileId })) as { png: string; width: number; height: number };
      return { bytes: decode64(s.png), width: Number(s.width), height: Number(s.height) };
    },
    async stream(a) {
      const s = await used(a.profileId, () => call("stream", { profileId: a.profileId })) as { url?: string; ws?: string; width?: number; height?: number };
      return { transport: "mjpeg", url: s.url ?? "", ...(typeof s.ws === "string" ? { ws: s.ws } : {}), ...(typeof s.width === "number" && typeof s.height === "number" ? { width: s.width, height: s.height } : {}) };
    },
    async sessions(profileId) {
      const r = (await call("sessions", { profileId })) as { sessions?: Array<{ site: string; since: number; lastSeen: number }> };
      return Array.isArray(r.sessions) ? r.sessions : [];
    },
    async signOut(profileId, site) { return ((await used(profileId, () => call("sign_out", { profileId, site }))) as { ok?: boolean }).ok === true; },
    async importChrome(profileId, tar) {
      const put = async (): Promise<void> => { await call("reset_chrome", { profileId }); await o.api.putArchive(name, `/data/profiles/${profileId}`, tar); };
      if (seal) await seal.replace(profileId, put); else await put();
      return { bytes: tar.length };
    },
    async stop(profileId) { if (await o.api.containerRunning(name)) { await exec("stop", { profileId }); await seal?.seal(profileId, { quiet: false }).catch((e: unknown) => o.log?.("warn", "computers.browser.seal_failed", { profile: profileId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" })); } },
    async forget(profileId) { if (await o.api.containerRunning(name)) await exec("forget", { profileId }); await seal?.forgotten(profileId); },
    async profiles() {
      if (!(await o.api.containerRunning(name))) return { profiles: [], maxRunning: o.maxRunning ?? 6 };
      const s = await exec("status", {}) as { profiles?: ProfileRow[]; maxRunning?: number };
      return { profiles: Array.isArray(s.profiles) ? s.profiles : [], maxRunning: Number(s.maxRunning ?? o.maxRunning ?? 6) };
    },
    async health() {
      try {
        if (!(await o.api.ping())) return { ok: false, detail: "The container runtime did not answer." };
        if (!(await o.api.containerRunning(name))) return { ok: true, detail: "The Space browser is not running; it starts with the first browser tool." };
        await exec("status", {});
        return { ok: true };
      } catch (e) { return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }; }
    },
  };
}
