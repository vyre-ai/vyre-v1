// What the runner lets through for AGENT COMPUTERS (a Team Space server has no Docker socket for vyred; this runner, which alone holds it, makes the computers too). The same pattern as a site:
// every request is judged here before Docker sees it, and anything not named is refused. An agent computer is one container vyre-comp-<id> from the agent-computer image, labelled
// vyre.computer=<id> and vyre.agent=<agent>, with a named volume vyre-comp-<id>-profile for its profile disk and a network of its own, vyre-compnet-<id>, so one agent's computer cannot
// reach another's (Docker keeps two user networks apart) and nothing reaches vyred but the one route agentd posts to. It runs with every capability dropped, no new privileges, a seccomp
// profile, a CPU, memory and process cap, rotated logs, and no host folder, device, port or namespace. Exec, archive and logs are allowed only on containers that carry vyre.computer, and
// archive only inside the computer's own home. Mirrors modules/computers reviewComputerConfig, which a computer's config must pass before it is even sent.
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** cmt_<uuid with dashes>, as modules/computers mints it. */
export const COMPUTER_ID = /^cmt_[a-z0-9-]{8,64}$/;
const hexOf = (id: string): string => id.replace(/^cmt_/, "");
/** The container's name: vyre-comp-<id without cmt_>, which is what the module names it. */
export const computerName = (id: string): string => `vyre-comp-${hexOf(id)}`;
/** The computer's own network. */
export const computerNet = (id: string): string => `vyre-compnet-${hexOf(id).replace(/-/g, "").slice(-16)}`;
export const COMPUTER_NAME = /^vyre-comp-[a-z0-9-]{8,64}$/;
export const COMPUTER_NET = /^vyre-compnet-[a-z0-9]{1,16}$/;
export const PROFILE_VOLUME = /^vyre-comp-[a-z0-9-]{8,64}-profile$/;
export const HELPER_NAME_RE = /^vyre-comp-[a-z0-9-]{8,64}-home-rm$/;
/** The agent computer image and its tag: the default, or the registry copy. More can be named for a server in VYRE_COMPUTER_IMAGES (comma separated repositories). */
export function computerImages(extra = process.env["VYRE_COMPUTER_IMAGES"] ?? ""): RegExp {
  const repos = ["vyre/agent-computer", "ghcr.io/vyre-ai/agent-computer", ...extra.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9./_-]{0,100}$/.test(s))];
  return new RegExp(`^(${repos.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")}):[A-Za-z0-9_.-]{1,64}$`);
}
/** The same two repositories by digest (`repo@sha256:<64 hex>`): immutable, so a tag cannot be swapped under a server. Nothing else, and no other repository, by digest. */
export const COMPUTER_DIGEST = /^(vyre\/agent-computer|ghcr\.io\/vyre-ai\/agent-computer)@sha256:[0-9a-f]{64}$/;
export const isComputerImage = (name: string): boolean => computerImages().test(name) || COMPUTER_DIGEST.test(name);

export const MAX = { nanoCpus: 4e9, memory: 8 * 1024 ** 3, pids: 2048 };
export const LOGS = { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } };
export const GUEST_HOME = "/home/agent";
export const PROFILE_GUEST = "/home/agent/.profile-disk";
/** The one script the removal helper runs (modules/computers/handlers/home-fs.ts keeps the same text; a test holds the two together). */
export const HOME_RM_SCRIPT = 'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';

const TOP_KEYS = new Set(["Image", "Hostname", "User", "WorkingDir", "Cmd", "Env", "Labels", "StopTimeout", "HostConfig", "NetworkingConfig"]);
const HOST_KEYS = new Set(["Binds", "ReadonlyRootfs", "Tmpfs", "CapDrop", "CapAdd", "SecurityOpt", "Privileged", "NetworkMode", "PidMode", "IpcMode", "UsernsMode", "Devices", "PidsLimit", "Memory", "MemorySwap", "NanoCpus", "Init", "AutoRemove", "Ulimits", "LogConfig", "ExtraHosts", "Dns"]);
const emptyish = (v: unknown): boolean => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

/** The id a computer's labels name, or null. */
export function computerOf(labels: Record<string, string> | null | undefined): string | null {
  const id = labels?.["vyre.computer"] ?? "";
  return COMPUTER_ID.test(id) ? id : null;
}

/** A computer's container create body, or why it is refused. Returns the body with the drop of every capability, the log rotation and the privileged switch written in. */
export function computerBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the container config is not an object" };
  for (const k of Object.keys(body)) if (!TOP_KEYS.has(k) && !emptyish(body[k])) return { why: `a computer container may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const id = String(labels["vyre.computer"] ?? "");
  if (!COMPUTER_ID.test(id)) return { why: "a container must carry vyre.computer=<computer>" };
  for (const k of Object.keys(labels)) if (k !== "vyre.computer" && k !== "vyre.agent") return { why: `a computer container may not carry the label ${k}` };
  if ("vyre.ingress" in labels) return { why: "a computer container cannot be the ingress" };
  if (name !== computerName(id)) return { why: "a computer container is named vyre-comp-<its computer>" };
  if (!isComputerImage(String(body["Image"] ?? ""))) return { why: "a computer runs the agent computer image" };
  if (body["Hostname"] !== undefined && body["Hostname"] !== name) return { why: "a computer's hostname is its container name" };
  const env = Array.isArray(body["Env"]) ? (body["Env"] as unknown[]) : [];
  for (const e of env) if (typeof e !== "string" || !/^(VYRE_COMPUTER_ID|VYRE_AGENT_ID|VYRE_TAB_LIMIT)=[A-Za-z0-9_.:-]{0,100}$/.test(e)) return { why: "a computer's environment is its id, its agent and its tab limit" };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a computer container needs its limits" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!HOST_KEYS.has(k) && !emptyish(h[k])) return { why: `a computer container may not set HostConfig.${k}` };
  if (h["NetworkMode"] !== computerNet(id)) return { why: "a computer is on its own network only" };
  if (!emptyish(h["PidMode"])) return { why: "the host pid namespace is refused (PidMode)" };
  if (h["IpcMode"] !== undefined && h["IpcMode"] !== "private") return { why: "a computer's ipc namespace is private" };
  if (!emptyish(h["UsernsMode"])) return { why: "a user namespace mode is refused" };
  if (!emptyish(h["Devices"])) return { why: "devices are refused (Devices)" };
  if (!emptyish(h["ExtraHosts"]) || !emptyish(h["Dns"])) return { why: "a computer takes no extra hosts or DNS servers" };
  if (!emptyish(h["CapAdd"])) return { why: "a computer container gets no capability (CapAdd)" };
  if (!Array.isArray(h["CapDrop"]) || !(h["CapDrop"] as unknown[]).includes("ALL")) return { why: "every capability must be dropped" };
  const sec = Array.isArray(h["SecurityOpt"]) ? (h["SecurityOpt"] as unknown[]) : [];
  if (!sec.includes("no-new-privileges:true") && !sec.includes("no-new-privileges")) return { why: "new privileges must be off" };
  let seccomp = false;
  for (const o of sec) {
    if (o === "no-new-privileges:true" || o === "no-new-privileges") continue;
    if (typeof o === "string" && o.startsWith("seccomp=") && o !== "seccomp=unconfined") {
      try { const p = JSON.parse(o.slice(8)) as { defaultAction?: unknown }; if (p.defaultAction === "SCMP_ACT_ERRNO" || p.defaultAction === "SCMP_ACT_KILL" || p.defaultAction === "SCMP_ACT_KILL_PROCESS") { seccomp = true; continue; } } catch { /* not a profile */ }
      return { why: "the seccomp profile must deny what it does not name" };
    }
    return { why: "a computer container takes no security option but no-new-privileges and a seccomp profile" };
  }
  if (!seccomp) return { why: "a computer container needs its seccomp profile" };
  const binds = Array.isArray(h["Binds"]) ? (h["Binds"] as unknown[]) : [];
  for (const b of binds) {
    if (b !== `${name}-profile:${PROFILE_GUEST}:rw` && b !== `${name}-profile:${PROFILE_GUEST}`) return { why: "host folders are refused: a computer mounts only its own profile volume" };
  }
  const tmpfs = isObj(h["Tmpfs"]) ? h["Tmpfs"] : {};
  if (Object.keys(tmpfs).some((k) => k !== "/tmp" && k !== "/dev/shm")) return { why: "only /tmp and /dev/shm may be a tmpfs" };
  const nano = Number(h["NanoCpus"]), mem = Number(h["Memory"]), pids = Number(h["PidsLimit"]);
  if (!(nano > 0 && nano <= MAX.nanoCpus)) return { why: "a computer needs a CPU cap of at most 4 CPUs" };
  if (!(mem > 0 && mem <= MAX.memory) || Number(h["MemorySwap"]) !== mem) return { why: "a computer needs a memory cap of at most 8 GB and no swap" };
  if (!(pids > 0 && pids <= MAX.pids)) return { why: "a computer needs a process cap of at most 2048" };
  const ul = Array.isArray(h["Ulimits"]) ? (h["Ulimits"] as unknown[]) : [];
  if (ul.some((u) => !isObj(u) || (u["Name"] !== "nofile" && u["Name"] !== "core"))) return { why: "a computer takes no ulimit but nofile and core" };
  if (h["AutoRemove"] === true) return { why: "a computer is removed by Vyre, not by Docker" };
  const net = isObj(body["NetworkingConfig"]) && isObj(body["NetworkingConfig"]["EndpointsConfig"]) ? Object.keys(body["NetworkingConfig"]["EndpointsConfig"]) : [];
  if (net.some((n) => n !== computerNet(id))) return { why: "a computer joins its own network only" };
  return { body: { ...body, HostConfig: { ...h, CapAdd: [], Privileged: false, LogConfig: LOGS, Devices: [], PidMode: "" } } };
}

/** The helper that deletes files in a computer's home (archive cannot delete): the same image on no network, sharing only that computer's volumes, running only the fixed script. */
export function helperBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!HELPER_NAME_RE.test(name)) return { why: "a helper is named vyre-comp-<its computer>-home-rm" };
  if (!isObj(body)) return { why: "the container config is not an object" };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const id = String(labels["vyre.computer"] ?? "");
  if (!COMPUTER_ID.test(id) || `${computerName(id)}-home-rm` !== name || labels["vyre.helper"] !== "home-rm") return { why: "a helper carries vyre.computer=<its computer> and vyre.helper=home-rm" };
  for (const k of Object.keys(labels)) if (k !== "vyre.computer" && k !== "vyre.helper") return { why: `a helper may not carry the label ${k}` };
  if (!isComputerImage(String(body["Image"] ?? ""))) return { why: "a helper runs the agent computer image" };
  const cmd = Array.isArray(body["Cmd"]) ? (body["Cmd"] as unknown[]) : [];
  if (cmd[0] !== "sh" || cmd[1] !== "-c" || cmd[2] !== HOME_RM_SCRIPT || !cmd.every((c) => typeof c === "string")) return { why: "a helper runs only the removal script" };
  const paths = cmd.slice(4) as string[];
  if (paths.some((p) => p !== "::" && !(p.startsWith(`${GUEST_HOME}/`) && !p.includes("/../") && !p.endsWith("/.."))) ) return { why: "a helper removes only inside the computer's home" };
  for (const k of Object.keys(body)) if (!["Image", "Entrypoint", "Cmd", "User", "NetworkDisabled", "HostConfig", "Labels"].includes(k) && !emptyish(body[k])) return { why: `a helper may not set ${k}` };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a helper needs its host config" };
  const from = Array.isArray(h["VolumesFrom"]) ? (h["VolumesFrom"] as unknown[]) : [];
  if (from.length !== 1 || from[0] !== computerName(id)) return { why: "a helper shares only its own computer's volumes" };
  if (h["NetworkMode"] !== "none") return { why: "a helper has no network" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!["VolumesFrom", "CapDrop", "SecurityOpt", "NetworkMode", "Privileged", "AutoRemove"].includes(k) && !emptyish(h[k])) return { why: `a helper may not set HostConfig.${k}` };
  return { body: { ...body, NetworkDisabled: true, HostConfig: { VolumesFrom: from, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false, Memory: 256 * 1024 * 1024, PidsLimit: 64 } } };
}

/** A computer's network: a plain bridge with its label. Containers on it reach the internet and the one ingress that joins it, and no other computer's network. */
export function computerNetworkBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the network config is not an object" };
  for (const k of Object.keys(body)) if (!["Name", "Driver", "Labels", "CheckDuplicate", "Internal", "Options"].includes(k)) return { why: `a computer network may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const id = String(labels["vyre.computer"] ?? "");
  if (!COMPUTER_ID.test(id)) return { why: "a computer network carries vyre.computer=<computer>" };
  if (body["Name"] !== computerNet(id)) return { why: "a computer network is named vyre-compnet-<its computer>" };
  if (body["Driver"] !== undefined && body["Driver"] !== "bridge") return { why: "a computer network is a bridge" };
  if (isObj(body["Options"]) && Object.keys(body["Options"]).some((k) => k !== "com.docker.network.bridge.enable_icc")) return { why: "a computer network takes no driver options" };
  return { body: { Name: body["Name"], Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.computer": id }, ...(body["Internal"] === true ? { Internal: true } : {}) } };
}

/** Archive on a computer: its own home only, to read or to write. */
export function archiveOk(method: string, query: URLSearchParams): boolean {
  const p = query.get("path") ?? "";
  if (method !== "GET" && method !== "PUT" && method !== "HEAD") return false;
  if (p.includes("..")) return false;
  return p === GUEST_HOME || p === `${GUEST_HOME}/.` || p.startsWith(`${GUEST_HOME}/`);
}

// ---- the Space browser (images/space-browser): one container for the Space host, `vyre-sbrowser`, labelled vyre.sbrowser=1, with its profiles on the named volume `vyre-sbrowser-data` and a network of its
// own, `vyre-sbrowsernet`, so it cannot reach an agent computer or a site and only the ingress that joins it (the one route the Vault channel posts to) can reach it. The same confinement as a computer:
// every capability dropped, no new privileges, a seccomp profile, caps on CPU, memory and processes, no host folder, device, port or namespace. Exec and logs only; no archive, no wait.

export const SBROWSER_NAME = "vyre-sbrowser";
export const SBROWSER_NET = "vyre-sbrowsernet";
export const SBROWSER_VOLUME = "vyre-sbrowser-data";
export const SBROWSER_DATA_GUEST = "/data";

/** The Space browser image and its tag: the default, or the registry copy. More can be named for a server in VYRE_SBROWSER_IMAGES (comma separated repositories). */
export function sbrowserImages(extra = process.env["VYRE_SBROWSER_IMAGES"] ?? ""): RegExp {
  const repos = ["vyre/space-browser", "ghcr.io/vyre-ai/space-browser", ...extra.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9./_-]{0,100}$/.test(s))];
  return new RegExp(`^(${repos.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")}):[A-Za-z0-9_.-]{1,64}$`);
}
export const SBROWSER_DIGEST = /^(vyre\/space-browser|ghcr\.io\/vyre-ai\/space-browser)@sha256:[0-9a-f]{64}$/;
export const isSbrowserImage = (name: string): boolean => sbrowserImages().test(name) || SBROWSER_DIGEST.test(name);

/** Is this container the Space browser's (by its labels)? */
export const sbrowserOf = (labels: Record<string, string> | null | undefined): boolean => labels?.["vyre.sbrowser"] === "1";

/** The Space browser's container create body, or why it is refused. */
export function sbrowserBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the container config is not an object" };
  for (const k of Object.keys(body)) if (!TOP_KEYS.has(k) && !emptyish(body[k])) return { why: `the Space browser container may not set ${k}` };
  if (name !== SBROWSER_NAME) return { why: "the Space browser container is named vyre-sbrowser" };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  if (labels["vyre.sbrowser"] !== "1") return { why: "the Space browser container must carry vyre.sbrowser=1" };
  for (const k of Object.keys(labels)) if (k !== "vyre.sbrowser") return { why: `the Space browser container may not carry the label ${k}` };
  if (!isSbrowserImage(String(body["Image"] ?? ""))) return { why: "the Space browser runs the Space browser image" };
  if (body["Hostname"] !== undefined && body["Hostname"] !== name) return { why: "the Space browser's hostname is its container name" };
  const env = Array.isArray(body["Env"]) ? (body["Env"] as unknown[]) : [];
  for (const e of env) if (typeof e !== "string" || !/^VYRE_BROWSER_(MAX_RUNNING|IDLE_MINUTES|SWEEP_SECONDS)=[0-9.]{1,8}$/.test(e)) return { why: "the Space browser's environment is its limits and idle time" };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "the Space browser container needs its limits" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!HOST_KEYS.has(k) && !emptyish(h[k])) return { why: `the Space browser container may not set HostConfig.${k}` };
  if (h["NetworkMode"] !== SBROWSER_NET) return { why: "the Space browser is on its own network only" };
  if (!emptyish(h["PidMode"])) return { why: "the host pid namespace is refused (PidMode)" };
  if (h["IpcMode"] !== undefined && h["IpcMode"] !== "private") return { why: "the Space browser's ipc namespace is private" };
  if (!emptyish(h["UsernsMode"])) return { why: "a user namespace mode is refused" };
  if (!emptyish(h["Devices"])) return { why: "devices are refused (Devices)" };
  if (!emptyish(h["ExtraHosts"]) || !emptyish(h["Dns"])) return { why: "the Space browser takes no extra hosts or DNS servers" };
  if (!emptyish(h["CapAdd"])) return { why: "the Space browser container gets no capability (CapAdd)" };
  if (!Array.isArray(h["CapDrop"]) || !(h["CapDrop"] as unknown[]).includes("ALL")) return { why: "every capability must be dropped" };
  const sec = Array.isArray(h["SecurityOpt"]) ? (h["SecurityOpt"] as unknown[]) : [];
  if (!sec.includes("no-new-privileges:true") && !sec.includes("no-new-privileges")) return { why: "new privileges must be off" };
  let seccomp = false;
  for (const o of sec) {
    if (o === "no-new-privileges:true" || o === "no-new-privileges") continue;
    if (typeof o === "string" && o.startsWith("seccomp=") && o !== "seccomp=unconfined") {
      try { const p = JSON.parse(o.slice(8)) as { defaultAction?: unknown }; if (p.defaultAction === "SCMP_ACT_ERRNO" || p.defaultAction === "SCMP_ACT_KILL" || p.defaultAction === "SCMP_ACT_KILL_PROCESS") { seccomp = true; continue; } } catch { /* refused below */ }
      return { why: "the seccomp profile must deny what it does not name" };
    }
    return { why: "the Space browser container takes no security option but no-new-privileges and a seccomp profile" };
  }
  if (!seccomp) return { why: "the Space browser container needs its seccomp profile" };
  const binds = Array.isArray(h["Binds"]) ? (h["Binds"] as unknown[]) : [];
  for (const b of binds) if (b !== `${SBROWSER_VOLUME}:${SBROWSER_DATA_GUEST}:rw` && b !== `${SBROWSER_VOLUME}:${SBROWSER_DATA_GUEST}`) return { why: "host folders are refused: the Space browser mounts only its own profile volume" };
  const tmpfs = isObj(h["Tmpfs"]) ? h["Tmpfs"] : {};
  if (Object.keys(tmpfs).some((k) => k !== "/tmp" && k !== "/dev/shm")) return { why: "only /tmp and /dev/shm may be a tmpfs" };
  const nano = Number(h["NanoCpus"]), mem = Number(h["Memory"]), pids = Number(h["PidsLimit"]);
  if (!(nano > 0 && nano <= MAX.nanoCpus)) return { why: "the Space browser needs a CPU cap of at most 4 CPUs" };
  if (!(mem > 0 && mem <= MAX.memory) || Number(h["MemorySwap"]) !== mem) return { why: "the Space browser needs a memory cap of at most 8 GB and no swap" };
  if (!(pids > 0 && pids <= MAX.pids)) return { why: "the Space browser needs a process cap of at most 2048" };
  const ul = Array.isArray(h["Ulimits"]) ? (h["Ulimits"] as unknown[]) : [];
  if (ul.some((u) => !isObj(u) || (u["Name"] !== "nofile" && u["Name"] !== "core"))) return { why: "the Space browser takes no ulimit but nofile and core" };
  if (h["AutoRemove"] === true) return { why: "the Space browser is removed by Vyre, not by Docker" };
  const net = isObj(body["NetworkingConfig"]) && isObj(body["NetworkingConfig"]["EndpointsConfig"]) ? Object.keys(body["NetworkingConfig"]["EndpointsConfig"]) : [];
  if (net.some((n) => n !== SBROWSER_NET)) return { why: "the Space browser joins its own network only" };
  return { body: { ...body, HostConfig: { ...h, CapAdd: [], Privileged: false, LogConfig: LOGS, Devices: [], PidMode: "" } } };
}

/** The Space browser's network: a plain bridge with its label. Only it and the ingress join. */
export function sbrowserNetworkBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the network config is not an object" };
  for (const k of Object.keys(body)) if (!["Name", "Driver", "Labels", "CheckDuplicate", "Internal", "Options"].includes(k)) return { why: `the Space browser network may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  if (labels["vyre.sbrowser"] !== "1") return { why: "the Space browser network carries vyre.sbrowser=1" };
  if (body["Name"] !== SBROWSER_NET) return { why: "the Space browser network is named vyre-sbrowsernet" };
  if (body["Driver"] !== undefined && body["Driver"] !== "bridge") return { why: "the Space browser network is a bridge" };
  if (isObj(body["Options"]) && Object.keys(body["Options"]).some((k) => k !== "com.docker.network.bridge.enable_icc")) return { why: "the Space browser network takes no driver options" };
  return { body: { Name: SBROWSER_NET, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" }, ...(body["Internal"] === true ? { Internal: true } : {}) } };
}

/** What the Space browser's container may be asked: read it, start, stop and remove it, run browserd's control program in it. No archive (no file goes in or out) and no wait. */
export function sbrowserAllows(action: string, _method: string, _query: URLSearchParams): boolean {
  return ["json", "logs", "start", "stop", "restart", "remove", "exec"].includes(action);
}
