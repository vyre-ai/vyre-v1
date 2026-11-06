// What the runner lets through for AGENT WORKSPACES (6 Nov), the same pattern as agent computers (computers-policy.ts): every request is judged here before Docker sees it, and anything not named is
// refused. A workspace is one container vyre-ws-<agent> from the workspace image, labelled vyre.workspace=<agent> and vyre.mounts=<hash>, on a network of its own, vyre-wsnet-<hash>, so one agent's
// workspace cannot reach another's. It mounts only named volumes: its home (vyre-ws-<agent>-home), its Files folder (vyre-ws-<agent>-files) and one shared volume per project, vyre-wsproj-<project>,
// which every agent on the project mounts; never a host folder. It runs as 10001, with every capability dropped, no new privileges, a CPU, memory and process cap, rotated logs and no host
// namespace. The one other container is the project-folder helper (a new volume's root belongs to root; the helper, with the one capability CHOWN, no network and a fixed command, gives it to 10001).
// Exec is allowed on a workspace; archive and wait are not. Mirrors modules/terminal/workspace.ts (reviewWorkspaceConfig, projectInitBody), which a test holds together with this file.
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export const WS_AGENT = /^[A-Za-z0-9_-]{1,64}$/;
export const WS_NAME = /^vyre-ws-[A-Za-z0-9_-]{1,64}$/;
export const WS_INIT_NAME = /^vyre-wsinit-[A-Za-z0-9_-]{1,64}$/;
export const WS_NET = /^vyre-wsnet-[a-f0-9]{16}$/;
export const WS_VOLUME = /^vyre-ws-[A-Za-z0-9_-]{1,64}-(home|files)$/;
export const WS_PROJECT_VOLUME = /^vyre-wsproj-[A-Za-z0-9_-]{1,64}$/;
export const wsAgentOf = (name: string): string => name.replace(/^vyre-ws-/, "");
export const wsNetOf = (agentId: string, sha16: string): boolean => WS_NET.test(`vyre-wsnet-${sha16}`) && agentId !== "";
/** The workspace image: the default, the registry copy, by tag or by digest. More repositories can be named in VYRE_WORKSPACE_IMAGES (comma separated). */
export function workspaceImages(extra = process.env["VYRE_WORKSPACE_IMAGES"] ?? ""): RegExp {
  const repos = ["vyre/agent-workspace", "ghcr.io/vyre-ai/agent-workspace", ...extra.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9./_-]{0,100}$/.test(s))];
  return new RegExp(`^(${repos.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")}):[A-Za-z0-9_.-]{1,64}$`);
}
export const WS_DIGEST = /^(vyre\/agent-workspace|ghcr\.io\/vyre-ai\/agent-workspace)@sha256:[0-9a-f]{64}$/;
export const isWorkspaceImage = (name: string): boolean => workspaceImages().test(name) || WS_DIGEST.test(name);

export const WS_MAX = { nanoCpus: 4e9, memory: 8 * 1024 ** 3, pids: 2048 };
const LOGS = { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } };
export const WS_HOME = "/home/agent";
/** The one command the project-folder helper runs (modules/terminal/workspace.ts PROJECT_INIT_SCRIPT is the same text; a test holds the two together). */
export const WS_INIT_SCRIPT = "chown 10001:10001 /vol && chmod 2775 /vol";

const TOP_KEYS = new Set(["Image", "Hostname", "User", "WorkingDir", "Cmd", "Env", "Labels", "StopTimeout", "HostConfig", "NetworkingConfig"]);
const HOST_KEYS = new Set(["Binds", "ReadonlyRootfs", "Tmpfs", "CapDrop", "CapAdd", "SecurityOpt", "Privileged", "NetworkMode", "PidMode", "IpcMode", "UsernsMode", "Devices", "PidsLimit", "Memory", "MemorySwap", "NanoCpus", "Init", "AutoRemove", "Ulimits", "LogConfig", "ExtraHosts", "Dns"]);
const emptyish = (v: unknown): boolean => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

/** The agent a workspace container's labels name, or null. */
export function workspaceOf(labels: Record<string, string> | null | undefined): string | null {
  const id = labels?.["vyre.workspace"] ?? "";
  return WS_AGENT.test(id) ? id : null;
}
/** The project a project-folder helper's labels name, or null. */
export function workspaceHelperOf(labels: Record<string, string> | null | undefined): string | null {
  const id = labels?.["vyre.workspace.project"] ?? "";
  return labels?.["vyre.workspace.helper"] === "project-init" && WS_AGENT.test(id) ? id : null;
}

/** A workspace's container create body, or why it is refused. `netOf` turns the agent id into the network's name (the module hashes it). */
export function workspaceBody(name: string, body: unknown, netOk: (agentId: string, net: string) => boolean): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the container config is not an object" };
  for (const k of Object.keys(body)) if (!TOP_KEYS.has(k) && !emptyish(body[k])) return { why: `a workspace container may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const agent = String(labels["vyre.workspace"] ?? "");
  if (!WS_AGENT.test(agent)) return { why: "a container must carry vyre.workspace=<agent>" };
  for (const k of Object.keys(labels)) if (k !== "vyre.workspace" && k !== "vyre.mounts") return { why: `a workspace container may not carry the label ${k}` };
  if (name !== `vyre-ws-${agent}`) return { why: "a workspace container is named vyre-ws-<its agent>" };
  if (!isWorkspaceImage(String(body["Image"] ?? ""))) return { why: "a workspace runs the agent workspace image" };
  if (body["Hostname"] !== undefined && body["Hostname"] !== name) return { why: "a workspace's hostname is its container name" };
  if (body["User"] !== "10001:10001") return { why: "a workspace runs as 10001:10001" };
  const cmd = Array.isArray(body["Cmd"]) ? (body["Cmd"] as unknown[]) : [];
  if (cmd.length > 0 && !(cmd.length === 2 && cmd[0] === "sleep" && cmd[1] === "infinity")) return { why: "a workspace container only waits (sleep infinity); every command is an exec" };
  const env = Array.isArray(body["Env"]) ? (body["Env"] as unknown[]) : [];
  for (const e of env) if (typeof e !== "string" || !(e === `VYRE_WORKSPACE_AGENT=${agent}` || e === "HOME=/home/agent" || e === "TERM=xterm-256color" || e === "LANG=en_US.UTF-8")) return { why: "a workspace's environment is its agent, home, terminal type and language" };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a workspace container needs its limits" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!HOST_KEYS.has(k) && !emptyish(h[k])) return { why: `a workspace container may not set HostConfig.${k}` };
  if (typeof h["NetworkMode"] !== "string" || !netOk(agent, h["NetworkMode"])) return { why: "a workspace is on its own network only" };
  if (!emptyish(h["PidMode"])) return { why: "the host pid namespace is refused (PidMode)" };
  if (h["IpcMode"] !== undefined && h["IpcMode"] !== "private") return { why: "a workspace's ipc namespace is private" };
  if (!emptyish(h["UsernsMode"])) return { why: "a user namespace mode is refused" };
  if (!emptyish(h["Devices"])) return { why: "devices are refused (Devices)" };
  if (!emptyish(h["ExtraHosts"]) || !emptyish(h["Dns"])) return { why: "a workspace takes no extra hosts or DNS servers" };
  if (!emptyish(h["CapAdd"])) return { why: "a workspace container gets no capability (CapAdd)" };
  if (!Array.isArray(h["CapDrop"]) || !(h["CapDrop"] as unknown[]).includes("ALL")) return { why: "every capability must be dropped" };
  const sec = Array.isArray(h["SecurityOpt"]) ? (h["SecurityOpt"] as unknown[]) : [];
  if (!sec.includes("no-new-privileges:true") && !sec.includes("no-new-privileges")) return { why: "new privileges must be off" };
  if (sec.some((o) => o !== "no-new-privileges:true" && o !== "no-new-privileges")) return { why: "a workspace container takes no security option but no-new-privileges (Docker's own seccomp profile stays)" };
  const binds = Array.isArray(h["Binds"]) ? (h["Binds"] as unknown[]) : [];
  for (const b of binds) {
    const m = typeof b === "string" ? /^([^/:][^:]*):(\/[^:]+):rw$/.exec(b) : null;
    const src = m?.[1] ?? "";
    const guest = m?.[2] ?? "";
    const ok = m !== null && ((src === `${name}-home` && guest === WS_HOME) || (src === `${name}-files` && guest === `${WS_HOME}/Vyre`) || (WS_PROJECT_VOLUME.test(src) && guest === `${WS_HOME}/projects/${src.replace(/^vyre-wsproj-/, "")}`));
    if (!ok) return { why: "host folders are refused: a workspace mounts only its own home and files volumes and its projects' shared volumes" };
  }
  const tmpfs = isObj(h["Tmpfs"]) ? h["Tmpfs"] : {};
  if (Object.keys(tmpfs).some((k) => k !== "/tmp")) return { why: "only /tmp may be a tmpfs" };
  const nano = Number(h["NanoCpus"]), mem = Number(h["Memory"]), pids = Number(h["PidsLimit"]);
  if (!(nano > 0 && nano <= WS_MAX.nanoCpus)) return { why: "a workspace needs a CPU cap of at most 4 CPUs" };
  if (!(mem > 0 && mem <= WS_MAX.memory) || Number(h["MemorySwap"]) !== mem) return { why: "a workspace needs a memory cap of at most 8 GB and no swap" };
  if (!(pids > 0 && pids <= WS_MAX.pids)) return { why: "a workspace needs a process cap of at most 2048" };
  const ul = Array.isArray(h["Ulimits"]) ? (h["Ulimits"] as unknown[]) : [];
  if (ul.some((u) => !isObj(u) || (u["Name"] !== "nofile" && u["Name"] !== "core"))) return { why: "a workspace takes no ulimit but nofile and core" };
  if (h["AutoRemove"] === true) return { why: "a workspace is removed by Vyre, not by Docker" };
  const net = isObj(body["NetworkingConfig"]) && isObj(body["NetworkingConfig"]["EndpointsConfig"]) ? Object.keys(body["NetworkingConfig"]["EndpointsConfig"]) : [];
  if (net.some((n) => !netOk(agent, n))) return { why: "a workspace joins its own network only" };
  return { body: { ...body, HostConfig: { ...h, CapAdd: [], Privileged: false, LogConfig: LOGS, Devices: [], PidMode: "" } } };
}

/** The project-folder helper: the workspace image as root with CHOWN only, on no network, sharing nothing but the project's new volume, running only the fixed command. */
export function workspaceInitBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!WS_INIT_NAME.test(name)) return { why: "a helper is named vyre-wsinit-<its project>" };
  if (!isObj(body)) return { why: "the container config is not an object" };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const project = String(labels["vyre.workspace.project"] ?? "");
  if (!WS_AGENT.test(project) || name !== `vyre-wsinit-${project}` || labels["vyre.workspace.helper"] !== "project-init") return { why: "a helper carries vyre.workspace.helper=project-init and vyre.workspace.project=<its project>" };
  for (const k of Object.keys(labels)) if (k !== "vyre.workspace.helper" && k !== "vyre.workspace.project") return { why: `a helper may not carry the label ${k}` };
  if (!isWorkspaceImage(String(body["Image"] ?? ""))) return { why: "a helper runs the agent workspace image" };
  const ep = Array.isArray(body["Entrypoint"]) ? (body["Entrypoint"] as unknown[]) : [];
  if (ep.length !== 3 || ep[0] !== "sh" || ep[1] !== "-c" || ep[2] !== WS_INIT_SCRIPT) return { why: "a helper runs only the folder script" };
  if (body["User"] !== "0:0") return { why: "a helper runs as root, with CHOWN alone" };
  for (const k of Object.keys(body)) if (!["Image", "Entrypoint", "Cmd", "User", "NetworkDisabled", "HostConfig", "Labels"].includes(k) && !emptyish(body[k])) return { why: `a helper may not set ${k}` };
  if (!emptyish(body["Cmd"])) return { why: "a helper takes no command words" };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a helper needs its host config" };
  const binds = Array.isArray(h["Binds"]) ? (h["Binds"] as unknown[]) : [];
  if (binds.length !== 1 || binds[0] !== `vyre-wsproj-${project}:/vol:rw`) return { why: "a helper mounts only its project's volume at /vol" };
  const caps = Array.isArray(h["CapAdd"]) ? (h["CapAdd"] as unknown[]) : [];
  if (caps.length !== 1 || caps[0] !== "CHOWN") return { why: "a helper gets the one capability CHOWN" };
  if (h["NetworkMode"] !== "none") return { why: "a helper has no network" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!["Binds", "CapDrop", "CapAdd", "SecurityOpt", "NetworkMode", "Privileged", "AutoRemove", "Memory", "PidsLimit"].includes(k) && !emptyish(h[k])) return { why: `a helper may not set HostConfig.${k}` };
  return { body: { Image: body["Image"], User: "0:0", Entrypoint: ["sh", "-c", WS_INIT_SCRIPT], NetworkDisabled: true, Labels: { "vyre.workspace.helper": "project-init", "vyre.workspace.project": project }, HostConfig: { Binds: [`vyre-wsproj-${project}:/vol:rw`], CapDrop: ["ALL"], CapAdd: ["CHOWN"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false, Memory: 128 * 1024 * 1024, PidsLimit: 32 } } };
}

/** A workspace's network: a plain bridge with its label. */
export function workspaceNetworkBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the network config is not an object" };
  for (const k of Object.keys(body)) if (!["Name", "Driver", "Labels", "CheckDuplicate"].includes(k)) return { why: `a workspace network may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const agent = String(labels["vyre.workspace"] ?? "");
  if (!WS_AGENT.test(agent) || Object.keys(labels).some((k) => k !== "vyre.workspace")) return { why: "a workspace network carries vyre.workspace=<agent>" };
  if (typeof body["Name"] !== "string" || !WS_NET.test(body["Name"])) return { why: "a workspace network is named vyre-wsnet-<hash>" };
  if (body["Driver"] !== undefined && body["Driver"] !== "bridge") return { why: "a workspace network is a bridge" };
  return { body: { Name: body["Name"], Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": agent } } };
}

/** A project's shared volume: a plain local volume with its label. */
export function workspaceVolumeBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the volume config is not an object" };
  for (const k of Object.keys(body)) if (!["Name", "Labels"].includes(k)) return { why: `a workspace volume may not set ${k}` };
  const name = String(body["Name"] ?? "");
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  if (!WS_PROJECT_VOLUME.test(name) || labels["vyre.workspace.project"] !== name.replace(/^vyre-wsproj-/, "") || Object.keys(labels).some((k) => k !== "vyre.workspace.project")) return { why: "a workspace volume is a project's: vyre-wsproj-<project>, labelled with it" };
  return { body: { Name: name, Labels: { "vyre.workspace.project": name.replace(/^vyre-wsproj-/, "") } } };
}

/** What a workspace container may be asked: start, stop, inspect, remove, logs and exec. Not archive (files travel through the mounts) and not wait. The helper is the one container that is waited for. */
export function workspaceAllows(action: string, helper: boolean): boolean {
  if (helper) return action === "start" || action === "wait" || action === "remove" || action === "json";
  return action === "start" || action === "stop" || action === "restart" || action === "json" || action === "logs" || action === "remove" || action === "exec";
}

/** The list of workspaces: only the ones that carry the workspace label, and only the two query words. */
export function workspaceListOk(query: URLSearchParams): boolean {
  for (const k of query.keys()) if (k !== "all" && k !== "filters") return false;
  const all = query.get("all");
  if (all !== null && all !== "true" && all !== "false") return false;
  try { const f = JSON.parse(query.get("filters") ?? "") as { label?: unknown }; return isObj(f) && Object.keys(f).length === 1 && Array.isArray(f.label) && f.label.length === 1 && f.label[0] === "vyre.workspace"; } catch { return false; }
}
