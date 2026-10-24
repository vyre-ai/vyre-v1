// The warm engine pool (ARCH 6.6): "a resumed chat never cold-starts its engine", measured as engine.acquire under 20 ms (perf engine_pool).
//
// A warm session is an engine session that is open and idle: for an API driver a resolved provider client with an open connection and the cached prefix, for a CLI driver a spawned
// process attached to its MCP endpoint with its resume state loaded. acquire() hands one out in a map lookup; when there is none it opens one (a cold start, counted as a miss).
// A hint (the thread was opened, or the composer got focus) opens one ahead of the first message, and a session released after a turn stays warm for the next.
//
//   key       (driver, account, model, sandbox, MCP profile); a CLI session is also bound to the one thread whose transcript it holds
//   caps      per driver 4 on a device; on the host 2 per driver for each active person; 24 in all
//   idle      10 minutes, then closed; when a cap is hit the least recently used idle session goes first, a busy one never does
//   spend     a warm session costs nothing until it makes calls (the driver bills calls, the pool never calls a provider); memory is capped by the sandbox
import type { EngineSession, SessionSpec } from "../turn-engine/types.ts";
import { keyString } from "./key.ts";
import type { PoolKey } from "./key.ts";

export interface PoolDriver {
  readonly id: string;
  readonly kind: "api" | "cli";
  /** Open a session: connect or spawn. May take long; the pool's job is to do this before anyone waits for it. */
  open(spec: SessionSpec): Promise<EngineSession>;
}

export interface PoolSpec {
  key: PoolKey;
  threadId: string;
  /** The person whose account and sandbox this is; the host's per-person cap counts these. */
  person: string;
  /** What the driver needs to open a session. */
  session: SessionSpec;
}

export interface PoolOptions {
  /** A device holds a few sessions per driver; the host holds a few per driver for each active person. */
  placement: "device" | "host";
  drivers: readonly PoolDriver[];
  now?: () => number;
  /** Warm sessions per driver on a device. Default 4. */
  maxPerDriver?: number;
  /** Warm sessions per driver and person on the host. Default 2. */
  maxPerPerson?: number;
  /** Sessions in all. Default 24. */
  maxTotal?: number;
  /** Idle time before a session is closed. Default 10 minutes. */
  idleMs?: number;
}

export const POOL_DEFAULTS = Object.freeze({ maxPerDriver: 4, maxPerPerson: 2, maxTotal: 24, idleMs: 10 * 60_000 });

export interface Lease {
  readonly id: number;
  readonly session: EngineSession;
  /** True when the session was already open: a hit. */
  readonly warm: boolean;
  /** True when the acquire had to wait for a hint's open that was still under way. */
  readonly waited: boolean;
  readonly key: PoolKey;
}

export interface DriverStatus { driver: string; warm: number; busy: number; max: number; hits: number; misses: number; evictions: number }
export interface PoolStatus { sessions: DriverStatus[]; totalWarm: number; totalBusy: number }

export interface EnginePool {
  /** A session for this turn: warm if there is one, else opened now. */
  acquire(spec: PoolSpec): Promise<Lease>;
  /** Open one ahead of the first message (thread opened, composer focus, after a switch). Does nothing when a matching session is already warm or on its way. */
  hint(spec: PoolSpec): void;
  /** The turn is over. A session stays warm for the next turn unless it is dirty (`reuse: false`: cancelled, failed) or the pool is over a cap. */
  release(lease: Lease, o?: { reuse?: boolean }): Promise<void>;
  /** Close the idle sessions older than the idle time. Called before every acquire; also callable on a timer. */
  sweep(): Promise<number>;
  status(): PoolStatus;
  /** Wait for hints that are still opening. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

interface Entry {
  id: number;
  key: string;
  parts: PoolKey;
  kind: "api" | "cli";
  person: string;
  /** A CLI session holds one thread's transcript. */
  thread: string | null;
  session: EngineSession;
  state: "idle" | "busy";
  lastUsed: number;
  /** Opened when no cap had room and nothing could be evicted: closed on release instead of kept. */
  overflow: boolean;
}

interface Pending { key: string; thread: string | null; person: string; driver: string; promise: Promise<Entry | null> }


interface Stats { hits: number; misses: number; evictions: number }

export function createPool(o: PoolOptions): EnginePool {
  const now = o.now ?? Date.now;
  const drivers = new Map(o.drivers.map((d) => [d.id, d] as const));
  const maxPerDriver = o.maxPerDriver ?? POOL_DEFAULTS.maxPerDriver;
  const maxPerPerson = o.maxPerPerson ?? POOL_DEFAULTS.maxPerPerson;
  const maxTotal = o.maxTotal ?? POOL_DEFAULTS.maxTotal;
  const idleMs = o.idleMs ?? POOL_DEFAULTS.idleMs;

  const entries = new Map<number, Entry>();
  const pending = new Set<Pending>();
  const stats = new Map<string, Stats>();
  let next = 0;
  let closed = false;

  const statsOf = (driver: string): Stats => {
    let s = stats.get(driver);
    if (!s) { s = { hits: 0, misses: 0, evictions: 0 }; stats.set(driver, s); }
    return s;
  };
  const driverOf = (id: string): PoolDriver => {
    const d = drivers.get(id);
    if (!d) throw new RangeError(`no driver ${id} in the pool`);
    return d;
  };
  const threadOf = (kind: "api" | "cli", spec: PoolSpec): string | null => (kind === "cli" ? spec.threadId : null);

  const matches = (e: { key: string; thread: string | null; person: string }, key: string, thread: string | null, person: string): boolean =>
    e.key === key && e.person === person && (thread === null || e.thread === null || e.thread === thread);

  async function drop(e: Entry, why: "evict" | "close"): Promise<void> {
    entries.delete(e.id);
    if (why === "evict") statsOf(e.parts.driver).evictions++;
    try { await e.session.close(); } catch { /* a session that will not close is forgotten */ }
  }

  const lru = (a: Entry, b: Entry): number => a.lastUsed - b.lastUsed;

  /**
   * Room for one more session of this driver and person: close the least recently used idle ones until under the driver's cap (on the host, this person's) and the total.
   * Returns false when only busy sessions stand in the way; the new session is then kept only until its turn ends.
   */
  async function makeRoom(driver: string, person: string): Promise<boolean> {
    const mine = (d: string, p: string): boolean => d === driver && (o.placement === "device" || p === person);
    const cap = o.placement === "device" ? maxPerDriver : maxPerPerson;
    const driverCount = (): number => [...entries.values()].filter((e) => mine(e.parts.driver, e.person)).length + [...pending].filter((p) => mine(p.driver, p.person)).length;
    while (driverCount() >= cap) {
      const victim = [...entries.values()].filter((e) => e.state === "idle" && mine(e.parts.driver, e.person)).sort(lru)[0];
      if (!victim) return false;
      await drop(victim, "evict");
    }
    while (entries.size + pending.size >= maxTotal) {
      const victim = [...entries.values()].filter((e) => e.state === "idle").sort(lru)[0];
      if (!victim) return false;
      await drop(victim, "evict");
    }
    return true;
  }

  async function open(spec: PoolSpec): Promise<Entry | null> {
    const d = driverOf(spec.key.driver);
    const room = await makeRoom(spec.key.driver, spec.person);
    const session = await d.open(spec.session);
    if (closed) {
      try { await session.close(); } catch { /* closing anyway */ }
      return null;
    }
    const e: Entry = {
      id: ++next, key: keyString(spec.key), parts: spec.key, kind: d.kind, person: spec.person, thread: threadOf(d.kind, spec), session, state: "idle", lastUsed: now(), overflow: !room,
    };
    entries.set(e.id, e);
    return e;
  }

  /** Start opening a session and count it against the caps from this moment, so a second acquire or hint for the same key waits for it instead of opening another. */
  function startOpen(spec: PoolSpec, thread: string | null): Pending {
    const p: Pending = { key: keyString(spec.key), thread, person: spec.person, driver: spec.key.driver, promise: Promise.resolve(null) };
    p.promise = open(spec).finally(() => { pending.delete(p); });
    pending.add(p);
    return p;
  }

  function lease(e: Entry, warm: boolean, waited: boolean): Lease {
    e.state = "busy";
    e.lastUsed = now();
    return { id: e.id, session: e.session, warm, waited, key: e.parts };
  }

  const pool: EnginePool = {
    async acquire(spec) {
      if (closed) throw new Error("the pool is closed");
      const d = driverOf(spec.key.driver);
      const key = keyString(spec.key);
      const thread = threadOf(d.kind, spec);
      let started = false;
      let waited = false;
      // Normally one pass: a warm session, or the open this call starts. More only when someone else took the session this call waited for.
      for (let attempt = 0; attempt < 4; attempt++) {
        await pool.sweep();
        // The most recently used idle session that agrees on the key (and the thread, for a CLI).
        const idle = [...entries.values()].filter((e) => e.state === "idle" && matches(e, key, thread, spec.person)).sort((a, b) => b.lastUsed - a.lastUsed)[0];
        if (idle) {
          if (started) statsOf(spec.key.driver).misses++;
          else statsOf(spec.key.driver).hits++;
          if (idle.kind === "cli" && idle.thread === null) idle.thread = spec.threadId;
          return lease(idle, !started, waited);
        }
        // An open that is already under way (a hint's): wait for it rather than start a second one.
        let coming = [...pending].find((p) => matches(p, key, thread, spec.person));
        const own = coming === undefined;
        if (own) { coming = startOpen(spec, thread); started = true; } else waited = true;
        try {
          await coming?.promise;
        } catch (e) {
          if (own) throw e;   // our own open failed: the caller sees why
          // a hint's open failed: the next pass opens one for this call
        }
        if (closed) throw new Error("the pool closed while a session was opening");
      }
      throw new Error("could not get an engine session");
    },

    hint(spec) {
      if (closed) return;
      const d = drivers.get(spec.key.driver);
      if (!d) return;
      const key = keyString(spec.key);
      const thread = threadOf(d.kind, spec);
      const have = [...entries.values()].find((e) => e.state === "idle" && matches(e, key, thread, spec.person));
      if (have) { have.lastUsed = now(); return; }
      if ([...pending].some((p) => matches(p, key, thread, spec.person))) return;
      startOpen(spec, thread).promise.catch(() => null);   // a hint that fails costs nothing: the acquire opens its own
    },

    async release(l, rel) {
      const e = entries.get(l.id);
      if (!e) return;
      const reuse = rel?.reuse !== false && !closed && !e.overflow;
      if (!reuse) { await drop(e, "close"); return; }
      e.state = "idle";
      e.lastUsed = now();
    },

    async sweep() {
      const cutoff = now() - idleMs;
      const stale = [...entries.values()].filter((e) => e.state === "idle" && e.lastUsed < cutoff);
      for (const e of stale) await drop(e, "evict");
      return stale.length;
    },

    status() {
      const max = o.placement === "device" ? maxPerDriver : maxPerPerson;
      const names = new Set<string>([...drivers.keys(), ...stats.keys()]);
      const sessions = [...names].sort().map((driver): DriverStatus => {
        const mine = [...entries.values()].filter((e) => e.parts.driver === driver);
        const s = statsOf(driver);
        return { driver, warm: mine.filter((e) => e.state === "idle").length, busy: mine.filter((e) => e.state === "busy").length, max, hits: s.hits, misses: s.misses, evictions: s.evictions };
      });
      return { sessions, totalWarm: sessions.reduce((n, x) => n + x.warm, 0), totalBusy: sessions.reduce((n, x) => n + x.busy, 0) };
    },

    async settled() {
      while (pending.size > 0) await Promise.allSettled([...pending].map((p) => p.promise));
    },

    async close() {
      closed = true;
      await Promise.allSettled([...pending].map((p) => p.promise));
      for (const e of [...entries.values()]) await drop(e, "close");
    },
  };
  return pool;
}
