// The open line to browserd (lane r42-computer, 19 Nov 2026). Every call used to be `docker exec <container> ctl ...`: an exec and a new Node process, 131 ms before the call did anything. The server
// now asks `ctl channel` once for a key and then posts each call to browserd's own port: POST /control with the key in `x-vyre-control`, the body {action, args}, the answer the same object `ctl` prints.
//
// Who may call. The key is handed out only through `ctl`, so whoever holds one could already run `ctl` in this container: the trust line of modules/computers/sbrowser/docker.ts does not move. Every
// agent's pages share this container's loopback with the port, so a page is kept out twice: it cannot know a key (32 random bytes, compared in constant time), and a request that names an Origin, which
// every page's request does, is refused before the key is looked at. Keys live in memory only: a browserd that restarts has none, answers 401, and the server asks `ctl` for a new one.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentError } from "../../agent-computer/agentd/errors.ts";

type Args = Record<string, unknown>;

export interface ControlDeps {
  /** The same actions `ctl` reaches (main.ts dispatch). */
  dispatch(action: string, args: Args): Promise<Args>;
  /** Something asked browserd: it is not an orphan. */
  asked(): void;
  /** The largest body taken, in bytes. Default 12 MB, the control socket's own limit. */
  maxBody?: number;
  /** How many keys are good at once (two daemons on one engine share the container; each asks again after its own restart). Default 8; the oldest goes first. */
  maxKeys?: number;
}

export interface Control {
  /** A new key, for `ctl channel`. */
  mint(): string;
  has(key: string): boolean;
  /** Answers POST /control and returns true; any other request is not its own and returns false. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
}

/** What a refusal looks like on either line: the control socket (`ctl`) and POST /control print the same object. */
export function refusalOf(e: unknown): Args {
  if (e instanceof AgentError)
    return {
      ok: false,
      code: e.code,
      message: e.message,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.start !== undefined ? { start: e.start } : {}),
    };
  return { ok: false, code: "unavailable", message: e instanceof Error ? e.message : "the browser failed" };
}

export function createControl(d: ControlDeps): Control {
  const maxBody = d.maxBody ?? 12 * 1024 * 1024;
  const maxKeys = d.maxKeys ?? 8;
  const keys: Buffer[] = [];
  const has = (key: string): boolean => {
    const got = Buffer.from(key, "utf8");
    let found = false;
    // every key is compared, whatever the first ones say, so the time taken tells nothing
    for (const k of keys) if (k.length === got.length && timingSafeEqual(k, got)) found = true;
    return found;
  };
  const send = (res: ServerResponse, status: number, body: Args): void => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
      // one call, one connection: the server never reuses one, so a call is never written to a connection browserd has just closed (which could not be told from a call that was done)
      connection: "close",
    });
    res.end(text);
  };
  return {
    mint() {
      const k = randomBytes(32).toString("hex");
      keys.push(Buffer.from(k, "utf8"));
      while (keys.length > maxKeys) keys.shift();
      return k;
    },
    has,
    handle(req, res) {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/control") return false;
      if (req.method !== "POST") {
        send(res, 405, { ok: false, code: "bad_input", message: "The control line takes POST." });
        return true;
      }
      if (req.headers["origin"] !== undefined) {
        send(res, 403, { ok: false, code: "unavailable", message: "The control line is not for pages." });
        return true;
      }
      const key = req.headers["x-vyre-control"];
      if (typeof key !== "string" || !has(key)) {
        send(res, 401, { ok: false, code: "unavailable", message: "This needs a key from ctl." });
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBody) over = true;
        else chunks.push(c);
      });
      req.on("error", () => undefined);
      req.on("end", () => {
        if (over) {
          send(res, 413, { ok: false, code: "bad_input", message: "That call is too large to send to the browser." });
          return;
        }
        let msg: { action?: unknown; args?: unknown };
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action?: unknown; args?: unknown };
          if (typeof msg !== "object" || msg === null) throw new Error("not an object");
        } catch {
          send(res, 400, { ok: false, code: "bad_input", message: "not JSON" });
          return;
        }
        d.asked();
        const args = (typeof msg.args === "object" && msg.args !== null ? msg.args : {}) as Args;
        d.dispatch(String(msg.action ?? ""), args).then(
          (result) => send(res, 200, { ok: true, result }),
          (e: unknown) => send(res, 200, refusalOf(e)),
        );
      });
      return true;
    },
  };
}
