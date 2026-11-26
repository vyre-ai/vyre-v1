// The live stream of a terminal's screen (27 Nov 2026, rc.44), for a viewer in a browser tab or on a phone.
//   viewer -> Space  GET /terminals/<terminal>/ws  (WebSocket). Nothing secret is in the address: the first message is {t:"hello", ticket, rev?} with the ticket terminal.stream handed out (one use, sixty
//                    seconds, for this terminal only) and the number of the last change the viewer has, if it is coming back. The terminal module spends the ticket and answers with numbered changes: {t:"screen"}
//                    the whole screen, {t:"diff"} a change, {t:"ok"} when the viewer is current (modules/terminal/watch.ts). {t:"ping",seq} is answered {t:"pong",seq}; {t:"resync"} asks for the whole screen.
//   typing           does not go through here: it is terminal.keys, with its lease, number and key, so a repeat never types twice.
// A view is pinged and closed when nothing comes back, so one whose other end went away never holds a terminal's watcher; the person's views end when they lose access (endPerson).
import type http from "node:http";
import type { Duplex } from "node:stream";
import { acceptPeer as accept } from "../ws.ts";
import { safeUrl } from "../safe-url.ts";

const VIEW_PATH = /^\/terminals\/(trm_[A-Za-z0-9]{3,80})\/ws$/;
const MAX_VIEWER_MESSAGE = 4 * 1024;
const MAX_VIEWS = 64;
const HELLO_MS = 5_000;

export interface TerminalOpened {
  personId: string;
  stop(): void;
  resync(): void;
}
export interface TerminalStreamDeps {
  /** Spend the ticket for this terminal and join its watcher; `send` writes one JSON text to the viewer. Null when the ticket is not good. */
  open(
    terminalId: string,
    ticket: string,
    since: number | undefined,
    send: (text: string) => void,
  ): Promise<TerminalOpened | null>;
  now?: () => number;
  pingMs?: number;
  deadMs?: number;
  helloMs?: number;
}
export interface TerminalStream {
  claims(req: http.IncomingMessage): boolean;
  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  views(): number;
  /** The person can no longer watch: every view of theirs ends now. Returns how many. */
  endPerson(personId: string): number;
}

const refuseUpgrade = (socket: Duplex, status: string): void => {
  socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`);
};

export function createTerminalStream(deps: TerminalStreamDeps): TerminalStream {
  const PING_MS = deps.pingMs ?? 10_000;
  const DEAD_MS = deps.deadMs ?? 30_000;
  const HELLO = deps.helloMs ?? HELLO_MS;
  let views = 0;
  const open = new Set<{ personId: string; end(): void }>();
  return {
    claims(req) {
      return VIEW_PATH.test(safeUrl(req.url, "http://x").pathname);
    },
    upgrade(req, sock, head) {
      const m = VIEW_PATH.exec(safeUrl(req.url, "http://x").pathname);
      if (!m) return refuseUpgrade(sock, "404 Not Found");
      if (views >= MAX_VIEWS) return refuseUpgrade(sock, "429 Too Many Requests");
      const terminalId = m[1]!;
      const peer = accept(req, sock, head, MAX_VIEWER_MESSAGE);
      if (!peer) return;
      views += 1;
      let counted = true;
      const release = (): void => {
        if (counted) {
          counted = false;
          views -= 1;
        }
      };
      let opened: TerminalOpened | null = null;
      let helloing = false;
      const send = (text: string): void => {
        if (peer.open) peer.send(text);
      };
      const refuse = (reason: string): void => {
        send(JSON.stringify({ t: "refused", reason }));
        peer.close(1008);
      };
      // the ticket must come in the first message, soon: a socket that says nothing is closed
      const hello = setTimeout(() => {
        if (opened === null && !helloing) refuse("The first message must be the ticket.");
      }, HELLO);
      (hello as { unref?: () => void }).unref?.();
      const entry = {
        personId: "",
        end: () => {
          opened?.stop();
          peer.close(1008);
        },
      };
      const alive = setInterval(() => {
        if (!peer.open) {
          clearInterval(alive);
          return;
        }
        if (peer.heardAt && (deps.now ?? Date.now)() - peer.heardAt() >= DEAD_MS) {
          clearInterval(alive);
          peer.close(1001);
          return;
        }
        peer.ping?.();
      }, PING_MS);
      (alive as { unref?: () => void }).unref?.();
      peer.onClose(() => {
        clearTimeout(hello);
        clearInterval(alive);
        opened?.stop();
        opened = null;
        open.delete(entry);
        release();
      });
      peer.onMessage((data, binary) => {
        if (binary) return;
        let msg: { t?: unknown; ticket?: unknown; rev?: unknown; seq?: unknown };
        try {
          msg = JSON.parse(data.toString("utf8")) as typeof msg;
        } catch {
          return;
        }
        if (msg.t === "ping") {
          send(JSON.stringify({ t: "pong", seq: typeof msg.seq === "number" ? msg.seq : 0 }));
          return;
        }
        if (msg.t === "resync") {
          opened?.resync();
          return;
        }
        if (msg.t !== "hello" || opened !== null || helloing) return;
        if (typeof msg.ticket !== "string" || msg.ticket === "")
          return refuse("This view needs a live ticket for this terminal.");
        helloing = true;
        const since = typeof msg.rev === "number" && Number.isInteger(msg.rev) && msg.rev >= 0 ? msg.rev : undefined;
        void deps
          .open(terminalId, msg.ticket, since, send)
          .then(
            (o) => {
              if (!o) return refuse("This view needs a live ticket for this terminal.");
              if (!peer.open) {
                o.stop();
                return;
              }
              opened = o;
              entry.personId = o.personId;
              open.add(entry);
            },
            () => refuse("The terminal did not open its view."),
          )
          .finally(() => {
            clearTimeout(hello);
          });
      });
    },
    views: () => views,
    endPerson(personId) {
      let n = 0;
      for (const e of [...open])
        if (e.personId === personId) {
          open.delete(e);
          e.end();
          n++;
        }
      return n;
    },
  };
}
