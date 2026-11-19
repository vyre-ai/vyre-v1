// Vyre for Chrome connected straight to a Space, with no Vyre app on the computer: the Space's side of one socket per signed-in extension. One pure module (no node imports): the
// daemon's route (host/src/routes/chrome-direct.ts) hands it accepted sockets, and the tests hand it fakes.
//
// The wire is the native host's wire (apps/chrome/src/worker/protocol.js), as JSON text frames, so the extension runs one protocol over two transports:
//
//   ext -> space   { type: "hello", token }                         the first frame, within ten seconds: the extension's OWN device session for this Space (identity.pair_redeem)
//   space -> ext   { type: "ready", space: { id, name }, person }   or { type: "refused", code } and the socket closes with 4401
//   ext -> space   { id, type: "invoke" | "bridge", ... }           exactly as over the native host
//   space -> ext   { id, ok, output | error }, and the pushes (fill, chat.delta, agent.call ...)
//   space -> ext   { type: "ping" } every 20 s; the extension answers { type: "pong" }. A message is what keeps a Manifest V3 worker awake, so this is also the keepalive.
//
// Behind every socket sit the same two modules the desktop app's daemon runs: lib/chrome-bridge.ts (requests, pushes, agent calls) and lib/chrome-app.ts (the operations, built from
// capability calls). Every call is made as the person the session belongs to, through the Space's own gateway with that session, so access, rate limits and the audit trail are the
// ordinary ones. The daemon's admin token is never accepted here: only a device session.
//
// A Vault fill into a page (vault.fill with a `browser` target) is delivered down the socket whose extension minted the ref, and only when the fill ran for that socket's person.
// The value passes through this module for one push and is never kept.

import { createChromeApp } from "./chrome-app.ts";
import { createChromeBridge, type AgentEvent, type ChromeBridge } from "./chrome-bridge.ts";

export const HELLO_MS = 10_000;
export const PING_MS = 20_000;
export const SILENT_MS = 65_000;
export const FILL_REF_MS = 30_000;
/** Close codes the extension reads: replaced by a newer socket of the same session, not signed in, signed out or revoked. */
export const CLOSE = Object.freeze({ replaced: 4000, unauthenticated: 4401, revoked: 4403 });

/** The parts of an accepted WebSocket this module uses (host/src/ws.ts Peer satisfies it). */
export interface SocketPeer {
  send(text: string): boolean;
  close(code?: number): void;
  onMessage(f: (data: { toString(): string }, binary: boolean) => void): void;
  onClose(f: () => void): void;
  readonly open: boolean;
}

/** A live device session: whom the token speaks for. */
export interface DirectSession {
  sessionId: string;
  person: string;
  device: string;
  space: string;
}

export interface ChromeSocketDeps {
  /** The live device session a token belongs to; null when it is unknown or revoked, or its person is not active. Never the daemon's admin token. */
  resolve(token: string): DirectSession | null;
  /** The Space's name, for the extension's Space switcher. */
  spaceName(): Promise<string> | string;
  /** The address people reach this Space at, for "open the web app". */
  address(): string;
  /** One capability call with that session, through the Space's gateway. Throws with the gateway's error code. */
  call(token: string, cap: string, input: Record<string, unknown>): Promise<unknown>;
  /** An event from the extension about an agent driving a tab. */
  onEvent?(session: DirectSession, event: AgentEvent): void;
  appVersion?: string;
  now?: () => number;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  setEvery?: (f: () => void, ms: number) => unknown;
  clearEvery?: (t: unknown) => void;
}

interface Conn {
  peer: SocketPeer;
  session: DirectSession;
  token: string;
  bridge: ChromeBridge;
  heard: number;
  tick: unknown;
  detach: () => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createChromeSocket(deps: ChromeSocketDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const setEvery = deps.setEvery ?? ((f, ms) => setInterval(f, ms));
  const clearEvery = deps.clearEvery ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  /** One socket per device session: a newer one replaces the older. */
  const conns = new Map<string, Conn>();
  /** Fill refs an extension handed out, and the socket each came from. A ref is good for one delivery. */
  const refs = new Map<string, { conn: Conn; expires: number }>();

  function drop(c: Conn, code?: number): void {
    if (conns.get(c.session.sessionId) === c) conns.delete(c.session.sessionId);
    clearEvery(c.tick);
    c.detach();
    c.bridge.failAll();
    for (const [ref, r] of refs) if (r.conn === c) refs.delete(ref);
    if (code !== undefined && c.peer.open) c.peer.close(code);
  }

  function open(peer: SocketPeer, session: DirectSession, token: string): Conn {
    let name = "";
    const app = createChromeApp({
      sessions: () => [{ id: session.space, name, address: deps.address(), token }],
      call: (s, cap, input) => deps.call(s.token, cap, input),
      push: (m) => {
        bridge.push(m);
      },
      ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
    });
    const bridge = createChromeBridge({
      // the HTTP routes of the bridge are never mounted for a socket; a value nobody can present
      token: `unused-${session.sessionId}-${now()}`,
      invoke: async (cap, input) => {
        const target = isObject(input["target"]) ? input["target"] : null;
        const ref = cap === "vault.fill" && target && target["kind"] === "browser" ? target["ref"] : null;
        if (typeof ref !== "string") return app.invoke(cap, input);
        if (ref.length < 16 || ref.length > 120)
          throw Object.assign(new Error("Not a field."), { code: "bad_request" });
        for (const [k, r] of refs) if (r.expires < now()) refs.delete(k);
        refs.set(ref, { conn: c, expires: now() + FILL_REF_MS });
        try {
          return await app.invoke(cap, input);
        } finally {
          refs.delete(ref);
        }
      },
      op: (op, input) => app.op(op, input),
      onEvent: (e) => deps.onEvent?.(session, e),
    });
    const c: Conn = { peer, session, token, bridge, heard: now(), tick: null, detach: () => undefined };
    c.detach = bridge.attach((line) => {
      peer.send(line.trimEnd());
    });
    const old = conns.get(session.sessionId);
    if (old) drop(old, CLOSE.replaced);
    conns.set(session.sessionId, c);
    c.tick = setEvery(() => {
      // signed out in Settings, or the person was suspended: the socket ends at the next beat, and every call before it is refused by the gateway
      if (!deps.resolve(token)) return drop(c, CLOSE.revoked);
      if (now() - c.heard > SILENT_MS) return drop(c, CLOSE.replaced);
      peer.send('{"type":"ping"}');
    }, PING_MS);
    void Promise.resolve()
      .then(() => deps.spaceName())
      .catch(() => "")
      .then((n) => {
        name = String(n || "Space");
        peer.send(JSON.stringify({ type: "ready", space: { id: session.space, name }, person: session.person }));
      });
    return c;
  }

  return {
    /** A socket the route accepted: nothing is answered until its first frame names a live device session. */
    accept(peer: SocketPeer): void {
      let conn: Conn | null = null;
      const late = setTimer(() => {
        if (!conn) peer.close(CLOSE.unauthenticated);
      }, HELLO_MS);
      peer.onMessage((data, binary) => {
        if (binary) return;
        let m: unknown;
        try {
          m = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!isObject(m)) return;
        if (!conn) {
          const token = m["type"] === "hello" && typeof m["token"] === "string" ? m["token"] : "";
          const session = token ? deps.resolve(token) : null;
          clearTimer(late);
          if (!session) {
            peer.send('{"type":"refused","code":"signed_out"}');
            peer.close(CLOSE.unauthenticated);
            return;
          }
          conn = open(peer, session, token);
          return;
        }
        conn.heard = now();
        if (m["type"] === "pong" || m["type"] === "hello") return;
        const c = conn;
        void c.bridge.rpc(m).then((reply) => {
          if (c.peer.open) c.peer.send(JSON.stringify(reply));
        });
      });
      peer.onClose(() => {
        clearTimer(late);
        if (conn) drop(conn);
      });
    },

    /**
     * The Vault's `browser` fill place: deliver one value to the field whose ref an extension minted for the call that is running now. False when nobody waits for that ref, or
     * when the fill ran for someone other than the person that extension is signed in as.
     */
    fill(ref: string, value: string, who: { kind: string; id: string; actingFor?: string | undefined }): boolean {
      const r = refs.get(ref);
      refs.delete(ref);
      if (!r || r.expires < now() || !r.conn.peer.open) return false;
      const person = who.kind === "person" ? who.id : who.actingFor;
      if (person !== r.conn.session.person) return false;
      return r.conn.bridge.push({ type: "fill", ref, value }) > 0;
    },

    /** The bridge of the extension a person is connected with (the newest when they have several), for agent calls into their Chrome. */
    bridgeOf(person: string): ChromeBridge | null {
      let found: Conn | null = null;
      for (const c of conns.values()) if (c.session.person === person && c.peer.open) found = c;
      return found ? found.bridge : null;
    },

    /** Sockets open now. */
    get connected(): number {
      return conns.size;
    },

    /** The daemon is stopping: every socket ends. */
    close(): void {
      for (const c of [...conns.values()]) drop(c, 1001);
      refs.clear();
    },
  };
}

export type ChromeSocket = ReturnType<typeof createChromeSocket>;
