// What a computer says about itself every 30 seconds for the Machines page: its specs, how busy it is, what Vyre runs on it and what it can run. The same sampler serves the Space server (stored
// straight into the network tables) and a person's own computer (sent over the device link as a {t:"report"} frame, stored by the Space). It reads the operating system and nothing else: no file
// names, no process names. Only Vyre's own share of the load is reported besides the machine's whole.
import fs from "node:fs";
import os from "node:os";
import { cleanReport, recordReport } from "../../../lib/machines.ts";
import type { Db, Report, Runs } from "../../../lib/machines.ts";

export interface OsLike {
  cpus(): { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[];
  totalmem(): number; freemem(): number; platform(): string; arch(): string; release(): string; type(): string;
}
export interface SamplerDeps {
  os?: OsLike;
  /** Bytes free and total on the volume of a folder; null when it cannot be read. */
  disk?: (dir: string) => { free: number; total: number } | null;
  /** Bytes received and sent since boot (Linux: /proc/net/dev); null where there is no such count. */
  net?: () => { rx: number; tx: number } | null;
  /** CPU time this process has used, in microseconds, and its resident memory. */
  self?: () => { cpuUs: number; rss: number };
  now?: () => number;
  dir: string;
  version: string;
}

const defaultDisk = (dir: string): { free: number; total: number } | null => {
  try { const s = fs.statfsSync(dir); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
};
const defaultNet = (): { rx: number; tx: number } | null => {
  try {
    let rx = 0, tx = 0;
    for (const line of fs.readFileSync("/proc/net/dev", "utf8").split("\n").slice(2)) {
      const [name, rest] = line.split(":");
      if (!name || !rest || name.trim() === "lo") continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] ?? 0; tx += f[8] ?? 0;
    }
    return { rx, tx };
  } catch { return null; }
};
const defaultSelf = (): { cpuUs: number; rss: number } => { const c = process.cpuUsage(); return { cpuUs: c.user + c.system, rss: process.memoryUsage().rss }; };

export interface Sampler { sample(): Pick<Report, "specs" | "load"> }

/** Each sample is measured against the one before it (CPU time, network bytes), so the first answers with no CPU or network and the second onwards are real. */
export function createSampler(d: SamplerDeps): Sampler {
  const o = d.os ?? os, disk = d.disk ?? defaultDisk, net = d.net ?? defaultNet, self = d.self ?? defaultSelf, now = d.now ?? Date.now;
  let last: { at: number; busy: number; total: number; rx: number; tx: number; cpuUs: number } | null = null;
  return {
    sample() {
      const cpus = o.cpus(), at = now();
      let busy = 0, total = 0;
      for (const c of cpus) { const t = c.times; busy += t.user + t.nice + t.sys + t.irq; total += t.user + t.nice + t.sys + t.irq + t.idle; }
      const n = net(), me = self(), dsk = disk(d.dir);
      let cpu = 0, inBps = 0, outBps = 0, vyre = 0;
      if (last && at > last.at) {
        const dt = (at - last.at) / 1000;
        cpu = total > last.total ? ((busy - last.busy) / (total - last.total)) * 100 : 0;
        if (n) { inBps = Math.max(0, (n.rx - last.rx) / dt); outBps = Math.max(0, (n.tx - last.tx) / dt); }
        vyre = Math.max(0, (me.cpuUs - last.cpuUs) / 1e6 / dt / Math.max(1, cpus.length)) * 100;
      }
      last = { at, busy, total, rx: n?.rx ?? 0, tx: n?.tx ?? 0, cpuUs: me.cpuUs };
      const mem = o.totalmem();
      return {
        specs: { os: `${o.type()} ${o.release()}`.slice(0, 60), arch: o.arch(), cores: Math.max(1, cpus.length), memBytes: mem, diskBytes: dsk?.total ?? 0, version: d.version },
        load: { cpu: Math.min(100, Math.max(0, cpu)), memUsedBytes: Math.max(0, mem - o.freemem()), diskFreeBytes: dsk?.free ?? 0, netInBps: inBps, netOutBps: outBps, vyreCpu: Math.min(100, vyre), vyreMemBytes: me.rss },
      };
    },
  };
}

export interface ReportDeps extends SamplerDeps {
  /** What Vyre runs here right now. */
  runs?: () => Partial<Runs>;
  /** What this machine can run: engine driver ids and tools (claude_code, codex, docker, chrome). */
  can?: () => string[];
  latencyMs?: () => number | undefined;
}

/** The whole report a machine sends: the sampler's specs and load, what runs here and what could. */
export function createReporter(d: ReportDeps): { report(): Report } {
  const s = createSampler(d);
  return {
    report() {
      const { specs, load } = s.sample(), r = d.runs?.() ?? {};
      const out: Report = { specs, load, runs: { turns: r.turns ?? 0, agentComputers: r.agentComputers ?? 0, sites: r.sites ?? 0, automations: r.automations ?? 0, work: r.work ?? [] }, can: d.can?.() ?? [] };
      const ms = d.latencyMs?.(); if (ms !== undefined) out.latencyMs = ms;
      return out;
    },
  };
}

/** Store the Space server's own report: srv_local is the one row of role "space". */
export function recordSpaceReport(db: Db, rep: Report, now: number): void { recordReport(db, "srv_local", rep, now); }

/**
 * Store a report that arrived over a link. A node that joined with a credential keeps its own row; a person's own computer gets one row of its own, made the first time it reports (id srv_dev_<device>,
 * owned by that person), so it appears in Machines and in Settings, This device. Returns the server id it was stored under, or null when the report was not usable.
 */
export function recordLinkedReport(db: Db, from: { serverId?: string; device?: { deviceId: string; person: string; name?: string } }, raw: unknown, now: number): string | null {
  const rep = cleanReport(raw);
  if (!rep) return null;
  let serverId = from.serverId ?? null;
  if (!serverId && from.device) {
    serverId = `srv_dev_${from.device.deviceId.replace(/^dev_/, "").replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
    const name = from.device.name?.slice(0, 60) || "This computer";
    const had = db.all("SELECT server_id FROM network_server WHERE server_id = ?", serverId)[0];
    if (had) db.run("UPDATE network_server SET name = ?, owner = ? WHERE server_id = ?", name, from.device.person, serverId);
    else db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at, enrollment, owner, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", serverId, name, "compute", "healthy", now, "approved", from.device.person, now);
  }
  if (!serverId) return null;
  recordReport(db, serverId, rep, now);
  return serverId;
}
