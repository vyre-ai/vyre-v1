// Vyre for Chrome connected straight to this Space: the socket at /chrome/v1/socket. The extension dials it at the Space's web address with a device session of its own
// (identity.pair_redeem), so a person needs no Vyre app on the computer. Everything past the upgrade is lib/chrome-socket.ts: the same bridge and the same operations the desktop
// app's daemon runs, every call made as the session's person through this Space's own gateway.
//
// The session token travels in the first frame, never in the address (an address is written to logs and shown in a console). A page of a web site cannot use this socket: it holds
// no session, and a connection that names a web origin is turned away before the upgrade.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { gatewayCall } from "../../../lib/chrome-app.ts";
import type { AgentEvent } from "../../../lib/chrome-bridge.ts";
import { createChromeSocket, type ChromeSocket, type DirectSession } from "../../../lib/chrome-socket.ts";
import { acceptPeer, MAX_FRAME_BYTES } from "../ws.ts";

export const CHROME_SOCKET_PATH = "/chrome/v1/socket";

export interface ChromeDirectDeps {
  /** The live device session a token belongs to (never the admin token), or null. */
  resolve(token: string): DirectSession | null;
  spaceName(): Promise<string> | string;
  /** The address people reach this Space at. */
  address(): string;
  /** This daemon's own gateway on loopback: calls are made there with the person's session, exactly as their app makes them. */
  gateway(): string;
  onEvent?(session: DirectSession, event: AgentEvent): void;
  appVersion?: string;
  fetch?: typeof fetch;
}

/** An extension's own origin, or none (a program that is not a browser page). A web page's origin is refused. */
export function originAllowed(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true;
  return typeof origin === "string" && /^(chrome|moz)-extension:\/\/[a-z0-9-]{8,64}$/.test(origin);
}

export function createChromeDirectRoute(d: ChromeDirectDeps): {
  claims(req: http.IncomingMessage): boolean;
  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  socket: ChromeSocket;
  close(): void;
} {
  const socket = createChromeSocket({
    resolve: d.resolve,
    spaceName: d.spaceName,
    address: d.address,
    call: (token, cap, input) =>
      gatewayCall({ id: "", name: "", address: d.gateway(), token }, cap, input, d.fetch ? { fetch: d.fetch } : {}),
    ...(d.onEvent ? { onEvent: d.onEvent } : {}),
    ...(d.appVersion ? { appVersion: d.appVersion } : {}),
  });
  return {
    socket,
    claims: (req) => (req.url ?? "").split("?")[0] === CHROME_SOCKET_PATH,
    upgrade(req, sock, head) {
      if (!originAllowed(req.headers["origin"])) {
        sock.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
        return;
      }
      const peer = acceptPeer(req, sock, head, MAX_FRAME_BYTES);
      if (!peer) return;
      socket.accept({
        send: (text) => peer.send(text),
        close: (code) => peer.close(code ?? 1000),
        onMessage: (f) => peer.onMessage(f),
        onClose: (f) => peer.onClose(f),
        get open() {
          return peer.open;
        },
      });
    },
    close: () => socket.close(),
  };
}
