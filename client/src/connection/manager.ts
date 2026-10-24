// The connection manager (ARCH 5.9): one live connection per device per Space, shared by every screen.
//   endpoints   race the top two usable ones, stick to the winner, close the other
//   heartbeat   a hb every 15 s; 40 s without any frame marks the endpoint down and fails over to the next
//   resume      every connect says hello with the cursor the replica has applied, so the server replays from there and a drop never leaves a gap
//   events      `ev` batches are applied in order, then acked; a batch that fails to apply is not acked and the connection restarts from the cursor
//   sharing     acquire() hands out counted handles; the socket closes shortly after the last one is released
import { rank, usable, ENDPOINT_COOLDOWN_MS } from "./endpoints.ts";
import type { Endpoint } from "./endpoints.ts";
import { readEvent, readHelloOk } from "./frames.ts";
import type { EventBatch, HelloInfo, HelloOk, Mode } from "./frames.ts";
import { realScheduler } from "./scheduler.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Dial, Transport } from "./transport.ts";

export const HEARTBEAT_MS = 15_000;
export const HEARTBEAT_DEAD_MS = 40_000;
export const HELLO_TIMEOUT_MS = 10_000;
export const IDLE_CLOSE_MS = 30_000;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;

export type Status = "idle" | "connecting" | "live" | "reconnecting" | "read_only" | "stopped";

export interface ConnectionOpts {
  space: string;
  endpoints: readonly Endpoint[];
  dial: Dial;
  hello(): HelloInfo;
  /** The replica's cursor: the last seq applied. */
  cursor: { get(): number; set(n: number): void | Promise<void> };
  /** Apply one batch to the replica. The manager acks only after this resolves. */
  apply(batch: EventBatch): void | Promise<void>;
  scheduler?: Scheduler;
  heartbeatMs?: number;
  deadMs?: number;
  idleCloseMs?: number;
  on?: {
    status?(s: Status, endpoint: Endpoint | null): void;
    /** The server answered hello with a mode other than live (read-only, resync, purge). */
    mode?(mode: Mode, ok: HelloOk): void;
    /** The head moved while the manager held events back or fell behind: pull. */
    pullHint?(seq: number): void;
    purge?(epoch: number): void;
    /** Any other frame (turn, presence, typing, ydoc.*, computer.frame). */
    frame?(frame: unknown): void;
  };
}

export interface Handle { release(): void }

export interface Connection {
  start(): void;
  stop(): void;
  /** Count a user of the connection. The first starts it; the last, after a short rest, stops it. */
  acquire(): Handle;
  status(): Status;
  endpoint(): Endpoint | null;
  endpoints(): Endpoint[];
  /** Send a frame on the live link. False when there is none. */
  send(frame: unknown): boolean;
  stats(): { dials: number; opened: number; closed: number; failovers: number; users: number };
}

class Superseded extends Error {}

interface Racer { ep: Endpoint; t: Transport; ok: HelloOk; buffered: unknown[] }

export function createConnection(o: ConnectionOpts): Connection {
  const clock = o.scheduler ?? realScheduler;
  const heartbeatMs = o.heartbeatMs ?? HEARTBEAT_MS;
  const deadMs = o.deadMs ?? HEARTBEAT_DEAD_MS;
  const idleCloseMs = o.idleCloseMs ?? IDLE_CLOSE_MS;
  const list: Endpoint[] = o.endpoints.map((e) => ({ ...e }));
  let status: Status = "idle";
  let current: { ep: Endpoint; t: Transport } | null = null;
  let generation = 0;
  let users = 0;
  let attempts = 0;
  let lastRx = 0;
  let stopHeartbeat: (() => void) | null = null;
  let cancelRetry: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();
  let wantOn = false;
  let everLive = false;
  const stats = { dials: 0, opened: 0, closed: 0, failovers: 0 };

  const set = (s: Status): void => { if (status !== s) { status = s; o.on?.status?.(s, current?.ep ?? null); } };
  const find = (ep: Endpoint): Endpoint => list.find((e) => e.url === ep.url && e.kind === ep.kind) ?? ep;
  const down = (ep: Endpoint): void => { const e = find(ep); e.health = "down"; e.downUntil = clock.now() + ENDPOINT_COOLDOWN_MS; };

  function hello(): unknown {
    return { t: "hello", hello: { ...o.hello(), cursor: o.cursor.get() } };
  }

  /** Dial one endpoint and say hello. Resolves with the answer, or rejects. */
  function open(ep: Endpoint, gen: number, abort: AbortController): Promise<Racer> {
    return new Promise<Racer>((resolve, reject) => {
      stats.dials++;
      let done = false;
      let transport: Transport | null = null;
      const fail = (why: string, superseded = false): void => {
        if (done) return;
        done = true;
        cancel();
        try { transport?.close(why); } catch { /* already closed */ }
        reject(superseded ? new Superseded(why) : new Error(why));
      };
      const cancel = clock.after(HELLO_TIMEOUT_MS, () => fail("hello timed out"));
      abort.signal.addEventListener("abort", () => fail("superseded", true), { once: true });
      o.dial(ep, abort.signal).then((t) => {
        if (done || gen !== generation || abort.signal.aborted) { try { t.close("superseded"); } catch { /* closed */ } return; }
        transport = t;
        const buffered: unknown[] = [];
        let answered: HelloOk | null = null;
        t.onFrame((f) => {
          if (!answered) {
            const ok = readHelloOk(f);
            if (!ok) return;
            answered = ok;
            done = true;
            cancel();
            resolve({ ep, t, ok, buffered });
            return;
          }
          // After hello_ok, before a winner is chosen: hold the frames. The winner replays them; a loser drops them with its link.
          if (buffered) buffered.push(f);
        });
        t.onClose((r) => fail(`closed: ${r}`));
        t.send(hello());
      }, (e: unknown) => fail(e instanceof Error ? e.message : String(e)));
    });
  }

  async function race(gen: number): Promise<Racer | null> {
    const abort = new AbortController();
    const now = clock.now();
    const order = rank(list, now);
    const picks = order.filter((e) => usable(e, now)).slice(0, 2);
    if (!picks.length && order[0]) picks.push(order[0]);
    if (!picks.length) return null;
    return new Promise<Racer | null>((resolve) => {
      let left = picks.length;
      let won = false;
      for (const ep of picks) {
        open(ep, gen, abort).then((r) => {
          if (won || gen !== generation) { try { r.t.close("lost the race"); } catch { /* closed */ } return; }
          won = true;
          abort.abort();
          resolve(r);
        }, (e: unknown) => {
          if (!(e instanceof Superseded)) down(ep);
          if (--left === 0 && !won) resolve(null);
        }).then(() => undefined);
      }
    });
  }

  async function connect(): Promise<void> {
    if (!wantOn || status === "stopped") return;
    const gen = ++generation;
    set(everLive ? "reconnecting" : "connecting");
    const r = await race(gen);
    if (gen !== generation || !wantOn) { if (r) try { r.t.close("superseded"); } catch { /* closed */ } return; }
    if (!r) {
      attempts++;
      const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
      cancelRetry?.();
      cancelRetry = clock.after(wait, () => { cancelRetry = null; void connect(); });
      return;
    }
    attempts = 0;
    adopt(r, gen);
  }

  function adopt(r: Racer, gen: number): void {
    current = { ep: r.ep, t: r.t };
    const e = find(r.ep);
    e.health = "healthy"; e.lastOk = clock.now(); delete e.downUntil;
    stats.opened++;
    everLive = true;
    lastRx = clock.now();
    r.t.onFrame((f) => { if (gen === generation) onFrame(f); });
    r.t.onClose(() => { if (gen === generation && current?.t === r.t) lost(r.ep, "closed"); });
    if (r.ok.mode === "live") set("live"); else set("read_only");
    if (r.ok.mode === "purge") { o.on?.purge?.(r.ok.epoch); o.on?.mode?.(r.ok.mode, r.ok); halt(); return; }
    if (r.ok.mode !== "live") o.on?.mode?.(r.ok.mode, r.ok);
    stopHeartbeat?.();
    stopHeartbeat = clock.every(heartbeatMs, () => {
      if (gen !== generation) return;
      if (clock.now() - lastRx >= deadMs) { lost(r.ep, "no heartbeat"); return; }
      r.t.send({ t: "hb", seq: o.cursor.get() });
    });
    for (const f of r.buffered) onFrame(f);
  }

  function onFrame(f: unknown): void {
    lastRx = clock.now();
    const t = typeof f === "object" && f !== null ? (f as { t?: unknown }).t : undefined;
    if (t === "hb" || t === "hello_ok") return;
    if (t === "ev") {
      const batch = readEvent(f);
      if (!batch) return;
      chain = chain.then(() => deliver(batch, generation)).catch(() => undefined);
      return;
    }
    if (t === "pull_hint") { const seq = (f as { seq?: unknown }).seq; if (typeof seq === "number") o.on?.pullHint?.(seq); return; }
    if (t === "purge") { const epoch = (f as { epoch?: unknown }).epoch; o.on?.purge?.(typeof epoch === "number" ? epoch : 0); halt(); return; }
    o.on?.frame?.(f);
  }

  async function deliver(b: EventBatch, gen: number): Promise<void> {
    if (gen !== generation) return;
    const have = o.cursor.get();
    // A batch the replica already has (a replay after a reconnect) is acked, not applied twice.
    if (b.seq > have || b.items.length || b.hide.length) {
      const fresh: EventBatch = { seq: b.seq, items: b.items.filter((c) => c.seq > have), hide: b.hide.filter((h) => h.seq > have) };
      try {
        if (fresh.items.length || fresh.hide.length) await o.apply(fresh);
      } catch {
        // Not applied, so not acked: start again from the cursor.
        if (gen === generation && current) lost(current.ep, "apply failed", false);
        return;
      }
      if (b.seq > have) await o.cursor.set(b.seq);
    }
    if (gen === generation && current) current.t.send({ t: "ack", seq: Math.max(b.seq, o.cursor.get()) });
  }

  function drop(): void {
    stopHeartbeat?.(); stopHeartbeat = null;
    const c = current;
    current = null;
    generation++;
    if (c) { stats.closed++; try { c.t.close("leaving"); } catch { /* closed */ } }
  }

  /** The link failed (closed, silent, or a batch would not apply): mark the endpoint, reconnect to the best other one. */
  function lost(ep: Endpoint, _why: string, mark = true): void {
    if (!current || current.ep !== ep) return;
    if (mark) down(ep);
    stats.failovers++;
    drop();
    if (!wantOn) return;
    set("reconnecting");
    if (mark) { void connect(); return; }
    // The link was fine and the replica could not take the batch: wait before trying again, so a batch that always fails does not spin.
    attempts++;
    cancelRetry?.();
    cancelRetry = clock.after(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1)), () => { cancelRetry = null; void connect(); });
  }

  function halt(): void {
    wantOn = false;
    cancelRetry?.(); cancelRetry = null;
    drop();
    set("stopped");
  }

  const conn: Connection = {
    start() { if (wantOn || status === "stopped") return; wantOn = true; void connect(); },
    stop() { halt(); },
    acquire() {
      users++;
      cancelIdle?.(); cancelIdle = null;
      conn.start();
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          users--;
          if (users === 0) cancelIdle = clock.after(idleCloseMs, () => { cancelIdle = null; if (users === 0) { wantOn = false; cancelRetry?.(); cancelRetry = null; drop(); set("idle"); } });
        },
      };
    },
    status: () => status,
    endpoint: () => (current ? find(current.ep) : null),
    endpoints: () => list.map((e) => ({ ...e })),
    send(frame) { if (!current || (status !== "live" && status !== "read_only")) return false; current.t.send(frame); return true; },
    stats: () => ({ ...stats, users }),
  };
  return conn;
}

const registry = new Map<string, Connection>();
/** One connection per Space: every tab, screen and hook asks here and gets the same one (SharedWorker on web, the daemon on desktop, a singleton on RN). */
export function connectionFor(space: string, make: () => Connection): Connection {
  let c = registry.get(space);
  if (!c) { c = make(); registry.set(space, c); }
  return c;
}
export function forgetConnections(): void {
  for (const c of registry.values()) c.stop();
  registry.clear();
}
