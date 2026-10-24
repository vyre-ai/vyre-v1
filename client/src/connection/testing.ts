// A fake server for the connection tests: it answers hello, counts sockets, and lets a test push frames, go quiet or refuse a dial. No node imports, so it runs in any layer that may import the client.
import { memoryLink } from "./memory.ts";
import type { MemoryLink } from "./memory.ts";
import type { Endpoint } from "./endpoints.ts";
import type { ManualScheduler } from "./scheduler.ts";
import type { Dial } from "./transport.ts";

export interface FakeSocket { url: string; link: MemoryLink; hellos: { cursor: number; deviceId: string }[]; received: unknown[] }

export interface FakeServer {
  dial: Dial;
  sockets: FakeSocket[];
  /** Sockets that are open now. */
  open(): number;
  openAt(url: string): number;
  /** Refuse dials to this url (or allow them again). */
  refuse(url: string, on?: boolean): void;
  /** Hold back hello_ok on this url until released (a slow endpoint). */
  slow(url: string, on?: boolean): void;
  /** Answer hello with this mode. */
  mode: "live" | "update_required" | "resync" | "purge";
  /** Send a frame on every open socket. */
  broadcast(frame: unknown): void;
  /** Make the url go dark: nothing crosses in either direction on its sockets, and new ones are dark too. */
  blackhole(url: string, on?: boolean): void;
  /** Frames the server received of one type. */
  got(t: string): unknown[];
}

export function fakeServer(): FakeServer {
  const refused = new Set<string>();
  const slowed = new Set<string>();
  const dark = new Set<string>();
  const waiting: (() => void)[] = [];
  const s: FakeServer = {
    sockets: [],
    mode: "live",
    open: () => s.sockets.filter((x) => x.link.isOpen()).length,
    openAt: (url) => s.sockets.filter((x) => x.url === url && x.link.isOpen()).length,
    refuse(url, on = true) { if (on) refused.add(url); else refused.delete(url); },
    slow(url, on = true) {
      if (on) slowed.add(url);
      else { slowed.delete(url); for (const w of waiting.splice(0)) w(); }
    },
    broadcast(frame) { for (const x of s.sockets) if (x.link.isOpen()) x.link.server.send(frame); },
    blackhole(url, on = true) {
      if (on) dark.add(url); else dark.delete(url);
      for (const x of s.sockets) if (x.url === url) x.link.blackhole(on);
    },
    got: (t) => s.sockets.flatMap((x) => x.received).filter((f) => (f as { t?: string }).t === t),
    dial: async (ep: Endpoint) => {
      if (refused.has(ep.url)) throw new Error(`refused ${ep.url}`);
      const link = memoryLink();
      if (dark.has(ep.url)) link.blackhole(true);
      const sock: FakeSocket = { url: ep.url, link, hellos: [], received: [] };
      s.sockets.push(sock);
      link.server.onFrame((f) => {
        sock.received.push(f);
        const frame = f as { t?: string; hello?: { cursor: number; deviceId: string } };
        if (frame.t === "hello" && frame.hello) {
          sock.hellos.push({ cursor: frame.hello.cursor, deviceId: frame.hello.deviceId });
          const answer = () => link.server.send({ t: "hello_ok", ok: { serverVersion: "test", epoch: 0, serverHlc: "000000000001-0000-srv", mode: s.mode, head: 0, entityVersions: {} } });
          if (slowed.has(ep.url)) waiting.push(answer); else answer();
        } else if (frame.t === "hb") link.server.send({ t: "hb", seq: 0 });
      });
      return link.client;
    },
  };
  return s;
}

/** Let promises and microtask-delivered frames run. */
export async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

/**
 * Move the manual clock forward in small steps, letting frames and promises run between them. Advancing a long way in one call would run every heartbeat check before a single reply could arrive,
 * which no real clock does.
 */
export async function elapse(sched: ManualScheduler, ms: number, step = 5000): Promise<void> {
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    sched.advance(d);
    left -= d;
    await settle();
  }
}
