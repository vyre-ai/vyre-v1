// The Docker adapter of the Space browser: one container `vyre-sbrowser` per Space host from images/space-browser, a named volume for the profiles at /data, and browserd inside, which this adapter talks
// to by running its control program (`docker exec <container> /opt/browserd/ctl <action> '<json>'`, one JSON object on stdout, a refusal is {"code","message"} on stderr with a non-zero exit), the same way
// the agent computer's host talks to agentd (modules/computers/impl.ts). The container is started on the first browser tool and stays up: it holds nothing while no profile runs a browser.
import type { ContainerConfig, DockerApi } from "../../../sandbox/src/docker.ts";
import { computerSeccomp, reviewComputerConfig, toolErrorOf } from "../impl.ts";
import { ToolError } from "../handlers/tools/common.ts";
import type { BrowserAnswer, BrowserToolCall, ProfileRow, SpaceBrowser } from "./port.ts";

export const DEFAULT_BROWSER_IMAGE = "vyre/space-browser:1";
export const BROWSERD_CTL = "/opt/browserd/ctl";
export const BROWSER_DATA_GUEST = "/data";
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
  /** The network the container joins (a Team server's runner gives it one of its own). Default bridge. */
  network?: string;
  /** Where the live view is reached from the host: its address inside the network, else what browserd reports. */
  sleep?: (ms: number) => Promise<void>;
  startTimeoutMs?: number;
}

export function browserContainerConfig(o: DockerSpaceBrowserOptions): ContainerConfig {
  const name = o.name ?? "vyre-sbrowser";
  const limits = { cpus: 2, memoryMb: 3072, pids: 2048, ...o.limits };
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
      NetworkMode: o.network ?? "bridge",
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

const decode64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createDockerSpaceBrowser(o: DockerSpaceBrowserOptions): SpaceBrowser {
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

  /** The container exists and runs; made and started on first use, with browserd answering. Calls that arrive together share one check. */
  function ensureUp(): Promise<void> {
    up ??= (async () => {
      if (await o.api.containerRunning(name)) return;
      const config = browserContainerConfig(o);
      const wrong = reviewComputerConfig(config);
      if (wrong.length > 0) throw new ToolError("unavailable", `The Space browser's container config is outside its profile: ${wrong.join(", ")}`);
      if (!(await o.api.imageExists(config.Image))) throw new ToolError("unavailable", `The Space browser image ${config.Image} is not on this server. Update the server to fetch it.`);
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

  return {
    async tool(a: BrowserToolCall) {
      return call("tool", { profileId: a.profileId, tool: a.tool, args: a.args, timeoutMs: a.timeoutMs, ...(a.by ? { by: a.by } : {}), ...(a.fill ? { fillUrl: a.fill.url, fillToken: a.fill.token } : {}) });
    },
    async takeover(a) { await call("takeover", { profileId: a.profileId, personId: a.personId }); },
    async giveBack(profileId) { await call("give_back", { profileId }); },
    async screenshot(profileId) {
      const s = await call("screenshot", { profileId }) as { png: string; width: number; height: number };
      return { bytes: decode64(s.png), width: Number(s.width), height: Number(s.height) };
    },
    async stream(a) {
      const s = await call("stream", { profileId: a.profileId }) as { url?: string; ws?: string };
      return { transport: "mjpeg", url: s.url ?? "", ...(typeof s.ws === "string" ? { ws: s.ws } : {}) };
    },
    async stop(profileId) { if (await o.api.containerRunning(name)) await exec("stop", { profileId }); },
    async forget(profileId) { if (await o.api.containerRunning(name)) await exec("forget", { profileId }); },
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
