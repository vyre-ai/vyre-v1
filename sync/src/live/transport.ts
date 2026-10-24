// The server end of a live link (ARCH 5.9): JSON frames in both directions, ordered, closable. The host's WebSocket handler, the relay channel and the in-memory link all fit it.
// The client end has the same shape (client/src/connection/transport.ts); the layers cannot import each other, so the two are declared twice and tested against each other.
export interface LiveTransport {
  send(frame: unknown): void;
  close(reason?: string): void;
  onFrame(cb: (frame: unknown) => void): void;
  onClose(cb: (reason: string) => void): void;
}

/** Time for the hub, behind a port so heartbeat tests run without waiting. */
export interface LiveClock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
}

export const systemClock: LiveClock = {
  now: () => Date.now(),
  every(ms, fn) { const h = setInterval(fn, ms); return () => clearInterval(h); },
  after(ms, fn) { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
};
