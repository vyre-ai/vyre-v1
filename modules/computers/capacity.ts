// @reads /modules/computers/migrations/0003_claims.sql
// Room on a host (6 Nov design, "Capacity"): what each kind of container holds back, whether a host has room for one more, and the line that waits when it does not.
//   Three kinds share a host: a desktop computer (Xvfb + Chromium, today's agent computer), a workspace (a shell container, one per agent and person) and a browser profile (a Chrome of the Space browser).
//   A workload asks `claimRoom` before it starts and calls `releaseRoom` when it stops. A refused claim is kept as `waiting`; `drainWaiting` starts the oldest one that now fits.
//   l-ws (workspaces) and l-sbrowser (the Space browser) use claimRoom / releaseRoom / bindStarter below and nothing else of this file. Desktop computers use them from handlers/lifecycle.ts.
// DECISION: A host's budget is its memory minus HEADROOM_MB (the OS and Vyre itself). Each running workload holds back its `reserveMb` of it, not its hard cap, so a burstable workspace (cap 1 GB,
//   holds back 256 MB) fits many times over. The host's real free memory must also cover the new workload's reserve, so a host that is short for another reason (a site build) refuses too.
// DECISION: machines.maxAgentComputers counts full desktops only. A headless browser profile (about 150 to 250 MB) and a workspace (about 50 MB idle) are budgeted by memory and disk room, so every agent can have both on a 4-core 8 GB server.
// DECISION: The default limit is the machines module's: half the cores, at least one. It applies when nothing says otherwise, so a Space server that was never set now holds that many at once.
// DECISION: A fact the host does not report is not a refusal. A host with no memory figure is limited by the count alone, one with neither takes the workload.
import { boundHost, rowsOf } from "./projections.ts";
import type { CompCtx, Db } from "./projections.ts";

export type Workload = "desktop" | "workspace" | "browser";
export const WORKLOADS: readonly Workload[] = ["desktop", "workspace", "browser"];

/** Per kind: the hard caps a new container is made with, and what it holds back of the host while it runs. Desktops stay at today's limits until the workspace and the Space browser replace them. */
export const LIMITS: Record<Workload, { cpus: number; memoryMb: number; reserveMb: number; pids: number; burstable: boolean }> = {
  desktop: { cpus: 2, memoryMb: 4096, reserveMb: 4096, pids: 1024, burstable: false },
  workspace: { cpus: 1, memoryMb: 1024, reserveMb: 64, pids: 512, burstable: true },
  browser: { cpus: 1, memoryMb: 1024, reserveMb: 256, pids: 512, burstable: true },
};
/**
 * The Docker HostConfig limits a new container of this kind is made with. Swap is pinned to the memory cap (no swap, as the host policy requires). A burstable kind also gets a soft reservation and
 * low CPU shares: it may use up to its cap when the host has room, and gives it back first when the host is busy.
 */
export function hostConfigLimits(kind: Workload): { NanoCpus: number; Memory: number; MemorySwap: number; PidsLimit: number; MemoryReservation?: number; CpuShares?: number } {
  const l = LIMITS[kind];
  const memory = l.memoryMb * 1024 * 1024;
  return { NanoCpus: Math.round(l.cpus * 1e9), Memory: memory, MemorySwap: memory, PidsLimit: l.pids, ...(l.burstable ? { MemoryReservation: l.reserveMb * 1024 * 1024, CpuShares: 256 } : {}) };
}
/** Memory kept for the OS and the Space itself. */
export const HEADROOM_MB = 1536;
/** Disk a host must have free before it starts or makes another container (images, profiles and Files grow on it). */
export const MIN_DISK_MB = 2048;
/** The kinds the machine's `maxAgentComputers` counts: full desktops. */
export const COUNTED: ReadonlySet<Workload> = new Set<Workload>(["desktop"]);

/** What a host says it can hold. Every figure is optional: a host reports what it knows. */
export interface HostFacts { name: string; totalMb?: number; freeMb?: number; cpus?: number; diskFreeMb?: number; maxAgentComputers?: number }
/** What already runs on the host: the memory it holds back, and how many of the counted kinds. */
export interface Held { reserveMb: number; counted: number }
export type Verdict = { ok: true } | { ok: false; reason: "memory" | "disk" | "count"; detail: string };

const SPACE = "space";
/** The host a workload lives on: a joined computer's id, or "space" for the Space's own server. */
export const hostKey = (nodeId: string | null | undefined): string => (nodeId === null || nodeId === undefined ? SPACE : nodeId);

/** The line a person reads while their request waits. */
export const waitingLine = (name: string): string => `Waiting for room on ${name}. Add a compute server in Console > Computers to run more.`;

/** Pure: does one more `kind` fit beside what is held? */
export function verdictOf(f: HostFacts, held: Held, kind: Workload): Verdict {
  const need = LIMITS[kind].reserveMb;
  if (f.diskFreeMb !== undefined && f.diskFreeMb < MIN_DISK_MB) return { ok: false, reason: "disk", detail: `${f.name} has ${f.diskFreeMb} MB of disk left` };
  if (COUNTED.has(kind) && f.maxAgentComputers !== undefined && held.counted >= f.maxAgentComputers) return { ok: false, reason: "count", detail: `${f.name} is set to run ${f.maxAgentComputers} at once` };
  if (f.totalMb !== undefined) {
    if (held.reserveMb + need > Math.max(0, f.totalMb - HEADROOM_MB)) return { ok: false, reason: "memory", detail: `${f.name} has no memory to give another one` };
    if (f.freeMb !== undefined && f.freeMb < need) return { ok: false, reason: "memory", detail: `${f.name} has ${f.freeMb} MB free` };
  }
  return { ok: true };
}

/** How many more of `kind` fit on an empty-handed read of the host, for a picker: the lesser of memory and count. */
export function fitsOf(f: HostFacts, held: Held, kind: Workload): number {
  const need = LIMITS[kind].reserveMb;
  const byMem = f.totalMb === undefined ? Infinity : Math.max(0, Math.floor((Math.max(0, f.totalMb - HEADROOM_MB) - held.reserveMb) / need));
  const byCount = COUNTED.has(kind) && f.maxAgentComputers !== undefined ? Math.max(0, f.maxAgentComputers - held.counted) : Infinity;
  const n = Math.min(byMem, byCount);
  return Number.isFinite(n) ? n : 0;
}

// ---- what the host reports -------------------------------------------------------------------------------------------------------------------------------

const MB = 1024 * 1024;
type MachineRow = { machineId: string; name?: string; nickname?: string; cores?: number; memBytes?: number; limits?: { maxAgentComputers?: number }; load?: { memUsedBytes?: number; diskFreeBytes?: number } };

/** What a host can hold: the Space's own container runtime for the Space server, then the machine's own report (machines.list) for any host. The first figure that answers wins. */
export async function factsOf(ctx: CompCtx, key: string): Promise<HostFacts> {
  const f: HostFacts = { name: key === SPACE ? "the Space server" : "this server" };
  let machine: MachineRow | undefined;
  try {
    const out = (await ctx.call("machines.list", {})) as { machines?: MachineRow[] };
    machine = (out.machines ?? []).find((m) => m.machineId === key);
  } catch { /* the machines module is not running: only the host's own answer */ }
  // machines.rooms names the Space server and the caller's own machines to anyone, and carries the limit an admin set: a member's or an agent's wake sees it too
  try {
    const out = (await ctx.call("machines.rooms", { ids: [key] })) as { rooms?: Array<{ machineId: string; maxAgentComputers?: number }> };
    const r = (out.rooms ?? []).find((x) => x.machineId === key);
    if (r && typeof r.maxAgentComputers === "number") f.maxAgentComputers = r.maxAgentComputers;
  } catch { /* not running: the default below */ }
  if (machine) {
    const shown = machine.nickname ?? machine.name;
    if (shown) f.name = key === SPACE ? "the Space server" : shown;
    if (typeof machine.cores === "number") f.cpus = machine.cores;
    if (typeof machine.memBytes === "number") {
      f.totalMb = Math.round(machine.memBytes / MB);
      if (typeof machine.load?.memUsedBytes === "number") f.freeMb = Math.max(0, f.totalMb - Math.round(machine.load.memUsedBytes / MB));
    }
    if (typeof machine.load?.diskFreeBytes === "number") f.diskFreeMb = Math.round(machine.load.diskFreeBytes / MB);
    if (typeof machine.limits?.maxAgentComputers === "number") f.maxAgentComputers = machine.limits.maxAgentComputers;
  }
  if (key === SPACE) {
    try {
      const c = await boundHost()?.capacity?.();
      if (c) {
        f.totalMb = c.totalMb; f.freeMb = c.freeMb; f.cpus = c.cpus;
        if (c.diskFreeMb !== undefined) f.diskFreeMb = c.diskFreeMb;
      }
    } catch { /* the machine's report stands */ }
    // machines.list shows the Space server only to an admin, so a member's or an agent's call may not see the limit the admin set; the machines module's own default (half the cores, at least one) stands in
    if (f.maxAgentComputers === undefined && f.cpus !== undefined) f.maxAgentComputers = Math.max(1, Math.floor(f.cpus / 2));
  }
  return f;
}

// ---- what runs now ---------------------------------------------------------------------------------------------------------------------------------

const AWAKE_SQL = "('waking', 'working', 'takeover')";

/** The memory held back and the counted workloads on a host: awake desktop computers (their rows), plus every running claim. A desktop that is only waiting holds nothing. */
export function heldOn(db: Db, key: string): Held {
  const desktops = rowsOf(db, `SELECT COUNT(*) AS n FROM computers_computers WHERE state IN ${AWAKE_SQL} AND COALESCE(node_id, '${SPACE}') = ? AND computer_id NOT IN (SELECT claim_key FROM computers_claim WHERE state = 'waiting')`, key)[0];
  const nDesk = Number(desktops?.["n"] ?? 0);
  let reserveMb = nDesk * LIMITS.desktop.reserveMb;
  let counted = nDesk;
  for (const r of rowsOf(db, "SELECT kind, COUNT(*) AS n FROM computers_claim WHERE host = ? AND state = 'running' GROUP BY kind", key)) {
    const kind = String(r["kind"]) as Workload;
    const n = Number(r["n"]);
    if (!(kind in LIMITS)) continue;
    reserveMb += n * LIMITS[kind].reserveMb;
    if (COUNTED.has(kind)) counted += n;
  }
  return { reserveMb, counted };
}

/** Is there room for one more `kind` on this host now? Reads the host's report and what runs; changes nothing. */
export async function checkRoom(ctx: CompCtx, a: { kind: Workload; nodeId?: string | null }): Promise<{ verdict: Verdict; facts: HostFacts; line: string }> {
  const key = hostKey(a.nodeId);
  const facts = await factsOf(ctx, key);
  const verdict = verdictOf(facts, heldOn(ctx.db, key), a.kind);
  return { verdict, facts, line: waitingLine(facts.name) };
}

export interface ClaimResult { state: "running" | "waiting"; line?: string }

/**
 * Ask for room before starting a workload. `key` names it (a computer id, a workspace id, a browser profile id) and asking twice is the same ask. Room: the claim is recorded as running and the caller
 * starts. No room: the claim is recorded as waiting with its line, and the caller shows the line and does not start; `drainWaiting` starts it when something stops.
 * A workload that is already running keeps its claim without a second check.
 */
export async function claimRoom(ctx: CompCtx, a: { kind: Workload; key: string; nodeId?: string | null }): Promise<ClaimResult> {
  const prior = rowsOf(ctx.db, "SELECT state FROM computers_claim WHERE claim_key = ?", a.key)[0];
  if (prior && String(prior["state"]) === "running") return { state: "running" };
  const key = hostKey(a.nodeId);
  const { verdict, line } = await checkRoom(ctx, a);
  if (verdict.ok) {
    ctx.db.run("DELETE FROM computers_claim WHERE claim_key = ?", a.key);
    // a desktop's own row says it is awake; only the other kinds hold a running claim
    if (a.kind !== "desktop") ctx.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, ?, ?, 'running', ?, NULL)", a.key, a.kind, key, ctx.now());
    return { state: "running" };
  }
  if (prior) ctx.db.run("UPDATE computers_claim SET note = ? WHERE claim_key = ?", line, a.key);
  else ctx.db.run("INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, ?, ?, 'waiting', ?, ?)", a.key, a.kind, key, ctx.now(), line);
  ctx.log.warn("capacity: waiting for room", { key: a.key, kind: a.kind, host: key, why: verdict.detail });
  return { state: "waiting", line };
}

/** A workload stopped or was removed: its claim goes. Does not start anything; call drainWaiting after. */
export function releaseRoom(ctx: Pick<CompCtx, "db">, key: string): void {
  ctx.db.run("DELETE FROM computers_claim WHERE claim_key = ?", key);
}

/** The line a waiting workload shows, or null when it is not waiting. */
export function waitingNote(db: Db, key: string): string | null {
  const r = rowsOf(db, "SELECT note FROM computers_claim WHERE claim_key = ? AND state = 'waiting'", key)[0];
  return r ? String(r["note"] ?? "") || waitingLine("this server") : null;
}

export const isWaiting = (db: Db, key: string): boolean => waitingNote(db, key) !== null;

type Starter = (ctx: CompCtx, key: string) => Promise<void>;
const starters = new Map<Workload, Starter>();
/** The code that starts a waiting workload of a kind once there is room (l-ws binds "workspace", l-sbrowser "browser"; lifecycle binds "desktop"). It runs after the claim is running. */
export function bindStarter(kind: Workload, f: Starter | null): void { if (f) starters.set(kind, f); else starters.delete(kind); }

/** Start the oldest waiting workloads that now fit, host by host, oldest first. Returns the keys started. A workload whose starter throws is released, not retried forever. */
export async function drainWaiting(ctx: CompCtx): Promise<string[]> {
  const started: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    let next: { key: string; kind: Workload; host: string } | null = null;
    for (const r of rowsOf(ctx.db, "SELECT claim_key, kind, host FROM computers_claim WHERE state = 'waiting' ORDER BY since, claim_key")) {
      const kind = String(r["kind"]) as Workload, host = String(r["host"]);
      if (!starters.has(kind)) continue;
      const facts = await factsOf(ctx, host);
      if (verdictOf(facts, heldOn(ctx.db, host), kind).ok) { next = { key: String(r["claim_key"]), kind, host }; break; }
    }
    if (!next) return started;
    const start = starters.get(next.kind)!;
    if (next.kind === "desktop") ctx.db.run("DELETE FROM computers_claim WHERE claim_key = ?", next.key);
    else ctx.db.run("UPDATE computers_claim SET state = 'running', note = NULL WHERE claim_key = ?", next.key);
    try { await start(ctx, next.key); started.push(next.key); } catch (e) {
      ctx.log.warn("capacity: a waiting workload did not start", { key: next.key, reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
      releaseRoom(ctx, next.key);
    }
  }
  return started;
}
