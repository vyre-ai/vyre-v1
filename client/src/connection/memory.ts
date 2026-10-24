// from vyre 0.6.9 kernel/remote/memory-transport.js@7cabde80e (the idea: an in-memory stand-in for the connection where everything crosses as JSON text, as on a wire; rewritten for frames)
// A pair of linked transports for tests and for a home that serves a device on the same machine. Delivery is asynchronous (a microtask), in order, and every frame is JSON-copied.
import type { Transport } from "./transport.ts";

export interface MemoryLink {
  /** The device end and the server end. */
  client: Transport;
  server: Transport;
  /** Frames sent by each side, as JSON text. */
  sent: { client: string[]; server: string[] };
  /** Stop delivering in both directions without closing: the link has gone quiet, as when a network path dies. */
  blackhole(on?: boolean): void;
  /** Close both ends. */
  cut(reason?: string): void;
  isOpen(): boolean;
}

export function memoryLink(): MemoryLink {
  let open = true;
  let dark = false;
  const sent = { client: [] as string[], server: [] as string[] };
  const ends: { a: End; b: End } = { a: end("client"), b: end("server") };
  function end(name: "client" | "server") {
    return { name, frame: null as ((f: unknown) => void) | null, closed: null as ((r: string) => void) | null };
  }
  type End = ReturnType<typeof end>;
  const make = (me: End, peer: End): Transport => ({
    send(frame) {
      if (!open) return;
      const text = JSON.stringify(frame);
      sent[me.name].push(text);
      if (dark) return;
      // A frame sent before a close is delivered before the close is seen, as on a socket; only a path that has gone dark swallows it.
      queueMicrotask(() => { if (!dark) peer.frame?.(JSON.parse(text) as unknown); });
    },
    close(reason = "closed") { cut(reason); },
    onFrame(cb) { me.frame = cb; },
    onClose(cb) { me.closed = cb; },
  });
  function cut(reason = "closed"): void {
    if (!open) return;
    open = false;
    queueMicrotask(() => { ends.a.closed?.(reason); ends.b.closed?.(reason); });
  }
  return {
    client: make(ends.a, ends.b),
    server: make(ends.b, ends.a),
    sent,
    blackhole(on = true) { dark = on; },
    cut,
    isOpen: () => open,
  };
}
