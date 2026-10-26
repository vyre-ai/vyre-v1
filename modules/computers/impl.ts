// computers module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25). The handler table holds the
// lifecycle, recording, screenshot, live view and timeline capabilities (P-L2_16); the 35 Chrome, Screen and Files tools are in handlers/tools (P-L2_16b) and run through the `tool` action below.
//
// Also here: the Docker host. One container `vyre-comp-<id>` per agent computer from images/agent-computer, a named volume for the profile disk, and `agentd` inside, which this adapter talks to
// by running its control program in the container (`docker exec <container> /opt/agentd/ctl <action> '<json>'`, one JSON object on stdout, a non-zero exit is an error). The module itself never
// starts a process or opens a socket: it asks the ComputerHost the host binds, and createDockerComputerHost is the one the server binds.
//
// CONTROL PROTOCOL (what images/agent-computer's agentd must answer, P-L2_17):
//   status        {}                          -> { tabs, busy, caption?, lastFrameAt?, diskBytes? }
//   configure     { tabLimit }                -> {}
//   takeover      { personId }                -> {}      the agent's tools pause, the desktop answers the person
//   give_back     {}                          -> {}
//   screenshot    {}                          -> { png: <base64>, width, height }
//   stream        { ticket }                  -> { transport: "webrtc" | "mjpeg", url }
//   record_start  { recordingId }             -> {}
//   record_stop   { recordingId }             -> { events: <jsonl>, har: <har json>, durationMs }   (the video is written to work/recordings/<id>/video.mp4)
//   sessions      {}                          -> { sessions: [{ site, signedInAs?, since, lastSeen }] }
//   sign_out      { site }                    -> { ok }
//   tool          { tool, args, timeoutMs }   -> the tool's output, plus optional { used, frame, caption } (handlers/tools/common.ts has the whole contract; a refusal is a JSON
//                                                {code, message} on stderr with a non-zero exit)
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Handler } from "../../host/src/invoke.ts";
import { tarFiles } from "../../sandbox/src/tar.ts";
import { createDockerApi, unixSocketHttp } from "../../sandbox/src/docker.ts";
import type { ContainerConfig, DockerApi, DockerHttp } from "../../sandbox/src/docker.ts";
import { handlers as table } from "./handlers/index.ts";
import { createFillService, fillHttp } from "./handlers/fill.ts";
import type { FillSource, FillUse } from "./handlers/fill.ts";
import { bindFill, bindHost } from "./projections.ts";
import { ToolError } from "./handlers/tools/common.ts";
import type { ToolAnswer, ToolCode, ToolHost } from "./handlers/tools/common.ts";
import type { ComputerHost, HostKind, Probe, RecordResult, SessionInfo } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { bindFill, bindHost, bindKit, bindTeam, boundHost, redeemTicket, rememberSecrets, forgetSecrets, addStep, ensure } from "./projections.ts";
export type { ComputerHost, CompCtx, Probe, RecordResult, SessionInfo } from "./projections.ts";
export { sleepIdle, awaken } from "./handlers/lifecycle.ts";
export { maskEvents, maskHar } from "./handlers/record.ts";

// ---- the Docker host -----------------------------------------------------------------------------------------------------------------------------------

export const DEFAULT_COMPUTER_IMAGE = "vyre/agent-computer:1";
export const AGENTD_CTL = "/opt/agentd/ctl";
/** Where the agent's Files folder is bound inside the computer (one copy, no sync). */
export const FILES_GUEST = "/home/agent/Vyre";

export interface DockerHostOptions {
  api: DockerApi;
  /** Raw Engine access, for the volume calls DockerApi does not have. Without it a profile volume is created by Docker on first use and kept when the computer is removed. */
  http?: DockerHttp;
  image?: string;
  /** Command of the container. Default: the image's own entrypoint. */
  cmd?: readonly string[];
  /** Container names are `<prefix><computer id without cmt_>`. Default `vyre-comp-`. */
  prefix?: string;
  /** agentd's control program inside the image. */
  ctl?: string;
  kind?: HostKind;
  /** The host path of an agent's Files folder, bound at ~/Vyre. Omit to run without it. */
  filesRoot?: (agentId: string) => string | null;
  limits?: Partial<{ cpus: number; memoryMb: number; pids: number }>;
  /** Where the live view is served from, for a ticket. Default: the host's /computers/<id>/stream over MJPEG. */
  streamUrl?: (computerId: string, ticket: string) => { transport: "webrtc" | "mjpeg"; url: string };
  /** The profile disk is sealed under the Space key while the computer sleeps (ARCH 6.6): unseal before the container starts, seal after it stopped. */
  profile?: { unseal(computerId: string): Promise<void>; seal(computerId: string): Promise<void> };
  /** How long start waits for agentd to answer. Default 30 s. */
  startTimeoutMs?: number;
  user?: { uid: number; gid: number };
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const RECORDING_PATH = /^work\/recordings\/rcd_[a-z0-9]+$/;

/** Everything the container is not given: no capability, no new privileges, no devices, no Docker socket, no host namespaces. */
export function computerContainerConfig(name: string, computerId: string, agentId: string, o: DockerHostOptions, tabLimit: number): ContainerConfig {
  const limits = { cpus: 2, memoryMb: 4096, pids: 1024, ...o.limits };
  const memory = Math.round(limits.memoryMb * 1024 * 1024);
  const uid = o.user?.uid ?? 10001;
  const gid = o.user?.gid ?? 10001;
  const files = o.filesRoot?.(agentId) ?? null;
  return {
    Image: o.image ?? DEFAULT_COMPUTER_IMAGE,
    Hostname: name,
    User: "",
    WorkingDir: "/home/agent",
    Cmd: [...(o.cmd ?? [])],
    Env: [`VYRE_COMPUTER_ID=${computerId}`, `VYRE_AGENT_ID=${agentId}`, `VYRE_TAB_LIMIT=${tabLimit}`],
    Labels: { "vyre.computer": computerId, "vyre.agent": agentId },
    StopTimeout: 10,
    HostConfig: {
      Binds: [`${name}-profile:/home/agent/.profile-disk:rw`, ...(files ? [`${files}:${FILES_GUEST}:rw`] : [])],
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=1g,uid=${uid},gid=${gid},mode=1777`, "/dev/shm": "rw,nosuid,nodev,noexec,size=1g" },
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      NetworkMode: "bridge",
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
      Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 16384 }, { Name: "core", Soft: 0, Hard: 0 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      ExtraHosts: [],
      Dns: [],
    },
  };
}

/** What a computer container must never have, as code: returns what is wrong, empty when it is within the profile. */
export function reviewComputerConfig(c: ContainerConfig): string[] {
  const h = c.HostConfig;
  const bad: string[] = [];
  if (h.Privileged) bad.push("privileged");
  if (!h.CapDrop.includes("ALL")) bad.push("capabilities are not all dropped");
  if (h.CapAdd.length > 0) bad.push("capabilities added");
  if (!h.SecurityOpt.includes("no-new-privileges:true")) bad.push("new privileges allowed");
  if (h.Devices.length > 0) bad.push("devices");
  if (h.PidMode !== "") bad.push("host pid namespace");
  if (h.IpcMode !== "private") bad.push("shared ipc namespace");
  if (h.NetworkMode === "host") bad.push("host network");
  if (h.Binds.some((b) => b.includes("docker.sock"))) bad.push("docker socket");
  const SYSTEM = new Set(["/", "/etc", "/var", "/usr", "/root", "/home", "/proc", "/sys", "/dev", "/boot", "/lib", "/bin", "/sbin"]);
  if (h.Binds.some((b) => SYSTEM.has((b.split(":")[0] ?? "").replace(/\/+$/, "") || "/"))) bad.push("a system folder is bound");
  if (h.PidsLimit <= 0 || h.Memory <= 0) bad.push("no process or memory limit");
  return bad;
}

const decode64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** One tool call is one argument of `docker exec`; the kernel allows 128 KB for it. */
const MAX_TOOL_ARG = 125_000;
const TOOL_CODES: readonly string[] = ["timeout", "paused", "not_found", "bad_input", "held", "unavailable"];

/** The refusal agentd printed: {"code","message"} on its last stderr line. Anything else is an unavailable computer with the first words of what it said. */
export function toolErrorOf(stderr: string, exitCode: number | null): ToolError {
  const last = stderr.trim().split("\n").pop() ?? "";
  try {
    const j = JSON.parse(last) as { code?: unknown; message?: unknown };
    if (typeof j.code === "string" && TOOL_CODES.includes(j.code)) return new ToolError(j.code as ToolCode, typeof j.message === "string" ? j.message : "The tool failed.");
  } catch { /* not JSON */ }
  return new ToolError("unavailable", `agentd tool failed (${exitCode ?? "no exit code"}): ${stderr.trim().slice(0, 200)}`);
}

export function createDockerComputerHost(o: DockerHostOptions): ComputerHost & ToolHost {
  const prefix = o.prefix ?? "vyre-comp-";
  const ctlPath = o.ctl ?? AGENTD_CTL;
  const sleep = o.sleep ?? realSleep;
  const nameOf = (computerId: string): string => `${prefix}${computerId.replace(/^cmt_/, "")}`;

  async function ctl<T>(computerId: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
    const r = await o.api.exec(nameOf(computerId), { cmd: [ctlPath, action, JSON.stringify(body)], env: [], ...(o.user ? { user: `${o.user.uid}:${o.user.gid}` } : {}) });
    if (r.exitCode !== 0) throw new Error(`agentd ${action} failed (${r.exitCode ?? "no exit code"}): ${r.stderr.trim().slice(0, 200)}`);
    const text = r.stdout.trim();
    if (text === "") return {} as T;
    try { return JSON.parse(text) as T; } catch { throw new Error(`agentd ${action} answered with something that is not JSON`); }
  }

  const host: ComputerHost & ToolHost = {
    kind: o.kind ?? "server",
    async create(a) {
      const name = nameOf(a.computerId);
      const config = computerContainerConfig(name, a.computerId, a.agentId, o, a.tabLimit);
      const wrong = reviewComputerConfig(config);
      if (wrong.length > 0) throw new Error(`the computer's container config is outside its profile: ${wrong.join(", ")}`);
      if (!(await o.api.imageExists(config.Image))) throw new Error(`the image ${config.Image} is not on this host`);
      await o.api.containerCreate(name, config);
      return {};
    },
    async start(a) {
      const name = nameOf(a.computerId);
      if (o.profile) await o.profile.unseal(a.computerId);
      await o.api.containerStart(name);
      const deadline = Date.now() + (o.startTimeoutMs ?? 30_000);
      for (;;) {
        try {
          await ctl(a.computerId, "configure", { tabLimit: a.tabLimit });
          return;
        } catch (e) {
          if (Date.now() >= deadline) throw new Error(`agentd did not answer in time: ${e instanceof Error ? e.message : "unknown"}`);
          await sleep(500);
        }
      }
    },
    async stop(a) {
      const name = nameOf(a.computerId);
      let sessions: SessionInfo[] | undefined;
      if (a.reason !== "remove") {
        try { sessions = (await ctl<{ sessions?: SessionInfo[] }>(a.computerId, "sessions")).sessions; } catch { /* the last list stays */ }
      }
      await o.api.containerStop(name, 10);
      if (o.profile && a.reason !== "remove") await o.profile.seal(a.computerId);
      return sessions ? { sessions } : {};
    },
    async remove(computerId) {
      const name = nameOf(computerId);
      await o.api.containerRemove(name);
      if (o.http) {
        const r = await o.http({ method: "DELETE", path: `/volumes/${name}-profile`, query: { force: "true" } });
        if (r.status !== 204 && r.status !== 404) throw new Error(`the profile volume was not removed (${r.status})`);
      }
    },
    async probe(computerId) {
      const running = await o.api.containerRunning(nameOf(computerId));
      if (!running) return { running: false, busy: false, tabs: 0 };
      const s = await ctl<{ tabs?: number; busy?: boolean; caption?: string; lastFrameAt?: number; diskBytes?: number }>(computerId, "status");
      const p: Probe = { running: true, busy: s.busy === true, tabs: Number(s.tabs ?? 0) };
      if (typeof s.caption === "string") p.caption = s.caption;
      if (typeof s.lastFrameAt === "number") p.lastFrameAt = s.lastFrameAt;
      if (typeof s.diskBytes === "number") p.diskBytes = s.diskBytes;
      return p;
    },
    async configure(a) { await ctl(a.computerId, "configure", { tabLimit: a.tabLimit, ...(a.fillUrl !== undefined && a.fillToken !== undefined ? { fillUrl: a.fillUrl, fillToken: a.fillToken } : {}) }); },
    async takeover(a) { await ctl(a.computerId, "takeover", { personId: a.personId }); },
    async giveBack(computerId) { await ctl(computerId, "give_back"); },
    async screenshot(computerId) {
      const s = await ctl<{ png: string; width: number; height: number }>(computerId, "screenshot");
      return { bytes: decode64(s.png), width: Number(s.width), height: Number(s.height) };
    },
    async stream(a) {
      if (o.streamUrl) {
        await ctl(a.computerId, "stream", { ticket: a.ticket });
        return o.streamUrl(a.computerId, a.ticket);
      }
      const s = await ctl<{ transport?: "webrtc" | "mjpeg"; url?: string }>(a.computerId, "stream", { ticket: a.ticket });
      return { transport: s.transport === "webrtc" ? "webrtc" : "mjpeg", url: s.url ?? `/computers/${a.computerId}/stream?ticket=${a.ticket}` };
    },
    async record(a) {
      if (a.action === "start") { await ctl(a.computerId, "record_start", { recordingId: a.recordingId }); return {}; }
      const r = await ctl<RecordResult>(a.computerId, "record_stop", { recordingId: a.recordingId });
      return { ...(typeof r.events === "string" ? { events: r.events } : {}), ...(typeof r.har === "string" ? { har: r.har } : {}), ...(typeof r.durationMs === "number" ? { durationMs: r.durationMs } : {}) };
    },
    async saveRecording(a) {
      if (!RECORDING_PATH.test(a.folderPath)) throw new Error("a recording is saved under work/recordings/<id>");
      const name = nameOf(a.computerId);
      const dir = `${FILES_GUEST}/${a.folderPath}`;
      const made = await o.api.exec(name, { cmd: ["mkdir", "-p", dir], env: [] });
      if (made.exitCode !== 0) throw new Error("the recording folder could not be made");
      const enc = new TextEncoder();
      const uid = o.user?.uid ?? 10001;
      const gid = o.user?.gid ?? 10001;
      const at = Math.floor(Date.now() / 1000);
      await o.api.putArchive(name, dir, tarFiles([
        { path: "events.jsonl", data: enc.encode(a.events), mode: 0o640, uid, gid, mtime: at },
        { path: "network.har", data: enc.encode(a.har), mode: 0o640, uid, gid, mtime: at },
      ]));
    },
    async removeRecording(a) {
      if (!RECORDING_PATH.test(a.folderPath)) throw new Error("a recording lives under work/recordings/<id>");
      const r = await o.api.exec(nameOf(a.computerId), { cmd: ["rm", "-rf", `${FILES_GUEST}/${a.folderPath}`], env: [] });
      if (r.exitCode !== 0) throw new Error("the recording could not be removed");
    },
    async sessions(computerId) { return (await ctl<{ sessions?: SessionInfo[] }>(computerId, "sessions")).sessions ?? []; },
    async signOut(a) { return (await ctl<{ ok?: boolean }>(a.computerId, "sign_out", { site: a.site })).ok === true; },
    async tool(a) {
      const body = JSON.stringify({ tool: a.tool, args: a.args, timeoutMs: a.timeoutMs });
      if (body.length > MAX_TOOL_ARG) throw new ToolError("bad_input", "That call is too large to send to the computer.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ToolError("timeout", `The computer did not finish ${a.tool} in time.`)), a.timeoutMs + 5_000); });
      let r: Awaited<ReturnType<DockerApi["exec"]>>;
      try {
        r = await Promise.race([o.api.exec(nameOf(a.computerId), { cmd: [ctlPath, "tool", body], env: [], ...(o.user ? { user: `${o.user.uid}:${o.user.gid}` } : {}) }), late]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (r.exitCode !== 0) throw toolErrorOf(r.stderr, r.exitCode);
      let answer: unknown;
      try { answer = JSON.parse(r.stdout.trim() || "{}"); } catch { throw new ToolError("unavailable", "agentd answered the tool with something that is not JSON"); }
      if (typeof answer !== "object" || answer === null || Array.isArray(answer)) throw new ToolError("unavailable", "agentd answered the tool with something that is not an object");
      return answer as ToolAnswer;
    },
    async health() {
      const t0 = Date.now();
      const ok = await o.api.ping();
      return { ok, latencyMs: Date.now() - t0, ...(ok ? {} : { detail: "The container runtime did not answer." }) };
    },
  };
  return host;
}

/** What the host hands the module for the Vault channel of agent computers (host/src/seams/computers.ts): the Vault source, a use log, the address agentd posts to and where to mount the route. */
export interface ComputersFillSeam { source: FillSource; log(use: FillUse): void | Promise<void>; url(): string; mount(handler: (req: IncomingMessage, res: ServerResponse) => void): void; now?: () => number }

export function setComputersFill(h: ComputersFillSeam | null): void {
  if (!h) { bindFill(null); return; }
  const service = createFillService({ source: h.source, log: h.log, ...(h.now ? { now: h.now } : {}) });
  h.mount(fillHttp(service));
  bindFill({ issue: (x) => service.issue(x), url: h.url });
}

/** What the host hands over at boot (host/src/seams/computers-host.ts): the Docker socket, the image and the agents' Files folders. The module builds the Docker host from it and binds it. */
export interface ComputersHostConfig {
  socketPath?: string;
  image?: string;
  filesRoot?: (agentId: string) => string | null;
  startTimeoutMs?: number;
}

export function setComputerHost(c: ComputersHostConfig | null): void {
  if (c === null) { bindHost(null); return; }
  const http = unixSocketHttp(c.socketPath);
  bindHost(createDockerComputerHost({
    api: createDockerApi(http), http,
    ...(c.image !== undefined ? { image: c.image } : {}),
    ...(c.filesRoot !== undefined ? { filesRoot: c.filesRoot } : {}),
    ...(c.startTimeoutMs !== undefined ? { startTimeoutMs: c.startTimeoutMs } : {}),
  }));
}

export const hostSeams = { setComputersFill, setComputerHost };
