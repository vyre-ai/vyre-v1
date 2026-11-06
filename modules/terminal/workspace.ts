// The agent workspace (owner brainstorm 6 Nov 2026, team/v1/DESIGN-agent-workspaces.md). One small container per agent (a person's Assistant is an agent, so it is the same path): a shell, tmux, git,
// node and python, no screen and no Chrome. It is made the first time anything needs it (the first terminal command or the first attach), with no grant, sleeps after idle minutes (the container
// stops, the volumes stay) and wakes on the next use in about a second.
//
//   container   vyre-ws-<agent> from images/agent-workspace: non-root (10001), every capability dropped, no new privileges, no Docker socket, no device, /tmp a noexec tmpfs, limits.
//   volumes     vyre-ws-<agent>-home at /home/agent (everything the agent keeps), the volume vyre-ws-<agent>-files at ~/Vyre, which mirrors the agent's folder in Files (the computers module's home
//               sync, run by the daemon through `home`, so the same rules, versions and conflict handling), and one shared volume per project the agent is on, vyre-wsproj-<project>, at ~/projects/<project>
//               (every agent on the project mounts the same one).
//   terminal    tmux inside the container, driven with `docker exec`. `createWorkspaceTerminalHost` is a TerminalHost over it (createTmuxHost with this container's exec), so what an agent runs and
//               what a person attaches to are the same tmux sessions. Live frames come from `tmux pipe-pane` into a file that is read back, since the Engine API's exec here is not streamed.
//   sleep       a workspace is idle when nothing used it for `idleMs` and no tmux pane runs anything but a shell; `sweep` (a timer) stops it. tmux dies with the container, so a session that had
//               been open is made again, empty, the next time something uses it.
// The module never opens a socket of its own: the DockerApi and DockerHttp come from the host's seam (the Docker socket, or the runner on a Team server), like agent computers.
import { createHash } from "node:crypto";
import { createDockerApi } from "../../sandbox/src/docker.ts";
import { tarFiles } from "../../sandbox/src/tar.ts";
import type { ContainerConfig, DockerApi, DockerHttp } from "../../sandbox/src/docker.ts";
import { createTmuxHost } from "./impl.ts";
import type { ExecResult } from "./impl.ts";
import type { TerminalHost } from "./projections.ts";

export const DEFAULT_WORKSPACE_IMAGE = "vyre/agent-workspace:1";
export const WORKSPACE_PREFIX = "vyre-ws-";
export const PROJECT_VOLUME_PREFIX = "vyre-wsproj-";
export const WORKSPACE_HOME = "/home/agent";
export const FILES_GUEST = "/home/agent/Vyre";
export const PROJECTS_GUEST = "/home/agent/projects";
export const WORKSPACE_UID = 10001;
export const DEFAULT_IDLE_MS = 10 * 60_000;

export const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "ash", "tmux"]);

export const workspaceName = (agentId: string): string => `${WORKSPACE_PREFIX}${agentId}`;
export const workspaceNetworkName = (agentId: string): string => `vyre-wsnet-${createHash("sha256").update(agentId).digest("hex").slice(0, 16)}`;
export const homeVolume = (agentId: string): string => `${workspaceName(agentId)}-home`;
export const filesVolume = (agentId: string): string => `${workspaceName(agentId)}-files`;
export const projectVolume = (projectId: string): string => `${PROJECT_VOLUME_PREFIX}${projectId}`;

/** What the disk side of the Files mirror is, as the computers module's HomeSync reads it (its HomeFs, written out: a module does not import another module). */
export interface HomeSnapshot { files: Map<string, { bytes: Buffer; mtimeMs: number }>; dirs: Set<string>; refused: string[]; complete: boolean }
export interface HomeDisk {
  snapshot(): Promise<HomeSnapshot>;
  put(files: Array<{ rel: string; bytes: Uint8Array; readOnly: boolean }>): Promise<void>;
  remove(files: string[], dirs: string[]): Promise<void>;
}
export interface WorkspaceHome {
  /** One mirror of this agent's folder in Files onto `disk`; `pass` runs one round. The daemon makes it with the computers module's createHomeSync, as the agent principal. */
  sync(o: { agentId: string; computerId: string; fs: HomeDisk; manifest: string }): { pass(): Promise<{ failed: number }> };
  /** The computers module's reader of the tar the archive call returns: plain files and folders only, anything else refused by name. */
  readTar(tar: Uint8Array): HomeSnapshot;
  manifest(agentId: string): string;
  /**
   * One mirror of a project's shared folder onto `fs` (the project's volume, seen from a running workspace that mounts it), with every Files call made as `agentId`, so the file's history says which agent
   * made a change. Null when the project has no folder in Files: then the volume is shared between its agents and nothing else.
   */
  syncProject?(o: { projectId: string; agentId: string; fs: HomeDisk; manifest: string }): { pass(): Promise<{ failed: number }> } | null;
  projectManifest?(projectId: string): string;
  /** How often a pass runs while the workspace is awake. Default 3 s. */
  intervalMs?: number;
}

export interface WorkspaceOptions {
  api: DockerApi;
  /** Raw Engine access: inspect, volumes, the list of workspaces, and waiting for the one-off volume helper. */
  http: DockerHttp;
  image?: string;
  limits?: Partial<{ cpus: number; memoryMb: number; pids: number; reserveMb: number }>;
  /** How long after a command the project folders it may have changed are mirrored (a file must sit unchanged for a second first). Default 1200 ms. */
  projectKickMs?: number;
  /** A workspace with nothing using it for this long sleeps. Default 10 minutes. */
  idleMs?: number;
  /** The agent's folder in Files mirrored onto ~/Vyre (the computers module's home sync, handed over by the daemon). Omitted: ~/Vyre is an ordinary folder that Files does not see. */
  home?: WorkspaceHome;
  /** The projects the agent is on, read when the workspace wakes: a change recreates the container (volumes stay), so the new project's folder is there. */
  projectsOf?: (agentId: string) => Promise<readonly string[]> | readonly string[];
  /** Behind the runner (a Team server) each workspace gets a network of its own, so one cannot reach another. */
  runner?: boolean;
  /**
   * Room on the host (modules/computers/capacity.ts, reached by the daemon as host calls, since this module cannot import that one). `claim` is asked before a container starts: running means start,
   * waiting means do not, and the line is shown as the reason. `release` is told when one stops or is removed. A waiting workspace is started by the daemon when room opens (`ensure`).
   */
  capacity?: WorkspaceCapacity;
  /**
   * Called before a workspace is made or woken; throwing refuses it, with the error's message shown as the line. The capacity lane (l-capacity) plugs the room check in here: creating or waking
   * checks room first, and a full host queues with "Waiting for room on the Space server".
   */
  admit?: (a: { agentId: string; state: "create" | "wake" }) => Promise<void> | void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

export interface WorkspaceCapacity {
  /** `nodeId` names the server the workspace is on when it is not the Space's own. */
  claim(agentId: string, nodeId?: string): Promise<{ state: "running" | "waiting"; line?: string }>;
  release(agentId: string, nodeId?: string): Promise<void>;
}

/** What a workspace is doing, for the Terminal tab: asleep and running are its container; waiting is a start the host had no room for; none is no container yet. */
export interface WorkspaceStatus { state: "running" | "asleep" | "waiting" | "none"; line?: string; /** Where it is: the Space's own runtime, or a server that joined. */ host?: "space" | "server"; nodeId?: string; projects?: string[] }

export interface WorkspaceRow { agentId: string; state: "running" | "asleep"; lastUsedAt?: number }

export interface WorkspaceManager {
  /** What it is doing now, without waking it or making it. */
  status(agentId: string): Promise<WorkspaceStatus>;
  /** Make the workspace if there is none, stopped, with no claim on the host's room: for the one-time move of an agent computer. Safe to repeat. */
  provision(agentId: string): Promise<{ workspaceId: string }>;
  /** Make the workspace if there is none and wake it if it sleeps; counts as use. */
  ensure(agentId: string): Promise<"created" | "woke" | "running">;
  /** Run argv in the workspace (waking it first), as the container's own user (10001): an exec never names another. */
  exec(agentId: string, argv: readonly string[], o?: { env?: Readonly<Record<string, string>>; quiet?: boolean }): Promise<ExecResult>;
  /** How many times this process has started the workspace's container: a change says tmux was lost. */
  generation(agentId: string): number;
  /** Stop the container (the volumes stay). False when it was not running. */
  sleep(agentId: string): Promise<boolean>;
  /** Sleep every workspace that has been idle for `idleMs` and runs nothing but a shell. Returns who slept. */
  sweep(): Promise<string[]>;
  list(): Promise<WorkspaceRow[]>;
  /** The workspace that holds this tmux session, among the running ones (the host forgot where it was across a restart), or null. */
  find(session: string): Promise<string | null>;
  remove(agentId: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  /** Stop the idle timer. */
  close(): void;
}

// ---- the container --------------------------------------------------------------------------------------------------------------------------------------

export interface MountSpec { projects: string[] }

const stable = (m: MountSpec): string => createHash("sha256").update(JSON.stringify({ p: [...m.projects].sort() })).digest("hex").slice(0, 16);

export function workspaceContainerConfig(agentId: string, image: string, m: MountSpec, o: Pick<WorkspaceOptions, "limits" | "runner">): ContainerConfig {
  // the numbers are modules/computers/capacity.ts hostConfigLimits("workspace): a hard cap of 1 GB, 64 MB held back while it runs, low CPU shares, no swap (test/workspace.capacity.test.ts holds the two together)
  const limits = { cpus: 1, memoryMb: 1024, pids: 512, reserveMb: 64, ...o.limits };
  const memory = Math.round(limits.memoryMb * 1024 * 1024);
  const name = workspaceName(agentId);
  return {
    Image: image,
    Hostname: name,
    User: `${WORKSPACE_UID}:${WORKSPACE_UID}`,
    WorkingDir: WORKSPACE_HOME,
    Cmd: ["sleep", "infinity"],
    Env: [`VYRE_WORKSPACE_AGENT=${agentId}`, `HOME=${WORKSPACE_HOME}`, "TERM=xterm-256color", "LANG=en_US.UTF-8"],
    Labels: { "vyre.workspace": agentId, "vyre.mounts": stable(m) },
    StopTimeout: 10,
    HostConfig: {
      Binds: [
        `${homeVolume(agentId)}:${WORKSPACE_HOME}:rw`,
        `${filesVolume(agentId)}:${FILES_GUEST}:rw`,
        ...[...m.projects].sort().map((p) => `${projectVolume(p)}:${PROJECTS_GUEST}/${p}:rw`),
      ],
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=512m,uid=${WORKSPACE_UID},gid=${WORKSPACE_UID},mode=1777` },
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      NetworkMode: o.runner ? workspaceNetworkName(agentId) : "bridge",
      PidMode: "",
      IpcMode: "private",
      UsernsMode: "",
      Devices: [],
      PidsLimit: limits.pids,
      Memory: memory,
      MemorySwap: memory,
      NanoCpus: Math.round(limits.cpus * 1e9),
      MemoryReservation: Math.round(limits.reserveMb * 1024 * 1024),
      CpuShares: 256,
      Init: true,
      AutoRemove: false,
      Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 16384 }, { Name: "core", Soft: 0, Hard: 0 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      ExtraHosts: [],
      Dns: [],
    },
  };
}

/** What a workspace container must never have, as code: what is wrong, empty when it is within the profile. Run on every config before it is sent. */
export function reviewWorkspaceConfig(c: ContainerConfig, agentId: string): string[] {
  const h = c.HostConfig;
  const bad: string[] = [];
  if (h.Privileged) bad.push("privileged");
  if (!h.CapDrop.includes("ALL")) bad.push("capabilities are not all dropped");
  if (h.CapAdd.length > 0) bad.push("capabilities added");
  if (!h.SecurityOpt.includes("no-new-privileges:true")) bad.push("new privileges allowed");
  if (h.SecurityOpt.some((x) => x.endsWith("=unconfined"))) bad.push("a security profile is switched off");
  if (h.Devices.length > 0) bad.push("devices");
  if (h.PidMode !== "") bad.push("host pid namespace");
  if (h.IpcMode !== "private") bad.push("shared ipc namespace");
  if (h.UsernsMode !== "") bad.push("a user namespace mode");
  if (h.NetworkMode === "host" || h.NetworkMode.startsWith("container:")) bad.push("host or shared network");
  if (h.ExtraHosts.length > 0 || h.Dns.length > 0) bad.push("overrides name resolution");
  if (h.PidsLimit <= 0 || h.Memory <= 0 || h.NanoCpus <= 0) bad.push("no process, memory or CPU limit");
  if (h.MemorySwap !== h.Memory) bad.push("swap is not pinned to memory");
  const user = /^(\d+):(\d+)$/.exec(c.User);
  if (!user || Number(user[1]) === 0 || Number(user[2]) === 0) bad.push(`runs as ${c.User || "the image's user"}`);
  if (c.Hostname !== workspaceName(agentId) || c.Labels["vyre.workspace"] !== agentId) bad.push("is not this agent's workspace");
  const SYSTEM = new Set(["/", "/etc", "/var", "/usr", "/root", "/home", "/proc", "/sys", "/dev", "/boot", "/lib", "/bin", "/sbin", "/run"]);
  for (const b of h.Binds) {
    const m = /^([^:]+):(\/[^:]*):(ro|rw)$/.exec(b);
    if (!m) { bad.push(`bind ${b} is not source:guest:mode`); continue; }
    const src = m[1] as string;
    const guest = m[2] as string;
    if (/docker\.sock|containerd\.sock|\.sock$/.test(src)) bad.push("docker socket");
    if (SYSTEM.has(src.replace(/\/+$/, "") || "/")) bad.push("a system folder is bound");
    if (src.startsWith("/")) bad.push(`a host folder is bound at ${guest}`);
    else if (![homeVolume(agentId), filesVolume(agentId)].includes(src) && !(src.startsWith(PROJECT_VOLUME_PREFIX) && PROJECT_ID.test(src.slice(PROJECT_VOLUME_PREFIX.length)))) bad.push(`volume ${src} is not this workspace's`);
    if (!(guest === WORKSPACE_HOME || guest === FILES_GUEST || guest.startsWith(`${PROJECTS_GUEST}/`))) bad.push(`binds into ${guest}`);
  }
  if (Object.keys(h.Tmpfs).some((k) => k !== "/tmp")) bad.push("a tmpfs other than /tmp");
  return bad;
}

// ---- the manager ----------------------------------------------------------------------------------------------------------------------------------------

const dec = new TextDecoder();
const bodyText = (b: Uint8Array): string => { const s = dec.decode(b); try { const m = (JSON.parse(s) as { message?: string }).message; return String(m ?? s).slice(0, 200); } catch { return s.slice(0, 200); } };
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** A refusal written for a person: the first line is plain words, anything after it (Details: ...) is for Copy details. The terminal says the first line as the reason a session did not open. */
const wsError = (message: string, code = "unavailable"): Error => Object.assign(new Error(message), { code, workspace: true });

export const IMAGE_MISSING_LINE = "This server can't start agent workspaces yet.";

export function createWorkspaceManager(o: WorkspaceOptions): WorkspaceManager {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const api = o.api;
  const http = o.http;
  const image = o.image ?? DEFAULT_WORKSPACE_IMAGE;
  const idleMs = o.idleMs ?? DEFAULT_IDLE_MS;
  const log = o.log ?? (() => undefined);
  const lastUsed = new Map<string, number>();
  const gens = new Map<string, number>();
  const waitingLine = new Map<string, string>();
  /** The project folders each workspace was made or woken with, for the Terminal tab. */
  const mounted = new Map<string, string[]>();
  const chain = new Map<string, Promise<unknown>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const homes = new Map<string, { sync: { pass(): Promise<{ failed: number }> }; timer: ReturnType<typeof setInterval> | null }>();
  // the projects each awake workspace mounts, who last worked in each project, and its mirror
  const agentProjects = new Map<string, string[]>();
  const projectActor = new Map<string, string>();
  const projects = new Map<string, { sync: { pass(): Promise<{ failed: number }> } | null; timer: ReturnType<typeof setInterval> | null; kick: ReturnType<typeof setTimeout> | null; holder: string | null }>();
  let imageKnown = false;
  let discovered = false;

  /** One at a time per workspace: two first commands in the same moment make it once. */
  function serial<T>(agentId: string, f: () => Promise<T>): Promise<T> {
    const prev = chain.get(agentId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(f);
    chain.set(agentId, next);
    void next.finally(() => { if (chain.get(agentId) === next) chain.delete(agentId); }).catch(() => undefined);
    return next;
  }

  async function inspect(name: string): Promise<{ running: boolean; labels: Record<string, string> } | null> {
    const r = await http({ method: "GET", path: `/containers/${name}/json` });
    if (r.status === 404) return null;
    if (r.status !== 200) throw wsError(`Docker did not answer for the workspace (${r.status}: ${bodyText(r.body)}).`);
    const j = JSON.parse(dec.decode(r.body)) as { State?: { Running?: boolean }; Config?: { Labels?: Record<string, string> } };
    return { running: j.State?.Running === true, labels: j.Config?.Labels ?? {} };
  }

  async function ensureImage(): Promise<void> {
    if (imageKnown) return;
    if (!(await api.imageExists(image))) {
      const byDigest = image.includes("@");
      const [repo, tag] = byDigest ? [image, ""] : [image.slice(0, image.lastIndexOf(":")), image.slice(image.lastIndexOf(":") + 1)];
      let why = "";
      let pulled = false;
      try {
        const r = await http({ method: "POST", path: "/images/create", query: byDigest ? { fromImage: repo } : { fromImage: repo, tag }, timeoutMs: 15 * 60_000 });
        pulled = r.status === 200 && !/"error"/.test(dec.decode(r.body));
        if (!pulled) why = bodyText(r.body);
      } catch (e) { why = e instanceof Error ? e.message.slice(0, 160) : "no answer"; }
      if (!pulled || !(await api.imageExists(image))) throw wsError(`${IMAGE_MISSING_LINE}\nDetails: the workspace image ${image} is not on this server${why ? ` and could not be fetched (${why.slice(0, 80)})` : ""}. Load it with: docker pull ${image}`, "image_missing");
    }
    imageKnown = true;
  }

  /** A shared project folder is a new volume the container's user cannot write to (Docker makes the root of a volume root's); a one-off helper with the one capability that needs, CHOWN, gives it to the agent user. */
  async function ensureProjectVolume(projectId: string): Promise<void> {
    const vol = projectVolume(projectId);
    const have = await http({ method: "GET", path: `/volumes/${vol}` });
    if (have.status === 200) return;
    if (have.status !== 404) throw wsError(`Docker did not answer for the project folder (${have.status}: ${bodyText(have.body)}).`);
    const made = await http({ method: "POST", path: "/volumes/create", json: { Name: vol, Labels: { "vyre.workspace.project": projectId } } });
    if (made.status !== 201 && made.status !== 200) throw wsError(`The project folder was not made (${made.status}: ${bodyText(made.body)}).`);
    const helper = `vyre-wsinit-${projectId}`;
    await http({ method: "DELETE", path: `/containers/${helper}`, query: { force: "true" } }).catch(() => undefined);
    const c = await http({
      method: "POST", path: "/containers/create", query: { name: helper },
      json: projectInitBody(projectId, image),
    });
    if (c.status !== 201) throw wsError(`The project folder could not be set up (${c.status}: ${bodyText(c.body)}).`);
    try {
      const s = await http({ method: "POST", path: `/containers/${helper}/start` });
      if (s.status !== 204 && s.status !== 304) throw wsError(`The project folder could not be set up (${s.status}: ${bodyText(s.body)}).`);
      const w = await http({ method: "POST", path: `/containers/${helper}/wait`, timeoutMs: 60_000 });
      const code = (JSON.parse(dec.decode(w.body) || "{}") as { StatusCode?: number }).StatusCode;
      if (w.status !== 200 || code !== 0) throw wsError(`The project folder could not be set up (exit ${code ?? "unknown"}).`);
    } finally { await http({ method: "DELETE", path: `/containers/${helper}`, query: { force: "true" } }).catch(() => undefined); }
  }

  async function makeNetwork(agentId: string): Promise<void> {
    if (!o.runner) return;
    const name = workspaceNetworkName(agentId);
    const r = await http({ method: "POST", path: "/networks/create", json: { Name: name, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": agentId } } });
    if (r.status !== 201 && r.status !== 409) throw wsError(`The workspace's network was not made (${r.status}: ${bodyText(r.body)}).`);
  }

  async function mounts(agentId: string): Promise<MountSpec> {
    const projects = [...new Set((await o.projectsOf?.(agentId)) ?? [])].filter((p) => PROJECT_ID.test(p)).sort();
    return { projects };
  }

  // ---- the Files mirror: ~/Vyre against the agent's folder in Files, read and written through the Engine's archive calls (a link in the folder can only point at something in the container) ----
  const GUEST = FILES_GUEST;
  function diskOf(agentId: string): HomeDisk {
    const name = workspaceName(agentId);
    const home = o.home as WorkspaceHome;
    return {
      async snapshot() {
        const r = await http({ method: "GET", path: `/containers/${name}/archive`, query: { path: `${GUEST}/.` }, timeoutMs: 120_000 });
        if (r.status === 404) return { files: new Map(), dirs: new Set(), refused: [], complete: true };
        if (r.status !== 200) throw new Error(`the Files folder could not be read (${r.status})`);
        if (r.body.length > 256 * 1024 * 1024) return { files: new Map(), dirs: new Set(), refused: [], complete: false };
        return home.readTar(r.body);
      },
      async put(files) {
        if (files.length === 0) return;
        const at = Math.floor(now() / 1000);
        const tar = tarFiles(files.map((f) => ({ path: f.rel, data: f.bytes, mode: f.readOnly ? 0o444 : 0o644, uid: f.readOnly ? 0 : WORKSPACE_UID, gid: f.readOnly ? 0 : WORKSPACE_UID, mtime: at })));
        const r = await http({ method: "PUT", path: `/containers/${name}/archive`, query: { path: GUEST }, body: tar, contentType: "application/x-tar", timeoutMs: 120_000 });
        if (r.status !== 200) throw new Error(`the Files folder could not be written (${r.status})`);
      },
      async remove(files, dirs) {
        if (files.length === 0 && dirs.length === 0) return;
        // a removal is an exec as the agent's own user inside the running container: rm and rmdir on named paths, nothing else
        const script = 'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';
        const r = await execIn(agentId, ["sh", "-c", script, "sh", ...files.map((f) => `${GUEST}/${f}`), "::", ...dirs.map((d) => `${GUEST}/${d}`)], undefined);
        if (r.code !== 0) throw new Error(`the Files folder could not be tidied (${r.stderr.slice(0, 100)})`);
      },
    };
  }
  function homeOf(agentId: string): { sync: { pass(): Promise<{ failed: number }> }; timer: ReturnType<typeof setInterval> | null } | null {
    if (!o.home) return null;
    let h = homes.get(agentId);
    if (!h) { h = { sync: o.home.sync({ agentId, computerId: `ws_${agentId}`, fs: diskOf(agentId), manifest: o.home.manifest(agentId) }), timer: null }; homes.set(agentId, h); }
    return h;
  }
  /** One round of the mirror; true when it finished with nothing left undone (or there is no mirror), so a caller about to stop the container knows nothing was lost. */
  async function homePass(agentId: string): Promise<boolean> {
    const h = homeOf(agentId);
    if (!h) return true;
    try { return (await h.sync.pass()).failed === 0; }
    catch (e) { log("warn", "workspace.home_pass_failed", { agent: agentId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); return false; }
  }
  /** Before a workspace stops: the project folders it mounts, mirrored once more, when it is the last running workspace on them (while another runs, that one keeps mirroring). */
  async function finalProjectPasses(agentId: string): Promise<boolean> {
    let ok = true;
    for (const projectId of agentProjects.get(agentId) ?? []) {
      let other = false;
      for (const [a, ps] of agentProjects) if (a !== agentId && ps.includes(projectId) && (await api.containerRunning(workspaceName(a)).catch(() => false))) other = true;
      if (!other && !(await projectPass(projectId))) ok = false;
    }
    stopProjects(agentId);
    return ok;
  }
  function startHome(agentId: string): void {
    const h = homeOf(agentId);
    if (!h || h.timer) return;
    h.timer = setInterval(() => { void api.containerRunning(workspaceName(agentId)).then((up) => (up ? homePass(agentId) : undefined)).catch(() => undefined); }, o.home?.intervalMs ?? 3000);
    h.timer.unref?.();
  }
  function stopHome(agentId: string): void { const h = homes.get(agentId); if (h?.timer) { clearInterval(h.timer); h.timer = null; } }

  // ---- the project folders: a volume the agents on a project share, mirrored with the project's folder in Files, with history that says which agent changed what ----
  // The disk is read through any running workspace that mounts it. A pass runs as the agent that last worked in the project (every command an agent runs makes it the one, and a pass follows a second
  // later), so a change on the disk is put in the file's history as that agent's, and Files' own versions give "who changed what" and undo.
  const PROJECT_GUEST = (p: string): string => `${PROJECTS_GUEST}/${p}`;
  const runningMounter = async (projectId: string): Promise<string | null> => {
    for (const [agent, ps] of agentProjects) if (ps.includes(projectId) && (await api.containerRunning(workspaceName(agent)).catch(() => false))) return agent;
    return null;
  };
  function projectDisk(projectId: string, via: string): HomeDisk {
    const name = workspaceName(via);
    const home = o.home as WorkspaceHome;
    const dir = PROJECT_GUEST(projectId);
    return {
      async snapshot() {
        const r = await http({ method: "GET", path: `/containers/${name}/archive`, query: { path: `${dir}/.` }, timeoutMs: 120_000 });
        if (r.status === 404) return { files: new Map(), dirs: new Set(), refused: [], complete: true };
        if (r.status !== 200) throw new Error(`the project folder could not be read (${r.status})`);
        if (r.body.length > 256 * 1024 * 1024) return { files: new Map(), dirs: new Set(), refused: [], complete: false };
        return home.readTar(r.body);
      },
      async put(files) {
        if (files.length === 0) return;
        const at = Math.floor(now() / 1000);
        const tar = tarFiles(files.map((f) => ({ path: f.rel, data: f.bytes, mode: 0o644, uid: WORKSPACE_UID, gid: WORKSPACE_UID, mtime: at })));
        const r = await http({ method: "PUT", path: `/containers/${name}/archive`, query: { path: dir }, body: tar, contentType: "application/x-tar", timeoutMs: 120_000 });
        if (r.status !== 200) throw new Error(`the project folder could not be written (${r.status})`);
      },
      async remove(files, dirs) {
        if (files.length === 0 && dirs.length === 0) return;
        const script = 'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';
        const r = await execIn(via, ["sh", "-c", script, "sh", ...files.map((f) => `${dir}/${f}`), "::", ...dirs.map((d) => `${dir}/${d}`)], undefined);
        if (r.code !== 0) throw new Error(`the project folder could not be tidied (${r.stderr.slice(0, 100)})`);
      },
    };
  }
  /** One round of a project's mirror, as the agent that last worked in it, through a workspace that is running and mounts it. True when nothing was left undone, or there is nothing to do. */
  async function projectPass(projectId: string): Promise<boolean> {
    if (!o.home?.syncProject) return true;
    const via = await runningMounter(projectId);
    if (via === null) return true;
    const as = projectActor.get(projectId) ?? via;
    const p = projects.get(projectId) ?? { sync: null, timer: null, kick: null, holder: null };
    projects.set(projectId, p);
    try {
      // the mirror is made for the agent whose calls it makes and the workspace whose disk it reads; either changing makes a new one (the manifest, which is the project's, is shared)
      if (p.holder !== `${as}|${via}`) { p.sync = o.home.syncProject({ projectId, agentId: as, fs: projectDisk(projectId, via), manifest: (o.home.projectManifest ?? ((id) => `${o.home!.manifest(`project_${id}`)}`))(projectId) }); p.holder = `${as}|${via}`; }
      if (p.sync === null) return true;
      return (await p.sync.pass()).failed === 0;
    } catch (e) { log("warn", "workspace.project_pass_failed", { project: projectId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); return false; }
  }
  function startProjects(agentId: string, ps: readonly string[]): void {
    if (!o.home?.syncProject) return;
    agentProjects.set(agentId, [...ps]);
    for (const projectId of ps) {
      const p = projects.get(projectId) ?? { sync: null, timer: null, kick: null, holder: null };
      projects.set(projectId, p);
      if (p.timer) continue;
      p.timer = setInterval(() => {
        void runningMounter(projectId).then(async (via) => {
          if (via === null) { if (p.timer) { clearInterval(p.timer); p.timer = null; } return; }
          await projectPass(projectId);
        }).catch(() => undefined);
      }, o.home.intervalMs ?? 3000);
      p.timer.unref?.();
    }
  }
  /** A command ran in this agent's workspace: the project folders it mounts are the ones it may have changed, and it is the agent they are attributed to. A pass follows, after the second a file must sit unchanged. */
  function kickProjects(agentId: string): void {
    if (!o.home?.syncProject) return;
    for (const projectId of agentProjects.get(agentId) ?? []) {
      projectActor.set(projectId, agentId);
      const p = projects.get(projectId);
      if (!p || p.kick) continue;
      p.kick = setTimeout(() => { p.kick = null; void projectPass(projectId); }, o.projectKickMs ?? 1200);
      p.kick.unref?.();
    }
  }
  function stopProjects(agentId: string): void {
    const ps = agentProjects.get(agentId) ?? [];
    agentProjects.delete(agentId);
    for (const projectId of ps) {
      const p = projects.get(projectId);
      if (!p) continue;
      // the timer stays while another running workspace mounts the project; it ends itself at its next look otherwise
      if (p.kick) { clearTimeout(p.kick); p.kick = null; }
    }
  }

  async function removeContainer(name: string): Promise<void> {
    await api.containerStop(name, 10);
    await api.containerRemove(name);
  }

  /** Make the container, stopped: the profile review, the image, the project volumes, the network. */
  async function build(agentId: string, name: string, want: MountSpec, config: ContainerConfig): Promise<void> {
    const wrong = reviewWorkspaceConfig(config, agentId);
    if (wrong.length > 0) throw wsError(`the workspace's container config is outside its profile: ${wrong.join(", ")}`);
    await ensureImage();
    for (const p of want.projects) await ensureProjectVolume(p);
    await makeNetwork(agentId);
    await api.containerCreate(name, config);
  }

  function provision(agentId: string): Promise<{ workspaceId: string }> {
    if (!AGENT_ID.test(agentId)) return Promise.reject(wsError("That is not an agent a workspace can be made for.", "bad_input"));
    return serial(agentId, async () => {
      const name = workspaceName(agentId);
      if (!(await inspect(name))) { const want = await mounts(agentId); await build(agentId, name, want, workspaceContainerConfig(agentId, image, want, o)); log("info", "workspace.provisioned", { agent: agentId }); }
      return { workspaceId: name };
    });
  }

  async function wake(agentId: string): Promise<"created" | "woke" | "running"> {
    const name = workspaceName(agentId);
    const want = await mounts(agentId);
    const config = workspaceContainerConfig(agentId, image, want, o);
    let info = await inspect(name);
    // the projects it is on changed (or the Files folder moved): the container is made again with the new mounts; the volumes, and so everything the agent kept, stay
    if (info && info.labels["vyre.mounts"] !== config.Labels["vyre.mounts"]) { stopHome(agentId); if (info.running) await homePass(agentId); await removeContainer(name); info = null; gens.set(agentId, (gens.get(agentId) ?? 0) + 1); }
    if (info?.running) {
      lastUsed.set(agentId, now());
      mounted.set(agentId, want.projects);
      // running before this process started: its projects' mirrors start now
      if (!agentProjects.has(agentId)) startProjects(agentId, want.projects);
      return "running";
    }
    await o.admit?.({ agentId, state: info ? "wake" : "create" });
    // room first: a host that is full queues it with a plain line and nothing is made or started
    if (o.capacity) {
      const room = await o.capacity.claim(agentId);
      if (room.state === "waiting") { waitingLine.set(agentId, room.line ?? "Waiting for room on the Space server."); throw wsError(room.line ?? "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.", "waiting"); }
      waitingLine.delete(agentId);
    }
    try {
      if (!info) await build(agentId, name, want, config);
      await api.containerStart(name);
    } catch (e) { await o.capacity?.release(agentId).catch(() => undefined); throw e; }
    gens.set(agentId, (gens.get(agentId) ?? 0) + 1);
    lastUsed.set(agentId, now());
    // Files down into ~/Vyre before the first command, then every few seconds while it is awake
    await homePass(agentId);
    startHome(agentId);
    mounted.set(agentId, want.projects);
    startProjects(agentId, want.projects);
    for (const p of want.projects) await projectPass(p);
    startTimer();
    log("info", info ? "workspace.woke" : "workspace.created", { agent: agentId });
    return info ? "woke" : "created";
  }

  function ensure(agentId: string): Promise<"created" | "woke" | "running"> {
    if (!AGENT_ID.test(agentId)) return Promise.reject(wsError("That is not an agent a workspace can be made for.", "bad_input"));
    return serial(agentId, () => wake(agentId));
  }

  async function execIn(agentId: string, argv: readonly string[], env: Readonly<Record<string, string>> | undefined): Promise<ExecResult> {
    const r = await api.exec(workspaceName(agentId), { cmd: argv, env: Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`) });
    return { code: r.exitCode ?? 1, stdout: r.stdout, stderr: r.stderr };
  }

  async function exec(agentId: string, argv: readonly string[], x?: { env?: Readonly<Record<string, string>>; quiet?: boolean }): Promise<ExecResult> {
    // quiet: tidying up after a stream. It neither wakes a sleeping workspace nor counts as use.
    if (x?.quiet === true) return (await api.containerRunning(workspaceName(agentId))) ? execIn(agentId, argv, x.env) : { code: 1, stdout: "", stderr: "the workspace is asleep" };
    await ensure(agentId);
    lastUsed.set(agentId, now());
    kickProjects(agentId);
    try { return await execIn(agentId, argv, x?.env); }
    catch (e) {
      // the container stopped between the wake and the exec (a sweep, or someone stopped it): wake it once more
      if (await api.containerRunning(workspaceName(agentId)).catch(() => false)) throw e;
      await ensure(agentId);
      return execIn(agentId, argv, x?.env);
    }
  }

  async function sleepNow(agentId: string): Promise<boolean> {
    return serial(agentId, async () => {
      if (!(await api.containerRunning(workspaceName(agentId)))) return false;
      // what the agent made goes to Files before the container stops
      stopHome(agentId);
      const synced = (await homePass(agentId)) && (await finalProjectPasses(agentId));
      if (!synced) log("warn", "workspace.slept_unsynced", { agent: agentId });
      await api.containerStop(workspaceName(agentId), 10);
      lastUsed.delete(agentId);
      // the room it held goes back, and the oldest waiting workspace starts
      await o.capacity?.release(agentId).catch(() => undefined);
      log("info", "workspace.slept", { agent: agentId });
      return true;
    });
  }

  async function running(): Promise<string[]> {
    const r = await http({ method: "GET", path: "/containers/json", query: { all: "false", filters: JSON.stringify({ label: ["vyre.workspace"] }) } });
    if (r.status !== 200) return [];
    const rows = JSON.parse(dec.decode(r.body)) as Array<{ Labels?: Record<string, string> }>;
    return rows.map((x) => x.Labels?.["vyre.workspace"] ?? "").filter((id) => AGENT_ID.test(id));
  }

  async function sweep(): Promise<string[]> {
    const slept: string[] = [];
    let live: string[];
    try { live = await running(); } catch { return slept; }
    // workspaces that were running before this process started get a whole idle period from now
    if (!discovered) { discovered = true; for (const id of live) if (!lastUsed.has(id)) lastUsed.set(id, now()); }
    for (const id of live) {
      const at = lastUsed.get(id);
      if (at === undefined) { lastUsed.set(id, now()); continue; }
      if (now() - at < idleMs) continue;
      // never sleeps mid-task: a pane that runs something other than a shell is work
      let busy = false;
      try {
        const r = await execIn(id, ["tmux", "list-panes", "-a", "-F", "#{pane_current_command}"], undefined);
        busy = r.code === 0 && r.stdout.split("\n").map((l) => l.trim()).some((c) => c !== "" && !SHELLS.has(c));
      } catch { busy = false; }
      if (busy) { lastUsed.set(id, now() - idleMs + 60_000); continue; }
      try { if (await sleepNow(id)) slept.push(id); } catch (e) { log("warn", "workspace.sleep_failed", { agent: id, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); }
    }
    return slept;
  }

  function startTimer(): void {
    if (timer) return;
    timer = setInterval(() => { void sweep().catch(() => undefined); }, Math.max(1000, Math.min(60_000, Math.floor(idleMs / 2))));
    timer.unref?.();
  }

  return {
    ensure, exec, provision,
    async status(agentId) {
      const row = (await this.list()).find((r) => r.agentId === agentId);
      const projects = mounted.get(agentId);
      if (row) return { state: row.state, ...(projects && projects.length > 0 ? { projects } : {}) };
      const line = waitingLine.get(agentId);
      return line !== undefined ? { state: "waiting", line } : { state: "none" };
    },
    generation: (agentId) => gens.get(agentId) ?? 0,
    sleep: sleepNow,
    sweep,
    async list() {
      const r = await http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ label: ["vyre.workspace"] }) } });
      if (r.status !== 200) return [];
      const rows = JSON.parse(dec.decode(r.body)) as Array<{ State?: string; Labels?: Record<string, string> }>;
      return rows.flatMap((x) => {
        const id = x.Labels?.["vyre.workspace"] ?? "";
        if (!AGENT_ID.test(id)) return [];
        const at = lastUsed.get(id);
        return [{ agentId: id, state: x.State === "running" ? ("running" as const) : ("asleep" as const), ...(at === undefined ? {} : { lastUsedAt: at }) }];
      });
    },
    async find(session) {
      for (const id of await running()) {
        try { if ((await execIn(id, ["tmux", "has-session", "-t", session], undefined)).code === 0) return id; } catch { /* not this one */ }
      }
      return null;
    },
    async remove(agentId) {
      await serial(agentId, async () => {
        if (await inspect(workspaceName(agentId))) await removeContainer(workspaceName(agentId));
        for (const v of [homeVolume(agentId), filesVolume(agentId)]) {
          const r = await http({ method: "DELETE", path: `/volumes/${v}`, query: { force: "true" } });
          if (r.status !== 204 && r.status !== 404) throw wsError(`The workspace's volume was not removed (${r.status}).`);
        }
        if (o.runner) await http({ method: "DELETE", path: `/networks/${workspaceNetworkName(agentId)}` }).catch(() => undefined);
        lastUsed.delete(agentId);
        await o.capacity?.release(agentId).catch(() => undefined);
      });
    },
    async health() {
      try {
        const r = await http({ method: "GET", path: "/_ping", timeoutMs: 5000 });
        return r.status === 200 ? { ok: true } : { ok: false, detail: `Docker answered an error (${r.status}).` };
      } catch (e) { return { ok: false, detail: e instanceof Error ? e.message.slice(0, 160) : "The container runtime did not answer." }; }
    },
    close() {
      if (timer) { clearInterval(timer); timer = null; }
      for (const id of [...homes.keys()]) stopHome(id);
      for (const p of projects.values()) { if (p.timer) clearInterval(p.timer); if (p.kick) clearTimeout(p.kick); p.timer = null; p.kick = null; }
    },
  };
}

/** The one-off container that gives a new project volume to the agent user. Fixed text: the runner holds the same shape and refuses any other. */
export const PROJECT_INIT_SCRIPT = `chown ${WORKSPACE_UID}:${WORKSPACE_UID} /vol`;
export const projectInitName = (projectId: string): string => `vyre-wsinit-${projectId}`;
export function projectInitBody(projectId: string, img: string): Record<string, unknown> {
  return {
    Image: img, User: "0:0", Entrypoint: ["sh", "-c", PROJECT_INIT_SCRIPT], NetworkDisabled: true, Labels: { "vyre.workspace.helper": "project-init", "vyre.workspace.project": projectId },
    HostConfig: { Binds: [`${projectVolume(projectId)}:/vol:rw`], CapDrop: ["ALL"], CapAdd: ["CHOWN"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false, Memory: 128 * 1024 * 1024, PidsLimit: 32 },
  };
}

/** The manager for a Docker engine reached through `http` (the socket, or the runner's). */
export function buildWorkspaceManager(c: Omit<WorkspaceOptions, "api">): WorkspaceManager {
  return createWorkspaceManager({ ...c, api: createDockerApi(c.http) });
}

// ---- the terminal ---------------------------------------------------------------------------------------------------------------------------------------

/** What tmux control mode prints for a byte it will not show: a backslash and three octal digits, the backslash itself the same way (the inverse of decodeControlOutput). */
export function encodeControlOutput(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b === 0x5c || b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b);
  return out;
}

/** How many trailing bytes are the start of a UTF-8 character that has not all arrived: they wait for the next read. */
export function incompleteTail(b: Uint8Array): number {
  for (let back = 1; back <= Math.min(3, b.length); back++) {
    const x = b[b.length - back] as number;
    if ((x & 0xc0) === 0x80) continue;
    const need = x >= 0xf0 ? 4 : x >= 0xe0 ? 3 : x >= 0xc0 ? 2 : 1;
    return need > back ? back : 0;
  }
  return 0;
}

/** The workspace host also says whether it holds a session (the id was opened here, or a running workspace has its tmux session): how the machine's host tells one of its sessions from another's. */
export type WorkspaceTerminalHost = TerminalHost & { has(terminalId: string): Promise<boolean> };

export interface WorkspaceTerminalOptions {
  manager: WorkspaceManager;
  /** How often the pipe file is read for live frames. Default 150 ms. */
  streamMs?: number;
  sleep?: (ms: number) => Promise<void>;
  prefix?: string;
}

/**
 * The TerminalHost of agent workspaces: one tmux host per workspace (createTmuxHost over `docker exec`), the right one picked by which workspace the session was opened in. A session the host forgot
 * (a restart) is found by asking the running workspaces; one whose tmux died with a sleep is made again, empty, in the folder and size it had.
 */
export function createWorkspaceTerminalHost(w: WorkspaceTerminalOptions): WorkspaceTerminalHost {
  const m = w.manager;
  const prefix = w.prefix ?? "vyre-";
  const sleep = w.sleep ?? realSleep;
  const streamMs = w.streamMs ?? 150;
  const nameOf = (terminalId: string): string => `${prefix}${terminalId}`;
  const where = new Map<string, { agentId: string; cols: number; rows: number; cwd?: string; gen: number }>();
  const tmuxHosts = new Map<string, TerminalHost>();

  // ---- live frames: tmux pipe-pane into a file in /tmp, read back from an offset, one reader per session however many tabs watch ----
  const streams = new Map<string, { listeners: Set<(line: string) => void>; stop(): void }>();
  function control(agentId: string): (session: string, onLine: (line: string) => void) => () => void {
    return (session, onLine) => {
      const have = streams.get(session);
      if (have) { have.listeners.add(onLine); return () => { have.listeners.delete(onLine); if (have.listeners.size === 0) have.stop(); }; }
      const file = `/tmp/.vyre-stream-${session}`;
      const listeners = new Set<(line: string) => void>([onLine]);
      let stopped = false;
      const entry = { listeners, stop() { stopped = true; streams.delete(session); void m.exec(agentId, ["sh", "-c", 'tmux pipe-pane -t "$1" 2>/dev/null; rm -f "$2"', "sh", session, file], { quiet: true }).catch(() => undefined); } };
      streams.set(session, entry);
      void (async () => {
        let offset = 0;
        let carry: Uint8Array = new Uint8Array(0);
        try {
          await m.exec(agentId, ["sh", "-c", ': > "$2"; tmux pipe-pane -t "$1" "cat >> $2"', "sh", session, file]);
          while (!stopped) {
            const r = await m.exec(agentId, ["sh", "-c", 'tail -c +"$1" "$2" 2>/dev/null | head -c 49152 | base64 -w0', "sh", String(offset + 1), file]);
            const b64 = r.stdout.trim();
            if (b64 !== "") {
              const got = Buffer.from(b64, "base64");
              offset += got.length;
              const all = new Uint8Array(carry.length + got.length);
              all.set(carry); all.set(got, carry.length);
              const hold = incompleteTail(all);
              carry = all.slice(all.length - hold);
              const send = all.subarray(0, all.length - hold);
              if (send.length > 0) { const line = `%output %0 ${encodeControlOutput(send)}`; for (const l of [...listeners]) l(line); }
            }
            await sleep(streamMs);
          }
        } catch { entry.stop(); }
      })();
      return () => { listeners.delete(onLine); if (listeners.size === 0) entry.stop(); };
    };
  }

  function tmuxFor(agentId: string): TerminalHost {
    let h = tmuxHosts.get(agentId);
    if (!h) { h = createTmuxHost({ exec: (argv) => m.exec(agentId, argv), control: control(agentId), prefix }); tmuxHosts.set(agentId, h); }
    return h;
  }

  /** The workspace a session is in, awake, with its tmux session there (made again when the container was stopped since). */
  async function at(terminalId: string): Promise<{ agentId: string; host: TerminalHost }> {
    let w0 = where.get(terminalId);
    if (!w0) {
      const found = await m.find(nameOf(terminalId));
      if (found === null) throw wsError("there is no such session in a workspace", "not_found");
      w0 = { agentId: found, cols: 120, rows: 32, gen: m.generation(found) };
      where.set(terminalId, w0);
    }
    await m.ensure(w0.agentId);
    const gen = m.generation(w0.agentId);
    if (w0.gen !== gen) {
      // tmux died with the container: the session is made again, empty, where it was
      await m.exec(w0.agentId, ["tmux", "new-session", "-A", "-d", "-s", nameOf(terminalId), "-x", String(w0.cols), "-y", String(w0.rows), ...(w0.cwd === undefined ? [] : ["-c", w0.cwd])]);
      w0.gen = gen;
    }
    return { agentId: w0.agentId, host: tmuxFor(w0.agentId) };
  }

  return {
    async has(id) { return where.has(id) || (await m.find(nameOf(id))) !== null; },
    async open(a) {
      const agentId = a.target.agentId;
      if (agentId === undefined) throw wsError("Say which agent's workspace to open the terminal in.", "bad_input");
      await m.ensure(agentId);
      const r = await tmuxFor(agentId).open(a);
      where.set(a.terminalId, { agentId, cols: a.cols, rows: a.rows, cwd: r.cwd, gen: m.generation(agentId) });
      return { ...r, title: "Workspace" };
    },
    async input(id, data) { const t = await at(id); await t.host.input(id, data); },
    async interrupt(id) { const t = await at(id); await t.host.interrupt(id); },
    async resize(id, cols, rows) { const t = await at(id); await t.host.resize(id, cols, rows); const x = where.get(id); if (x) { x.cols = cols; x.rows = rows; } },
    async read(id, r) { const t = await at(id); return t.host.read(id, r); },
    async run(id, r) { const t = await at(id); return t.host.run(id, r); },
    async status(ids) {
      const out: Awaited<ReturnType<TerminalHost["status"]>> = [];
      for (const id of ids) {
        // a status read never wakes a sleeping workspace: asleep, its sessions are idle in the list until something uses them
        const x = where.get(id);
        const live = x ? (await m.list()).find((r) => r.agentId === x.agentId)?.state === "running" && x.gen === m.generation(x.agentId) : false;
        if (!x || !live) { out.push({ terminalId: id, state: x ? "idle" : "exited", exitCode: null }); continue; }
        out.push(...(await tmuxFor(x.agentId).status([id])));
      }
      return out;
    },
    stream(id, onFrame) {
      const x = where.get(id);
      if (!x) return () => undefined;
      const h = tmuxFor(x.agentId);
      return h.stream ? h.stream(id, onFrame) : () => undefined;
    },
    async close(id) {
      const x = where.get(id);
      if (x) { const live = (await m.list()).find((r) => r.agentId === x.agentId)?.state === "running"; if (live) await tmuxFor(x.agentId).close(id); where.delete(id); return; }
      const found = await m.find(nameOf(id));
      if (found !== null) await tmuxFor(found).close(id);
    },
    async health() {
      const h = await m.health();
      const rows = h.ok ? await m.list().catch(() => []) : [];
      return { ok: h.ok, detail: h.ok ? `${rows.filter((r) => r.state === "running").length} of ${rows.length} workspaces awake` : (h.detail ?? "The container runtime did not answer."), sessions: where.size };
    },
  };
}
