// What the sites runner lets through to Docker (owner, 3 Nov: Vyre never holds the full Docker socket). Every request from vyred is judged here before the runner forwards it; anything
// not named below is refused. Allowed: build an image tagged vyre-site/<site>:<deployment>; fetch the two database images; make a site's own network vyre-site-<site> and join to it only
// that site's containers and the ingress (the vyred and Caddy service, labelled vyre.ingress); create a container that carries vyre.site=<site>, sits on its site's network only, runs with
// every capability dropped, no new privileges, a CPU, memory and process cap, rotated logs, and no host path, device, port or namespace; start, stop, read, remove and log only containers
// that carry vyre.site; exec only into those, as their own user; remove only vyre-site images, volumes and networks. So one site cannot reach another site or its database.
import { COMPUTER_NAME, COMPUTER_NET, HELPER_NAME_RE, PROFILE_VOLUME, SBROWSER_NAME, SBROWSER_NET, SBROWSER_VOLUME, archiveOk, isComputerImage, isSbrowserImage } from "./computers-policy.ts";

/** A site's own network: its app, its Postgres and Redis, and the ingress. */
export const networkOf = (siteId: string): string => `vyre-site-${siteId.replace(/^sit_/, "").slice(-16)}`;
const NET_NAME = /^vyre-site-[a-z0-9]{1,16}$/;
export const SITE_ID = /^sit_[a-z0-9]{1,64}$/;
export const ADDON_IMAGES: Readonly<Record<string, string>> = { postgres: "postgres:16-alpine", redis: "redis:7-alpine" };
export const MAX = { nanoCpus: 4e9, memory: 8 * 1024 ** 3, pids: 1024, buildMemory: 4 * 1024 ** 3, buildCpuQuota: 400_000 };
export const LOGS = { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } };

export type Verdict =
  | { ok: true; kind: "plain" | "body" | "build" | "exec-create" | "exec-use"; path?: string; body?: unknown; container?: string }
  | { ok: false; status: number; why: string };

export interface Request { method: string; path: string; query: URLSearchParams }

const no = (why: string, status = 403): Verdict => ({ ok: false, status, why });
const hexOf = (siteId: string): string => siteId.replace(/^sit_/, "");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The path without the API version Docker clients put in front (/v1.47/...). */
export function bare(path: string): string { return path.replace(/^\/v\d+\.\d+(?=\/)/, ""); }

/** A query a build may carry, with the caps written in; null when it asks for anything else. */
export function buildQuery(q: URLSearchParams): { query: URLSearchParams; siteId: string } | { why: string } {
  const allowed = new Set(["t", "dockerfile", "rm", "forcerm", "buildargs", "labels", "memory", "memswap", "cpuperiod", "cpuquota", "pull", "nocache", "q"]);
  for (const k of q.keys()) if (!allowed.has(k)) return { why: `a build may not set ${k}` };
  let labels: Record<string, unknown>;
  try { labels = JSON.parse(q.get("labels") ?? "{}") as Record<string, unknown>; } catch { return { why: "the build labels are not JSON" }; }
  const siteId = String(labels["vyre.site"] ?? "");
  if (!SITE_ID.test(siteId)) return { why: "a build must carry vyre.site=<site>" };
  const tag = q.get("t") ?? "";
  if (!new RegExp(`^vyre-site/${hexOf(siteId)}:[a-z0-9]{1,64}$`).test(tag)) return { why: "a build is tagged vyre-site/<its site>:<deployment>" };
  const out = new URLSearchParams(q);
  const mem = Math.min(Number(q.get("memory")) || MAX.buildMemory, MAX.buildMemory);
  out.set("memory", String(mem));
  out.set("memswap", String(mem * 2));
  out.set("cpuperiod", "100000");
  out.set("cpuquota", String(Math.min(Number(q.get("cpuquota")) || MAX.buildCpuQuota, MAX.buildCpuQuota)));
  return { query: out, siteId };
}

const HOST_KEYS = new Set(["NetworkMode", "RestartPolicy", "LogConfig", "NanoCpus", "Memory", "MemorySwap", "PidsLimit", "SecurityOpt", "Init", "CapDrop", "CapAdd", "Tmpfs", "Binds", "StorageOpt", "ReadonlyRootfs"]);
const TOP_KEYS = new Set(["Image", "Env", "Cmd", "ExposedPorts", "Labels", "HostConfig", "NetworkingConfig", "User", "WorkingDir", "Hostname"]);

/** A container create body: the site's own, on its network, inside the caps. Returns the body with the log rotation and the drop of every capability written in. */
export function containerBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the container config is not an object" };
  for (const k of Object.keys(body)) if (!TOP_KEYS.has(k) && body[k] !== undefined && body[k] !== null) return { why: `a site container may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const siteId = String(labels["vyre.site"] ?? "");
  if (!SITE_ID.test(siteId)) return { why: "a container must carry vyre.site=<site>" };
  const hex = hexOf(siteId);
  const kind = String(labels["vyre.kind"] ?? "");
  if (!["app", "postgres", "redis"].includes(kind)) return { why: "a site container is an app, postgres or redis" };
  if ("vyre.ingress" in labels) return { why: "a site container cannot be the ingress" };
  if (!name.startsWith(`vyre-site-${hex.slice(-12)}-`)) return { why: "a site container is named vyre-site-<its site>-..." };
  const image = String(body["Image"] ?? "");
  if (kind === "app" ? !image.startsWith(`vyre-site/${hex}:`) : image !== ADDON_IMAGES[kind]) return { why: kind === "app" ? "an app runs its own site's image" : `${kind} runs ${ADDON_IMAGES[kind]}` };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a site container needs its limits" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h)) if (!HOST_KEYS.has(k) && h[k] !== undefined && h[k] !== null && h[k] !== false && !(Array.isArray(h[k]) && (h[k] as unknown[]).length === 0) && !(isObj(h[k]) && Object.keys(h[k] as object).length === 0)) return { why: `a site container may not set ${k}` };
  if (h["NetworkMode"] !== networkOf(siteId)) return { why: "a site container is on its own site's network only" };
  const nano = Number(h["NanoCpus"]), mem = Number(h["Memory"]), pids = Number(h["PidsLimit"]);
  if (!(nano > 0 && nano <= MAX.nanoCpus)) return { why: "a site container needs a CPU cap of at most 4 CPUs" };
  if (!(mem > 0 && mem <= MAX.memory) || Number(h["MemorySwap"]) !== mem) return { why: "a site container needs a memory cap of at most 8 GB and no swap" };
  if (!(pids > 0 && pids <= MAX.pids)) return { why: "a site container needs a process cap of at most 1024" };
  const caps = Array.isArray(h["CapAdd"]) ? (h["CapAdd"] as unknown[]) : [];
  if (caps.some((c) => c !== "NET_BIND_SERVICE")) return { why: "a site container gets no capability but binding low ports" };
  const sec = Array.isArray(h["SecurityOpt"]) ? (h["SecurityOpt"] as unknown[]) : [];
  if (sec.some((o) => o !== "no-new-privileges" && o !== "no-new-privileges:true")) return { why: "a site container takes no security option but no-new-privileges" };
  const binds = Array.isArray(h["Binds"]) ? (h["Binds"] as unknown[]) : [];
  for (const b of binds) {
    const m = typeof b === "string" ? /^([^/:][^:]*):(\/[^:]+)(:rw)?$/.exec(b) : null;
    if (!m || m[1] !== `vyre-site-${hex.slice(-12)}-${kind}-data` || kind === "app") return { why: "host folders are refused: a site container mounts only its own data volume" };
  }
  const tmpfs = isObj(h["Tmpfs"]) ? h["Tmpfs"] : {};
  if (Object.keys(tmpfs).some((k) => k !== "/tmp")) return { why: "only /tmp may be a tmpfs" };
  const rp = isObj(h["RestartPolicy"]) ? String(h["RestartPolicy"]["Name"] ?? "") : "";
  if (rp !== "" && !["unless-stopped", "no", "on-failure"].includes(rp)) return { why: "that restart policy is refused" };
  const net = isObj(body["NetworkingConfig"]) && isObj(body["NetworkingConfig"]["EndpointsConfig"]) ? Object.keys(body["NetworkingConfig"]["EndpointsConfig"]) : [];
  if (net.some((n) => n !== networkOf(siteId))) return { why: "a site container joins its own site's network only" };
  return { body: { ...body, HostConfig: { ...h, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], LogConfig: LOGS, Privileged: false } } };
}

/** A site's network: a plain bridge with its label, nothing else (no host access, no IP ranges, no driver options). */
export function networkBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the network config is not an object" };
  for (const k of Object.keys(body)) if (!["Name", "Driver", "Labels", "CheckDuplicate"].includes(k)) return { why: `a site network may not set ${k}` };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  const siteId = String(labels["vyre.site"] ?? "");
  if (!SITE_ID.test(siteId)) return { why: "a site network carries vyre.site=<site>" };
  if (body["Name"] !== networkOf(siteId)) return { why: "a site network is named vyre-site-<its site>" };
  if (body["Driver"] !== undefined && body["Driver"] !== "bridge") return { why: "a site network is a bridge" };
  return { body: { Name: body["Name"], Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.site": siteId } } };
}

/** An exec into a site container: a command, its env, its output; never another user, privileged or a TTY. */
export function execBody(body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!isObj(body)) return { why: "the exec config is not an object" };
  for (const k of Object.keys(body)) if (!["Cmd", "Env", "AttachStdout", "AttachStderr", "AttachStdin", "WorkingDir", "Tty"].includes(k)) return { why: `an exec may not set ${k}` };
  if (body["Tty"] === true) return { why: "an exec may not set Tty" };
  if (!Array.isArray(body["Cmd"]) || !(body["Cmd"] as unknown[]).every((c) => typeof c === "string")) return { why: "an exec runs a list of words" };
  return { body: { ...body, Privileged: false, Tty: false } };
}

/** The first look at a request: what kind it is, or why it is refused. Requests on a container are checked again once its labels are read (siteContainer). */
export function judge(r: Request): Verdict | { ok: true; kind: "container"; id: string; action: string } | { ok: true; kind: "exec-start" | "exec-inspect"; id: string } | { ok: true; kind: "network-create" } | { ok: true; kind: "network-connect"; network: string } {
  const p = bare(r.path);
  const m = r.method.toUpperCase();
  if ((m === "GET" || m === "HEAD") && (p === "/_ping" || p === "/version")) return { ok: true, kind: "plain" };
  if (m === "POST" && p === "/build") return { ok: true, kind: "build" };
  if (m === "POST" && p === "/images/create") {
    const from = r.query.get("fromImage") ?? "";
    // a digest pull names the whole reference in fromImage and sets no tag; any other pull is repo and tag
    const ref = from.includes("@") ? (r.query.has("tag") ? `${from}:${r.query.get("tag")}` : from) : `${from}:${r.query.get("tag") ?? "latest"}`;
    for (const k of r.query.keys()) if (k !== "fromImage" && k !== "tag") return no(`a pull may not set ${k}`);
    return Object.values(ADDON_IMAGES).includes(ref) || isComputerImage(ref) || isSbrowserImage(ref) ? { ok: true, kind: "plain" } : no(`only ${Object.values(ADDON_IMAGES).join(" and ")}, the agent computer image and the Space browser image may be fetched`);
  }
  const img = /^\/images\/(.+?)(\/json)?$/.exec(p);
  if (img) {
    const name = decodeURIComponent(img[1] as string);
    const site = /^vyre-site\/[a-z0-9]{1,64}:[a-z0-9]{1,64}$/.test(name);
    if (m === "GET" && img[2] && (site || Object.values(ADDON_IMAGES).includes(name) || isComputerImage(name) || isSbrowserImage(name))) return { ok: true, kind: "plain" };
    if (m === "DELETE" && !img[2] && site) return { ok: true, kind: "plain" };
    return no("only a site's own images may be read or removed");
  }
  if (m === "POST" && p === "/containers/create") {
    const name = r.query.get("name") ?? "";
    for (const k of r.query.keys()) if (k !== "name") return no(`a create may not set ${k}`);
    return /^vyre-site-[a-z0-9-]{1,100}$/.test(name) || COMPUTER_NAME.test(name) || HELPER_NAME_RE.test(name) || name === SBROWSER_NAME ? { ok: true, kind: "body", path: name } : no("a site container is named vyre-site-..., a computer's vyre-comp-... and the Space browser's vyre-sbrowser");
  }
  const c = /^\/containers\/([A-Za-z0-9_.-]{1,128})(?:\/(json|logs|start|stop|restart|archive|exec|wait))?$/.exec(p);
  if (c) {
    const action = c[2] ?? (m === "DELETE" ? "remove" : "");
    // the first look is for the methods; which of them a container may be asked is decided once its labels say whether it is a site's or a computer's (siteAllows, computerAllows)
    const ok = (action === "json" && m === "GET") || (action === "logs" && m === "GET") || (["start", "stop", "restart", "wait"].includes(action) && m === "POST") || (action === "remove" && m === "DELETE")
      || (action === "archive" && ["PUT", "GET", "HEAD"].includes(m)) || (action === "exec" && m === "POST");
    if (!ok) return no("that is not something a container of Vyre's may be asked");
    if (action === "logs") for (const k of r.query.keys()) if (!["stdout", "stderr", "tail", "timestamps", "since"].includes(k)) return no(`logs may not set ${k}`);
    return { ok: true, kind: "container", id: c[1] as string, action };
  }
  const e = /^\/exec\/([a-f0-9]{64})\/(start|json)$/.exec(p);
  if (e) return m === "POST" && e[2] === "start" ? { ok: true, kind: "exec-start", id: e[1] as string } : m === "GET" && e[2] === "json" ? { ok: true, kind: "exec-inspect", id: e[1] as string } : no("that exec call is refused");
  if (m === "POST" && p === "/networks/create") return { ok: true, kind: "network-create" };
  const net = /^\/networks\/([a-z0-9-]{1,40})(?:\/(connect))?$/.exec(p);
  if (net && (NET_NAME.test(net[1] as string) || COMPUTER_NET.test(net[1] as string) || net[1] === SBROWSER_NET)) {
    if (m === "GET" && !net[2]) return { ok: true, kind: "plain" };
    if (m === "DELETE" && !net[2]) return { ok: true, kind: "plain" };
    if (m === "POST" && net[2] === "connect") return { ok: true, kind: "network-connect", network: net[1] as string };
  }
  if (net) return no("only a site's, a computer's or the Space browser's own network may be read, made, joined or removed");
  if (m === "DELETE" && /^\/volumes\/vyre-site-[a-z0-9]{1,12}-(postgres|redis)-data$/.test(p)) return { ok: true, kind: "plain" };
  if (m === "DELETE" && PROFILE_VOLUME.test(p.replace(/^\/volumes\//, ""))) return { ok: true, kind: "plain" };
  if (m === "DELETE" && p === `/volumes/${SBROWSER_VOLUME}`) return { ok: true, kind: "plain" };
  return no("the sites runner does not do that");
}

/** What a site's container may be asked, by method and query. */
export function siteAllows(action: string, method: string, query: URLSearchParams): boolean {
  if (action === "archive") return method === "PUT" && query.get("path") === "/tmp";
  return action !== "wait";
}

/** What a computer's container may be asked: everything a site's may, and read and write inside its own home. The removal helper is the one container that is waited for. */
export function computerAllows(action: string, method: string, query: URLSearchParams, helper: boolean): boolean {
  if (helper) return action === "start" || action === "wait" || action === "remove" || action === "json";
  if (action === "wait") return false;
  if (action === "archive") return archiveOk(method, query);
  return true;
}
