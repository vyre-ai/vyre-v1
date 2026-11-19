// No request can take the daemon down (lane r42-mcp, 19 Nov 2026). Everything the daemon does with a request before a route claims it (reading headers, the visitor the relay vouched for, the guards)
// runs inside this: a throw there, or a promise that rejects, answers 500 and is logged, and the daemon stays up for the next request. An upgrade that throws closes its socket.
import type http from "node:http";
import type { Duplex } from "node:stream";

export type OnError = (where: "request" | "upgrade", error: unknown) => void;

export function guardRequest(
  fn: (req: http.IncomingMessage, res: http.ServerResponse) => unknown,
  onError: OnError,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const fail = (e: unknown, res: http.ServerResponse): void => {
    try {
      onError("request", e);
    } catch {
      /* logging never decides whether the answer goes out */
    }
    try {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      if (!res.writableEnded) res.end(JSON.stringify({ error: { code: "internal.unexpected", message: "Something went wrong on the server." } }));
    } catch {
      res.destroy();
    }
  };
  return (req, res) => {
    try {
      const out = fn(req, res);
      if (out !== null && typeof out === "object" && typeof (out as Promise<unknown>).catch === "function")
        (out as Promise<unknown>).catch((e: unknown) => fail(e, res));
    } catch (e) {
      fail(e, res);
    }
  };
}

export function guardUpgrade(
  fn: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => unknown,
  onError: OnError,
): (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    try {
      fn(req, socket, head);
    } catch (e) {
      try {
        onError("upgrade", e);
      } catch {
        /* see above */
      }
      socket.destroy();
    }
  };
}
