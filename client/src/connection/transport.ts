// A live link to one endpoint (ARCH 5.9): JSON frames in both directions, ordered, closable. A WebSocket, a relay channel and the in-memory pair below all fit it.
import type { Endpoint } from "./endpoints.ts";

export interface Transport {
  send(frame: unknown): void;
  close(reason?: string): void;
  onFrame(cb: (frame: unknown) => void): void;
  onClose(cb: (reason: string) => void): void;
}

/** Open a transport to an endpoint. Rejects when it cannot; the manager treats that as the endpoint being down. */
export type Dial = (endpoint: Endpoint, signal: AbortSignal) => Promise<Transport>;
