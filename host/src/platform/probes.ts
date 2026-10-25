// Host probes (spec 4.18, ARCH 7.13): the eight facts the health module's `health.<probe>` capabilities read from health_probe. Each probe is a cheap, idempotent read that answers
// {state, detail?, latencyMs?, values?}. The daemon writes the results on a schedule; `vyre-server doctor` runs the same functions once, with no gateway.
// disk_encrypted is Lead ruling Q1: the data directory must sit on an encrypted volume (FileVault on Mac, LUKS or dm-crypt on Linux). P-L7b_04 may replace `diskEncrypted` with its recorded-output version; the daemon takes it as an option.
import type { Platform } from "./index.ts";

export type ProbeState = "healthy" | "degraded" | "down";
export interface ProbeResult { state: ProbeState; detail?: string; latencyMs?: number; values?: Record<string, number> }
export type ProbeName = "disk_encrypted" | "events_db" | "index_db" | "scheduler" | "docker" | "caddy" | "disk_space" | "time_skew";
export const PROBE_NAMES: readonly ProbeName[] = ["disk_encrypted", "events_db", "index_db", "scheduler", "docker", "caddy", "disk_space", "time_skew"];
export type FetchFn = (url: string, init?: { method?: string; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

const result = (state: ProbeState, detail: string, extra: Omit<ProbeResult, "state" | "detail"> = {}): ProbeResult => ({ state, detail, ...extra });

// ---- disk encryption

/** `fdesetup status` prints "FileVault is On." or "FileVault is Off." */
export function parseFdesetup(out: string): boolean | null {
  if (/FileVault is On/i.test(out)) return true;
  if (/FileVault is Off/i.test(out)) return false;
  return null;
}

/** `lsblk -s -no TYPE <device>` lists the device and everything under it: a `crypt` row means dm-crypt/LUKS sits in the stack. */
export function stackIsEncrypted(lsblkTypes: string): boolean {
  return lsblkTypes.split("\n").some((l) => l.trim().toLowerCase() === "crypt");
}

export async function diskEncrypted(p: Platform, dataDir: string): Promise<ProbeResult> {
  if (p.os === "darwin") {
    const r = await p.run("fdesetup", ["status"]);
    const on = r.code === 0 || r.stdout ? parseFdesetup(r.stdout) : null;
    if (on === true) return result("healthy", "FileVault is on.");
    if (on === false) return result("down", "FileVault is off. Turn it on in System Settings, Privacy and Security, then run vyre-server doctor.");
    return result("degraded", "Could not read the FileVault state.");
  }
  if (p.os === "linux") {
    const m = await p.run("findmnt", ["-n", "-o", "SOURCE", "--target", dataDir]);
    const source = m.stdout.trim().split("\n")[0]?.trim() ?? "";
    if (m.code !== 0 || !source) return result("degraded", "Could not find the volume that holds the data directory.");
    const t = await p.run("lsblk", ["-s", "-n", "-o", "TYPE", source]);
    if (t.code !== 0) return result("degraded", `Could not inspect ${source}.`);
    return stackIsEncrypted(t.stdout)
      ? result("healthy", `${source} sits on an encrypted volume.`)
      : result("down", `${source} is not encrypted. Put the data directory on a LUKS or dm-crypt volume.`);
  }
  return result("degraded", `Disk encryption cannot be checked on ${p.os}.`);
}

// ---- disk space

export const DISK_DEGRADED_BELOW = 5_000_000_000;
export const DISK_DOWN_BELOW = 500_000_000;

export function diskSpace(p: Platform, dataDir: string): ProbeResult {
  const free = p.freeBytes(dataDir);
  if (free === null) return result("degraded", "Could not read free disk space.");
  const gb = (free / 1e9).toFixed(1);
  const state: ProbeState = free < DISK_DOWN_BELOW ? "down" : free < DISK_DEGRADED_BELOW ? "degraded" : "healthy";
  return result(state, `${gb} GB free.`, { values: { freeBytes: Math.floor(free) } });
}

// ---- docker and caddy

export async function docker(p: Platform): Promise<ProbeResult> {
  const t0 = p.now();
  const r = await p.run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 4000 });
  const latencyMs = p.now() - t0;
  if (r.code === 0) return result("healthy", `Docker ${r.stdout.trim()} answers.`, { latencyMs });
  if (r.code === 127) return result("down", "Docker is not installed. Run vyre-server install.", { latencyMs });
  if (r.code === 124) return result("down", "Docker did not answer within 4 seconds.", { latencyMs });
  return result("down", "Docker is installed but not running. Start Docker or Colima.", { latencyMs });
}

export async function caddy(fetchFn: FetchFn, adminUrl: string, now: () => number): Promise<ProbeResult> {
  const t0 = now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    timer.unref();
    // Node's fetch sends Sec-Fetch-Mode: cors, which Caddy's admin API reads as a browser and answers 403 ("not allowed to access from origin ''") unless the request names an allowed
    // Origin. The admin address is on its own allow list, so the probe names it.
    const r = await fetchFn(`${adminUrl.replace(/\/$/, "")}/config/`, { signal: ctl.signal, headers: { origin: new URL(adminUrl).origin } }).finally(() => clearTimeout(timer));
    const latencyMs = now() - t0;
    if (!r.ok) return result("down", `Caddy admin answered ${r.status}.`, { latencyMs });
    const body = (await r.text()).trim();
    return body === "" || body === "null" ? result("degraded", "Caddy runs but has no routes loaded.", { latencyMs }) : result("healthy", "Caddy answers and routes are loaded.", { latencyMs });
  } catch {
    return result("down", "Caddy admin API does not answer.", { latencyMs: now() - t0 });
  }
}

// ---- scheduler, events, index, clock

export const SCHEDULER_STALE_MS = 60_000;
export function schedulerTick(lastTickAt: number | null, now: number): ProbeResult {
  if (lastTickAt === null) return result("down", "The scheduler has not ticked yet.");
  const age = now - lastTickAt;
  return age <= SCHEDULER_STALE_MS ? result("healthy", `Ticked ${Math.round(age / 1000)} s ago.`, { values: { ageMs: age } }) : result("down", `The scheduler has not ticked for ${Math.round(age / 1000)} s.`, { values: { ageMs: age } });
}

export interface EventsCheck { ok: boolean; seq: number; why?: string; queue?: number; latencyMs?: number }
export function eventsDb(c: EventsCheck): ProbeResult {
  if (!c.ok) return result("down", `events.db failed verification${c.why ? `: ${c.why}` : ""}.`, { ...(c.latencyMs !== undefined ? { latencyMs: c.latencyMs } : {}), values: { seq: c.seq } });
  const queue = c.queue ?? 0;
  const out: ProbeResult = { state: queue > 100 ? "degraded" : "healthy", detail: queue > 100 ? `The writer queue holds ${queue} events.` : `Chain verifies through event ${c.seq}.`, values: { seq: c.seq, queue } };
  if (c.latencyMs !== undefined) out.latencyMs = c.latencyMs;
  return out;
}

/** lag = events the search index is behind the log head, or null when the Space has no index yet. */
export function indexLag(lag: number | null): ProbeResult {
  if (lag === null) return result("healthy", "No search index is configured yet.", { values: { lag: 0 } });
  return lag <= 100 ? result("healthy", lag === 0 ? "The index is caught up." : `The index is ${lag} events behind.`, { values: { lag } }) : result(lag <= 10_000 ? "degraded" : "down", `The index is ${lag} events behind the log.`, { values: { lag } });
}

/** Skew against a time source (the relay's Date header). HLC clamps at 5 minutes; the health def degrades at 60 s and fails at 300 s. */
export async function timeSkew(fetchFn: FetchFn | null, url: string | null, now: () => number): Promise<ProbeResult> {
  if (!fetchFn || !url) return result("healthy", "No relay configured to compare against.", { values: { skewMs: 0 } });
  const t0 = now();
  try {
    const r = await fetchFn(url, { method: "HEAD" });
    const t1 = now();
    const date = r.headers.get("date");
    const remote = date ? Date.parse(date) : NaN;
    if (!Number.isFinite(remote)) return result("degraded", "The relay sent no usable Date header.", { latencyMs: t1 - t0 });
    const skewMs = Math.abs((t0 + t1) / 2 - remote);
    const state: ProbeState = skewMs > 300_000 ? "down" : skewMs > 60_000 ? "degraded" : "healthy";
    return result(state, `Clock differs from the relay by ${Math.round(skewMs / 1000)} s.`, { latencyMs: t1 - t0, values: { skewMs: Math.round(skewMs) } });
  } catch {
    return result("degraded", "The relay did not answer, so the clock was not compared.", { latencyMs: now() - t0 });
  }
}
