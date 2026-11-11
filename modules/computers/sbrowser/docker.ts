// The Docker adapter of the Space browser: one container `vyre-sbrowser` per Space host from images/space-browser, a named volume for the profiles at /data, and browserd inside, which this adapter talks
// to by running its control program (`docker exec <container> /opt/browserd/ctl <action> '<json>'`, one JSON object on stdout, a refusal is {"code","message"} on stderr with a non-zero exit), the same way
// the agent computer's host talks to agentd (modules/computers/impl.ts). The container is started on the first browser tool and stays up: it holds nothing while no profile runs a browser.
import type { ContainerConfig, DockerApi, DockerHttp } from "../../../sandbox/src/docker.ts";
import { computerSeccomp, reviewComputerConfig, toolErrorOf } from "../impl.ts";
import { LIMITS } from "../capacity.ts";
import { ToolError } from "../handlers/tools/common.ts";
import type { BrowserAnswer, BrowserToolCall, ProfileRow, SpaceBrowser } from "./port.ts";

export const DEFAULT_BROWSER_IMAGE = "vyre/space-browser:1";
export const BROWSERD_CTL = "/opt/browserd/ctl";
export const BROWSER_DATA_GUEST = "/data";
export const BROWSER_NETWORK = "vyre-sbrowsernet";
/** The network of a Space browser container: `vyre-sbrowsernet` for the usual one, `<name>net` for another (a test's). */
export const browserNetworkOf = (name: string | undefined): string => (name === undefined || name === "vyre-sbrowser" ? BROWSER_NETWORK : `${name}net`);
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
  /**
   * Raw Engine access: for the image pull and the service's own network. With it the container is on a network of its own (with or without the runner), so the daemon knows a request from it by its
   * subnet and lets it reach only the Vault channel (computerSubnets). Without it the image must already be on the machine and the container uses the default bridge.
   */
  http?: DockerHttp;
  /**
   * Run behind the container runner (a Team server: vyred holds no Docker socket). The container then gets a network of its own, `vyre-sbrowsernet`, so it cannot reach an agent computer or a site, and the
   * ingress (vyred) joins it under `alias` so the browser can reach the one route it posts to (the Vault channel).
   */
  runner?: { ingress?: string; alias?: string };
  sleep?: (ms: number) => Promise<void>;
  startTimeoutMs?: number;
  /** Where the adapter says what it does to the container (replacing one of an earlier release). Default: stderr. */
  log?: (m: string) => void;
  /** How long a container of an earlier release that was busy is used before the next look. Default 30 seconds. */
  recheckMs?: number;
}

/** `net`: the service's own network was made, and (without the runner) the address of the host on it, which `host.docker.internal` names so the Vault channel is reached on that network. */
export function browserContainerConfig(o: DockerSpaceBrowserOptions, net?: { gateway?: string }): ContainerConfig {
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
      NetworkMode: o.runner || net ? browserNetworkOf(o.name) : "bridge",
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
      // behind the runner the daemon is the ingress on the network under its alias; without it the daemon is the host, reached at the network's own gateway so the request arrives on that network
      ExtraHosts: !o.runner && net?.gateway ? [`host.docker.internal:${net.gateway}`] : [],
      Dns: [],
    },
  };
}

const bodyText = (b: Uint8Array): string => { const t = new TextDecoder().decode(b); try { return String((JSON.parse(t) as { message?: string }).message ?? t).slice(0, 200); } catch { return t.slice(0, 200); } };
const decode64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createDockerSpaceBrowser(o: DockerSpaceBrowserOptions): SpaceBrowser {
  const name = o.name ?? "vyre-sbrowser";
  const sleep = o.sleep ?? realSleep;
  const netName = browserNetworkOf(o.name);
  let up: Promise<void> | null = null;
  // the service's network as the Engine reports it: the daemon refuses every route but the Vault channel to a request from it
  let subnet: string | null = null;

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

  /** What the Engine says of the service's network: its subnet and the host's address on it; null when it is not there. */
  async function learnNetwork(): Promise<{ subnet: string; gateway?: string } | null> {
    if (!o.http) return null;
    try {
      const r = await o.http({ method: "GET", path: `/networks/${netName}` });
      if (r.status !== 200) return null;
      const cfg = (JSON.parse(new TextDecoder().decode(r.body)) as { IPAM?: { Config?: Array<{ Subnet?: string; Gateway?: string }> } }).IPAM?.Config?.find((c) => c.Subnet && /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(c.Subnet));
      if (!cfg?.Subnet) return null;
      subnet = cfg.Subnet;
      return { subnet: cfg.Subnet, ...(cfg.Gateway ? { gateway: cfg.Gateway } : {}) };
    } catch { return null; }
  }

  /** The service's own network (behind the runner with the ingress joined): made once, again if it is gone. */
  async function makeNetwork(): Promise<{ gateway?: string } | undefined> {
    if (!o.http) return undefined;
    const made = await o.http({ method: "POST", path: "/networks/create", json: { Name: netName, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" } } });
    if (made.status !== 201 && made.status !== 409) throw new ToolError("unavailable", `The Space browser's network was not made (${made.status}: ${bodyText(made.body)})`);
    if (o.runner?.ingress) {
      const joined = await o.http({ method: "POST", path: `/networks/${netName}/connect`, json: { Container: o.runner.ingress, EndpointConfig: { Aliases: [o.runner.alias ?? "vyre-host"] } } });
      if (joined.status !== 200 && joined.status !== 403 && !/already exists/i.test(bodyText(joined.body))) throw new ToolError("unavailable", `vyred could not join the Space browser's network (${joined.status}: ${bodyText(joined.body)})`);
      if (joined.status === 403 && !/already/i.test(bodyText(joined.body))) throw new ToolError("unavailable", `The runner refused to join vyred to the Space browser's network: ${bodyText(joined.body)}`);
    }
    const n = await learnNetwork();
    return n?.gateway ? { gateway: n.gateway } : {};
  }

  // ---- the container is of this release ----
  // A Space that ran the Space browser before an update keeps its container (and with it the old browserd, its policy and its network) unless something replaces it. What a container was made from is
  // read back from the Engine (its image id and the settings this adapter gives it) and compared with what this release would make; a container that differs is replaced, at once when no profile is busy
  // and nobody has the controls, otherwise at the first quiet moment. The volume stays, so every profile keeps its sign-ins. (A label would say it more simply, but the runner allows the Space browser no
  // label beyond vyre.sbrowser=1, host/src/sites-runner/computers-policy.ts.)
  const log = o.log ?? ((m: string): void => { process.stderr.write(`space browser: ${m}\n`); });
  let current = false;
  let recheckAt = 0;
  const sorted = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).sort() : []);
  const envKeys = (env: readonly string[]): Set<string> => new Set(env.map((e) => e.split("=")[0]!));
  const revision = (x: { image: string; net: string; hosts: unknown; env: string[]; binds: unknown; memory: number; cpus: number; security: unknown }): string => JSON.stringify([x.image, x.net, sorted(x.hosts), x.env.slice().sort(), sorted(x.binds), x.memory, x.cpus, sorted(x.security)]);
  async function jsonOf(path: string): Promise<Record<string, unknown> | null> {
    if (!o.http) return null;
    try { const r = await o.http({ method: "GET", path }); return r.status === 200 ? (JSON.parse(new TextDecoder().decode(r.body)) as Record<string, unknown>) : null; } catch { return null; }
  }
  /** null: the Engine cannot be asked (no raw access), so nothing is compared. Otherwise whether the container is missing, of this release, or another. */
  async function releaseOf(config: ContainerConfig): Promise<"missing" | "same" | "other" | null> {
    if (!o.http) return null;
    const c = await jsonOf(`/containers/${name}/json`);
    if (!c) return "missing";
    const img = await jsonOf(`/images/${encodeURIComponent(config.Image)}/json`);
    if (!img || typeof img["Id"] !== "string") return null;
    const hc = (c["HostConfig"] ?? {}) as Record<string, unknown>;
    const cc = (c["Config"] ?? {}) as Record<string, unknown>;
    const ours = envKeys(config.Env);
    const want = revision({ image: img["Id"], net: config.HostConfig.NetworkMode, hosts: config.HostConfig.ExtraHosts, env: [...config.Env], binds: config.HostConfig.Binds, memory: config.HostConfig.Memory, cpus: config.HostConfig.NanoCpus, security: config.HostConfig.SecurityOpt });
    const have = revision({ image: String(c["Image"] ?? ""), net: String(hc["NetworkMode"] ?? ""), hosts: hc["ExtraHosts"] ?? [], env: sorted(cc["Env"]).filter((e) => ours.has(e.split("=")[0]!)), binds: hc["Binds"] ?? [], memory: Number(hc["Memory"] ?? 0), cpus: Number(hc["NanoCpus"] ?? 0), security: hc["SecurityOpt"] ?? [] });
    return want === have ? "same" : "other";
  }
  /** No profile is busy and nobody has the controls: the container can be replaced without cutting anything off. */
  async function quietNow(): Promise<boolean> {
    try { const s = (await exec("status", {})) as { profiles?: ProfileRow[] }; return !(s.profiles ?? []).some((p) => p.busy || p.takeover); } catch { return true; }
  }

  /** The container exists, is of this release, and runs; made and started on first use, with browserd answering. Calls that arrive together share one check. */
  function ensureUp(): Promise<void> {
    up ??= (async () => {
      const running = await o.api.containerRunning(name);
      // without raw Engine access nothing can be compared: a running container is used as it is
      if (running && (current || !o.http || Date.now() < recheckAt)) { if (subnet === null) await learnNetwork(); return; }
      const net = await makeNetwork();
      const config = browserContainerConfig(o, net);
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
      const release = await releaseOf(config);
      if (release === "other") {
        if (running && !(await quietNow())) {
          log("the container is of an earlier release; it is replaced as soon as no agent is using its browser and nobody has the controls");
          recheckAt = Date.now() + (o.recheckMs ?? 30_000);
          if (subnet === null) await learnNetwork();
          return;
        }
        log("replacing the container of an earlier release with this release's (the profiles and their sign-ins stay on the volume)");
        await o.api.containerStop(name, 10).catch(() => undefined);
        await o.api.containerRemove(name);
      } else if (release === "same" && running) { current = true; return; }
      try { await o.api.containerCreate(name, config); } catch (e) { if (!/already in use|409|conflict/i.test(e instanceof Error ? e.message : "")) throw e; }
      await o.api.containerStart(name);
      const deadline = Date.now() + (o.startTimeoutMs ?? 30_000);
      for (;;) {
        try { await exec("status", {}); current = release !== null; return; } catch (e) {
          if (Date.now() >= deadline) throw new ToolError("unavailable", `The Space browser did not answer in time: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
          await sleep(400);
        }
      }
    })().finally(() => { up = null; });
    return up;
  }

  // a container that runs is not always one whose browserd answers: just after it (re)started the control socket is not there yet, and the call waits for it instead of failing. Only a request that
  // certainly never reached browserd is asked again (ctl says "not up yet": no connection was made); one that was sent and then lost is an error to the caller, never a silent repeat (a click, a send).
  const starting = (e: unknown): boolean => e instanceof ToolError && e.code === "unavailable" && /^browserd is not up yet/.test(e.message);
  const call = async (action: string, body: Record<string, unknown>): Promise<BrowserAnswer> => {
    await ensureUp();
    try { return await exec(action, body); } catch (e) {
      if (!starting(e)) throw e;
      const deadline = Date.now() + (o.startTimeoutMs ?? 30_000);
      for (;;) {
        await sleep(400);
        try { await exec("status", {}); break; } catch (e2) { if (!starting(e2) || Date.now() >= deadline) throw e2; }
      }
      return exec(action, body);
    }
  };
  // a daemon that starts while the service already runs knows its network before any page can ask it something
  void learnNetwork();

  return {
    available: () => o.api.ping().catch(() => false),
    async tool(a: BrowserToolCall) {
      return call("tool", { profileId: a.profileId, tool: a.tool, args: a.args, timeoutMs: a.timeoutMs, ...(a.by ? { by: a.by } : {}), ...(a.fill ? { fillUrl: a.fill.url, fillToken: a.fill.token } : {}), ...(a.space ? { spaceId: a.space } : {}), ...(a.hold !== undefined ? { hold: a.hold } : {}), ...(a.agent ? { agentName: a.agent.name, ...(a.agent.faceSvg ? { faceSvg: a.agent.faceSvg } : {}) } : {}) });
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
    async downloadKeep(profileId, file) { await call("download_keep", { profileId, name: file }); },
    async takeover(a) { await call("takeover", { profileId: a.profileId, personId: a.personId }); },
    async giveBack(profileId) { await call("give_back", { profileId }); },
    async screenshot(profileId) {
      const s = await call("screenshot", { profileId }) as { png: string; width: number; height: number };
      return { bytes: decode64(s.png), width: Number(s.width), height: Number(s.height) };
    },
    async stream(a) {
      const s = await call("stream", { profileId: a.profileId, ...(a.personId ? { personId: a.personId } : {}) }) as { url?: string; ws?: string; width?: number; height?: number };
      return { transport: "mjpeg", url: s.url ?? "", ...(typeof s.ws === "string" ? { ws: s.ws } : {}), ...(typeof s.width === "number" && typeof s.height === "number" ? { width: s.width, height: s.height } : {}) };
    },
    async sessions(profileId) {
      const r = (await call("sessions", { profileId })) as { sessions?: Array<{ site: string; since: number; lastSeen: number }> };
      return Array.isArray(r.sessions) ? r.sessions : [];
    },
    async signOut(profileId, site) { return ((await call("sign_out", { profileId, site })) as { ok?: boolean }).ok === true; },
    // browserd refuses (and the move is tried again) while a step is in flight or a person has the controls, and starts no browser for the profile until the data is in
    async importChrome(profileId, tar) {
      await call("reset_chrome", { profileId });
      try { await o.api.putArchive(name, `/data/profiles/${profileId}`, tar); } finally { await exec("import_done", { profileId }).catch(() => undefined); }
      return { bytes: tar.length };
    },
    async stop(profileId) { if (await o.api.containerRunning(name)) await exec("stop", { profileId }); },
    // the agent is gone: its sign-ins go too, so a service that is not running is started to remove the folder (it starts no browser)
    async forget(profileId) {
      // a host whose Space browser never ran has no volume: there is nothing to remove, and no container is made or image fetched for it
      if (!(await o.api.containerRunning(name)) && o.http) {
        const v = await o.http({ method: "GET", path: `/volumes/${name}-data` }).catch(() => null);
        if (v?.status === 404) return;
      }
      await call("forget", { profileId });
    },
    subnets: () => (subnet ? [subnet] : []),
    async profiles() {
      if (!(await o.api.containerRunning(name))) return { profiles: [], maxRunning: o.maxRunning ?? 6 };
      const s = await call("status", {}) as { profiles?: ProfileRow[]; maxRunning?: number };
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
