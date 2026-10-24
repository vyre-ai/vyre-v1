// The live hub (ARCH 5.9): one WebSocket per device per Space. A device says hello with its cursor; the hub answers with the mode and then pushes numbered `ev` batches as the log commits, filtered
// for that person and device exactly as a pull is (the hub asks the same pull). The client acks cumulatively. Because every batch is "what pull would return from the cursor", a dropped link,
// a lost frame or a replay after failover all end the same way: the device says hello with the cursor it applied and the hub continues from there, with nothing missing and nothing sent twice that matters.
//   ev        numbered, filtered items and hide rows; at most `window` unacked, then the hub sends pull_hint and waits for acks
//   hb        every 15 s each way; a device silent for 40 s is closed
//   purge     to every connection of a person whose epoch moved (revocation, 5.7)
//   one connection per device in steady state: a connecting device races its two best endpoints and closes the loser, so the hub allows a device two at once and drops the oldest beyond that
import { HEARTBEAT_DEAD_MS, HEARTBEAT_MS, decideMode, parseFrame } from "../protocol.ts";
import type { DeviceClass, Frame, Hello, Mode, Op, PullReq, PullRes, ServerState } from "../protocol.ts";
import type { LiveClock, LiveTransport } from "./transport.ts";

export interface LiveWho { person: string; device: string; deviceClass: DeviceClass }

export interface LiveDeps {
  state(who: LiveWho): ServerState;
  /** The same filtered read as sync.pull, for this person and device. */
  pull(who: LiveWho, req: PullReq): PullRes;
  /** Highest change seq in the feed. */
  head(): number;
  clock: LiveClock;
  heartbeatMs?: number;
  deadMs?: number;
  /** A hello must arrive within this long. */
  helloMs?: number;
  /** Unacked batches before the hub sends a pull_hint and waits. */
  window?: number;
  /** Most changes in one batch. */
  batch?: number;
  /** A client's low-latency op (same semantics as push). */
  onOp?(who: LiveWho, op: Op): Promise<void> | void;
  /** Every other frame: turn, presence, typing, computer.frame, ydoc.*. */
  onFrame?(who: LiveWho, frame: Frame): void;
}

export interface Session {
  readonly who: LiveWho;
  mode(): Mode | "new";
  /** The last seq sent / acked. */
  sent(): number;
  acked(): number;
  close(reason?: string): void;
}

export interface LiveHub {
  accept(t: LiveTransport, who: LiveWho): Session;
  /** The log committed: push to every live session now (the same tick as the commit). */
  commit(): void;
  /** A person's epoch moved: tell every connection of theirs to purge, and close it. Returns how many. */
  purge(person: string, epoch: number): number;
  sessions(): number;
  sessionsOf(person: string, device: string): number;
  close(): void;
}

/** A device holds one connection; while it races two endpoints it holds two. */
export const MAX_PER_DEVICE = 2;

export function createLiveHub(d: LiveDeps): LiveHub {
  const hbMs = d.heartbeatMs ?? HEARTBEAT_MS;
  const deadMs = d.deadMs ?? HEARTBEAT_DEAD_MS;
  const helloMs = d.helloMs ?? 10_000;
  const window = d.window ?? 8;
  const batch = d.batch ?? 500;
  const live = new Set<Impl>();

  interface Impl extends Session { flush(): void; sendPurge(epoch: number): void }

  function open(t: LiveTransport, who: LiveWho): Impl {
    let mode: Mode | "new" = "new";
    let sent = 0, acked = 0, epoch = 0;
    let inflight: number[] = [];
    let hinted = false;
    let lastRx = d.clock.now();
    let closed = false;
    const stopHb = d.clock.every(hbMs, () => {
      if (closed) return;
      if (d.clock.now() - lastRx >= deadMs) { close("silent"); return; }
      send({ t: "hb", seq: d.head() });
    });
    const stopHello = d.clock.after(helloMs, () => { if (mode === "new") close("no hello"); });

    const send = (f: Frame): void => { if (!closed) t.send(f); };
    function close(reason = "closed"): void {
      if (closed) return;
      closed = true;
      stopHb(); stopHello();
      live.delete(self);
      try { t.close(reason); } catch { /* already closed */ }
    }

    function flush(): void {
      if (closed || mode !== "live") return;
      let stalled = false;
      for (;;) {
        if (inflight.length >= window) { stalled = true; break; }
        const res = d.pull(who, { cursor: sent, epoch, limit: batch });
        if (res.reset === "purge") { send({ t: "purge", epoch: res.epoch }); close("purged"); return; }
        if (res.changes.length || res.hide.length) {
          send({ t: "ev", seq: res.next, items: res.changes, ...(res.hide.length ? { hide: res.hide } : {}) });
          inflight.push(res.next);
        }
        sent = Math.max(sent, res.next);
        if (!res.more) break;
      }
      if (stalled && !hinted) { hinted = true; send({ t: "pull_hint", seq: d.head() }); }
    }

    function hello(h: Hello): void {
      const ok = decideMode(h, d.state(who));
      epoch = h.epoch;
      send({ t: "hello_ok", ok });
      mode = ok.mode;
      if (ok.mode === "purge") { send({ t: "purge", epoch: ok.epoch }); close("purged"); return; }
      if (ok.mode !== "live") return;
      // A device racing two endpoints holds two for a moment; a third means an old one is a ghost (a half-open link), so the oldest goes.
      const same = [...live].filter((x) => x.who.person === who.person && x.who.device === who.device && x.mode() === "live");
      for (const old of same.slice(0, Math.max(0, same.length - MAX_PER_DEVICE))) old.close("replaced");
      sent = h.cursor; acked = h.cursor; inflight = []; hinted = false;
      flush();
    }

    t.onFrame((raw) => {
      if (closed) return;
      lastRx = d.clock.now();
      const p = parseFrame(raw);
      if (!p.ok) { close(`bad frame: ${p.error}`); return; }
      const f = p.value;
      if (f.t === "hello") { hello(f.hello); return; }
      if (mode === "new") { close("frame before hello"); return; }
      switch (f.t) {
        case "hb": send({ t: "hb", seq: d.head() }); break;
        case "ack":
          if (f.seq > acked) {
            acked = f.seq;
            inflight = inflight.filter((s) => s > acked);
            hinted = false;
            flush();
          }
          break;
        case "op": void Promise.resolve(d.onOp?.(who, f.op)).catch(() => undefined); break;
        case "hello_ok": case "ev": case "pull_hint": case "purge": break;
        default: d.onFrame?.(who, f);
      }
    });
    t.onClose(() => close("peer closed"));

    const self: Impl = {
      who, flush,
      mode: () => mode, sent: () => sent, acked: () => acked,
      close,
      sendPurge(e) { send({ t: "purge", epoch: e }); close("purged"); },
    };
    live.add(self);
    return self;
  }

  return {
    accept: (t, who) => open(t, who),
    commit() { for (const s of [...live]) s.flush(); },
    purge(person, epoch) {
      let n = 0;
      for (const s of [...live]) if (s.who.person === person) { s.sendPurge(epoch); n++; }
      return n;
    },
    sessions: () => live.size,
    sessionsOf: (person, device) => [...live].filter((s) => s.who.person === person && s.who.device === device).length,
    close() { for (const s of [...live]) s.close("hub closed"); },
  };
}
