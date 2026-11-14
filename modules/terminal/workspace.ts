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
import { sha256Hex } from "../../kernel/src/log/hash.ts";
import { NOT_FETCHED_REASON, createDockerApi, fetchableImage } from "../../sandbox/src/docker.ts";
import { tarFiles } from "../../sandbox/src/tar.ts";
import type { ContainerConfig, DockerApi, DockerHttp, DockerResponse } from "../../sandbox/src/docker.ts";
import { createTmuxHost, HISTORY_ENV } from "./impl.ts";
import { ensureCommand, SQUATTED } from "./asker.ts";
import type { AskerPlace } from "./asker.ts";
import type { TmuxHost } from "./impl.ts";
import type { ExecResult } from "./impl.ts";
import type { AdoptArgs, TerminalHost } from "./projections.ts";

export const DEFAULT_WORKSPACE_IMAGE = "vyre/agent-workspace:1";
export const WORKSPACE_PREFIX = "vyre-ws-";
export const PROJECT_VOLUME_PREFIX = "vyre-wsproj-";
export const WORKSPACE_HOME = "/home/agent";
export const FILES_GUEST = "/home/agent/Vyre";
export const PROJECTS_GUEST = "/home/agent/projects";
export const WORKSPACE_UID = 10001;
export const DEFAULT_IDLE_MS = 10 * 60_000;
/**
 * Running work keeps a workspace awake for at most this long after the last command or keystroke of the agent or a person (12 Nov, lead's decision): a job left in the background (tail -f, a dev
 * server) would otherwise hold it and its room forever. Then it sleeps anyway, and the next command says so once.
 */
export const MAX_BUSY_AWAKE_MS = 12 * 60 * 60_000;
/** How often a project change waiting for a busy workspace is looked at again. */
export const MOUNT_RECHECK_MS = 5000;

export const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "ash", "tmux"]);

export const workspaceName = (agentId: string): string => `${WORKSPACE_PREFIX}${agentId}`;
export const workspaceNetworkName = (agentId: string): string => `vyre-wsnet-${sha256Hex(agentId).slice(0, 16)}`;
export const homeVolume = (agentId: string): string => `${workspaceName(agentId)}-home`;
export const filesVolume = (agentId: string): string => `${workspaceName(agentId)}-files`;
/** The homes of the people who use the agent without owning it, each a Unix user of their own (asker.ts): mounted at /people. */
export const peopleVolume = (agentId: string): string => `${workspaceName(agentId)}-people`;
export const PEOPLE_GUEST = "/people";
export const projectVolume = (projectId: string): string => `${PROJECT_VOLUME_PREFIX}${projectId}`;

/** What the disk side of the Files mirror is, as the computers module's HomeSync reads it (its HomeFs, written out: a module does not import another module). */
export interface HomeSnapshot {
  files: Map<string, { bytes: Buffer; mtimeMs: number }>;
  dirs: Set<string>;
  refused: string[];
  complete: boolean;
}
export interface HomeDisk {
  snapshot(): Promise<HomeSnapshot>;
  put(files: Array<{ rel: string; bytes: Uint8Array; readOnly: boolean }>): Promise<void>;
  remove(files: string[], dirs: string[]): Promise<void>;
}
export interface WorkspaceHome {
  /** One mirror of this agent's folder in Files onto `disk`; `pass` runs one round. The daemon makes it with the computers module's createHomeSync, as the agent principal. */
  sync(o: { agentId: string; computerId: string; fs: HomeDisk; manifest: string }): {
    pass(): Promise<{ failed: number }>;
  };
  /** The computers module's reader of the tar the archive call returns: plain files and folders only, anything else refused by name. */
  readTar(tar: Uint8Array): HomeSnapshot;
  manifest(agentId: string): string;
  /**
   * One mirror of a project's shared folder onto `fs` (the project's volume, seen from a running workspace that mounts it), with every Files call made as `agentId`, so the file's history says which agent
   * made a change. Null when the project has no folder in Files: then the volume is shared between its agents and nothing else.
   */
  syncProject?(o: {
    projectId: string;
    agentId: string;
    fs: HomeDisk;
    manifest: string;
  }): { pass(): Promise<{ failed: number }> } | null;
  projectManifest?(projectId: string): string;
  /** How often a pass runs while the workspace is awake. Default 3 s. */
  intervalMs?: number;
}

export interface WorkspaceOptions {
  /**
   * May an exec carry Vault values to this machine? A server that joined is reached over its link to the Space, and a value goes over it only when that link is private (TLS, or this machine): the
   * rule an agent computer's Vault channel follows (modules/computers/handlers/lifecycle.ts connectFill). Omitted: this machine, always.
   */
  valuesAllowed?: () => boolean;
  api: DockerApi;
  /** Raw Engine access: inspect, volumes, the list of workspaces, and waiting for the one-off volume helper. */
  http: DockerHttp;
  image?: string;
  limits?: Partial<{ cpus: number; memoryMb: number; pids: number; reserveMb: number }>;
  /**
   * Where mirrors are rooted in Files, for a Files change to bring forward only the mirrors it touches (lead, 12 Nov): the agent's folder, the project's folder, a folder's ancestors (itself first),
   * a file's folder. Null where it cannot be told. Omitted: every slowed mirror is brought forward on any change.
   */
  folders?: {
    agentRoot(agentId: string): string | null;
    projectRoot(projectId: string): string | null;
    ancestors(folderId: string): string[] | null;
    ofFile(fileId: string): string | null;
  };
  /** Does this agent have a turn running now (the engine's turns)? undefined when that cannot be read. A workspace is never put to sleep to make room while it does (lead, 12 Nov). */
  inTurn?: (agentId: string) => boolean | undefined;
  /** The longest a mirror waits between passes when nothing happens in the workspace. Default 60 s. */
  mirrorMaxMs?: number;
  /** How long after a command the project folders it may have changed are mirrored (a file must sit unchanged for a second first). Default 1200 ms. */
  projectKickMs?: number;
  /** A workspace with nothing using it for this long sleeps. Default 10 minutes. */
  idleMs?: number;
  /** The Space this manager works for: its workspaces carry it (label vyre.space), and it only ever sleeps, removes or gives back the room of those. Omitted: every workspace on the engine (tests). */
  owner?: string;
  /** Does this Space know the agent (a container made before the Space label is ours only then). */
  ownsAgent?: (agentId: string) => boolean;
  /** Running work keeps it awake at most this long after the last command or keystroke. Default MAX_BUSY_AWAKE_MS (12 hours). */
  maxBusyMs?: number;
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
  /** The line of a workspace that waits for room in the host's queue (kept in its database across restarts), or null when it does not wait. */
  waiting?(agentId: string, nodeId?: string): Promise<string | null>;
}

/** What a workspace is doing, for the Terminal tab: asleep and running are its container; waiting is a start the host had no room for; none is no container yet. */
export interface WorkspaceStatus {
  state: "running" | "asleep" | "waiting" | "none";
  line?: string;
  /** Where it is: the Space's own runtime, or a server that joined. */ host?: "space" | "server";
  nodeId?: string;
  projects?: string[];
}

export interface WorkspaceRow {
  agentId: string;
  state: "running" | "asleep";
  lastUsedAt?: number;
}

export interface WorkspaceManager {
  /** What it is doing now, without waking it or making it. */
  status(agentId: string): Promise<WorkspaceStatus>;
  /** Make the workspace if there is none, stopped, with no claim on the host's room: for the one-time move of an agent computer. Safe to repeat. */
  provision(agentId: string): Promise<{ workspaceId: string }>;
  /** Make the workspace if there is none and wake it if it sleeps; counts as use. */
  ensure(agentId: string): Promise<"created" | "woke" | "running">;
  /** Run argv in the workspace (waking it first), as the container's own user (10001): an exec never names another. */
  exec(
    agentId: string,
    argv: readonly string[],
    o?: {
      env?: Readonly<Record<string, string>>;
      quiet?: boolean;
      /** Run as this Unix user instead of the agent's own (10001): a person who uses the agent without owning it (asker.ts). */
      user?: number;
      /** The env holds Vault values: refused where they would cross a link that is not private. */ values?: boolean;
    },
  ): Promise<ExecResult>;
  /** How many times this process has started the workspace's container: a change says tmux was lost. */
  generation(agentId: string): number;
  /** Stop the container (the volumes stay). False when it was not running. */
  sleep(agentId: string): Promise<boolean>;
  /** Sleep every workspace that has been idle for `idleMs` and runs nothing but a shell. Returns who slept. */
  sweep(): Promise<string[]>;
  list(): Promise<WorkspaceRow[]>;
  /** The workspace that holds this tmux session, among the running ones (the host forgot where it was across a restart), or null. */
  find(session: string): Promise<string | null>;
  /**
   * Take the workspace away: its container, its network and the room it held. `keepVolumes` leaves its home and Files volumes (what the agent kept), for an agent moved to Trash that may come back;
   * without it they go too.
   */
  remove(agentId: string, o?: { keepVolumes?: boolean }): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  /**
   * A command is running in the workspace (a `terminal_run` from typing it to its end): until the returned function is called the workspace neither sleeps nor is made again for a project change.
   * The terminal holds it around each run, since between two reads of the screen no exec is in flight and the pane alone cannot say a command is still Vyre's.
   */
  hold(agentId: string): () => void;
  /**
   * Someone worked in the workspace (a command ran to its end, keys were typed): the project folders it mounts are the ones that may have changed, and this agent is who the next mirror of them names in
   * Files history. Reading the screen, a resize or a status check is not work and names nobody.
   */
  worked(agentId: string): void;
  /**
   * The agent left a project: its workspace stops mounting and mirroring that project now. A running workspace is made again at once without the folder, whatever runs in it; an asleep one gets it at
   * its next wake. Safe to repeat.
   */
  revoke(agentId: string): Promise<void>;
  /**
   * The part of leaving a project that must be done before the removal answers (review, in force at return): the project's mirror stops for this agent and a running workspace that mounts it is stopped
   * at once, with no grace; the next use makes it again without the folder. Until the projects list catches up, the project is left out of its mounts.
   */
  cut(agentId: string, projectId: string): Promise<void>;
  /**
   * The subnets of the networks this engine's workspaces are on (the shared one, or each workspace's own behind the runner), as last read: the daemon's guard treats a caller from them as an agent's
   * container and keeps its own routes from it (host/src/routes/site-host.ts agentCaller, through the terminal module's agentSubnets).
   */
  subnets(): string[];
  /** Read the subnets of the networks workspaces are on now (made with the manager; the daemon awaits it before it takes calls, third look T5). */
  ready(): Promise<void>;
  /** The health line while workspaces go on Docker's default network because the shared one cannot be had, or null. */
  networkNote(): string | null;
  /** The subnets of every network on this host's Docker (behind the runner: subnets only), for the count of networks it has left; null when Docker does not answer. */
  hostSubnets(): Promise<string[] | null>;
  /** Is its container running now: one look at that container only (a tab's 400 ms read asks this, so it must not list every workspace). */
  awake(agentId: string): Promise<boolean>;
  /** Before a command: one pass of the workspace's mirrors when they slowed down, at most `ms`; false when that did not finish in time. */
  freshen(agentId: string, ms?: number): Promise<boolean>;
  /** Something changed in Files (the folders and file the event names): the slowed mirrors it touches make their next pass soon. */
  filesChanged(change?: { folderIds?: readonly string[]; fileId?: string; by?: string }): void;
  /** A person's open tab read the workspace's screen: it counts as attached for a short while (making room passes it over). */
  viewed(agentId: string): void;
  /** The line a workspace put to sleep at the 12-hour ceiling owes its next command, once (then null). */
  takeNote(agentId: string): string | null;
  /** The agent came back from Trash: its workspace may be made again (over the volumes it kept). */
  restore(agentId: string): void;
  /** The line for a command that was running when the workspace was made again under it (generation `since` or before), or null. */
  restartLine(agentId: string, since: number): string | null;
  /** Stop the idle timer. */
  close(): void;
}

/**
 * Prints the id and command line (cut short) of every process in the workspace that is work: anything but its init, the `sleep infinity` that keeps it up, the tmux server, the shells of the panes, and this check itself (and
 * what it forks). So `bash build.sh`, `sh -c ...` and a job left in the background (`npm run dev &`) count, where a pane's foreground command alone reads as the shell. Plain sh and /proc, no ps.
 */
export const BUSY_SCRIPT = [
  // the tmux servers and pane shells of the people who use the agent without owning it run as their own Unix users and cannot be asked from here: the caller asked each of them and passes the pids
  "t=\" $(tmux display-message -p '#{pid}' 2>/dev/null) ${VYRE_SKIP_T:-} \"",
  "panes=\" $(tmux list-panes -a -F '#{pane_pid}' 2>/dev/null | tr '\\n' ' ') ${VYRE_SKIP_PANES:-} \"",
  "for d in /proc/[0-9]*; do",
  "  p=${d#/proc/}",
  '  [ "$p" = "$$" ] && continue; [ "$p" = 1 ] && continue; case "$t" in *" $p "*) continue;; esac',
  '  s=$(cat "$d/stat" 2>/dev/null) || continue',
  "  r=${s##*) }; set -- $r",
  '  [ "$1" = Z ] && continue',
  '  [ "$2" = 0 ] || [ "$2" = "$$" ] && continue; case "$t" in *" $2 "*) continue;; esac',
  '  case "$panes" in *" $p "*) continue;; esac',
  "  if [ \"$2\" = 1 ]; then c=$(tr '\\000' ' ' < \"$d/cmdline\" 2>/dev/null); [ \"$c\" = 'sleep infinity ' ] && continue; fi",
  "  echo \"$p $(tr '\\000' ' ' < \"$d/cmdline\" 2>/dev/null | cut -c1-80)\"",
  "done",
  "true",
].join("\n");

// ---- the container --------------------------------------------------------------------------------------------------------------------------------------

export interface MountSpec {
  projects: string[];
}

/** The label that says what a container was made with: its project folders, and the shared network when it is on it (a workspace made on the default bridge before 12 Nov is made again once, when quiet). */
const stable = (m: MountSpec, net?: string): string =>
  // `u`: the people volume (14 Nov): a workspace made before it is made again once, when quiet, so it gets /people
  sha256Hex(JSON.stringify({ p: [...m.projects].sort(), u: 1, ...(net === SHARED_NETWORK ? { n: net } : {}) })).slice(0, 16);

/**
 * Where workspaces live on an engine with no runner in front (a Personal Space with Docker Desktop, a Team server on the computers socket option): one network for all of them with traffic between
 * containers switched off, so one workspace cannot reach a port another listens on, while each still reaches the internet, and only one address pool is used (a network per workspace would run
 * Docker out of pools at about thirty). Behind the runner each workspace has a network of its own.
 */
export const SHARED_NETWORK = "vyre-workspaces";
/** A workspace network of one workspace, as made before 12 Nov (and behind the runner as a fallback since). */
const OLD_NET = /^vyre-wsnet-[a-f0-9]{16}$/;
export const SHARED_NETWORK_BODY = {
  Name: SHARED_NETWORK,
  Driver: "bridge",
  CheckDuplicate: true,
  Options: { "com.docker.network.bridge.enable_icc": "false" },
  Labels: { "vyre.workspaces": "shared" },
};

/**
 * `net`: the network it goes on. Default: each workspace's own behind the runner, else the shared one. "bridge" is Docker's default network, where every workspace was before 12 Nov: the fallback when the
 * shared network cannot be made, so a working workspace is never taken away for want of a network (its label then says bridge, and a later wake moves it).
 */
export function workspaceContainerConfig(
  agentId: string,
  image: string,
  m: MountSpec,
  o: Pick<WorkspaceOptions, "limits" | "runner" | "owner">,
  net?: string,
): ContainerConfig {
  const network = net ?? (o.runner ? workspaceNetworkName(agentId) : SHARED_NETWORK);
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
    Labels: {
      "vyre.workspace": agentId,
      "vyre.mounts": stable(m, network),
      ...(o.owner === undefined ? {} : { "vyre.space": o.owner }),
    },
    StopTimeout: 10,
    HostConfig: {
      Binds: [
        `${homeVolume(agentId)}:${WORKSPACE_HOME}:rw`,
        `${filesVolume(agentId)}:${FILES_GUEST}:rw`,
        `${peopleVolume(agentId)}:${PEOPLE_GUEST}:rw`,
        ...[...m.projects].sort().map((p) => `${projectVolume(p)}:${PROJECTS_GUEST}/${p}:rw`),
      ],
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=512m,uid=${WORKSPACE_UID},gid=${WORKSPACE_UID},mode=1777` },
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      NetworkMode: network,
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
      Ulimits: [
        { Name: "nofile", Soft: 8192, Hard: 16384 },
        { Name: "core", Soft: 0, Hard: 0 },
      ],
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
  if (c.Hostname !== workspaceName(agentId) || c.Labels["vyre.workspace"] !== agentId)
    bad.push("is not this agent's workspace");
  const SYSTEM = new Set([
    "/",
    "/etc",
    "/var",
    "/usr",
    "/root",
    "/home",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/lib",
    "/bin",
    "/sbin",
    "/run",
  ]);
  for (const b of h.Binds) {
    const m = /^([^:]+):(\/[^:]*):(ro|rw)$/.exec(b);
    if (!m) {
      bad.push(`bind ${b} is not source:guest:mode`);
      continue;
    }
    const src = m[1] as string;
    const guest = m[2] as string;
    if (/docker\.sock|containerd\.sock|\.sock$/.test(src)) bad.push("docker socket");
    if (SYSTEM.has(src.replace(/\/+$/, "") || "/")) bad.push("a system folder is bound");
    if (src.startsWith("/")) bad.push(`a host folder is bound at ${guest}`);
    else if (
      ![homeVolume(agentId), filesVolume(agentId), peopleVolume(agentId)].includes(src) &&
      !(src.startsWith(PROJECT_VOLUME_PREFIX) && PROJECT_ID.test(src.slice(PROJECT_VOLUME_PREFIX.length)))
    )
      bad.push(`volume ${src} is not this workspace's`);
    if (!(guest === WORKSPACE_HOME || guest === FILES_GUEST || guest === PEOPLE_GUEST || guest.startsWith(`${PROJECTS_GUEST}/`)))
      bad.push(`binds into ${guest}`);
  }
  if (Object.keys(h.Tmpfs).some((k) => k !== "/tmp")) bad.push("a tmpfs other than /tmp");
  return bad;
}

// ---- the manager ----------------------------------------------------------------------------------------------------------------------------------------

const dec = new TextDecoder();
const bodyText = (b: Uint8Array): string => {
  const s = dec.decode(b);
  try {
    const m = (JSON.parse(s) as { message?: string }).message;
    return String(m ?? s).slice(0, 200);
  } catch {
    return s.slice(0, 200);
  }
};
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** A refusal written for a person: the first line is plain words, anything after it (Details: ...) is for Copy details. The terminal says the first line as the reason a session did not open. */
export const NOT_PRIVATE =
  "This workspace is on a server whose link to the Space is not private (no TLS), so no Vault value is sent to it. Connect the server over https, or run the command without the value.";
/** What a workspace session runs: a bash with a private umask (files the agent makes outside its own folder, in /tmp, are not readable by the other people of the computer). */
export const SESSION_SHELL: readonly string[] = ["sh", "-c", "umask 077; exec bash"];

const wsError = (message: string, code = "unavailable"): Error =>
  Object.assign(new Error(message), { code, workspace: true });

export const IMAGE_MISSING_LINE = "This server can't start agent workspaces yet.";
/** A command run before the workspace's copy of Files caught up (it took longer than a few seconds): its first line. */
export const FILES_LATE_LINE =
  "Files changed in the last few seconds may not be in the workspace yet: copying them from Files is taking longer than usual.";

/** A workspace that cannot get a network because Docker's address pools are used up (fourth look U3): it starts by itself on a later command once there is room. */
export const NO_ROOM_FOR_WORKSPACE_NETWORK =
  "This server has no room for another network for this workspace right now. Remove sites or networks you no longer use, or ask for help to make room; the workspace starts on the next command once there is room.";

/** What an agent's next command says after its workspace was put to sleep to make room for another (lead, 12 Nov). */
export const SLEPT_FOR_ROOM_LINE =
  "Your workspace was asleep and has been started again. Programs that were running are gone; your files are as you left them.";

/** What a deleted agent's commands answer (the daemon's admit check says the same, host/src/daemon/daemon.ts). */
export const AGENT_GONE_LINE = "That agent is in Trash, so it has no workspace. Restore it to use its terminal again.";
/** What a command cut off by a project removal answers. */
export const REMOVED_LINE =
  "The agent was removed from a project, so its workspace restarted without that project's folder. What was running in it stopped.";

/**
 * What a workspace waiting for room says. The host's line names the host; its advice to add a compute server is not true for a workspace (12 Nov, audit item 9): a workspace stays on the machine it
 * was made on, and the Space's own runtime always wins over a server, so a new server takes none of them. What is true: the waiting workspace starts by itself once room opens.
 */
export const WAIT_TAIL = "The workspace starts by itself when there is room.";
export function workspaceWaitLine(hostLine: string | undefined): string {
  const first = /^Waiting for room on [^.]+\./.exec(hostLine ?? "")?.[0] ?? "Waiting for room on the Space server.";
  return `${first} ${WAIT_TAIL}`;
}

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
  type Paced = {
    timer: ReturnType<typeof setTimeout> | null;
    delay: number;
    stopped: boolean;
    tick?: () => void;
    poked?: boolean;
    dirty?: boolean;
  };
  const homes = new Map<string, { sync: { pass(): Promise<{ failed: number }> } } & Paced>();
  // the projects each awake workspace mounts, who last worked in each project, and its mirror
  const agentProjects = new Map<string, string[]>();
  const projectActor = new Map<string, string>();
  const projects = new Map<
    string,
    {
      sync: { pass(): Promise<{ failed: number }> } | null;
      kick: ReturnType<typeof setTimeout> | null;
      holder: string | null;
    } & Paced
  >();
  let imageKnown = false;
  let discovered = false;
  /** The subnets of the workspaces' networks (subnets()), read when one is made and at every sweep. */
  let nets: string[] = [];
  /** Behind the runner the networks are read one by one, by the names this manager made (the runner lets a workspace network be read by name, not listed). */
  const madeNets = new Set<string>();
  async function readSubnets(): Promise<void> {
    type Net = { IPAM?: { Config?: Array<{ Subnet?: string }> } };
    let list: Net[] = [];
    // what the running workspaces are on (third look T5): behind the runner, the old networks of one workspace are read by name; a workspace on Docker's default bridge (the fallback, or one made
    // before 12 Nov and not moved yet) puts the bridge's subnet on the list, so the daemon's guard refuses it too
    let onBridge = false;
    try {
      const r = await http({
        method: "GET",
        path: "/containers/json",
        query: { all: "false", filters: JSON.stringify({ label: ["vyre.workspace"] }) },
      });
      if (r.status === 200) {
        for (const x of JSON.parse(dec.decode(r.body)) as Array<{
          Labels?: Record<string, string>;
          HostConfig?: { NetworkMode?: string };
        }>) {
          const id = x.Labels?.["vyre.workspace"] ?? "";
          if (!AGENT_ID.test(id) || !mine(x.Labels, id)) continue;
          const mode = x.HostConfig?.NetworkMode ?? "";
          if (o.runner && OLD_NET.test(mode)) madeNets.add(mode);
          if (mode === "bridge" || mode === "default") onBridge = true;
        }
      }
    } catch {
      /* read again at the next sweep */
    }
    if (onBridge && !o.runner) {
      const r = await http({ method: "GET", path: "/networks/bridge" }).catch(() => null);
      if (r?.status === 200) list.push(JSON.parse(dec.decode(r.body)) as Net);
    }
    if (o.runner) {
      for (const name of [SHARED_NETWORK, ...madeNets]) {
        const r = await http({ method: "GET", path: `/networks/${name}` }).catch(() => null);
        if (r?.status === 200) list.push(JSON.parse(dec.decode(r.body)) as Net);
        else if (r?.status === 404) madeNets.delete(name);
      }
    } else {
      const r = await http({
        method: "GET",
        path: "/networks",
        query: { filters: JSON.stringify({ label: ["vyre.workspaces"] }) },
      }).catch(() => null);
      if (!r || r.status !== 200) return;
      list.push(...(JSON.parse(dec.decode(r.body)) as Net[]));
    }
    nets = [
      ...new Set(
        list
          .flatMap((n) => (n.IPAM?.Config ?? []).map((c) => c.Subnet ?? ""))
          .filter((x) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(x)),
      ),
    ];
  }
  /** Workspaces this process started that hold room on the host: one whose container stopped without Vyre (out of memory, docker stop, a crash) gives its room back at the next sweep. */
  const claimed = new Set<string>();
  /** Runs in flight per workspace (hold). */
  const holds = new Map<string, number>();
  /** A project change waiting for the workspace to be quiet: when it was last looked at, so a busy workspace is not asked on every exec. */
  const pendingMounts = new Map<string, number>();
  /** When each workspace was last given room to start: for a minute, until its first command, it is not put to sleep to make room for another. */
  const wokenAt = new Map<string, number>();
  const JUST_WOKEN_MS = 60_000;
  /** When a person's open tab last read each workspace's screen: attached while that is recent. */
  const viewedAt = new Map<string, number>();
  /**
   * Making room never takes a workspace whose agent has a turn running, one a person has a tab attached to (read in the last 15 s), or one running a command. One whose agent has no turn running
   * may be taken 10 s after its last command or keystroke; only when the turn cannot be read is the wait 90 s, the guess at an agent between two commands of one task (lead, 12 Nov, as for the
   * Space browser).
   */
  const ROOM_GRACE_MS = 10_000;
  const ROOM_GRACE_UNKNOWN_MS = 90_000;
  const ATTACHED_MS = 15_000;
  /** Workspaces a newcomer is putting to sleep for room right now: other newcomers pass them over. */
  const forRoom = new Set<string>();
  /** The last command or keystroke in each workspace (a run, typed keys, any exec that counts as use): what the 12-hour ceiling counts from. */
  const lastTouch = new Map<string, number>();
  /** What keeps each workspace awake, for its status line. */
  const busyNote = new Map<string, string>();
  /** A workspace put to sleep at the ceiling: the line its next command says, once. */
  const sleptNote = new Map<string, string>();
  /** Agents removed in this process (in Trash): nothing makes, wakes or runs anything in a workspace for them until they are restored. */
  const gone = new Set<string>();
  /** Why the workspace was last made again while it ran (a project removal), and the start it made: a command it cut off says this line. */
  const restarts = new Map<string, { gen: number; line: string }>();

  /** One at a time per workspace: two first commands in the same moment make it once. */
  function serial<T>(agentId: string, f: () => Promise<T>): Promise<T> {
    const prev = chain.get(agentId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(f);
    chain.set(agentId, next);
    void next
      .finally(() => {
        if (chain.get(agentId) === next) chain.delete(agentId);
      })
      .catch(() => undefined);
    return next;
  }

  async function inspect(
    name: string,
  ): Promise<{ running: boolean; labels: Record<string, string>; projects: string[]; network: string } | null> {
    const r = await http({ method: "GET", path: `/containers/${name}/json` });
    if (r.status === 404) return null;
    if (r.status !== 200) throw wsError(`Docker did not answer for the workspace (${r.status}: ${bodyText(r.body)}).`);
    const j = JSON.parse(dec.decode(r.body)) as {
      State?: { Running?: boolean };
      Config?: { Labels?: Record<string, string> };
      HostConfig?: { Binds?: string[]; NetworkMode?: string };
    };
    // the project folders it was made with, from its binds: what it mounts until a change is applied
    const projects = (j.HostConfig?.Binds ?? [])
      .flatMap((b) => {
        const src = b.split(":")[0] ?? "";
        return src.startsWith(PROJECT_VOLUME_PREFIX) ? [src.slice(PROJECT_VOLUME_PREFIX.length)] : [];
      })
      .filter((p) => PROJECT_ID.test(p))
      .sort();
    return {
      running: j.State?.Running === true,
      labels: j.Config?.Labels ?? {},
      projects,
      network: j.HostConfig?.NetworkMode ?? "",
    };
  }

  async function ensureImage(): Promise<void> {
    if (imageKnown) return;
    if (!(await api.imageExists(image))) {
      const byDigest = image.includes("@");
      const [repo, tag] = byDigest
        ? [image, ""]
        : [image.slice(0, image.lastIndexOf(":")), image.slice(image.lastIndexOf(":") + 1)];
      let why = "";
      let pulled = false;
      // a local name (vyre/...) is never asked of a registry: Docker would look on Docker Hub, which is not Vyre's (sandbox/src/docker.ts fetchableImage)
      if (!fetchableImage(image))
        throw wsError(
          `${IMAGE_MISSING_LINE}\nDetails: the workspace image ${image} is not on this server; ${NOT_FETCHED_REASON}.`,
          "image_missing",
        );
      try {
        const r = await http({
          method: "POST",
          path: "/images/create",
          query: byDigest ? { fromImage: repo } : { fromImage: repo, tag },
          timeoutMs: 15 * 60_000,
        });
        pulled = r.status === 200 && !/"error"/.test(dec.decode(r.body));
        if (!pulled) why = bodyText(r.body);
      } catch (e) {
        why = e instanceof Error ? e.message.slice(0, 160) : "no answer";
      }
      if (!pulled || !(await api.imageExists(image)))
        throw wsError(
          `${IMAGE_MISSING_LINE}\nDetails: the workspace image ${image} is not on this server${why ? ` and could not be fetched (${why.slice(0, 80)})` : ""}. Load it with: docker pull ${image}`,
          "image_missing",
        );
    }
    imageKnown = true;
  }

  /** A shared project folder is a new volume the container's user cannot write to (Docker makes the root of a volume root's); a one-off helper with the one capability that needs, CHOWN, gives it to the agent user. */
  async function ensureProjectVolume(projectId: string): Promise<void> {
    const vol = projectVolume(projectId);
    const have = await http({ method: "GET", path: `/volumes/${vol}` });
    if (have.status === 200) return;
    if (have.status !== 404)
      throw wsError(`Docker did not answer for the project folder (${have.status}: ${bodyText(have.body)}).`);
    const made = await http({
      method: "POST",
      path: "/volumes/create",
      json: { Name: vol, Labels: { "vyre.workspace.project": projectId } },
    });
    if (made.status !== 201 && made.status !== 200)
      throw wsError(`The project folder was not made (${made.status}: ${bodyText(made.body)}).`);
    const helper = `vyre-wsinit-${projectId}`;
    await http({ method: "DELETE", path: `/containers/${helper}`, query: { force: "true" } }).catch(() => undefined);
    const c = await http({
      method: "POST",
      path: "/containers/create",
      query: { name: helper },
      json: projectInitBody(projectId, image),
    });
    if (c.status !== 201) throw wsError(`The project folder could not be set up (${c.status}: ${bodyText(c.body)}).`);
    try {
      const s = await http({ method: "POST", path: `/containers/${helper}/start` });
      if (s.status !== 204 && s.status !== 304)
        throw wsError(`The project folder could not be set up (${s.status}: ${bodyText(s.body)}).`);
      const w = await http({ method: "POST", path: `/containers/${helper}/wait`, timeoutMs: 60_000 });
      const code = (JSON.parse(dec.decode(w.body) || "{}") as { StatusCode?: number }).StatusCode;
      if (w.status !== 200 || code !== 0)
        throw wsError(`The project folder could not be set up (exit ${code ?? "unknown"}).`);
    } finally {
      await http({ method: "DELETE", path: `/containers/${helper}`, query: { force: "true" } }).catch(() => undefined);
    }
  }

  /**
   * The shared network, made once per engine, or found and checked: Vyre's label and traffic between containers off. A network of that name that is not ours, or lets containers reach each other, is
   * never used (isolation would fail without a word). False when it cannot be had now (Docker's address pools used up, a limited engine): the caller keeps the default bridge and logs it.
   */
  let sharedReady = false;
  /** When the shared network last could not be had, and Docker's reason: one try and one log line a minute while it cannot (third look T3); the health line says so. */
  let sharedFailedAt = -Infinity;
  let sharedFailure: string | null = null;
  const SHARED_RETRY_MS = 60_000;
  async function sharedNetwork(): Promise<boolean> {
    if (sharedReady) return true;
    if (now() - sharedFailedAt < SHARED_RETRY_MS) return false;
    const ok = await trySharedNetwork();
    if (ok) {
      sharedFailure = null;
      sharedFailedAt = -Infinity;
    } else sharedFailedAt = now();
    return ok;
  }
  async function trySharedNetwork(): Promise<boolean> {
    const create = async (): Promise<DockerResponse | null> => {
      try {
        return await http({ method: "POST", path: "/networks/create", json: SHARED_NETWORK_BODY });
      } catch {
        return null;
      }
    };
    let made = await create();
    // a host whose address pools are full of the old per-workspace networks: a pool is freed by removing the old network of a workspace that is not running (it moves to the shared one at its
    // next wake), then the shared one is made; a few tries, never a running workspace's
    for (
      let tries = 0;
      tries < 3 &&
      made !== null &&
      made.status !== 201 &&
      made.status !== 409 &&
      /address pools|subnetted|no available network/i.test(bodyText(made.body));
      tries++
    ) {
      if (!(await freeOldNetwork())) break;
      made = await create();
    }
    if (made?.status === 201) {
      sharedReady = true;
      await readSubnets();
      return true;
    }
    if (made?.status === 409) {
      const r = await http({ method: "GET", path: `/networks/${SHARED_NETWORK}` }).catch(() => null);
      const j =
        r?.status === 200
          ? (JSON.parse(dec.decode(r.body)) as { Labels?: Record<string, string>; Options?: Record<string, string> })
          : null;
      if (
        j &&
        j.Labels?.["vyre.workspaces"] === "shared" &&
        j.Options?.["com.docker.network.bridge.enable_icc"] === "false"
      ) {
        sharedReady = true;
        await readSubnets();
        return true;
      }
      log("warn", "workspace.network_not_ours", { network: SHARED_NETWORK });
      sharedFailure = "a network with its name is there that is not Vyre's, or lets containers reach each other";
      return false;
    }
    log("warn", "workspace.network_fallback", {
      network: SHARED_NETWORK,
      status: made?.status ?? 0,
      detail: made ? bodyText(made.body) : "no answer",
    });
    sharedFailure = made
      ? bodyText(made.body).slice(0, 200) || `Docker answered ${made.status}`
      : "Docker did not answer";
    return false;
  }
  /** Remove one old per-workspace network of a workspace that is not running (or of none), to free an address pool. True when one went. */
  async function freeOldNetwork(): Promise<boolean> {
    let rows: Array<{ State?: string; Labels?: Record<string, string>; HostConfig?: { NetworkMode?: string } }> = [];
    try {
      const r = await http({
        method: "GET",
        path: "/containers/json",
        query: { all: "true", filters: JSON.stringify({ label: ["vyre.workspace"] }) },
      });
      if (r.status === 200) rows = JSON.parse(dec.decode(r.body));
    } catch {
      rows = [];
    }
    const busy = new Set(rows.filter((x) => x.State === "running").map((x) => x.HostConfig?.NetworkMode ?? ""));
    const candidates = rows
      .filter(
        (x) =>
          x.State !== "running" &&
          OLD_NET.test(x.HostConfig?.NetworkMode ?? "") &&
          !busy.has(x.HostConfig?.NetworkMode ?? "") &&
          mine(x.Labels, x.Labels?.["vyre.workspace"] ?? ""),
      )
      .map((x) => x.HostConfig!.NetworkMode!);
    for (const net of candidates) {
      const r = await http({ method: "DELETE", path: `/networks/${net}` }).catch(() => null);
      if (r && (r.status === 204 || r.status === 200)) {
        madeNets.delete(net);
        log("info", "workspace.old_network_removed", { network: net, why: "pools" });
        return true;
      }
    }
    return false;
  }
  /**
   * The network a workspace is made on now: the shared one, with or without the runner (12 Nov: a network each ran Docker out of address pools at about 30). While it cannot be had: behind the runner
   * the workspace's own network as before, else the default bridge, so a working workspace is never taken away for want of a network (review S1).
   */
  async function networkFor(agentId: string): Promise<string> {
    if (await sharedNetwork()) return SHARED_NETWORK;
    // a workspace already on the shared network stays there while the network is there (a failed try is often a moment's, as a timeout): it is never moved back (third look T3)
    const cur = await inspect(workspaceName(agentId)).catch(() => null);
    if (cur?.network === SHARED_NETWORK) {
      const r = await http({ method: "GET", path: `/networks/${SHARED_NETWORK}` }).catch(() => null);
      if (r === null || r.status !== 404) return SHARED_NETWORK;
    }
    return o.runner ? workspaceNetworkName(agentId) : "bridge";
  }

  async function makeNetwork(agentId: string, net: string): Promise<void> {
    // the shared network was made or checked by networkFor before the config was chosen; on the default bridge there is nothing to make; behind the runner, the fallback is the workspace's own
    if (!o.runner || net !== workspaceNetworkName(agentId)) return;
    const name = workspaceNetworkName(agentId);
    const r = await http({
      method: "POST",
      path: "/networks/create",
      json: { Name: name, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": agentId } },
    });
    if (r.status !== 201 && r.status !== 409 && /address pools|subnetted|no available network/i.test(bodyText(r.body)))
      throw wsError(`${NO_ROOM_FOR_WORKSPACE_NETWORK} (${bodyText(r.body)})`, "unavailable");
    if (r.status !== 201 && r.status !== 409)
      throw wsError(`The workspace's network was not made (${r.status}: ${bodyText(r.body)}).`);
    madeNets.add(name);
    await readSubnets();
  }

  /** Projects an agent was cut from (cut) that the projects list may still name for a moment. */
  const excluded = new Map<string, Set<string>>();
  async function mounts(agentId: string): Promise<MountSpec> {
    const listed = [...new Set((await o.projectsOf?.(agentId)) ?? [])];
    const out = excluded.get(agentId);
    // once the list no longer names a cut project, the cut is done with
    if (out) {
      for (const p of [...out]) if (!listed.includes(p)) out.delete(p);
      if (out.size === 0) excluded.delete(agentId);
    }
    const projects = listed.filter((p) => PROJECT_ID.test(p) && !(out?.has(p) ?? false)).sort();
    return { projects };
  }

  // ---- the Files mirror: ~/Vyre against the agent's folder in Files, read and written through the Engine's archive calls (a link in the folder can only point at something in the container) ----
  const GUEST = FILES_GUEST;
  function diskOf(agentId: string): HomeDisk {
    const name = workspaceName(agentId);
    const home = o.home as WorkspaceHome;
    return {
      async snapshot() {
        const r = await http({
          method: "GET",
          path: `/containers/${name}/archive`,
          query: { path: `${GUEST}/.` },
          timeoutMs: 120_000,
        });
        if (r.status === 404) return { files: new Map(), dirs: new Set(), refused: [], complete: true };
        if (r.status !== 200) throw new Error(`the Files folder could not be read (${r.status})`);
        if (r.body.length > 256 * 1024 * 1024)
          return { files: new Map(), dirs: new Set(), refused: [], complete: false };
        return home.readTar(r.body);
      },
      async put(files) {
        if (files.length === 0) return;
        const at = Math.floor(now() / 1000);
        const tar = tarFiles(
          files.map((f) => ({
            path: f.rel,
            data: f.bytes,
            mode: f.readOnly ? 0o444 : 0o644,
            uid: f.readOnly ? 0 : WORKSPACE_UID,
            gid: f.readOnly ? 0 : WORKSPACE_UID,
            mtime: at,
          })),
        );
        const r = await http({
          method: "PUT",
          path: `/containers/${name}/archive`,
          query: { path: GUEST },
          body: tar,
          contentType: "application/x-tar",
          timeoutMs: 120_000,
        });
        if (r.status !== 200) throw new Error(`the Files folder could not be written (${r.status})`);
      },
      async remove(files, dirs) {
        if (files.length === 0 && dirs.length === 0) return;
        // a removal is an exec as the agent's own user inside the running container: rm and rmdir on named paths, nothing else
        const script =
          'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';
        const r = await execIn(
          agentId,
          ["sh", "-c", script, "sh", ...files.map((f) => `${GUEST}/${f}`), "::", ...dirs.map((d) => `${GUEST}/${d}`)],
          undefined,
        );
        if (r.code !== 0) throw new Error(`the Files folder could not be tidied (${r.stderr.slice(0, 100)})`);
      },
    };
  }
  function homeOf(agentId: string): ({ sync: { pass(): Promise<{ failed: number }> } } & Paced) | null {
    if (!o.home) return null;
    let h = homes.get(agentId);
    if (!h) {
      h = {
        sync: o.home.sync({
          agentId,
          computerId: `ws_${agentId}`,
          fs: diskOf(agentId),
          manifest: o.home.manifest(agentId),
        }),
        timer: null,
        delay: 0,
        stopped: false,
      };
      homes.set(agentId, h);
    }
    return h;
  }
  /** One round of the mirror; true when it finished with nothing left undone (or there is no mirror), so a caller about to stop the container knows nothing was lost. */
  /** Passes in flight, shared: a pass asked for while one runs waits for that one (a run's freshen, the paced timer and a wake never run two at once on one mirror). When each mirror last finished one. */
  const inflight = new Map<string, Promise<boolean>>();
  const lastPass = new Map<string, number>();
  /** Each agent's latest write through Files (from the Files events' `by`), and the agents whose first command in this process has freshened. */
  const lastWrites = new Map<string, number>();
  const freshenedOnce = new Set<string>();
  /** When each mirror's latest pass started: a Files write after it is not in the workspace yet. */
  const passStarted = new Map<string, number>();
  function shared(key: string, f: () => Promise<boolean>): Promise<boolean> {
    const have = inflight.get(key);
    if (have) return have;
    passStarted.set(key, now());
    const p = f().finally(() => {
      inflight.delete(key);
      lastPass.set(key, now());
    });
    inflight.set(key, p);
    return p;
  }
  function homePass(agentId: string): Promise<boolean> {
    const h = homeOf(agentId);
    if (!h) return Promise.resolve(true);
    return shared(`h:${agentId}`, async () => {
      try {
        return (await h.sync.pass()).failed === 0;
      } catch (e) {
        log("warn", "workspace.home_pass_failed", {
          agent: agentId,
          error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
        });
        return false;
      }
    });
  }
  /**
   * Before a command in a workspace whose mirrors slowed down (fourth look U2): one pass of its Files mirror and of its projects' mirrors, so a file a person just dropped is there when the command
   * runs. Only when the last pass is older than the quick pace; at most `ms`. False when it did not finish in time (the command then says so in its first line).
   */
  async function freshen(agentId: string, ms = 4000): Promise<boolean> {
    if (!homes.has(agentId) && !(agentProjects.get(agentId) ?? []).length) return true;
    // a slowed mirror always (its last pass may be a minute old), else one whose last pass is older than the quick pace
    const slowed = (x: Paced | undefined): boolean => x !== undefined && x.delay > mirrorBase();
    // not on age alone: at the quick pace a command would wait for a pass on every command (fifth look V3); a mirror at the quick pace is caught up within its next pass anyway
    const stale = (key: string): boolean => {
      const x = key.startsWith("h:") ? homes.get(key.slice(2)) : projects.get(key.slice(2));
      return slowed(x) || (x?.dirty ?? false);
    };
    // the agent's own last Files write (kept from the Files events, eighth look Y2: no table scan per command): one made after the latest pass started is copied in first. Its first command
    // after this process started freshens once, since a write just before the restart was not seen
    const wrote = lastWrites.get(agentId) ?? null;
    const first = !freshenedOnce.has(agentId);
    freshenedOnce.add(agentId);
    if (homes.has(agentId) && (first || (wrote !== null && wrote >= (passStarted.get(`h:${agentId}`) ?? 0)))) {
      const h = homes.get(agentId);
      if (h) h.dirty = true;
    }
    // a pass already running may have read Files before the drop: it is waited for, then a new one runs
    const after = async (key: string, f: () => Promise<boolean>): Promise<boolean> => {
      const have = inflight.get(key);
      if (have) await have.catch(() => false);
      return f();
    };
    const work: Array<Promise<boolean>> = [];
    if (homes.has(agentId) && (stale(`h:${agentId}`) || inflight.has(`h:${agentId}`)))
      work.push(after(`h:${agentId}`, () => homePass(agentId)));
    for (const pid of agentProjects.get(agentId) ?? [])
      if (stale(`p:${pid}`) || inflight.has(`p:${pid}`)) work.push(after(`p:${pid}`, () => projectPass(pid)));
    if (work.length === 0) return true;
    for (const pid of [agentId]) {
      const h = homes.get(pid);
      if (h) h.dirty = false;
    }
    for (const pid of agentProjects.get(agentId) ?? []) {
      const p = projects.get(pid);
      if (p) p.dirty = false;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([Promise.all(work).then(() => true), late]);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Something changed in Files: the slowed mirrors whose root is the changed folder or one of its ancestors make their next pass soon (once, at the quick pace), so a dropped file arrives within
   * seconds with no command, and a busy Files area elsewhere costs the quiet workspaces nothing. When the change cannot be placed (no resolver, a folder or file not found), every slowed mirror is
   * brought forward, so a drop is never missed.
   */
  const rootOf = new Map<string, string | null>();
  function filesChanged(change: { folderIds?: readonly string[]; fileId?: string; by?: string } = {}): void {
    if (change.by !== undefined && /^agt_/.test(change.by)) lastWrites.set(change.by, now());
    const f = o.folders;
    // every mirror the change touches is marked (its next command waits for one pass); the slowed ones among them also make that pass soon
    const slowedHomes = [...homes];
    const slowedProjects = [...projects];
    if (slowedHomes.length === 0 && slowedProjects.length === 0) return;
    let touched: Set<string> | null = null;
    if (f) {
      const folders = [...(change.folderIds ?? [])];
      if (change.fileId) {
        const at = f.ofFile(change.fileId);
        if (at) folders.push(at);
      }
      const chains = folders.map((id) => f.ancestors(id));
      if (folders.length > 0 && chains.every((c) => c !== null)) touched = new Set(chains.flat() as string[]);
    }
    const root = (key: string, look: () => string | null): string | null => {
      if (!rootOf.has(key)) rootOf.set(key, look());
      return rootOf.get(key) ?? null;
    };
    for (const [agentId, h] of slowedHomes) {
      const r = f ? root(`h:${agentId}`, () => f.agentRoot(agentId)) : null;
      if (touched === null || r === null || touched.has(r)) {
        h.dirty = true;
        poke(h, mirrorBase());
      }
    }
    for (const [projectId, p] of slowedProjects) {
      const r = f ? root(`p:${projectId}`, () => f.projectRoot(projectId)) : null;
      if (touched === null || r === null || touched.has(r)) {
        p.dirty = true;
        poke(p, mirrorBase());
      }
    }
  }
  /** Before a workspace stops: the project folders it mounts, mirrored once more, when it is the last running workspace on them (while another runs, that one keeps mirroring). */
  async function finalProjectPasses(agentId: string): Promise<boolean> {
    let ok = true;
    for (const projectId of agentProjects.get(agentId) ?? []) {
      let other = false;
      for (const [a, ps] of agentProjects)
        if (
          a !== agentId &&
          ps.includes(projectId) &&
          (await api.containerRunning(workspaceName(a)).catch(() => false))
        )
          other = true;
      if (!other && !(await projectPass(projectId))) ok = false;
    }
    stopProjects(agentId);
    return ok;
  }
  /**
   * A mirror's passes, paced (12 Nov: forty awake workspaces must cost next to nothing while nothing happens): every `base` while someone worked in the last minute, then twice as long after each pass,
   * up to MIRROR_MAX_MS; a command or a keystroke brings it back to `base` at once (nudge).
   */
  const MIRROR_MAX_MS = o.mirrorMaxMs ?? 60_000;
  const ACTIVE_MS = 60_000;
  function pace(x: Paced, base: number, activeAt: () => number, pass: () => Promise<unknown>): void {
    x.stopped = false;
    x.delay = base;
    const tick = (): void => {
      x.timer = null;
      x.dirty = false; // this pass reads Files as it is now: what a change marked is caught up by it
      void pass()
        .catch(() => undefined)
        .finally(() => {
          if (x.stopped || x.timer) return;
          x.delay = now() - activeAt() < ACTIVE_MS ? base : Math.min(MIRROR_MAX_MS, Math.max(base, x.delay * 2));
          x.timer = setTimeout(tick, x.delay);
          x.timer.unref?.();
        });
    };
    x.tick = tick;
    x.timer = setTimeout(tick, base);
    x.timer.unref?.();
  }
  /** Back to `base` now: someone works in it again. */
  function nudge(x: Paced | undefined, base: number): void {
    if (!x || x.stopped || !x.timer || !x.tick || x.delay <= base) return;
    // it had slowed: its last pass may be a minute old, so the command that woke it up waits for one (U2); later commands at the quick pace do not (V3)
    x.dirty = true;
    clearTimeout(x.timer);
    x.delay = base;
    x.timer = setTimeout(x.tick, base);
    x.timer.unref?.();
  }
  /** The next pass soon, at the quick pace, without changing how slow the mirror is (a burst of Files events costs one pass per mirror, not one per event). */
  function poke(x: Paced | undefined, base: number): void {
    if (!x || x.stopped || !x.timer || !x.tick || x.delay <= base || x.poked) return;
    clearTimeout(x.timer);
    x.poked = true;
    x.timer = setTimeout(() => {
      x.poked = false;
      x.tick?.();
    }, base);
    x.timer.unref?.();
  }
  const mirrorBase = (): number => o.home?.intervalMs ?? 3000;
  function startHome(agentId: string): void {
    const h = homeOf(agentId);
    if (!h || h.timer) return;
    pace(
      h,
      mirrorBase(),
      () => lastTouch.get(agentId) ?? 0,
      async () => {
        if (await api.containerRunning(workspaceName(agentId)).catch(() => false)) await homePass(agentId);
      },
    );
  }
  function stopHome(agentId: string): void {
    const h = homes.get(agentId);
    if (h) {
      h.stopped = true;
      if (h.timer) {
        clearTimeout(h.timer);
        h.timer = null;
      }
    }
  }

  // ---- the project folders: a volume the agents on a project share, mirrored with the project's folder in Files, with history that says which agent changed what ----
  // The disk is read through any running workspace that mounts it. A pass runs as the agent that last worked in the project (every command an agent runs makes it the one, and a pass follows a second
  // later), so a change on the disk is put in the file's history as that agent's, and Files' own versions give "who changed what" and undo.
  const PROJECT_GUEST = (p: string): string => `${PROJECTS_GUEST}/${p}`;
  const runningMounter = async (projectId: string): Promise<string | null> => {
    for (const [agent, ps] of agentProjects)
      if (ps.includes(projectId) && (await api.containerRunning(workspaceName(agent)).catch(() => false))) return agent;
    return null;
  };
  function projectDisk(projectId: string, via: string): HomeDisk {
    const name = workspaceName(via);
    const home = o.home as WorkspaceHome;
    const dir = PROJECT_GUEST(projectId);
    return {
      async snapshot() {
        const r = await http({
          method: "GET",
          path: `/containers/${name}/archive`,
          query: { path: `${dir}/.` },
          timeoutMs: 120_000,
        });
        if (r.status === 404) return { files: new Map(), dirs: new Set(), refused: [], complete: true };
        if (r.status !== 200) throw new Error(`the project folder could not be read (${r.status})`);
        if (r.body.length > 256 * 1024 * 1024)
          return { files: new Map(), dirs: new Set(), refused: [], complete: false };
        return home.readTar(r.body);
      },
      async put(files) {
        if (files.length === 0) return;
        const at = Math.floor(now() / 1000);
        const tar = tarFiles(
          files.map((f) => ({
            path: f.rel,
            data: f.bytes,
            mode: 0o644,
            uid: WORKSPACE_UID,
            gid: WORKSPACE_UID,
            mtime: at,
          })),
        );
        const r = await http({
          method: "PUT",
          path: `/containers/${name}/archive`,
          query: { path: dir },
          body: tar,
          contentType: "application/x-tar",
          timeoutMs: 120_000,
        });
        if (r.status !== 200) throw new Error(`the project folder could not be written (${r.status})`);
      },
      async remove(files, dirs) {
        if (files.length === 0 && dirs.length === 0) return;
        const script =
          'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';
        const r = await execIn(
          via,
          ["sh", "-c", script, "sh", ...files.map((f) => `${dir}/${f}`), "::", ...dirs.map((d) => `${dir}/${d}`)],
          undefined,
        );
        if (r.code !== 0) throw new Error(`the project folder could not be tidied (${r.stderr.slice(0, 100)})`);
      },
    };
  }
  /** One round of a project's mirror, as the agent that last worked in it, through a workspace that is running and mounts it. True when nothing was left undone, or there is nothing to do. */
  function projectPass(projectId: string): Promise<boolean> {
    return shared(`p:${projectId}`, () => projectPassNow(projectId));
  }
  async function projectPassNow(projectId: string): Promise<boolean> {
    if (!o.home?.syncProject) return true;
    const via = await runningMounter(projectId);
    if (via === null) return true;
    const as = projectActor.get(projectId) ?? via;
    const p = projects.get(projectId) ?? { sync: null, timer: null, kick: null, holder: null, delay: 0, stopped: true };
    projects.set(projectId, p);
    try {
      // the mirror is made for the agent whose calls it makes and the workspace whose disk it reads; either changing makes a new one (the manifest, which is the project's, is shared)
      if (p.holder !== `${as}|${via}`) {
        p.sync = o.home.syncProject({
          projectId,
          agentId: as,
          fs: projectDisk(projectId, via),
          manifest: (o.home.projectManifest ?? ((id) => `${o.home!.manifest(`project_${id}`)}`))(projectId),
        });
        p.holder = `${as}|${via}`;
      }
      if (p.sync === null) return true;
      return (await p.sync.pass()).failed === 0;
    } catch (e) {
      log("warn", "workspace.project_pass_failed", {
        project: projectId,
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      return false;
    }
  }
  function startProjects(agentId: string, ps: readonly string[]): void {
    if (!o.home?.syncProject) return;
    agentProjects.set(agentId, [...ps]);
    for (const projectId of ps) {
      const p = projects.get(projectId) ?? {
        sync: null,
        timer: null,
        kick: null,
        holder: null,
        delay: 0,
        stopped: false,
      };
      projects.set(projectId, p);
      if (p.timer) continue;
      // the project's last activity: the latest command of any agent whose workspace mounts it
      const active = (): number =>
        Math.max(
          0,
          ...[...agentProjects].filter(([, ps2]) => ps2.includes(projectId)).map(([a]) => lastTouch.get(a) ?? 0),
        );
      pace(p, mirrorBase(), active, async () => {
        const via = await runningMounter(projectId);
        if (via === null) {
          p.stopped = true;
          return;
        }
        await projectPass(projectId);
      });
    }
  }
  /** A command ran in this agent's workspace: the project folders it mounts are the ones it may have changed, and it is the agent they are attributed to. A pass follows, after the second a file must sit unchanged. */
  function kickProjects(agentId: string): void {
    if (!o.home?.syncProject) return;
    for (const projectId of agentProjects.get(agentId) ?? []) {
      projectActor.set(projectId, agentId);
      const p = projects.get(projectId);
      if (!p || p.kick) continue;
      p.kick = setTimeout(() => {
        p.kick = null;
        void projectPass(projectId);
      }, o.projectKickMs ?? 1200);
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
      if (p.kick) {
        clearTimeout(p.kick);
        p.kick = null;
      }
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
    await makeNetwork(agentId, config.HostConfig.NetworkMode);
    await api.containerCreate(name, config);
  }

  function provision(agentId: string): Promise<{ workspaceId: string }> {
    if (!AGENT_ID.test(agentId))
      return Promise.reject(wsError("That is not an agent a workspace can be made for.", "bad_input"));
    if (gone.has(agentId)) return Promise.reject(wsError(AGENT_GONE_LINE, "gone"));
    return serial(agentId, async () => {
      const name = workspaceName(agentId);
      // the same admission as a make or a wake: after a restart the move of an old computer must not build a workspace for an agent in Trash (review, first look 2)
      if (!(await inspect(name))) {
        await o.admit?.({ agentId, state: "create" });
        const want = await mounts(agentId);
        await build(agentId, name, want, workspaceContainerConfig(agentId, image, want, o, await networkFor(agentId)));
        log("info", "workspace.provisioned", { agent: agentId });
      }
      return { workspaceId: name };
    });
  }

  /**
   * Is something working in the workspace: a run Vyre holds, a pane whose foreground command is not a shell, or any process that is not the workspace's own (BUSY_SCRIPT). A workspace that does not
   * answer is taken as busy: nothing is stopped on a guess.
   */
  async function busy(agentId: string): Promise<boolean> {
    return (await work(agentId)) !== null;
  }
  /** What keeps the workspace busy, in a few words ("tail -f app.log"), or null when nothing does; remembered for its status line. */
  async function work(agentId: string): Promise<string | null> {
    const say = (what: string | null): string | null => {
      if (what === null) busyNote.delete(agentId);
      else busyNote.set(agentId, what.slice(0, 120));
      return what;
    };
    if ((holds.get(agentId) ?? 0) > 0) return say("a command");
    try {
      const panes = await execIn(agentId, ["tmux", "list-panes", "-a", "-F", "#{pane_current_command}"], undefined);
      const fg =
        panes.code === 0
          ? panes.stdout
              .split("\n")
              .map((l) => l.trim())
              .filter((c) => c !== "" && !SHELLS.has(c))
          : [];
      // the panes of the people who use the agent without owning it are on tmux servers of their own Unix users: each is asked as that user, and its pids are told to the process scan
      const skipT: string[] = [];
      const skipPanes: string[] = [];
      const listed = await execIn(agentId, ["sh", "-c", "ls -d /tmp/tmux-* 2>/dev/null; true"], undefined);
      for (const m of listed.stdout.matchAll(/\/tmp\/tmux-(\d+)/g)) {
        const uid = Number(m[1]);
        if (uid === WORKSPACE_UID) continue;
        const theirs = await execIn(
          agentId,
          [
            "sh",
            "-c",
            'echo "S $(tmux display-message -p "#{pid}" 2>/dev/null)"; tmux list-panes -a -F "P #{pane_pid} #{pane_current_command}" 2>/dev/null; true',
          ],
          undefined,
          uid,
        ).catch(() => null);
        if (theirs === null) continue;
        for (const l of theirs.stdout.split("\n")) {
          const [kind, a1, a2] = l.trim().split(/\s+/);
          if (kind === "S" && a1) skipT.push(a1);
          else if (kind === "P" && a1) {
            skipPanes.push(a1);
            if (a2 && !SHELLS.has(a2)) fg.push(a2);
          }
        }
      }
      if (fg.length > 0) return say([...new Set(fg)].join(", "));
      const procs = await execIn(agentId, ["sh", "-c", BUSY_SCRIPT], {
        VYRE_SKIP_T: skipT.join(" "),
        VYRE_SKIP_PANES: skipPanes.join(" "),
      });
      if (procs.code !== 0) return say("something");
      const names = procs.stdout
        .split("\n")
        .map((l) =>
          l
            .trim()
            .replace(/^\d+\s*/, "")
            .trim(),
        )
        .filter((l, i, all) => l !== "" || all.length === 1);
      if (procs.stdout.trim() === "") return say(null);
      return say([...new Set(names.filter((n) => n !== ""))].slice(0, 3).join(", ") || "something");
    } catch {
      return say("something");
    }
  }

  async function wake(agentId: string): Promise<"created" | "woke" | "running"> {
    const name = workspaceName(agentId);
    const want = await mounts(agentId);
    // the network is made or checked BEFORE anything is removed: if it cannot be had, the workspace keeps (or gets) the default bridge it worked on before, and a later wake tries again (review S1)
    const config = workspaceContainerConfig(agentId, image, want, o, await networkFor(agentId));
    let info = await inspect(name);
    // the projects it is on changed (or the Files folder moved): the container is made again with the new mounts; the volumes, and so everything the agent kept, stay. A running workspace is made
    // again only when it is quiet (no run held, nothing working in it), never in the middle of a command: until then it keeps its mounts, and the change is looked at again on a later use (at most
    // every few seconds) or applied when it next wakes.
    if (info && info.labels["vyre.mounts"] !== config.Labels["vyre.mounts"]) {
      let now_ = true;
      // a project the agent is no longer on: access is taken away now, whatever runs (12 Nov, lead's decision). Only an addition waits for a quiet moment.
      const removed = info.projects.filter((p) => !want.projects.includes(p));
      if (info.running && removed.length > 0) {
        restarts.set(agentId, { gen: (gens.get(agentId) ?? 0) + 1, line: REMOVED_LINE });
        agentProjects.set(
          agentId,
          (agentProjects.get(agentId) ?? []).filter((p) => !removed.includes(p)),
        );
        for (const p of removed) if (projectActor.get(p) === agentId) projectActor.delete(p);
        log("info", "workspace.project_removed", { agent: agentId, projects: removed });
      } else if (info.running) {
        const last = pendingMounts.get(agentId);
        if ((holds.get(agentId) ?? 0) > 0 || (last !== undefined && now() - last < MOUNT_RECHECK_MS)) now_ = false;
        else if (await busy(agentId)) now_ = false;
        if (!now_) {
          if (last === undefined) log("info", "workspace.mounts_deferred", { agent: agentId });
          if (last === undefined || now() - last >= MOUNT_RECHECK_MS) pendingMounts.set(agentId, now());
        }
      }
      if (now_) {
        pendingMounts.delete(agentId);
        stopHome(agentId);
        if (info.running) {
          await homePass(agentId);
          await finalProjectPasses(agentId);
        }
        // the room it holds stays held: the same workspace starts again at once, and the claim is asked again below
        await removeContainer(name);
        // moved off a network of its own: that network goes (a failure to remove it never stops the start)
        if (OLD_NET.test(info.network) && info.network !== config.HostConfig.NetworkMode) {
          const gone = await http({ method: "DELETE", path: `/networks/${info.network}` }).catch(() => null);
          if (gone && (gone.status === 204 || gone.status === 200 || gone.status === 404))
            madeNets.delete(info.network);
        }
        info = null;
        gens.set(agentId, (gens.get(agentId) ?? 0) + 1);
      }
    } else pendingMounts.delete(agentId);
    if (info?.running) {
      lastUsed.set(agentId, now());
      if (!pendingMounts.has(agentId)) mounted.set(agentId, want.projects);
      // running before this process started: its projects' mirrors start now, and so does the idle timer
      if (!agentProjects.has(agentId))
        startProjects(agentId, pendingMounts.has(agentId) ? info.projects : want.projects);
      // running before this process started, it holds room on the host (review 12 Nov, 5)
      if (o.capacity) claimed.add(agentId);
      if (pendingMounts.has(agentId)) mounted.set(agentId, info.projects);
      startTimer();
      return "running";
    }
    await o.admit?.({ agentId, state: info ? "wake" : "create" });
    // room first: a host that is full queues it with a plain line and nothing is made or started
    if (o.capacity) {
      let room = await o.capacity.claim(agentId);
      // a full host first puts its longest-quiet workspace to sleep (nothing held, nothing running) and starts this one; only when every awake one is truly busy does this one wait (12 Nov)
      // newcomers at the same moment can take each other's freed room: it tries again as long as it can put another quiet one to sleep (each try sleeps one, so this ends)
      while (room.state === "waiting" && (await makeRoom(agentId))) room = await o.capacity.claim(agentId);
      if (room.state === "waiting") {
        const line = workspaceWaitLine(room.line);
        waitingLine.set(agentId, line);
        throw wsError(line, "waiting");
      }
      waitingLine.delete(agentId);
      // it was just asked for: not the one another newcomer puts to sleep for room while it starts
      wokenAt.set(agentId, now());
    }
    try {
      // its network is gone (removed to free a pool while it slept, and the shared one still could not be had): starting it would give a workspace where every command fails, so it is made
      // again on what the rule gives now (fourth look U3); the volumes stay
      if (info && !["bridge", "default", "host", "none", ""].includes(info.network)) {
        const there = await http({ method: "GET", path: `/networks/${info.network}` }).catch(() => null);
        if (there?.status === 404) {
          log("warn", "workspace.network_missing", {
            agent: agentId,
            network: info.network,
            now: config.HostConfig.NetworkMode,
          });
          await removeContainer(name);
          info = null;
          gens.set(agentId, (gens.get(agentId) ?? 0) + 1);
        }
      }
      if (!info) await build(agentId, name, want, config);
      await api.containerStart(name);
    } catch (e) {
      await o.capacity?.release(agentId).catch(() => undefined);
      throw e;
    }
    if (o.capacity) claimed.add(agentId);
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
    if (!AGENT_ID.test(agentId))
      return Promise.reject(wsError("That is not an agent a workspace can be made for.", "bad_input"));
    if (gone.has(agentId)) return Promise.reject(wsError(AGENT_GONE_LINE, "gone"));
    usedHere.add(agentId);
    return serial(agentId, () => wake(agentId));
  }

  async function execIn(
    agentId: string,
    argv: readonly string[],
    env: Readonly<Record<string, string>> | undefined,
    user?: number,
  ): Promise<ExecResult> {
    // an exec runs as the agent's own user (10001), or as the Unix user of a person who uses the agent without owning it (asker.ts)
    const r = await api.exec(workspaceName(agentId), {
      cmd: argv,
      env: Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`),
      ...(user === undefined ? {} : { user: `${user}:${user}` }),
    });
    return { code: r.exitCode ?? 1, stdout: r.stdout, stderr: r.stderr };
  }

  async function exec(
    agentId: string,
    argv: readonly string[],
    x?: { env?: Readonly<Record<string, string>>; quiet?: boolean; values?: boolean; user?: number },
  ): Promise<ExecResult> {
    if (x?.values === true && o.valuesAllowed && !o.valuesAllowed()) throw wsError(NOT_PRIVATE);
    // quiet: tidying up after a stream. It neither wakes a sleeping workspace nor counts as use.
    if (x?.quiet === true)
      return (await api.containerRunning(workspaceName(agentId)))
        ? execIn(agentId, argv, x.env, x.user)
        : { code: 1, stdout: "", stderr: "the workspace is asleep" };
    await ensure(agentId);
    lastUsed.set(agentId, now());
    lastTouch.set(agentId, now());
    // someone works in it: its mirrors go back to their quick pace
    nudge(homes.get(agentId), mirrorBase());
    for (const pid of agentProjects.get(agentId) ?? []) nudge(projects.get(pid), mirrorBase());
    try {
      return await execIn(agentId, argv, x?.env, x?.user);
    } catch (e) {
      // the container stopped between the wake and the exec (a sweep, or someone stopped it): wake it once more
      if (await api.containerRunning(workspaceName(agentId)).catch(() => false)) throw e;
      await ensure(agentId);
      return execIn(agentId, argv, x?.env, x?.user);
    }
  }

  /** `ifIdle`: the sweep's sleep. Inside the workspace's turn it looks once more, so a command that began after the sweep looked (its wake came first) is never cut off. */
  /**
   * Room for `forAgent` on a full host: the awake workspaces of this Space, longest quiet first (the last command or keystroke), are looked at until one has nothing held and nothing running; that one
   * sleeps (its volumes and files stay; it wakes on its next use). A few at most are looked at, so a host of busy workspaces is not asked about every one. True when one slept.
   */
  async function makeRoom(forAgent: string): Promise<boolean> {
    let live: string[];
    try {
      live = await running();
    } catch {
      return false;
    }
    // one that was given room in the last minute and has had no command since is a newcomer still starting: never the one put to sleep
    // and one given room in the last minute is never taken for another: two agents never put each other to sleep twice within a minute (fourth look U1)
    const starting = (id: string): boolean => {
      const w = wokenAt.get(id);
      return w !== undefined && now() - w < JUST_WOKEN_MS;
    };
    // never one with a turn or a run in progress, used in the last 90 s, or with a person's tab attached: "nothing running this instant" is not enough (lead, 12 Nov)
    const mayTake = (id: string): boolean => {
      if ((holds.get(id) ?? 0) > 0 || starting(id) || now() - (viewedAt.get(id) ?? -Infinity) < ATTACHED_MS)
        return false;
      const turn = o.inTurn?.(id);
      if (turn === true) return false;
      return now() - (lastTouch.get(id) ?? 0) >= (turn === false ? ROOM_GRACE_MS : ROOM_GRACE_UNKNOWN_MS);
    };
    const quiet = live
      .filter((id) => id !== forAgent && mayTake(id))
      .sort((a, b) => (lastTouch.get(a) ?? 0) - (lastTouch.get(b) ?? 0));
    // at most a few awake ones are asked whether they are busy; ones another newcomer already put to sleep (newcomers at once share one list) are passed over without counting
    let asked = 0;
    for (const id of quiet) {
      if (asked >= 8) break;
      if (forRoom.has(id)) continue; // another newcomer is putting this one to sleep
      forRoom.add(id);
      try {
        if (!(await api.containerRunning(workspaceName(id)).catch(() => false))) continue;
        asked++;
        if (await sleepNow(id, false, true)) {
          // its agent's next command says so, once
          sleptNote.set(id, SLEPT_FOR_ROOM_LINE);
          log("info", "workspace.slept_for_room", { agent: id, for: forAgent });
          return true;
        }
      } finally {
        forRoom.delete(id);
      }
    }
    return false;
  }

  async function sleepNow(agentId: string, ifIdle = false, ifQuiet = false): Promise<boolean> {
    return serial(agentId, async () => {
      if (!(await api.containerRunning(workspaceName(agentId)))) return false;
      // making room: only one with nothing held and nothing running, looked at in its own turn
      if (ifQuiet && ((holds.get(agentId) ?? 0) > 0 || (await busy(agentId)))) return false;
      if (ifIdle) {
        const at = lastUsed.get(agentId);
        if (at !== undefined && now() - at < idleMs) return false;
        const doing = await work(agentId);
        if (doing !== null) {
          if (!overCeiling(agentId)) {
            lastUsed.set(agentId, now() - idleMs + 60_000);
            return false;
          }
          sleptNote.set(
            agentId,
            `The workspace went to sleep after 12 hours with no command or keystroke, though it was still running ${doing}. It woke for this command; what ran then was stopped.`,
          );
          log("info", "workspace.slept_at_ceiling", { agent: agentId, running: doing });
        }
      }
      // what the agent made goes to Files before the container stops
      stopHome(agentId);
      const synced = (await homePass(agentId)) && (await finalProjectPasses(agentId));
      if (!synced) log("warn", "workspace.slept_unsynced", { agent: agentId });
      await api.containerStop(workspaceName(agentId), 10);
      lastUsed.delete(agentId);
      // the room it held goes back, and the oldest waiting workspace starts
      claimed.delete(agentId);
      await o.capacity?.release(agentId).catch(() => undefined);
      log("info", "workspace.slept", { agent: agentId });
      return true;
    });
  }

  /**
   * Is a workspace container this manager's (this daemon's Space)? Two daemons often share one engine (the desktop app runs a Personal Space daemon beside a device daemon; a test box runs many): each only
   * ever sleeps, removes or gives back the room of its own. A container made before the Space label counts as ours when this Space knows its agent (ownsAgent) or this process has used it.
   */
  const usedHere = new Set<string>();
  const mine = (labels: Record<string, string> | undefined, agentId: string): boolean => {
    if (o.owner === undefined) return true;
    const space = labels?.["vyre.space"];
    if (space !== undefined) return space === o.owner;
    return usedHere.has(agentId) || (o.ownsAgent?.(agentId) ?? false);
  };
  async function running(): Promise<string[]> {
    const r = await http({
      method: "GET",
      path: "/containers/json",
      query: { all: "false", filters: JSON.stringify({ label: ["vyre.workspace"] }) },
    });
    if (r.status !== 200) return [];
    const rows = JSON.parse(dec.decode(r.body)) as Array<{ Labels?: Record<string, string> }>;
    return rows.flatMap((x) => {
      const id = x.Labels?.["vyre.workspace"] ?? "";
      return AGENT_ID.test(id) && mine(x.Labels, id) ? [id] : [];
    });
  }

  /** Every workspace container on this engine, running or not. */
  async function every(): Promise<Array<{ agentId: string; running: boolean }>> {
    const r = await http({
      method: "GET",
      path: "/containers/json",
      query: { all: "true", filters: JSON.stringify({ label: ["vyre.workspace"] }) },
    });
    if (r.status !== 200) throw new Error(`Docker did not list the workspaces (${r.status})`);
    return (JSON.parse(dec.decode(r.body)) as Array<{ State?: string; Labels?: Record<string, string> }>).flatMap(
      (x) => {
        const id = x.Labels?.["vyre.workspace"] ?? "";
        return AGENT_ID.test(id) && mine(x.Labels, id) ? [{ agentId: id, running: x.State === "running" }] : [];
      },
    );
  }

  /**
   * Room held for a workspace whose container is not running and that Vyre did not stop (out of memory, `docker stop` from outside, the host rebooted) goes back to the host. In this process the
   * workspaces it started are known; after a restart (a reboot restarts the daemon too) every stopped workspace's room is given back once, except one that is waiting for room here.
   */
  async function giveBackDeadRoom(firstLook: boolean): Promise<void> {
    if (!o.capacity) return;
    let all: Array<{ agentId: string; running: boolean }>;
    try {
      all = await every();
    } catch {
      return;
    }
    const up = new Set(all.filter((x) => x.running).map((x) => x.agentId));
    const dead = new Set<string>([...claimed].filter((id) => !up.has(id)));
    // after a restart: a stopped workspace's room goes back once, unless it waits in the host's queue, whose place the database keeps (review 12 Nov, 5)
    if (firstLook)
      for (const x of all) {
        if (x.running || waitingLine.has(x.agentId)) continue;
        const line = (await o.capacity.waiting?.(x.agentId).catch(() => null)) ?? null;
        if (line !== null) {
          waitingLine.set(x.agentId, workspaceWaitLine(line));
          continue;
        }
        dead.add(x.agentId);
      }
    // and one that was running before the restart holds room: if it dies outside Vyre later, that room goes back too
    if (firstLook) for (const x of all) if (x.running) claimed.add(x.agentId);
    for (const id of dead) {
      // in the workspace's own turn, looked at again there: a rebuild (a project change) stops the container for a moment and must keep its room (review 12 Nov, 4)
      await serial(id, async () => {
        if (await api.containerRunning(workspaceName(id)).catch(() => true)) return;
        claimed.delete(id);
        lastUsed.delete(id);
        stopHome(id);
        stopProjects(id);
        await o.capacity!.release(id).catch(() => undefined);
        log("warn", "workspace.stopped_outside", { agent: id });
      }).catch(() => undefined);
    }
  }

  /** No command or keystroke for MAX_BUSY_AWAKE_MS (counted from when this process first saw the workspace, if it never saw one). */
  function overCeiling(agentId: string): boolean {
    if (!lastTouch.has(agentId)) lastTouch.set(agentId, now());
    return now() - (lastTouch.get(agentId) as number) >= (o.maxBusyMs ?? MAX_BUSY_AWAKE_MS);
  }

  async function sweep(): Promise<string[]> {
    const slept: string[] = [];
    let live: string[];
    try {
      live = await running();
    } catch {
      return slept;
    }
    await giveBackDeadRoom(!discovered);
    // behind the runner, the networks of workspaces that were running before this process started are read by their names too
    if (o.runner) for (const id of live) madeNets.add(workspaceNetworkName(id));
    await readSubnets();
    // workspaces that were running before this process started get a whole idle period from now
    if (!discovered) {
      discovered = true;
      for (const id of live) if (!lastUsed.has(id)) lastUsed.set(id, now());
    }
    for (const id of live) {
      const at = lastUsed.get(id);
      if (at === undefined) {
        lastUsed.set(id, now());
        continue;
      }
      if (now() - at < idleMs) continue;
      // never sleeps mid-task: a run Vyre holds, a pane that runs something other than a shell, or any process of the agent's (a script, a job in the background) is work
      // ...but for at most MAX_BUSY_AWAKE_MS after the last command or keystroke: then it sleeps anyway (sleepNow says why to the next command)
      if ((await busy(id)) && !overCeiling(id)) {
        lastUsed.set(id, now() - idleMs + 60_000);
        continue;
      }
      try {
        if (await sleepNow(id, true)) slept.push(id);
      } catch (e) {
        log("warn", "workspace.sleep_failed", {
          agent: id,
          error: e instanceof Error ? e.message.slice(0, 160) : "unknown",
        });
      }
    }
    return slept;
  }

  function startTimer(): void {
    if (timer) return;
    timer = setInterval(
      () => {
        void sweep().catch(() => undefined);
      },
      Math.max(1000, Math.min(60_000, Math.floor(idleMs / 2))),
    );
    timer.unref?.();
  }

  // a workspace left running by the process before this one (an update restarts the daemon) sleeps when idle like any other, whether or not anything uses it again
  startTimer();
  // the subnets of the networks workspaces already running are on, read now rather than at the first sweep minutes later, so the daemon's guard refuses them from its first call (third look T5)
  const firstRead: Promise<void> = readSubnets().catch(() => undefined);

  return {
    ensure,
    exec,
    provision,
    worked: (agentId) => kickProjects(agentId),
    async revoke(agentId) {
      if (!AGENT_ID.test(agentId)) return;
      // the mirror stops for the projects it left before anything else, then the container follows its projects (wake makes it again at once when one was removed)
      const want = await mounts(agentId);
      const left = (agentProjects.get(agentId) ?? []).filter((p) => !want.projects.includes(p));
      if (left.length > 0) {
        agentProjects.set(
          agentId,
          (agentProjects.get(agentId) ?? []).filter((p) => want.projects.includes(p)),
        );
        for (const p of left) if (projectActor.get(p) === agentId) projectActor.delete(p);
      }
      if (await api.containerRunning(workspaceName(agentId)).catch(() => false)) await ensure(agentId);
    },
    restore(agentId) {
      gone.delete(agentId);
      restarts.delete(agentId);
    },
    subnets: () => [...nets],
    ready: () => firstRead,
    networkNote: () =>
      sharedFailure !== null && !o.runner
        ? `Agent workspaces are on Docker's default network because the shared one could not be made: ${sharedFailure}. They work, but can reach each other.`
        : null,
    hostSubnets: async () => {
      const r = await http({ method: "GET", path: "/networks" }).catch(() => null);
      if (!r || r.status !== 200) return null;
      try {
        return (JSON.parse(dec.decode(r.body)) as Array<{ IPAM?: { Config?: Array<{ Subnet?: string }> } }>)
          .flatMap((n) => (n.IPAM?.Config ?? []).map((c) => c.Subnet ?? ""))
          .filter(Boolean);
      } catch {
        return null;
      }
    },
    awake: (agentId) =>
      AGENT_ID.test(agentId) ? api.containerRunning(workspaceName(agentId)).catch(() => false) : Promise.resolve(false),
    viewed(agentId) {
      viewedAt.set(agentId, now());
    },
    freshen,
    filesChanged,
    takeNote(agentId) {
      const n = sleptNote.get(agentId) ?? null;
      sleptNote.delete(agentId);
      return n;
    },
    async cut(agentId, projectId) {
      if (!AGENT_ID.test(agentId) || !PROJECT_ID.test(projectId)) return;
      const out = excluded.get(agentId) ?? new Set<string>();
      out.add(projectId);
      excluded.set(agentId, out);
      agentProjects.set(
        agentId,
        (agentProjects.get(agentId) ?? []).filter((p) => p !== projectId),
      );
      if (projectActor.get(projectId) === agentId) projectActor.delete(projectId);
      const info = await inspect(workspaceName(agentId)).catch(() => null);
      if (info?.running && info.projects.includes(projectId)) {
        restarts.set(agentId, { gen: (gens.get(agentId) ?? 0) + 1, line: REMOVED_LINE });
        stopHome(agentId);
        await api.containerStop(workspaceName(agentId), 0);
        log("info", "workspace.project_cut", { agent: agentId, project: projectId });
      }
    },
    restartLine(agentId, since) {
      const r = restarts.get(agentId);
      return r !== undefined && r.gen > since ? r.line : null;
    },
    hold(agentId) {
      holds.set(agentId, (holds.get(agentId) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const n = (holds.get(agentId) ?? 1) - 1;
        if (n <= 0) holds.delete(agentId);
        else holds.set(agentId, n);
        // the run counts as use up to its end
        if (lastUsed.has(agentId)) lastUsed.set(agentId, now());
        // a project change that waited for this run is looked at on the next use, not a few seconds later
        if (n <= 0 && pendingMounts.has(agentId)) pendingMounts.set(agentId, Number.NEGATIVE_INFINITY);
      };
    },
    async status(agentId) {
      usedHere.add(agentId);
      // Docker that does not answer is not a workspace that sleeps: the caller says what would make it work (owner walk, 12 Nov)
      const ping = await http({ method: "GET", path: "/_ping", timeoutMs: 5000 }).catch(() => null);
      if (!ping || ping.status !== 200) throw wsError("The container runtime does not answer.", "docker_down");
      const row = (await this.list()).find((r) => r.agentId === agentId);
      const projects = mounted.get(agentId);
      const waits = waitingLine.get(agentId);
      // asleep with a place in the host's queue: it waits, and says for what
      if (row?.state === "asleep" && waits !== undefined) return { state: "waiting", line: waits };
      // awake past its idle time because something runs: the line says what, so a person sees why in the Computer tab
      const doing = row?.state === "running" ? busyNote.get(agentId) : undefined;
      if (row)
        return {
          state: row.state,
          ...(projects && projects.length > 0 ? { projects } : {}),
          ...(doing !== undefined ? { line: `running: ${doing}` } : {}),
        };
      const line = waitingLine.get(agentId);
      return line !== undefined ? { state: "waiting", line } : { state: "none" };
    },
    generation: (agentId) => gens.get(agentId) ?? 0,
    sleep: (agentId) => sleepNow(agentId),
    sweep,
    async list() {
      const r = await http({
        method: "GET",
        path: "/containers/json",
        query: { all: "true", filters: JSON.stringify({ label: ["vyre.workspace"] }) },
      });
      if (r.status !== 200) return [];
      const rows = JSON.parse(dec.decode(r.body)) as Array<{ State?: string; Labels?: Record<string, string> }>;
      return rows.flatMap((x) => {
        const id = x.Labels?.["vyre.workspace"] ?? "";
        if (!AGENT_ID.test(id) || !mine(x.Labels, id)) return [];
        const at = lastUsed.get(id);
        return [
          {
            agentId: id,
            state: x.State === "running" ? ("running" as const) : ("asleep" as const),
            ...(at === undefined ? {} : { lastUsedAt: at }),
          },
        ];
      });
    },
    async find(session) {
      for (const id of await running()) {
        try {
          if ((await execIn(id, ["tmux", "has-session", "-t", session], undefined)).code === 0) return id;
        } catch {
          /* not this one */
        }
      }
      return null;
    },
    async remove(agentId, x) {
      // from now on nothing makes or wakes it, not even a command still polling its screen: that command ends with the line below
      if (x?.keepVolumes === true) {
        gone.add(agentId);
        restarts.set(agentId, { gen: Number.MAX_SAFE_INTEGER, line: AGENT_GONE_LINE });
      }
      holds.delete(agentId);
      await serial(agentId, async () => {
        stopHome(agentId);
        stopProjects(agentId);
        homes.delete(agentId);
        if (await inspect(workspaceName(agentId))) await removeContainer(workspaceName(agentId));
        if (x?.keepVolumes !== true) {
          for (const v of [homeVolume(agentId), filesVolume(agentId), peopleVolume(agentId)]) {
            const r = await http({ method: "DELETE", path: `/volumes/${v}`, query: { force: "true" } });
            if (r.status !== 204 && r.status !== 404)
              throw wsError(`The workspace's volume was not removed (${r.status}).`);
          }
        }
        if (o.runner)
          await http({ method: "DELETE", path: `/networks/${workspaceNetworkName(agentId)}` }).catch(() => undefined);
        lastUsed.delete(agentId);
        mounted.delete(agentId);
        pendingMounts.delete(agentId);
        waitingLine.delete(agentId);
        claimed.delete(agentId);
        await o.capacity?.release(agentId).catch(() => undefined);
        log("info", "workspace.removed", { agent: agentId, keptVolumes: x?.keepVolumes === true });
      });
    },
    async health() {
      try {
        const r = await http({ method: "GET", path: "/_ping", timeoutMs: 5000 });
        return r.status === 200 ? { ok: true } : { ok: false, detail: `Docker answered an error (${r.status}).` };
      } catch (e) {
        return {
          ok: false,
          detail: e instanceof Error ? e.message.slice(0, 160) : "The container runtime did not answer.",
        };
      }
    },
    close() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const id of [...homes.keys()]) stopHome(id);
      for (const p of projects.values()) {
        p.stopped = true;
        if (p.timer) clearTimeout(p.timer);
        if (p.kick) clearTimeout(p.kick);
        p.timer = null;
        p.kick = null;
      }
    },
  };
}

/** The one-off container that gives a new project volume to the agent user. Fixed text: the runner holds the same shape and refuses any other. */
export const PROJECT_INIT_SCRIPT = `chown ${WORKSPACE_UID}:${WORKSPACE_UID} /vol`;
export const projectInitName = (projectId: string): string => `vyre-wsinit-${projectId}`;
export function projectInitBody(projectId: string, img: string): Record<string, unknown> {
  return {
    Image: img,
    User: "0:0",
    Entrypoint: ["sh", "-c", PROJECT_INIT_SCRIPT],
    NetworkDisabled: true,
    Labels: { "vyre.workspace.helper": "project-init", "vyre.workspace.project": projectId },
    HostConfig: {
      Binds: [`${projectVolume(projectId)}:/vol:rw`],
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
      NetworkMode: "none",
      Privileged: false,
      AutoRemove: false,
      Memory: 128 * 1024 * 1024,
      PidsLimit: 32,
    },
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
  for (const b of bytes)
    out += b === 0x5c || b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b);
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
export type WorkspaceTerminalHost = TerminalHost & {
  has(terminalId: string): Promise<boolean>;
  adopt(a: AdoptArgs): void;
};

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
  /** `gen`: the container start the session was last made or seen in (-1: not yet looked at since a restart); `seen`: the start it was known in, to tell a session the person ended from one a restart lost. */
  const where = new Map<
    string,
    {
      agentId: string;
      cols: number;
      rows: number;
      cwd?: string;
      gen: number;
      seen?: number;
      told?: number;
      /** A person who uses this shared agent's workspace without owning it: their own home, history and tmux server (asker.ts). */
      place?: AskerPlace;
    }
  >();
  const tmuxHosts = new Map<string, TmuxHost>();
  /** The first sweep of each workspace's leftover values buffers in this process: awaited before any use. */
  const firstSweep = new Map<string, Promise<void>>();

  // ---- live frames: tmux pipe-pane into a file in /tmp, read back from an offset, one reader per session however many tabs watch ----
  const streams = new Map<string, { listeners: Set<(line: string) => void>; stop(): void }>();
  function control(
    agentId: string,
    place?: AskerPlace,
  ): (session: string, onLine: (line: string) => void) => () => void {
    const user = place?.uid;
    return (session, onLine) => {
      const have = streams.get(session);
      if (have) {
        have.listeners.add(onLine);
        return () => {
          have.listeners.delete(onLine);
          if (have.listeners.size === 0) have.stop();
        };
      }
      // a person's own (asker.ts): in their own folder (0700, theirs), not in the /tmp every turn shares
      const file = place === undefined ? `/tmp/.vyre-stream-${session}` : `${place.home}/.tmp/stream-${session}`;
      const listeners = new Set<(line: string) => void>([onLine]);
      let stopped = false;
      const entry = {
        listeners,
        stop() {
          stopped = true;
          streams.delete(session);
          void m
            .exec(agentId, ["sh", "-c", 'tmux pipe-pane -t "$1" 2>/dev/null; rm -f "$2"', "sh", session, file], {
              quiet: true,
              ...(user === undefined ? {} : { user }),
            })
            .catch(() => undefined);
        },
      };
      streams.set(session, entry);
      void (async () => {
        let offset = 0;
        let carry: Uint8Array = new Uint8Array(0);
        try {
          await m.exec(
            agentId,
            ["sh", "-c", 'umask 077; : > "$2"; tmux pipe-pane -t "$1" "cat >> $2"', "sh", session, file],
            user === undefined ? undefined : { user },
          );
          while (!stopped) {
            const r = await m.exec(
              agentId,
              [
                "sh",
                "-c",
                'tail -c +"$1" "$2" 2>/dev/null | head -c 49152 | base64 -w0',
                "sh",
                String(offset + 1),
                file,
              ],
              user === undefined ? undefined : { user },
            );
            const b64 = r.stdout.trim();
            if (b64 !== "") {
              const got = Buffer.from(b64, "base64");
              offset += got.length;
              const all = new Uint8Array(carry.length + got.length);
              all.set(carry);
              all.set(got, carry.length);
              const hold = incompleteTail(all);
              carry = all.slice(all.length - hold);
              const send = all.subarray(0, all.length - hold);
              if (send.length > 0) {
                const line = `%output %0 ${encodeControlOutput(send)}`;
                for (const l of [...listeners]) l(line);
              }
            }
            await sleep(streamMs);
          }
        } catch {
          entry.stop();
        }
      })();
      return () => {
        listeners.delete(onLine);
        if (listeners.size === 0) entry.stop();
      };
    };
  }

  /** The folder of a person who uses the agent without owning it, made by their own Unix user. A folder someone else made first ends in `squatted`: the caller burns that uid. */
  async function ensurePlace(agentId: string, place: AskerPlace): Promise<void> {
    const r = await m.exec(agentId, ensureCommand(place), { user: place.uid });
    if (r.code === SQUATTED) throw wsError("That folder was made by someone else.", "squatted");
    if (r.code !== 0) throw wsError(`The folder of this person could not be made (${r.stderr.trim().slice(0, 120)}).`, "unavailable");
  }

  /** The tmux host of a workspace, or of one person's tmux server in it (a person who uses the shared agent without owning it, asker.ts). */
  function tmuxFor(agentId: string, place?: AskerPlace): TmuxHost {
    const key = place === undefined ? agentId : `${agentId}\u0000${place.person}`;
    let h = tmuxHosts.get(key);
    const user = place?.uid;
    // what a program reads on its standard input (a command's values, for tmux load-buffer) goes in by the exec's environment and a pipe, never in its arguments
    const exec = (argv: readonly string[], x?: { stdin?: string }): Promise<ExecResult> =>
      x?.stdin === undefined
        ? m.exec(agentId, argv, user === undefined ? undefined : { user })
        : m.exec(agentId, ["sh", "-c", 'printf %s "$VYRE_STDIN" | (unset VYRE_STDIN; exec "$@")', "sh", ...argv], {
            env: { VYRE_STDIN: x.stdin },
            values: true,
            ...(user === undefined ? {} : { user }),
          });
    if (!h) {
      // a tab's live read is quiet: it neither wakes the workspace nor counts as use, so a tab left open does not keep the workspace awake, and a person watching is not taken for the agent at work
      h = createTmuxHost({
        exec,
        quietExec: (argv) => m.exec(agentId, argv, { quiet: true, ...(user === undefined ? {} : { user }) }),
        // the shell of every session starts with a private umask: what a program writes outside its own folder (in /tmp) is not readable by the other people of the computer
        shell: SESSION_SHELL,
        control: control(agentId, place),
        prefix,
      });
      tmuxHosts.set(key, h);
      // the first use of this workspace in this process: what a run left before a restart is removed before anyone reads (review 12 Nov, 3b); every use waits for it (third look)
      firstSweep.set(
        key,
        h.sweep().catch(() => undefined),
      );
    }
    return h;
  }

  const LOST = /can't find session|no server running|no such session|error connecting to/i;
  /** The workspace a session is in, awake, with its tmux session there (made again when the container was stopped since, or when tmux lost it). */
  async function at(terminalId: string, remake = false): Promise<{ agentId: string; host: TerminalHost }> {
    let w0 = where.get(terminalId);
    if (!w0) {
      const found = await m.find(nameOf(terminalId));
      if (found === null) throw wsError("there is no such session in a workspace", "not_found");
      w0 = { agentId: found, cols: 120, rows: 32, gen: m.generation(found) };
      where.set(terminalId, w0);
    }
    await m.ensure(w0.agentId);
    const gen = m.generation(w0.agentId);
    const place = w0.place;
    const asThem = (): { user: number } | undefined => (place === undefined ? undefined : { user: place.uid });
    if (remake || w0.gen !== gen) {
      // tmux died with the container (or this process never saw the session: a restart): the session is made again, empty, where it was; one that is still there is kept as it is
      const session = nameOf(terminalId);
      if ((await m.exec(w0.agentId, ["tmux", "has-session", "-t", session], asThem())).code !== 0) {
        // the person's own folder is made again first, as them (a container made again has the volume, and a folder that is there is kept)
        if (place !== undefined) await ensurePlace(w0.agentId, place);
        await m.exec(
          w0.agentId,
          [
            "tmux",
            "new-session",
            "-A",
            ...HISTORY_ENV,
            ...(place === undefined ? [] : Object.entries(place.env).flatMap(([k, v]) => ["-e", `${k}=${v}`])),
            "-d",
            "-s",
            session,
            "-x",
            String(w0.cols),
            "-y",
            String(w0.rows),
            ...(w0.cwd === undefined ? [] : ["-c", w0.cwd]),
            ...SESSION_SHELL,
          ],
          asThem(),
        );
        await tmuxFor(w0.agentId, place).sweep();
      }
      w0.gen = gen;
    }
    const host = tmuxFor(w0.agentId, place);
    await firstSweep.get(place === undefined ? w0.agentId : `${w0.agentId}\u0000${place.person}`);
    return { agentId: w0.agentId, host };
  }
  /** Do `f` in the session's workspace; a session tmux lost under a running workspace (its server was killed from inside) is made again once and `f` tried again. */
  async function inSession<T>(terminalId: string, f: (h: TerminalHost) => Promise<T>): Promise<T> {
    const t = await at(terminalId);
    try {
      return await f(t.host);
    } catch (e) {
      if (!(e instanceof Error && LOST.test(e.message))) throw e;
      return f((await at(terminalId, true)).host);
    }
  }

  return {
    async has(id) {
      return where.has(id) || (await m.find(nameOf(id))) !== null;
    },
    adopt(a) {
      // what Vyre knows of a session (its row) after a restart: which workspace it is in, at what size and folder. Nothing is woken here; the next use wakes the workspace and remakes the session.
      if (where.has(a.terminalId) || a.target.agentId === undefined) return;
      where.set(a.terminalId, {
        agentId: a.target.agentId,
        cols: a.cols,
        rows: a.rows,
        ...(a.cwd === undefined ? {} : { cwd: a.cwd }),
        ...(a.place === undefined ? {} : { place: a.place }),
        gen: -1,
        seen: m.generation(a.target.agentId),
      });
    },
    async open(a) {
      const agentId = a.target.agentId;
      if (agentId === undefined) throw wsError("Say which agent's workspace to open the terminal in.", "bad_input");
      await m.ensure(agentId);
      // a person who uses the shared agent without owning it: their folder exists, theirs and 0700, before their shell does
      if (a.place !== undefined) await ensurePlace(agentId, a.place);
      const t = tmuxFor(agentId, a.place);
      await firstSweep.get(a.place === undefined ? agentId : `${agentId}\u0000${a.place.person}`);
      const r = await t.open(a);
      where.set(a.terminalId, {
        agentId,
        cols: a.cols,
        rows: a.rows,
        cwd: r.cwd,
        ...(a.place === undefined ? {} : { place: a.place }),
        gen: m.generation(agentId),
      });
      return { ...r, title: "Workspace" };
    },
    async input(id, data) {
      await inSession(id, (h) => h.input(id, data));
      const x = where.get(id);
      if (x) m.worked(x.agentId);
    },
    async interrupt(id) {
      await inSession(id, (h) => h.interrupt(id));
    },
    async resize(id, cols, rows) {
      await inSession(id, (h) => h.resize(id, cols, rows));
      const x = where.get(id);
      if (x) {
        x.cols = cols;
        x.rows = rows;
      }
    },
    async read(id, r) {
      const x = where.get(id);
      if (r.since === undefined || !x) return inSession(id, (h) => h.read(id, r));
      // the workspace was stopped or made again under the open tab for a reason (the agent left a project, went to Trash): the person sees the line the agent gets, once (third look T6)
      const why = m.restartLine(x.agentId, x.gen);
      if (why !== null && x.told !== x.gen) {
        x.told = x.gen;
        return { text: `\n${why}\n`, next: r.since };
      } // the pane writes \n as \r\n
      // the live read of an open tab: an asleep workspace has nothing new to show, and is left asleep until someone types or the agent runs something
      m.viewed(x.agentId);
      const up = await m.awake(x.agentId).catch(() => false);
      if (!up) return { text: "", next: r.since };
      if (x.gen !== m.generation(x.agentId)) {
        if (
          (
            await m.exec(x.agentId, ["tmux", "has-session", "-t", nameOf(id)], {
              quiet: true,
              ...(x.place === undefined ? {} : { user: x.place.uid }),
            })
          ).code !== 0
        )
          return { text: "", next: r.since };
        x.gen = m.generation(x.agentId);
      }
      try {
        return await tmuxFor(x.agentId, x.place).read(id, r);
      } catch {
        return { text: "", next: r.since };
      }
    },
    async run(id, r) {
      let t = await at(id);
      // held from the typed line to its end: the workspace neither sleeps nor is made again for a project change while it runs
      const release = m.hold(t.agentId);
      try {
        // a session tmux lost is made again before the line is typed; never after, so a command is never typed twice
        const placeUser = where.get(id)?.place?.uid;
        if (
          (
            await m.exec(
              t.agentId,
              ["tmux", "has-session", "-t", nameOf(id)],
              placeUser === undefined ? undefined : { user: placeUser },
            )
          ).code !== 0
        )
          t = await at(id, true);
        const g0 = m.generation(t.agentId);
        // a file a person just dropped into Files is there before the command runs (fourth look U2); if the copy takes too long, the command runs anyway and says so
        const fresh = await m.freshen(t.agentId).catch(() => false);
        // a workspace that slept at the 12-hour ceiling says so, once, in the answer of the command that woke it
        const slept = m.takeNote(t.agentId);
        const note = fresh ? slept : [slept, FILES_LATE_LINE].filter((x): x is string => x !== null).join("\n");
        try {
          const out = await t.host.run(id, r);
          return note === null ? out : { ...out, output: `${note}\n${out.output}` };
        } catch (e) {
          // the workspace was made again under the command (the agent left a project): say so instead of a tmux error
          const why = m.restartLine(t.agentId, g0);
          if (why !== null) throw Object.assign(new Error(why), { code: "restarted", workspace: true });
          throw e;
        }
      } finally {
        release();
        // what the command changed in a project folder is put in Files history as this workspace's agent, by the pass that follows its end
        m.worked(t.agentId);
      }
    },
    async status(ids) {
      const out: Awaited<ReturnType<TerminalHost["status"]>> = [];
      for (const id of ids) {
        // a status read never wakes a sleeping workspace: asleep, its sessions are idle in the list until something uses them; one tmux does not hold (yet) is made again on its next use
        const x = where.get(id);
        const live = x ? await m.awake(x.agentId) : false;
        if (!x || !live) {
          out.push({ terminalId: id, state: x ? "idle" : "exited", exitCode: null });
          continue;
        }
        // gone from the container it lived in: the person ended it (exit), so it reads as exited; gone because the container was started again since: idle, made again on its next use
        const sameStart = (x.gen !== -1 ? x.gen : x.seen) === m.generation(x.agentId);
        const got = await tmuxFor(x.agentId, x.place).status([id]);
        out.push(...got.map((g) => (g.state === "exited" && !sameStart ? { ...g, state: "idle" as const } : g)));
      }
      return out;
    },
    stream(id, onFrame) {
      const x = where.get(id);
      if (!x) return () => undefined;
      const h = tmuxFor(x.agentId, x.place);
      return h.stream ? h.stream(id, onFrame) : () => undefined;
    },
    async close(id) {
      const x = where.get(id);
      if (x) {
        const live = await m.awake(x.agentId);
        if (live) await tmuxFor(x.agentId, x.place).close(id);
        where.delete(id);
        return;
      }
      const found = await m.find(nameOf(id));
      if (found !== null) await tmuxFor(found).close(id);
    },
    async health() {
      const h = await m.health();
      const rows = h.ok ? await m.list().catch(() => []) : [];
      return {
        ok: h.ok,
        detail: h.ok
          ? `${rows.filter((r) => r.state === "running").length} of ${rows.length} workspaces awake`
          : (h.detail ?? "The container runtime did not answer."),
        sessions: where.size,
      };
    },
  };
}
