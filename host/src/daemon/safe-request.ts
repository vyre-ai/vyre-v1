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
      // once the head is out the body is someone's stream, download or proxied answer: nothing is appended to it, the connection is cut
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: { code: "internal.unexpected", message: "Something went wrong on the server." } }));
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
    const fail = (e: unknown): void => {
      try {
        onError("upgrade", e);
      } catch {
        /* see above */
      }
      socket.destroy();
    };
    try {
      const out = fn(req, socket, head);
      if (out !== null && typeof out === "object" && typeof (out as Promise<unknown>).catch === "function")
        (out as Promise<unknown>).catch(fail);
    } catch (e) {
      fail(e);
    }
  };
}

/**
 * What may be written to a log from an error: the stack and the message with every address cut to its origin and path (a query can carry a token) and every long token-like run replaced. An upstream error can echo a URL
 * or a key in its message, so nothing from an error goes to a log unscrubbed.
 */
export function scrub(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+[^\s?#]*)[^\s]*/gi, "$1")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "[removed]")
    .slice(0, 4000);
}
/** An error as a log line carries it: the scrubbed message and the scrubbed stack. */
export function errorLine(e: unknown): { error: string; stack?: string } {
  if (e instanceof Error) return { error: scrub(e.message), ...(e.stack ? { stack: scrub(e.stack) } : {}) };
  return { error: scrub(String(e)) };
}

let backstop = false;
let sink: (error: unknown) => void = () => undefined;
let rejected = 0;
/** How many unhandled rejections this process has had: a number a status page or a test can read. */
export const rejectionCount = (): number => rejected;
const strict = (): boolean =>
  process.env["VYRE_STRICT_REJECTIONS"] === "1" || process.env["NODE_ENV"] === "test" || process.env["NODE_TEST_CONTEXT"] !== undefined;
/**
 * The last line: a promise that rejects with nothing waiting on it is counted and logged (scrubbed, with its stack) and the daemon goes on, where Node's default would end the process. The handler is installed once
 * and calls the newest logger given, so a second daemon in one process logs and a stopped one is not called. In a test process (NODE_ENV=test, the node test runner, or VYRE_STRICT_REJECTIONS=1) it throws again, so a stray
 * rejection still fails the test as it always did.
 */
export function installRejectionBackstop(onError: (error: unknown) => void): void {
  sink = onError;
  if (backstop) return;
  backstop = true;
  process.on("unhandledRejection", (reason) => {
    rejected += 1;
    try {
      sink(reason);
    } catch {
      /* logging never decides whether the daemon lives */
    }
    if (strict()) throw reason instanceof Error ? reason : new Error(String(reason));
  });
}
