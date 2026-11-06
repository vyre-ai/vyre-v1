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
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Handler } from "../../host/src/invoke.ts";
import { tarFiles } from "../../sandbox/src/tar.ts";
import { createDockerApi, unixSocketHttp } from "../../sandbox/src/docker.ts";
import type { ContainerConfig, DockerApi, DockerHttp } from "../../sandbox/src/docker.ts";
import { handlers as table } from "./handlers/index.ts";
import { createHomeSync } from "./handlers/home.ts";
import { createContainerHomeFs } from "./handlers/home-fs.ts";
import type { HomeDeps, HomeSync, MadeFile } from "./handlers/home.ts";
import { createFillService, fillHttp } from "./handlers/fill.ts";
import type { FillSource, FillUse } from "./handlers/fill.ts";
import { bindFill, bindHost, boundHost } from "./projections.ts";
import { nodeHomeCheck, nodeJobs, nodeRecordingCheck, nodeResult, nodeStreamInput, nodeStreamOpen } from "./handlers/node.ts";
import { nodeRun } from "./remote.ts";
import { ToolError } from "./handlers/tools/common.ts";
import type { ToolAnswer, ToolCode, ToolHost } from "./handlers/tools/common.ts";
import type { ComputerHost, HostKind, Probe, RecordResult, SessionInfo } from "./projections.ts";
import { bindSpaceBrowser } from "./sbrowser/port.ts";
import type { SpaceBrowser } from "./sbrowser/port.ts";
import { createDockerSpaceBrowser, DEFAULT_BROWSER_IMAGE } from "./sbrowser/docker.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { bindFill, bindHost, bindKit, bindTeam, boundHost, redeemTicket, rememberSecrets, forgetSecrets, addStep, ensure } from "./projections.ts";
export type { ComputerHost, CompCtx, Probe, RecordResult, SessionInfo } from "./projections.ts";
export { sleepIdle, awaken } from "./handlers/lifecycle.ts";
export { createHomeSync } from "./handlers/home.ts";
export { maskEvents, maskHar } from "./handlers/record.ts";

// ---- the Docker host -----------------------------------------------------------------------------------------------------------------------------------

/** The plain first line when this server has no agent computer image (an older install, or one that could not fetch it): no system words. The text after "Details:" is for Copy details, never the panel's sentence; the panel adds who can fix it (an admin updates the server from Console > Computers, a member asks their admin). */
export const IMAGE_MISSING_SENTENCE = "This server can't start agent computers yet.";
export const DEFAULT_COMPUTER_IMAGE = "vyre/agent-computer:1";
/** Docker's default seccomp profile plus the namespace calls Chromium's own sandbox needs (images/agent-computer/seccomp.json). Sent inline, since the Engine API takes the profile itself. */
let seccomp: string | null = null;
export function computerSeccomp(): string {
  seccomp ??= JSON.stringify(JSON.parse(readFileSync(new URL("../../images/agent-computer/seccomp.json", import.meta.url), "utf8")));
  return seccomp;
}

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
  /** The agent's home on the computer mirrors its folder in Files (handlers/home.ts): calls as the agent, how often to look, and where the manifest of what was last synced is kept. */
  home?: { deps: HomeDeps; intervalMs?: number; manifest(agentId: string): string; announce?: (a: { agentId: string; computerId: string; files: MadeFile[] }) => Promise<boolean | void> };
  sleep?: (ms: number) => Promise<void>;
  /**
   * Run behind the container runner (a Team server: vyred holds no Docker socket, the runner does, and refuses all but agent computers). Each computer then gets a network of its own
   * (so one cannot reach another), only its profile volume (no host folder), and the ingress joins that network for the one route agentd posts to.
   */
  runner?: { socket: string; ingress?: string; alias?: string };
}

const bodyText = (b: Uint8Array): string => { const s = new TextDecoder().decode(b); try { const m = (JSON.parse(s) as { message?: string }).message; return String(m ?? s).slice(0, 200); } catch { return s.slice(0, 200); } };
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const RECORDING_PATH = /^work\/recordings\/rcd_[a-z0-9]+$/;

/** Everything the container is not given: no capability, no new privileges, no devices, no Docker socket, no host namespaces. */
export const computerNetworkName = (computerId: string): string => `vyre-compnet-${computerId.replace(/^cmt_/, "").replace(/-/g, "").slice(-16)}`;

export function computerContainerConfig(name: string, computerId: string, agentId: string, o: DockerHostOptions, tabLimit: number): ContainerConfig {
  const limits = { cpus: 2, memoryMb: 4096, pids: 1024, ...o.limits };
  const memory = Math.round(limits.memoryMb * 1024 * 1024);
  const uid = o.user?.uid ?? 10001;
  const gid = o.user?.gid ?? 10001;
  const files = o.runner ? null : o.filesRoot?.(agentId) ?? null;
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
      SecurityOpt: ["no-new-privileges:true", `seccomp=${computerSeccomp()}`],
      Privileged: false,
      NetworkMode: o.runner ? computerNetworkName(computerId) : "bridge",
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
  if (!h.SecurityOpt.some((x) => x.startsWith("seccomp=") && x !== "seccomp=unconfined")) bad.push("no seccomp profile");
  if (h.SecurityOpt.some((x) => x.endsWith("=unconfined"))) bad.push("a security profile is switched off");
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

/**
 * Why the container runtime cannot be used, in words a person can act on (shown in Computer and the host list). `where` says whether Vyre reaches the engine itself or the server's runner.
 * An unreachable socket says what to start; a refused token says what to restart; nothing says "try again".
 */
export function explainEngine(status: number, error: unknown, where: "engine" | "runner", platform: string = process.platform): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (where === "runner") {
    if (status === 401) return "This server's container runner did not accept Vyre's token. Restart the sites-runner service so it writes a new one: docker compose restart sites-runner vyred.";
    if (code === "ENOENT" || code === "ECONNREFUSED") return "This server's container runner is not running, so agent computers cannot start. Start it: docker compose up -d sites-runner.";
    if (code === "EACCES") return "Vyre may not open the container runner's socket on this server. Check that the sites-runner volume is shared with vyred.";
    if (status >= 500) return "This server's container runner answered an error, and Docker behind it may be down. Check docker compose logs sites-runner.";
    return "This server's container runner did not answer in time. Check docker compose ps.";
  }
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    return platform === "darwin" ? "Docker is not running on this Mac. Start Docker Desktop or Colima, then set up the computer."
      : platform === "win32" ? "Docker is not running on this computer. Start Docker Desktop, then set up the computer."
        : "There is no Docker on this machine (its socket is missing or nothing answers on it). Install and start Docker, then set up the computer.";
  }
  if (code === "EACCES") return "Vyre may not use Docker on this machine: the socket refuses it. Add the Vyre user to the docker group, then set up the computer.";
  if (status > 0) return `Docker answered an error (${status}). Check that it is healthy, then set up the computer.`;
  return "Docker did not answer in time. Check that it is running, then set up the computer.";
}

export function createDockerComputerHost(o: DockerHostOptions): ComputerHost & ToolHost {
  const prefix = o.prefix ?? "vyre-comp-";
  const ctlPath = o.ctl ?? AGENTD_CTL;
  const sleep = o.sleep ?? realSleep;
  const nameOf = (computerId: string): string => `${prefix}${computerId.replace(/^cmt_/, "")}`;

  async function containerAddress(computerId: string): Promise<string | null> {
    if (!o.http) return null;
    const r = await o.http({ method: "GET", path: `/containers/${nameOf(computerId)}/json` });
    if (r.status !== 200) return null;
    const info = JSON.parse(new TextDecoder().decode(r.body)) as { State?: { Running?: boolean }; NetworkSettings?: { IPAddress?: string; Networks?: Record<string, { IPAddress?: string }> } };
    if (info.State?.Running !== true) return null;
    const nets = info.NetworkSettings?.Networks ?? {};
    return nets["bridge"]?.IPAddress || info.NetworkSettings?.IPAddress || Object.values(nets).map((n) => n.IPAddress).find((a) => a) || null;
  }

  // ---- behind the runner: one network per computer ----
  const netOf = (computerId: string): string => computerNetworkName(computerId);
  const subnets = new Map<string, string>();
  async function learnSubnet(computerId: string): Promise<void> {
    if (!o.runner || !o.http) return;
    try {
      const r = await o.http({ method: "GET", path: `/networks/${netOf(computerId)}` });
      if (r.status !== 200) return;
      const cidr = (JSON.parse(new TextDecoder().decode(r.body)) as { IPAM?: { Config?: Array<{ Subnet?: string }> } }).IPAM?.Config?.find((c) => c.Subnet)?.Subnet;
      if (cidr) subnets.set(computerId, cidr);
    } catch { /* not known yet */ }
  }
  async function makeNetwork(computerId: string): Promise<void> {
    if (!o.runner || !o.http) return;
    const name = netOf(computerId);
    const made = await o.http({ method: "POST", path: "/networks/create", json: { Name: name, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.computer": computerId } } });
    if (made.status !== 201 && made.status !== 409) throw new Error(`the computer's network was not made (${made.status}: ${bodyText(made.body)})`);
    if (o.runner.ingress) {
      // the ingress (vyred) joins so agentd can reach the one route it posts to; the runner lets only the computer's own container and the ingress in
      const joined = await o.http({ method: "POST", path: `/networks/${name}/connect`, json: { Container: o.runner.ingress, EndpointConfig: { Aliases: [o.runner.alias ?? "vyre-host"] } } });
      if (joined.status !== 200 && joined.status !== 403 && !/already exists/i.test(bodyText(joined.body))) throw new Error(`vyred could not join the computer's network (${joined.status}: ${bodyText(joined.body)})`);
      if (joined.status === 403) throw new Error(`the runner refused to join vyred to the computer's network: ${bodyText(joined.body)}`);
    }
    await learnSubnet(computerId);
  }
  async function dropNetwork(computerId: string): Promise<void> {
    if (!o.runner || !o.http) return;
    const name = netOf(computerId);
    if (o.runner.ingress) await o.http({ method: "POST", path: `/networks/${name}/disconnect`, json: { Container: o.runner.ingress, Force: true } }).catch(() => undefined);
    const r = await o.http({ method: "DELETE", path: `/networks/${name}` });
    if (r.status !== 204 && r.status !== 404) throw new Error(`the computer's network was not removed (${r.status}: ${bodyText(r.body)})`);
    subnets.delete(computerId);
  }

  async function siteLogs(a: { computerId: string; slug: string; lines: number }): Promise<string[]> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.slug)) return [];
    const r = await o.api.exec(nameOf(a.computerId), { cmd: ["sh", "-c", 'tail -n "$1" "$HOME/sites/$2/site.log" 2>/dev/null', "sh", String(Math.max(1, Math.min(a.lines, 1000))), a.slug], env: ["HOME=/home/agent"] });
    return r.stdout.split("\n").filter((l) => l !== "");
  }

  async function ctl<T>(computerId: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
    const r = await o.api.exec(nameOf(computerId), { cmd: [ctlPath, action, JSON.stringify(body)], env: [], ...(o.user ? { user: `${o.user.uid}:${o.user.gid}` } : {}) });
    if (r.exitCode !== 0) throw new Error(`agentd ${action} failed (${r.exitCode ?? "no exit code"}): ${r.stderr.trim().slice(0, 200)}`);
    const text = r.stdout.trim();
    if (text === "") return {} as T;
    try { return JSON.parse(text) as T; } catch { throw new Error(`agentd ${action} answered with something that is not JSON`); }
  }

  // the home mirror: one HomeSync per computer, a pass before it starts, one every few seconds while it runs, and a last one after it stops
  const homes = new Map<string, { sync: HomeSync; timer: ReturnType<typeof setInterval> | null; agentId: string }>();
  function homeOf(computerId: string, agentId: string | undefined): { sync: HomeSync; timer: ReturnType<typeof setInterval> | null; agentId: string } | null {
    if (!o.home || !o.http || !agentId || !o.filesRoot?.(agentId)) return null;
    let h = homes.get(computerId);
    if (!h) {
      const fsView = createContainerHomeFs({ http: o.http, container: nameOf(computerId), image: o.image ?? DEFAULT_COMPUTER_IMAGE, user: { uid: o.user?.uid ?? 10001, gid: o.user?.gid ?? 10001 } });
      h = { sync: createHomeSync({ agentId, computerId, fs: fsView, manifest: o.home.manifest(agentId) }, o.home.deps), timer: null, agentId };
      homes.set(computerId, h);
    }
    return h;
  }
  /** One pass; true when it finished with nothing left undone (or there is no mirror), so a caller that is about to wipe its copy knows it is safe to. */
  // Files the agent made, held until the work goes quiet (a pass that made none) or the computer stops, then said once: one card per burst of work, not one per file.
  const made = new Map<string, MadeFile[]>();
  const heldSince = new Map<string, number>();
  const HOLD_MS = 10 * 60_000;
  async function sayMade(computerId: string, agentId: string): Promise<void> {
    const files = made.get(computerId);
    if (!files?.length || !o.home?.announce) return;
    made.delete(computerId);
    try {
      // announce answers false when there is no chat to say it in yet (the work was not for one): the files stay held, and are said when a chat appears, for ten minutes
      const said = await o.home.announce({ agentId, computerId, files });
      if (said === false) {
        const kept = [...files, ...(made.get(computerId) ?? [])].slice(-50);
        const since = heldSince.get(computerId) ?? Date.now();
        heldSince.set(computerId, since);
        if (Date.now() - since < HOLD_MS) made.set(computerId, kept); else heldSince.delete(computerId);
      } else heldSince.delete(computerId);
    } catch (e) { o.home.deps.log("warn", "computers.home.announce_failed", { computer: computerId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); }
  }
  /** What every pass leaves behind, whoever ran it (the timer, a tool, a recording, sleep): the files it made are held for the chat. A pass that goes round without losing them is the only way a file is announced. */
  async function afterPass(computerId: string, agentId: string, r: { made: MadeFile[] }, final = false): Promise<void> {
    if (r.made.length > 0) made.set(computerId, [...(made.get(computerId) ?? []), ...r.made]);
    else if (made.has(computerId) || final) await sayMade(computerId, agentId);
    if (final) await sayMade(computerId, agentId);
  }
  async function homePass(computerId: string, agentId: string | undefined, final = false): Promise<boolean> {
    const h = homeOf(computerId, agentId);
    if (!h) return true;
    try {
      const r = await h.sync.pass();
      await afterPass(computerId, h.agentId, r, final);
      if (r.down + r.up + r.conflicts + r.removed + r.suggested + r.refused.length > 0) o.home?.deps.log("info", "computers.home.pass", { computer: computerId, ...r, refused: r.refused.slice(0, 10) });
      return r.failed === 0;
    } catch (e) { o.home?.deps.log("warn", "computers.home.pass_failed", { computer: computerId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); return false; }
  }

  const host: ComputerHost & ToolHost = {
    address: containerAddress,
    siteLogs,
    kind: o.kind ?? "server",
    async create(a) {
      const name = nameOf(a.computerId);
      const config = computerContainerConfig(name, a.computerId, a.agentId, o, a.tabLimit);
      const wrong = reviewComputerConfig(config);
      if (wrong.length > 0) throw new Error(`the computer's container config is outside its profile: ${wrong.join(", ")}`);
      if (!(await o.api.imageExists(config.Image))) {
        // a server that has never run one fetches the image itself (the runner allows only this image); without a registry that has it, the reason says what is missing
        // a digest reference is pulled whole (fromImage carries it, no tag); a tag reference is repo and tag
        const byDigest = config.Image.includes("@");
        const [repo, tag] = byDigest ? [config.Image, ""] : [config.Image.slice(0, config.Image.lastIndexOf(":")), config.Image.slice(config.Image.lastIndexOf(":") + 1)];
        let pulled = false; let why = "";
        if (o.http) {
          try { const r = await o.http({ method: "POST", path: "/images/create", query: byDigest ? { fromImage: repo } : { fromImage: repo, tag }, timeoutMs: 15 * 60_000 }); pulled = r.status === 200 && !/"error"/.test(new TextDecoder().decode(r.body)); if (!pulled) why = bodyText(r.body); } catch (e) { why = e instanceof Error ? e.message.slice(0, 160) : "no answer"; }
        }
        if (!pulled || !(await o.api.imageExists(config.Image))) throw new Error(`${IMAGE_MISSING_SENTENCE}\nDetails: the agent computer image ${config.Image} is not on this server${why ? ` and could not be fetched (${why.slice(0, 80)})` : ""}. Load it with: docker pull ${config.Image}`);
      }
      await makeNetwork(a.computerId);
      try { await o.api.containerCreate(name, config); } catch (e) { await dropNetwork(a.computerId).catch(() => undefined); throw e; }
      return {};
    },
    async start(a) {
      const name = nameOf(a.computerId);
      if (o.profile) await o.profile.unseal(a.computerId);
      await homePass(a.computerId, a.agentId);
      await o.api.containerStart(name);
      await learnSubnet(a.computerId);
      const deadline = Date.now() + (o.startTimeoutMs ?? 30_000);
      for (;;) {
        try {
          await ctl(a.computerId, "configure", { tabLimit: a.tabLimit });
          const h = homeOf(a.computerId, a.agentId);
          if (h && !h.timer) { h.timer = setInterval(() => { void homePass(a.computerId, a.agentId); }, o.home?.intervalMs ?? 3000); h.timer.unref?.(); }
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
      const home = homes.get(a.computerId);
      if (home?.timer) { clearInterval(home.timer); home.timer = null; }
      await o.api.containerStop(name, 10);
      const homeSynced = a.reason !== "remove" ? await homePass(a.computerId, a.agentId, true) : false;
      if (o.profile && a.reason !== "remove") await o.profile.seal(a.computerId);
      return { ...(sessions ? { sessions } : {}), ...(a.reason !== "remove" ? { homeSynced } : {}) };
    },
    async remove(computerId) {
      const name = nameOf(computerId);
      await o.api.containerRemove(name);
      await dropNetwork(computerId);
      if (o.http) {
        const r = await o.http({ method: "DELETE", path: `/volumes/${name}-profile`, query: { force: "true" } });
        if (r.status !== 204 && r.status !== 404) throw new Error(`the profile volume was not removed (${r.status})`);
      }
    },
    async probe(computerId) {
      if (o.runner && !subnets.has(computerId)) await learnSubnet(computerId);
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
      const s = await ctl<{ transport?: "webrtc" | "mjpeg"; url?: string; ws?: string }>(a.computerId, "stream", { ticket: a.ticket });
      return { transport: s.transport === "webrtc" ? "webrtc" : "mjpeg", url: s.url ?? `/computers/${a.computerId}/stream?ticket=${a.ticket}`, ...(typeof s.ws === "string" ? { ws: s.ws } : {}) };
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
      // On a machine that keeps a working copy of the home, the finished folder (video, events, network log) has to reach Files before the recording counts as saved. A pass skips a file written in
      // the last second, so wait that out, then run the pass; one that leaves anything undone fails the save rather than reporting a recording the Space cannot play.
      const home = homes.get(a.computerId);
      if (home) {
        await sleep(1_100);
        const r = await home.sync.pass();
        await afterPass(a.computerId, home.agentId, r);
        if (r.failed > 0) throw new Error("the recording did not reach Files");
      }
    },
    async removeRecording(a) {
      if (!RECORDING_PATH.test(a.folderPath)) throw new Error("a recording lives under work/recordings/<id>");
      const r = await o.api.exec(nameOf(a.computerId), { cmd: ["rm", "-rf", `${FILES_GUEST}/${a.folderPath}`], env: [] });
      if (r.exitCode !== 0) throw new Error("the recording could not be removed");
    },
    async sessions(computerId) { return (await ctl<{ sessions?: SessionInfo[] }>(computerId, "sessions")).sessions ?? []; },
    async signOut(a) { return (await ctl<{ ok?: boolean }>(a.computerId, "sign_out", { site: a.site })).ok === true; },
    async tool(a) {
      const body = JSON.stringify({ tool: a.tool, args: a.args, timeoutMs: a.timeoutMs, ...(a.by === "person" ? { by: "person" } : {}) });
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
      // a tool may have changed files in the home: mirror them now rather than at the next pass
      const home = homes.get(a.computerId);
      if (home) void home.sync.pass().then((r) => afterPass(a.computerId, home.agentId, r)).catch((e: unknown) => { o.home?.deps.log("warn", "computers.home.pass_failed", { computer: a.computerId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); });
      return answer as ToolAnswer;
    },
    async health() {
      const t0 = Date.now();
      if (!o.http) { const ok = await o.api.ping(); return { ok, latencyMs: Date.now() - t0, ...(ok ? {} : { detail: "The container runtime did not answer." }) }; }
      try {
        const r = await o.http({ method: "GET", path: "/_ping", timeoutMs: 5000 });
        if (r.status === 200) return { ok: true, latencyMs: Date.now() - t0 };
        return { ok: false, latencyMs: Date.now() - t0, detail: explainEngine(r.status, null, o.runner ? "runner" : "engine") };
      } catch (e) { return { ok: false, latencyMs: Date.now() - t0, detail: explainEngine(0, e, o.runner ? "runner" : "engine") }; }
    },
    async capacity() {
      const os = process.getBuiltinModule("node:os");
      return { totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576), cpus: os.cpus().length, os: os.platform() };
    },
    subnets: () => [...subnets.values()],
    async knownNetworks(ids: readonly string[]) { for (const id of ids) await learnSubnet(id); return [...subnets.values()]; },
  };
  return host;
}

/** What the host hands the module for the Vault channel of agent computers (host/src/seams/computers.ts): the Vault source, a use log, the address agentd posts to and where to mount the route. */
export interface ComputersFillSeam { source: FillSource; log(use: FillUse): void | Promise<void>; url(): string; nodeSecure?(nodeId: string): boolean; mount(handler: (req: IncomingMessage, res: ServerResponse) => void): void; now?: () => number }

export function setComputersFill(h: ComputersFillSeam | null): void {
  if (!h) { bindFill(null); return; }
  const service = createFillService({ source: h.source, log: h.log, ...(h.now ? { now: h.now } : {}) });
  h.mount(fillHttp(service));
  bindFill({ issue: (x) => service.issue(x), url: h.url, ...(h.nodeSecure ? { nodeSecure: h.nodeSecure } : {}) });
}

/** What the host hands over at boot (host/src/seams/computers-host.ts): the Docker socket, the image and the agents' Files folders. The module builds the Docker host from it and binds it. */
export interface ComputersHostConfig {
  socketPath?: string;
  /** A Team server: the runner's socket and token (it alone holds the Docker socket), and the container vyred runs in, which joins each computer's network. */
  runner?: { socket: string; token(): string; ingress?: string; alias?: string };
  image?: string;
  /** The Space browser image (images/space-browser). Default vyre/space-browser:1. */
  browserImage?: string;
  /** How many browsers the Space browser holds at once and how long a quiet one stays (minutes). */
  browser?: { maxRunning?: number; idleMinutes?: number };
  filesRoot?: (agentId: string) => string | null;
  startTimeoutMs?: number;
  /** The agent's home mirror: calls as the agent principal, the upload of large files, how often a pass runs, where each agent's manifest lives, and a log. */
  home?: { callAs: HomeDeps["callAs"]; putBytes: HomeDeps["putBytes"]; intervalMs?: number; manifest(agentId: string): string; log?: HomeDeps["log"]; announce?: (a: { agentId: string; computerId: string; files: MadeFile[] }) => Promise<boolean | void> };
}

/** The Docker host for a machine, not yet bound: the Space binds it as its own; a computer that joined runs jobs on it. */
export function buildComputerHost(c: ComputersHostConfig): ComputerHost & ToolHost {
  // behind the runner the socket is the runner's and every call carries its token, read again each time (the runner writes a new one at each start)
  const http = c.runner ? unixSocketHttp(c.runner.socket, undefined, () => ({ authorization: `Bearer ${c.runner!.token()}` })) : unixSocketHttp(c.socketPath);
  return createDockerComputerHost({
    api: createDockerApi(http), http,
    ...(c.runner ? { runner: { socket: c.runner.socket, ...(c.runner.ingress ? { ingress: c.runner.ingress } : {}), ...(c.runner.alias ? { alias: c.runner.alias } : {}) } } : {}),
    ...(c.image !== undefined ? { image: c.image } : {}),
    ...(c.filesRoot !== undefined ? { filesRoot: c.filesRoot } : {}),
    ...(c.startTimeoutMs !== undefined ? { startTimeoutMs: c.startTimeoutMs } : {}),
    ...(c.home ? { home: { deps: { callAs: c.home.callAs, putBytes: c.home.putBytes, now: Date.now, log: c.home.log ?? (() => undefined) }, ...(c.home.intervalMs !== undefined ? { intervalMs: c.home.intervalMs } : {}), manifest: c.home.manifest, ...(c.home.announce ? { announce: c.home.announce } : {}) } } : {}),
  });
}

/** The address of a computer on this machine, for a site served from it; null when there is none or it is not running. */
export async function localComputerAddress(computerId: string): Promise<string | null> { return (await boundHost()?.address?.(computerId)) ?? null; }
/** The subnets of the computers' own networks, for the daemon: a connection that arrives on one may reach only the Vault channel. */
export function computerSubnets(): string[] { return (boundHost() as { subnets?: () => string[] } | null)?.subnets?.() ?? []; }
export async function learnComputerSubnets(ids: readonly string[]): Promise<string[]> { return (await (boundHost() as { knownNetworks?: (i: readonly string[]) => Promise<string[]> } | null)?.knownNetworks?.(ids)) ?? []; }
export async function localSiteLogs(a: { computerId: string; slug: string; lines: number }): Promise<string[]> { return (await boundHost()?.siteLogs?.(a)) ?? []; }

/** The Space browser for this machine, not yet bound: one container for the Space host, a Chrome profile per agent (sbrowser/). */
export function buildSpaceBrowser(c: ComputersHostConfig): SpaceBrowser {
  const http = c.runner ? unixSocketHttp(c.runner.socket, undefined, () => ({ authorization: `Bearer ${c.runner!.token()}` })) : unixSocketHttp(c.socketPath);
  return createDockerSpaceBrowser({
    api: createDockerApi(http), http,
    image: c.browserImage ?? DEFAULT_BROWSER_IMAGE,
    ...(c.runner ? { runner: { ...(c.runner.ingress ? { ingress: c.runner.ingress } : {}), ...(c.runner.alias ? { alias: c.runner.alias } : {}) } } : {}),
    ...(c.browser?.maxRunning !== undefined ? { maxRunning: c.browser.maxRunning } : {}),
    ...(c.browser?.idleMinutes !== undefined ? { idleMinutes: c.browser.idleMinutes } : {}),
    ...(c.startTimeoutMs !== undefined ? { startTimeoutMs: c.startTimeoutMs } : {}),
  });
}

export function setComputerHost(c: ComputersHostConfig | null): void {
  bindHost(c === null ? null : buildComputerHost(c));
  bindSpaceBrowser(c === null ? null : buildSpaceBrowser(c));
}

// Only the setters the daemon wires are host seams (the loader reports any other function here as a driver left unwired); what a computer that joined needs is exported beside them.
export const hostSeams = { setComputersFill, setComputerHost };
export { nodeRun };

/** What the host asks of this module on behalf of a computer that joined (host/src/routes/compute.ts): never a capability, never reachable from a session. */
export const hostCalls = { "computers.node_jobs": nodeJobs, "computers.node_result": nodeResult, "computers.node_home_check": nodeHomeCheck, "computers.stream_open": nodeStreamOpen, "computers.stream_input": nodeStreamInput, "computers.node_recording_check": nodeRecordingCheck };
