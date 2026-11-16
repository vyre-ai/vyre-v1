// The live hub (ARCH 5.9): one WebSocket per device per Space. A device says hello with its cursor; the hub answers with the mode and then pushes numbered `ev` batches as the log commits, filtered
// for that person and device exactly as a pull is (the hub asks the same pull). The client acks cumulatively. Because every batch is "what pull would return from the cursor", a dropped link,
// a lost frame or a replay after failover all end the same way: the device says hello with the cursor it applied and the hub continues from there, with nothing missing and nothing sent twice that matters.
//   ev        numbered, filtered items and hide rows; at most `window` unacked, then the hub sends pull_hint and waits for acks
//   hb        every 15 s each way; a device silent for 40 s is closed
//   purge     to every connection of a person whose epoch moved (revocation, 5.7)
//   one connection per device in steady state: a connecting device races its two best endpoints and closes the loser, so the hub allows a device two at once and drops the oldest beyond that
import { HEARTBEAT_DEAD_MS, HEARTBEAT_MS, decideMode, parseFrame } from "../protocol.ts";
import type { Change, DeviceClass, Frame, Hello, Hide, Mode, Op, PullReq, PullRes, ServerState } from "../protocol.ts";
import type { LiveClock, LiveTransport } from "./transport.ts";

export interface LiveWho {
  person: string;
  device: string;
  deviceClass: DeviceClass;
}

export interface LiveDeps {
  state(who: LiveWho): ServerState;
  /** The same filtered read as sync.pull, for this person and device. `maxBytes` asks it to stop once the changes it holds weigh that much (the one that crosses the line is kept). */
  pull(who: LiveWho, req: PullReq, maxBytes?: number): PullRes;
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
  /** The bytes of changes one `ev` frame is aimed to carry (default EV_BUDGET). */
  evBytes?: number;
  /** The most bytes one frame may weigh (default FRAME_MAX): below the relay's 1 MiB message limit with its framing. */
  frameMax?: number;
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

/** The bytes of changes an `ev` frame aims for: a Space with rows of 100 fields would otherwise send 500 of them (several MB) in one frame, and the relay drops a live message over 1 MiB. */
export const EV_BUDGET = 512 * 1024;
/** No frame is larger than this (the relay's limit is 1 MiB with its framing and tag). */
export const FRAME_MAX = 900 * 1024;
const FRAME_OVERHEAD = 256;
const encoder = new TextEncoder();
const weigh = (x: unknown): number => encoder.encode(JSON.stringify(x)).length;

/** A device holds one connection; while it races two endpoints it holds two. */
export const MAX_PER_DEVICE = 2;

export function createLiveHub(d: LiveDeps): LiveHub {
  const hbMs = d.heartbeatMs ?? HEARTBEAT_MS;
  const deadMs = d.deadMs ?? HEARTBEAT_DEAD_MS;
  const helloMs = d.helloMs ?? 10_000;
  const window = d.window ?? 8;
  const batch = d.batch ?? 500;
  const evBytes = d.evBytes ?? EV_BUDGET;
  const frameMax = d.frameMax ?? FRAME_MAX;
  const live = new Set<Impl>();

  interface Impl extends Session {
    flush(): void;
    sendPurge(epoch: number): void;
  }

  function open(t: LiveTransport, who: LiveWho): Impl {
    let mode: Mode | "new" = "new";
    let sent = 0,
      acked = 0,
      epoch = 0;
    let inflight: number[] = [];
    let hinted = false;
    // a web page keeps no copy of rows (its live link only re-reads what is on screen), so it is told the Space moved and sent no rows
    const tick = who.deviceClass === "web";
    // the stream waits here for a change with a field heavier than any frame, until the device has pulled it
    let blockedAt = 0;
    let lastRx = d.clock.now();
    let closed = false;
    const stopHb = d.clock.every(hbMs, () => {
      if (closed) return;
      if (d.clock.now() - lastRx >= deadMs) {
        close("silent");
        return;
      }
      send({ t: "hb", seq: d.head() });
    });
    const stopHello = d.clock.after(helloMs, () => {
      if (mode === "new") close("no hello");
    });

    const send = (f: Frame): void => {
      if (!closed) t.send(f);
    };
    function close(reason = "closed"): void {
      if (closed) return;
      closed = true;
      stopHb();
      stopHello();
      live.delete(self);
      try {
        t.close(reason);
      } catch {
        /* already closed */
      }
    }

    /**
     * The frames for one pull result, each under `frameMax`: the changes in order, packed by weight, and the hide rows on the first. A change too big for a frame alone goes as an upsert or patch of some
     * of its fields followed by patches of the rest, each piece but the last in a frame numbered just below the change (so a link that drops between pieces resumes from before it and gets it whole).
     * Returns the seq of a change with one field too big for any frame (nothing from it on is sent), or 0.
     */
    function sendEv(res: PullRes): number {
      const room = frameMax - FRAME_OVERHEAD;
      const frames: { seq: number; items: Change[]; hide?: Hide[] }[] = [];
      let items: Change[] = [];
      let bytes = res.hide.length ? weigh(res.hide) : 0;
      let stuck = 0;
      const emit = (seq: number, ch: Change[]): void => {
        frames.push({ seq, items: ch, ...(frames.length === 0 && res.hide.length ? { hide: res.hide } : {}) });
        items = [];
        bytes = 0;
      };
      const pack = (): void => {
        if (items.length) emit(items[items.length - 1]!.seq, items);
      };
      for (const c of res.changes) {
        const w = weigh(c);
        if (w <= room - bytes) {
          items.push(c);
          bytes += w;
          if (bytes >= evBytes) pack();
          continue;
        }
        pack();
        if (w <= room) {
          items.push(c);
          bytes = w;
          continue;
        }
        const base = weigh({ ...c, fields: {} });
        const pieces: Change["fields"][] = [];
        let part: Change["fields"] = {};
        let used = base;
        for (const [k, v] of Object.entries(c.fields)) {
          const fw = weigh(v) + k.length + 8;
          if (base + fw > room) {
            stuck = c.seq;
            break;
          }
          if (used + fw > room) {
            pieces.push(part);
            part = {};
            used = base;
          }
          part[k] = v;
          used += fw;
        }
        if (stuck) break;
        if (Object.keys(part).length) pieces.push(part);
        pieces.forEach((fields, i) =>
          emit(i === pieces.length - 1 ? c.seq : c.seq - 1, [{ ...c, op: i === 0 ? c.op : "patch", fields }]),
        );
      }
      pack();
      if (!frames.length && (res.hide.length || !stuck))
        frames.push({ seq: res.next, items: [], ...(res.hide.length ? { hide: res.hide } : {}) });
      if (!stuck && frames.length) frames[frames.length - 1]!.seq = Math.max(frames[frames.length - 1]!.seq, res.next);
      for (const f of frames) {
        send({ t: "ev", seq: f.seq, items: f.items, ...(f.hide ? { hide: f.hide } : {}) });
        inflight.push(f.seq);
      }
      return stuck;
    }

    function flush(): void {
      if (closed || mode !== "live") return;
      if (tick) {
        const head = d.head();
        if (head > sent && inflight.length < window) {
          send({ t: "ev", seq: head, items: [] });
          inflight.push(head);
          sent = head;
        }
        return;
      }
      if (blockedAt > 0) {
        if (acked < blockedAt) return;
        sent = Math.max(sent, acked);
        blockedAt = 0;
      }
      let stalled = false;
      for (;;) {
        if (inflight.length >= window) {
          stalled = true;
          break;
        }
        const res = d.pull(who, { cursor: sent, epoch, limit: batch }, evBytes);
        if (res.reset === "purge") {
          send({ t: "purge", epoch: res.epoch });
          close("purged");
          return;
        }
        if (res.changes.length || res.hide.length) {
          const stuck = sendEv(res);
          if (stuck) {
            // a field heavier than any frame: the device is told to pull that change itself, and the stream waits at it
            blockedAt = stuck;
            sent = stuck - 1;
            send({ t: "pull_hint", seq: d.head() });
            hinted = true;
            return;
          }
        }
        sent = Math.max(sent, res.next);
        if (!res.more) break;
      }
      if (stalled && !hinted) {
        hinted = true;
        send({ t: "pull_hint", seq: d.head() });
      }
    }

    function hello(h: Hello): void {
      const ok = decideMode(h, d.state(who));
      epoch = h.epoch;
      send({ t: "hello_ok", ok });
      mode = ok.mode;
      if (ok.mode === "purge") {
        send({ t: "purge", epoch: ok.epoch });
        close("purged");
        return;
      }
      if (ok.mode !== "live") return;
      // A device racing two endpoints holds two for a moment; a third means an old one is a ghost (a half-open link), so the oldest goes.
      const same = [...live].filter(
        (x) => x.who.person === who.person && x.who.device === who.device && x.mode() === "live",
      );
      for (const old of same.slice(0, Math.max(0, same.length - MAX_PER_DEVICE))) old.close("replaced");
      sent = tick ? Math.min(h.cursor, d.head()) : h.cursor;
      acked = h.cursor;
      inflight = [];
      hinted = false;
      blockedAt = 0;
      flush();
    }

    t.onFrame((raw) => {
      if (closed) return;
      lastRx = d.clock.now();
      const p = parseFrame(raw);
      if (!p.ok) {
        close(`bad frame: ${p.error}`);
        return;
      }
      const f = p.value;
      if (f.t === "hello") {
        hello(f.hello);
        return;
      }
      if (mode === "new") {
        close("frame before hello");
        return;
      }
      switch (f.t) {
        case "hb":
          send({ t: "hb", seq: d.head() });
          // a device that pulled a change the stream was waiting at says so in its heartbeat (its cursor)
          if (blockedAt > 0 && f.seq >= blockedAt && f.seq > acked) {
            acked = f.seq;
            inflight = inflight.filter((x) => x > acked);
            hinted = false;
            flush();
          }
          break;
        case "ack":
          if (f.seq > acked) {
            acked = f.seq;
            inflight = inflight.filter((s) => s > acked);
            hinted = false;
            flush();
          }
          break;
        case "op":
          void Promise.resolve(d.onOp?.(who, f.op)).catch(() => undefined);
          break;
        case "hello_ok":
        case "ev":
        case "pull_hint":
        case "purge":
          break;
        default:
          d.onFrame?.(who, f);
      }
    });
    t.onClose(() => close("peer closed"));

    const self: Impl = {
      who,
      flush,
      mode: () => mode,
      sent: () => sent,
      acked: () => acked,
      close,
      sendPurge(e) {
        send({ t: "purge", epoch: e });
        close("purged");
      },
    };
    live.add(self);
    return self;
  }

  return {
    accept: (t, who) => open(t, who),
    commit() {
      for (const s of [...live]) s.flush();
    },
    purge(person, epoch) {
      let n = 0;
      for (const s of [...live])
        if (s.who.person === person) {
          s.sendPurge(epoch);
          n++;
        }
      return n;
    },
    sessions: () => live.size,
    sessionsOf: (person, device) => [...live].filter((s) => s.who.person === person && s.who.device === device).length,
    close() {
      for (const s of [...live]) s.close("hub closed");
    },
  };
}
